import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

export function stagingReleaseSettings(env: Record<string, string | undefined>) {
  const value = z
    .object({
      RELEASE_SHA: z.string().regex(/^[a-f0-9]{40}$/),
      VERCEL_ORG_ID: z.string().min(1),
      VERCEL_PROJECT_ID: z.string().min(1),
      PRODUCTION_PROJECT_ID: z.string().min(1),
      VERCEL_TEAM_SLUG: z.string().regex(/^[a-z0-9-]+$/),
      VERCEL_PROJECT_NAME: z.string().regex(/^[a-z0-9-]+$/),
      STAGING_ORIGIN: z.url(),
      STAGING_API_KEY: z.string().min(1),
      VERCEL_TOKEN: z.string().min(1),
      GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      MIGRATION_DATABASE_URL: z.url(),
      DATABASE_URL: z.url(),
      AUTH_DATABASE_URL: z.url(),
      AUTH_SECRET: z.string().min(32),
      VAULT_KEY: z.string().min(32),
      APP_ORIGIN: z.url(),
      PLATFORM_MODE: z.literal('production'),
      ALLOW_PAID_EXECUTION: z.literal('false'),
    })
    .parse(env);
  if (value.VERCEL_PROJECT_ID === value.PRODUCTION_PROJECT_ID)
    throw new Error('Staging must not select the production project.');
  if (new URL(value.STAGING_ORIGIN).protocol !== 'https:') throw new Error('Staging requires HTTPS.');
  if (value.APP_ORIGIN !== value.STAGING_ORIGIN) throw new Error('Application origin must match staging.');
  return value;
}
export function readyRuntime(value: unknown) {
  return z
    .object({
      manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      status: z.literal('ready'),
      arch: z.literal('amd64'),
    })
    .parse(value);
}
export async function checkStaging(origin: string, credential: string, bypass?: string) {
  const headers = { ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
  for (const path of ['/health', '/openapi.json', '/docs/mcp']) {
    const response = await fetch(`${origin}${path}`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Staging readiness failed: ${path} (${response.status})`);
    if (path === '/health' && (await response.json()).status !== 'ok')
      throw new Error('Staging is not ready.');
    if (!response.bodyUsed) await response.body?.cancel();
  }
  const response = await fetch(`${origin}/v1/me`, {
    headers: { ...headers, Authorization: `Bearer ${credential}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Staging authentication failed (${response.status}).`);
  if (!response.bodyUsed) await response.body?.cancel();
}
async function command(program: string, args: string[]) {
  const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${program} failed (${code}).`)),
    );
  });
  return output.trim();
}
export async function releaseStaging(env = process.env, run = command) {
  const s = stagingReleaseSettings(env);
  const cli = (...args: string[]) =>
    run('pnpm', ['dlx', 'vercel@59.11.7', ...args, '--scope', s.VERCEL_TEAM_SLUG]);
  async function currentRevision() {
    const head = await run('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/commits/main`, '--jq', '.sha']);
    if (head !== s.RELEASE_SHA) throw new Error('A newer main revision exists. Refusing stale release.');
  }
  await currentRevision();
  if ((await run('git', ['rev-parse', 'HEAD'])) !== s.RELEASE_SHA)
    throw new Error('Checkout differs from verified source.');
  await cli('vcr', 'login', 'docker', '--project', s.VERCEL_PROJECT_ID);
  const image = `vcr.vercel.com/${s.VERCEL_TEAM_SLUG}/${s.VERCEL_PROJECT_NAME}/agent-runtime:${s.RELEASE_SHA}`;
  await run('docker', ['tag', 'platform-runtime:release', image]);
  await run('docker', ['push', image]);
  let runtime: ReturnType<typeof readyRuntime> | undefined;
  for (let n = 0; n < 60; n++) {
    const inspected = JSON.parse(
      await cli(
        'vcr',
        'tag',
        'inspect',
        'agent-runtime',
        s.RELEASE_SHA,
        '--project',
        s.VERCEL_PROJECT_ID,
        '--json',
      ),
    );
    if (inspected.status === 'ready') {
      runtime = readyRuntime(inspected);
      break;
    }
    if (inspected.status === 'failed') throw new Error('Runtime image preparation failed.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!runtime) throw new Error('Runtime image did not become ready within ten minutes.');
  await currentRevision();
  // Owner credentials exist only for these administrative children, never the Vercel build/runtime.
  for (const script of ['migrate', 'auth-migrate', 'provision-cli'])
    await run('pnpm', ['exec', 'tsx', `scripts/${script}.ts`]);
  const deployed = await cli(
    'deploy',
    '--prod',
    '--skip-domain',
    '--yes',
    '--project',
    s.VERCEL_PROJECT_ID,
    '--env',
    `RUNTIME_IMAGE=agent-runtime@${runtime.manifestDigest}`,
    '--meta',
    `release_sha=${s.RELEASE_SHA}`,
  );
  const url = deployed.split('\n').find((line) => /^https:\/\/[^\s]+\.vercel\.app$/.test(line.trim()));
  if (!url) throw new Error('Deployment did not return a Vercel URL.');
  const receipt = {
    sha: s.RELEASE_SHA,
    runtime: runtime.manifestDigest,
    deployment: url,
    project: s.VERCEL_PROJECT_ID,
    environment: 'staging',
    prepared_at: new Date().toISOString(),
    promoted: false,
  };
  await writeFile('staging-release.json', JSON.stringify(receipt, null, 2));
  await checkStaging(url, s.STAGING_API_KEY, env.VERCEL_AUTOMATION_BYPASS_SECRET);
  await currentRevision();
  await cli('promote', url, '--yes');
  await checkStaging(s.STAGING_ORIGIN, s.STAGING_API_KEY, env.VERCEL_AUTOMATION_BYPASS_SECRET);
  await writeFile(
    'staging-release.json',
    JSON.stringify({ ...receipt, promoted: true, accepted_at: new Date().toISOString() }, null, 2),
  );
}
