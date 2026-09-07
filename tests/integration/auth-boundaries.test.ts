import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, identify } from '../../packages/core/src/auth';
import { authPool, pool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { createKey } from '../../packages/core/src/keys';
import { id, sha256 } from '../../packages/core/src/crypto';
import { acceptInvitation, inviteMember } from '../../packages/core/src/organizations';
import { actorAuthorized } from '../../packages/core/src/actor-authorization';
import { fixtureAccount } from '../fixtures/account';

let a: Awaited<ReturnType<typeof fixtureAccount>>, b: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  a = await fixtureAccount('Auth boundaries A');
  b = await fixtureAccount('Auth boundaries B');
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const browser = (cookie: string, method = 'GET', origin?: string) =>
  new Request(`${config.origin}/v1/me`, {
    method,
    headers: { cookie, ...(origin === undefined ? {} : { origin }) },
  });
const api = (key: string, selector?: string) =>
  new Request(`${config.origin}/v1/me`, {
    headers: { authorization: `Bearer ${key}`, ...(selector ? { 'x-organization-id': selector } : {}) },
  });

describe('authenticated principals and session boundaries', () => {
  it('does not authenticate a request with no cookie or credential', async () => {
    await expect(identify(new Request(`${config.origin}/v1/me`))).rejects.toMatchObject({ status: 401 });
  });
  it('allows verified browser reads and same-origin mutations', async () => {
    expect((await identify(browser(a.cookie))).userId).toBe(a.p.userId);
    expect((await identify(browser(a.cookie, 'POST', config.origin))).organizationId).toBe(
      a.p.organizationId,
    );
  });
  it.each([undefined, 'https://attacker.invalid', config.origin + '.attacker.invalid'])(
    'rejects a browser mutation from origin %s',
    async (origin) => {
      await expect(identify(browser(a.cookie, 'POST', origin))).rejects.toMatchObject({ status: 403 });
    },
  );
  it('rejects a tenant selector that disagrees with a valid API key', async () => {
    await expect(identify(api(a.key, b.p.organizationId))).rejects.toMatchObject({ status: 403 });
  });
  it('rejects customer API keys at the operator audience', async () => {
    await expect(identify(api(a.key), `${config.origin}/admin/v1`)).rejects.toMatchObject({ status: 401 });
  });
  it.each(['expired', 'revoked'] as const)('rejects an %s API key', async (reason) => {
    const key = await transaction(a.p.organizationId, (tx) =>
      createKey(tx, a.p, { name: reason, scopes: ['identity:read'] }),
    );
    if (reason === 'expired')
      await pool.query("UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [key.id]);
    else await pool.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [key.id]);
    await expect(identify(api(key.secret))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a revoked browser session even if its signed cookie is retained', async () => {
    const account = await fixtureAccount('Revoked session');
    await auth.api.signOut({ headers: new Headers({ cookie: account.cookie }) });
    await expect(identify(browser(account.cookie))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects an expired browser session', async () => {
    const account = await fixtureAccount('Expired session');
    await pool.query('UPDATE auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1', [
      account.p.userId,
    ]);
    await expect(identify(browser(account.cookie))).rejects.toMatchObject({ status: 401 });
  });
  it('rechecks account verification before accepting an existing API key', async () => {
    const account = await fixtureAccount('Unverified credential owner');
    await pool.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1', [account.p.userId]);
    await expect(identify(api(account.key))).rejects.toMatchObject({ status: 403 });
  });
  it('rechecks membership after a credential was issued', async () => {
    const account = await fixtureAccount('Removed membership');
    await pool.query('DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      account.p.organizationId,
      account.p.userId,
    ]);
    await expect(identify(api(account.key))).rejects.toMatchObject({ status: 403 });
  });
});

describe('delegated execution and invitations', () => {
  it('checks current key scope and project binding before a delegated side effect', async () => {
    const key = await transaction(a.p.organizationId, (tx) =>
      createKey(tx, a.p, { name: 'Scoped run', scopes: ['runs:write'], project_id: id() }),
    );
    const row = (
      await pool.query('SELECT id,project_ids FROM api_keys WHERE key_hash=$1', [sha256(key.secret)])
    ).rows[0];
    const run = {
      organization_id: a.p.organizationId,
      project_id: row.project_ids[0],
      config: { user_id: a.p.userId!, principal_id: String(key.id), principal_kind: 'api_key' as const },
    };
    expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(true);
    expect(
      await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, { ...run, project_id: id() })),
    ).toBe(false);
    expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, run, 'connections:write'))).toBe(
      false,
    );
    await pool.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [key.id]);
    expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(false);
  });
  it('binds invitation acceptance to the intended verified email', async () => {
    const invite = await transaction(a.p.organizationId, (tx) =>
      inviteMember(tx, a.p, 'intended@example.test', 'member'),
    );
    const token = new URL(invite.invite_url).searchParams.get('token');
    const response = await acceptInvitation(
      new Request(`${config.origin}/auth/organizations/join`, {
        method: 'POST',
        headers: { cookie: b.cookie, origin: config.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'invitation_email_mismatch' } });
  });
  it('accepts a valid invitation once under concurrent delivery', async () => {
    const invite = await transaction(a.p.organizationId, (tx) => inviteMember(tx, a.p, b.p.email!, 'member'));
    const token = new URL(invite.invite_url).searchParams.get('token');
    const responses = await Promise.all(
      [1, 2].map(() =>
        acceptInvitation(
          new Request(`${config.origin}/auth/organizations/join`, {
            method: 'POST',
            headers: { cookie: b.cookie, origin: config.origin, 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          }),
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(
      (
        await pool.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2', [
          a.p.organizationId,
          b.p.userId,
        ])
      ).rowCount,
    ).toBe(1);
  });
});

describe('persisted delegated OAuth authority', () => {
  it.each([
    'revoked-token',
    'disabled-client',
    'expired-session',
    'removed-member',
    'viewer',
    'unverified',
  ] as const)('stops an accepted grant after %s without relying on token expiry', async (reason) => {
    const a = await fixtureAccount('Delegated authority'),
      client = id(),
      token = id();
    const session = (await pool.query('SELECT id FROM auth.session WHERE "userId"=$1', [a.p.userId])).rows[0]
      .id;
    await pool.query(
      `INSERT INTO auth."oauthClient"(id,"clientId",name,scopes,"redirectUris",disabled,"createdAt","updatedAt") VALUES($1,$1,'Delegation fixture','["runs:write"]','[]',false,now(),now())`,
      [client],
    );
    await pool.query(
      'INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now())',
      [id(), client, config.origin + '/v1'],
    );
    // Expiration alone does not revoke an already accepted run's delegated authority.
    await pool.query(
      `INSERT INTO auth."oauthAccessToken"(id,token,"clientId","userId","sessionId",scopes,"expiresAt","createdAt") VALUES($1,$2,$3,$4,$5,'["runs:write"]',now()-interval '1 second',now())`,
      [token, sha256(id()), client, a.p.userId, session],
    );
    const run = {
      organization_id: a.p.organizationId,
      project_id: id(),
      config: {
        user_id: a.p.userId!,
        principal_id: a.p.id,
        principal_kind: 'user' as const,
        oauth_token_id: token,
      },
    };
    expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(true);
    let changed;
    if (reason === 'revoked-token')
      changed = await pool.query('UPDATE auth."oauthAccessToken" SET revoked=now() WHERE id=$1', [token]);
    if (reason === 'disabled-client')
      changed = await pool.query('UPDATE auth."oauthClient" SET disabled=true WHERE "clientId"=$1', [client]);
    if (reason === 'expired-session')
      changed = await pool.query(
        'UPDATE auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',
        [session],
      );
    if (reason === 'removed-member')
      changed = await pool.query('DELETE FROM memberships WHERE user_id=$1 AND organization_id=$2', [
        a.p.userId,
        a.p.organizationId,
      ]);
    if (reason === 'viewer')
      changed = await pool.query(
        "UPDATE memberships SET role='viewer' WHERE user_id=$1 AND organization_id=$2",
        [a.p.userId, a.p.organizationId],
      );
    if (reason === 'unverified')
      changed = await pool.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1', [a.p.userId]);
    expect(changed?.rowCount).toBe(1);
    expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(false);
    expect((await pool.query('SELECT id FROM auth."oauthAccessToken" WHERE id=$1', [token])).rowCount).toBe(
      1,
    );
  });
});

it('rejects malformed OAuth cookies as invalid state before contacting a provider', async () => {
  const { finishGithub } = await import('../../packages/core/src/github-auth');
  const { finishMcpOAuth } = await import('../../packages/core/src/mcp-oauth');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'fixture');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'fixture');
  vi.stubEnv('GITHUB_APP_SLUG', 'fixture');
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider call'));
  try {
    for (const [provider, finish] of [
      ['github', finishGithub],
      ['mcp', finishMcpOAuth],
    ] as const) {
      await expect(
        finish(
          new Request(`${config.origin}/integrations/${provider}/callback?state=fixture&code=fixture`, {
            headers: { cookie: `${provider}-state=%ZZ` },
          }),
          transport,
        ),
      ).rejects.toMatchObject({ status: 400, code: 'invalid_oauth_state' });
    }
    expect(transport).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

it('completes GitHub authorization with a framework request proxy and rejects replay', async () => {
  const { startGithub, finishGithub } = await import('../../packages/core/src/github-auth');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'fixture');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'fixture');
  vi.stubEnv('GITHUB_APP_SLUG', 'fixture');
  try {
    const started = await startGithub(
      new Request(config.origin + '/integrations/github/install', {
        headers: { cookie: a.cookie },
      }),
    );
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const cookie = a.cookie + '; ' + started.headers.get('set-cookie')!.split(';')[0];
    const request = () =>
      new Proxy(
        new Request(
          config.origin + '/integrations/github/callback?code=fixture&state=' + encodeURIComponent(state),
          {
            headers: { cookie },
          },
        ),
        { get: (target, key) => Reflect.get(target, key, target) },
      );
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://github.com/login/oauth/access_token');
      expect(JSON.parse(String(init?.body)).code).toBe('fixture');
      return Response.json({ access_token: 'fixture-github-access', expires_in: 3600 });
    });
    expect((await finishGithub(request(), transport)).headers.get('location')).toBe('/connections');
    const link = await transaction(a.p.organizationId, (tx) =>
      tx.query('SELECT token_ciphertext FROM github_user_links WHERE user_id=$1', [a.p.userId]),
    );
    expect(link.rowCount).toBe(1);
    expect(link.rows[0].token_ciphertext).not.toContain('fixture-github-access');
    await expect(finishGithub(request(), transport)).rejects.toMatchObject({ code: 'oauth_already_used' });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});
