import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { release, defaultScopes } from './settings';
import { Client, ApiError, serviceOrigin } from '../../../sdk/typescript/src/client';
import { z } from 'zod';

export type Profile = {
  origin: string;
  organization?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
};
type ProfileStore = { version: 1; defaultProfile: string; profiles: Record<string, Profile> };
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().max(86400),
  scope: z.string().optional(),
});
const deviceSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number().positive().max(1800),
  interval: z.number().positive().optional(),
});
const profileName = (name: string) => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name))
    throw new Error('Use a short profile name containing letters, numbers, underscores or hyphens.');
  return name;
};
async function secured(target: string, directory = false) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
    throw new Error(`Refusing unsafe credential path: ${target}`);
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    throw new Error(`Credential path must be owned by you and private: ${target}`);
}
async function secureDirectory() {
  await mkdir(release.configDirectory, { recursive: true, mode: 0o700 });
  await secured(release.configDirectory, true);
  if (process.platform === 'win32') {
    // Windows mode bits are not ACLs. Explicitly limit this application's credential directory to the current user.
    const script =
      "$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:AGENT_CREDENTIAL_DIRECTORY -AclObject $acl";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { env: { ...process.env, AGENT_CREDENTIAL_DIRECTORY: release.configDirectory }, stdio: 'ignore' },
      );
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Could not secure the Windows credential directory.')),
      );
    });
  }
}
async function store(): Promise<ProfileStore> {
  await secureDirectory();
  const file = path.join(release.configDirectory, 'profiles.json');
  try {
    await secured(file);
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1) throw new Error('Unsupported credential format.');
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, defaultProfile: 'default', profiles: {} };
    throw error;
  }
}
async function writeStore(value: ProfileStore) {
  await secureDirectory();
  const target = path.join(release.configDirectory, 'profiles.json'),
    temp = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, target);
}
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  await secureDirectory();
  const lock = path.join(release.configDirectory, 'profiles.lock');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const handle = await open(lock, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, created: Date.now() }));
      await handle.close();
      try {
        return await fn();
      } finally {
        await rm(lock, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(lock, 'utf8'));
        if (Date.now() - owner.created > 120000) {
          try {
            process.kill(owner.pid, 0);
          } catch (dead) {
            if ((dead as NodeJS.ErrnoException).code === 'ESRCH') {
              await rm(lock, { force: true });
              continue;
            }
          }
        }
      } catch {
        /* Another process may still be creating its lock. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Another CLI process is refreshing credentials. Try again shortly.');
}
export async function saveProfile(name: string, value: Profile) {
  profileName(name);
  serviceOrigin(value.origin);
  await locked(async () => {
    const data = await store();
    data.profiles[name] = value;
    data.defaultProfile = name;
    await writeStore(data);
  });
}
export async function selectedProfile(name?: string) {
  const data = await store();
  const selected = profileName(name || data.defaultProfile);
  const profile = data.profiles[selected];
  if (!profile)
    throw new ApiError(401, 'login_required', `Run ${release.executable} login --profile ${selected} first.`);
  return { name: selected, profile };
}
export async function tokenFor(name: string): Promise<string> {
  return locked(async () => {
    const { profile } = await selectedProfile(name);
    if (profile.apiKey) return profile.apiKey;
    if (profile.accessToken && profile.expiresAt! > Date.now() + 60000) return profile.accessToken;
    if (!profile.refreshToken) throw new ApiError(401, 'login_required', 'The login expired. Sign in again.');
    const result = tokenSchema.parse(
      await oauthRequest(profile.origin, '/auth/oauth2/token', {
        grant_type: 'refresh_token',
        refresh_token: profile.refreshToken,
        client_id: release.clientId,
        resource: `${profile.origin}/v1`,
      }),
    );
    const data = await store();
    data.profiles[name] = {
      ...profile,
      accessToken: result.access_token,
      refreshToken: result.refresh_token || profile.refreshToken,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    await writeStore(data);
    return result.access_token;
  });
}
export async function oauthRequest(
  origin: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(serviceOrigin(origin) + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const result = z.record(z.string(), z.unknown()).parse(await response.json());
  if (!response.ok)
    throw new ApiError(
      response.status,
      String(result.error || result.code || 'oauth_error'),
      String(result.error_description || result.message || 'Authentication failed.'),
    );
  return result;
}
export async function deviceLogin(options: {
  origin: string;
  profile: string;
  scope?: string[];
  onCode: (url: string, code: string) => void | Promise<void>;
  signal?: AbortSignal;
}) {
  const origin = serviceOrigin(options.origin);
  const scope = [...new Set([...defaultScopes, ...(options.scope || [])])];
  const device = deviceSchema.parse(
    await oauthRequest(origin, '/auth/device/code', {
      client_id: release.clientId,
      scope: scope.join(' '),
      resource: `${origin}/v1`,
    }),
  );
  const verification = new URL(device.verification_uri_complete || device.verification_uri, origin);
  if (verification.origin !== origin)
    throw new Error('The server returned a verification URL outside the approved service origin.');
  await options.onCode(verification.toString(), String(device.user_code));
  let interval = Math.max(1, Number(device.interval) || 5);
  const deadline = Date.now() + Math.min(1800, Number(device.expires_in) || 600) * 1000;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    try {
      const tokens = tokenSchema.parse(
        await oauthRequest(origin, '/auth/oauth2/token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
          client_id: release.clientId,
          resource: `${origin}/v1`,
        }),
      );
      const profile: Profile = {
        origin,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
        scopes: String(tokens.scope || scope.join(' ')).split(' '),
      };
      await new Client({ baseURL: origin, token: profile.accessToken! }).request('getIdentity');
      await saveProfile(options.profile, profile);
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'authorization_pending') continue;
      if (error instanceof ApiError && error.code === 'slow_down') {
        interval += 5;
        continue;
      }
      throw error;
    }
  }
  throw new ApiError(401, 'device_code_expired', 'The login code expired. Start login again.');
}
export async function logout(name?: string) {
  const { name: selected, profile } = await selectedProfile(name);
  let revoked = false;
  if (profile.refreshToken)
    try {
      await oauthRequest(profile.origin, '/auth/oauth2/revoke', {
        token: profile.refreshToken,
        client_id: release.clientId,
        token_type_hint: 'refresh_token',
      });
      revoked = true;
    } catch {
      revoked = false;
    }
  await locked(async () => {
    const data = await store();
    delete data.profiles[selected];
    await writeStore(data);
  });
  return { removed: true, revoked };
}
export async function profileSummaries() {
  const data = await store();
  return {
    defaultProfile: data.defaultProfile,
    profiles: Object.entries(data.profiles).map(([name, p]) => ({
      name,
      origin: p.origin,
      organization: p.organization,
      authentication: p.apiKey ? 'API key' : 'OAuth',
      scopes: p.scopes,
    })),
  };
}
