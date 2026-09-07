import { z } from 'zod';
import { identify, requireScopes, type Principal } from './auth';
import { transaction, lock, type Tx } from '../../db';
import { config, isLocal } from './config';
import { id, seal, unseal, sameSecret } from './crypto';
import { assert } from './errors';
import * as resources from './resources';
import { branchName } from '../../providers/src/git-repository';
import { boundedJSON } from './body';
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  default_branch: z.string(),
  owner: z.object({ login: z.string() }),
  permissions: z.object({ push: z.boolean().optional(), admin: z.boolean().optional() }).optional(),
});
const repositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema).max(100),
});
const installationsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z
    .array(z.object({ id: z.number().int().positive(), account: z.object({ login: z.string() }) }))
    .max(100),
});
const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2026-03-10',
});
function configured() {
  assert(
    process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_SLUG,
    503,
    'github_not_configured',
    'The operator must configure the GitHub App before connecting repositories.',
  );
}
export function githubManager(p: Principal) {
  requireScopes(p, ['projects:write']);
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'forbidden',
    'An organization owner or admin must connect GitHub repositories.',
  );
}
export async function startGithub(request: Request) {
  configured();
  const p = await identify(request);
  githubManager(p);
  assert(
    !request.headers.has('authorization'),
    403,
    'browser_required',
    'Use your signed-in dashboard to connect GitHub.',
  );
  const project = new URL(request.url).searchParams.get('project_id');
  const attempt = id();
  await transaction(p.organizationId, async (tx) => {
    if (project) await resources.get(tx, 'projects', project, p);
    await tx.query(
      "INSERT INTO oauth_attempts(id,organization_id,user_id,provider,data,expires_at) VALUES($1,$2,$3,'github',$4,now()+interval '10 minutes')",
      [attempt, p.organizationId, p.userId, JSON.stringify({ project_id: project })],
    );
  });
  const state = seal({ attempt, org: p.organizationId, user: p.userId, expires: Date.now() + 600000 });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_APP_CLIENT_ID!);
  url.searchParams.set('redirect_uri', config.origin + '/integrations/github/callback');
  url.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      location: url.href,
      'set-cookie': `${isLocal() ? 'github-state' : '__Host-github-state'}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${isLocal() ? '' : '; Secure'}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
export async function finishGithub(request: Request, transport: typeof fetch = fetch) {
  configured();
  const url = new URL(request.url),
    state = url.searchParams.get('state') || '',
    code = url.searchParams.get('code');
  const cookie = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith((isLocal() ? 'github-state' : '__Host-github-state') + '='))
    ?.split('=')
    .slice(1)
    .join('=');
  assert(
    cookie && sameSecret(cookie, encodeURIComponent(state)) && code,
    400,
    'invalid_oauth_state',
    'GitHub authorization state did not match. Start again.',
  );
  let data: { attempt: string; org: string; user: string; expires: number };
  try {
    data = unseal(state);
  } catch {
    assert(false, 400, 'invalid_oauth_state', 'Invalid GitHub authorization state.');
  }
  assert(data.expires > Date.now(), 400, 'oauth_expired', 'GitHub authorization expired.');
  const p = await identify(
    new Request(request.url, { headers: new Headers([...request.headers, ['x-organization-id', data.org]]) }),
  );
  githubManager(p);
  assert(
    p.userId === data.user,
    403,
    'invalid_oauth_state',
    'Sign in with the account that started this connection.',
  );
  const attempt = await transaction(data.org, async (tx) => {
    const r = await tx.query(
      "UPDATE oauth_attempts SET consumed_at=now() WHERE id=$1 AND user_id=$2 AND provider='github' AND consumed_at IS NULL AND expires_at>now() RETURNING data",
      [data.attempt, p.userId],
    );
    assert(r.rowCount, 400, 'oauth_already_used', 'This authorization has already been used. Start again.');
    return r.rows[0].data;
  });
  const response = await transport('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: config.origin + '/integrations/github/callback',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const tokens = (await boundedJSON(response, 256 * 1024)) as { access_token?: string; expires_in?: number };
  assert(
    response.ok && tokens.access_token,
    400,
    'github_authorization_failed',
    'GitHub could not complete authorization.',
  );
  await transaction(data.org, async (tx) => {
    await tx.query(
      'INSERT INTO github_user_links(organization_id,user_id,token_ciphertext,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,user_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at',
      [
        data.org,
        p.userId,
        seal({ token: tokens.access_token }),
        new Date(Date.now() + Math.min(tokens.expires_in || 28800, 28800) * 1000),
      ],
    );
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: attempt.project_id ? `/projects/${attempt.project_id}?tab=git` : '/connections',
      'set-cookie': `${isLocal() ? 'github-state' : '__Host-github-state'}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isLocal() ? '' : '; Secure'}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
async function userToken(tx: Tx, p: Principal) {
  const value = (
    await tx.query(
      'SELECT token_ciphertext FROM github_user_links WHERE organization_id=$1 AND user_id=$2 AND expires_at>now()',
      [p.organizationId, p.userId],
    )
  ).rows[0];
  assert(value, 409, 'github_authorization_required', 'Authorize GitHub from the dashboard.');
  return unseal<{ token: string }>(value.token_ciphertext).token;
}
async function githubJSON(url: string, token: string, transport: typeof fetch) {
  const response = await transport('https://api.github.com' + url, {
    headers: headers(token),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  assert(
    response.ok,
    502,
    'github_api_error',
    'GitHub could not verify repository access. Reconnect or retry later.',
  );
  return boundedJSON(response, 4 * 1024 * 1024);
}
export async function githubInstallations(tx: Tx, p: Principal, transport: typeof fetch = fetch) {
  githubManager(p);
  const token = await userToken(tx, p);
  const body = installationsSchema.parse(
    await githubJSON('/user/installations?per_page=100', token, transport),
  );
  return {
    data: body.installations.map((i) => ({
      installation_id: String(i.id),
      account_login: i.account.login,
    })),
    install_url: `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`,
    truncated: body.total_count > 100,
  };
}
export async function githubRepositories(
  tx: Tx,
  p: Principal,
  installation: string,
  transport: typeof fetch = fetch,
) {
  githubManager(p);
  assert(/^\d+$/.test(installation), 400, 'invalid_installation', 'Use a numeric installation ID.');
  const token = await userToken(tx, p);
  const body = repositoriesSchema.parse(
    await githubJSON(`/user/installations/${installation}/repositories?per_page=100`, token, transport),
  );
  return {
    data: body.repositories
      .filter((r) => r.permissions?.push || r.permissions?.admin)
      .map((r) => ({
        repository_id: String(r.id),
        full_name: r.full_name,
        default_branch: r.default_branch,
      })),
    truncated: body.total_count > 100,
  };
}
export async function authorizeRepository(
  tx: Tx,
  p: Principal,
  value: { installation_id: string; repository_id: string; target_branch: string },
  transport: typeof fetch = fetch,
) {
  githubManager(p);
  branchName(value.target_branch);
  await lock(tx, `github-installation:${value.installation_id}`);
  assert(
    /^\d+$/.test(value.installation_id) && /^\d+$/.test(value.repository_id),
    400,
    'invalid_repository',
    'Use numeric GitHub IDs.',
  );
  const token = await userToken(tx, p);
  const repo = repositorySchema.parse(
    await githubJSON(`/repositories/${value.repository_id}`, token, transport),
  );
  assert(
    repo.permissions?.push || repo.permissions?.admin,
    403,
    'github_write_required',
    'Your GitHub account must have write access to connect this repository.',
  );
  // A user token is the intersection of user and app permissions. Verify this installation's exact repo membership.
  let found = false,
    account = '';
  for (let page = 1; page <= 100; page++) {
    const body = repositoriesSchema.parse(
      await githubJSON(
        `/user/installations/${value.installation_id}/repositories?per_page=100&page=${page}`,
        token,
        transport,
      ),
    );
    if (body.repositories.some((r) => String(r.id) === value.repository_id)) {
      found = true;
      account = repo.owner.login;
      break;
    }
    if (body.repositories.length < 100) break;
  }
  assert(
    found,
    403,
    'installation_not_authorized',
    'The selected installation does not grant this repository.',
  );
  const installed = await tx.query(
    'INSERT INTO github_installations(installation_id,organization_id,account_login) VALUES($1,$2,$3) ON CONFLICT(organization_id,installation_id) DO UPDATE SET account_login=excluded.account_login,active=true RETURNING installation_id',
    [value.installation_id, p.organizationId, account],
  );
  assert(
    installed.rowCount,
    409,
    'installation_already_linked',
    'This GitHub installation is already linked to another organization.',
  );
  await tx.query(
    'INSERT INTO github_webhook_routes(installation_id,organization_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [value.installation_id, p.organizationId],
  );
  await tx.query(
    'INSERT INTO github_repository_grants(organization_id,installation_id,repository_id,full_name,default_branch,granted_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,installation_id,repository_id) DO UPDATE SET full_name=excluded.full_name,default_branch=excluded.default_branch,granted_by=excluded.granted_by',
    [
      p.organizationId,
      value.installation_id,
      value.repository_id,
      repo.full_name,
      repo.default_branch,
      p.userId,
    ],
  );
  return { ...value, full_name: repo.full_name };
}
