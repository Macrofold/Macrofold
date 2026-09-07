import { z } from 'zod';
import { transaction } from '../../db';
import { identify, requireScopes } from './auth';
import { config, isLocal } from './config';
import { assert } from './errors';
import { seal, unseal, id } from './crypto';
import * as resources from './resources';
import { composio, assertConnectionOwner } from './connections';
import { boundedJSON } from './body';

const cookieName = () => (isLocal() ? 'composio-state' : '__Host-composio-state');
const cookie = (state = '', age = 0) =>
  `${cookieName()}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${isLocal() ? '' : '; Secure'}`;
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
export async function startComposio(request: Request) {
  assert(
    process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED === 'true',
    503,
    'integration_not_configured',
    'Enable Composio callback identity verification before connecting user accounts.',
  );
  const url = new URL(request.url),
    organization = url.searchParams.get('organization_id') || '';
  const p = await identify(
    // Next.js proxies route requests; construct from public fields instead of cloning private state.
    new Request(request.url, {
      method: request.method,
      headers: new Headers([...request.headers, ['x-organization-id', organization]]),
    }),
  );
  requireScopes(p, ['connections:write']);
  assert(p.kind === 'user', 403, 'browser_required', 'Sign in to connect your app account.');
  return transaction(p.organizationId, async (tx) => {
    const c = await resources.get(tx, 'connections', url.searchParams.get('connection_id') || '', p);
    assertConnectionOwner(p, c);
    assert(c.kind === 'composio' && !c.deleted, 400, 'invalid_connection', 'Choose a connected app.');
    const configs = JSON.parse(process.env.COMPOSIO_AUTH_CONFIGS_JSON || '{}') as Record<string, string>;
    assert(
      configs[String(c.provider)],
      503,
      'integration_not_configured',
      'Register an auth configuration for this app in Composio.',
    );
    const link = await composio().connectedAccounts.link(
      `${p.organizationId}:${p.userId}`,
      configs[String(c.provider)],
      { callbackUrl: config.origin + '/integrations/composio/callback' },
    );
    assert(
      link.redirectUrl && new URL(link.redirectUrl).protocol === 'https:',
      502,
      'authorization_failed',
      'The provider did not return a secure authorization URL.',
    );
    const attempt = id();
    await tx.query(
      "INSERT INTO oauth_attempts(id,organization_id,user_id,provider,data,expires_at) VALUES($1,$2,$3,'composio',$4,now()+interval '10 minutes')",
      [
        attempt,
        p.organizationId,
        p.userId,
        JSON.stringify({ connection_id: c.id, external_account_id: link.id }),
      ],
    );
    await resources.update(tx, 'connections', c.id, {
      external_account_id: link.id,
      identity_verified: false,
      status: 'pending',
    });
    const state = seal({
      attempt,
      org: p.organizationId,
      user: p.userId,
      connection: c.id,
      expires: Date.now() + 600000,
    });
    return new Response(null, {
      status: 302,
      headers: { ...headers, 'set-cookie': cookie(state, 600), location: link.redirectUrl },
    });
  });
}
/** The URI is opaque input to Composio's fixed endpoint. It is never fetched as a user-supplied URL. */
export async function finishComposio(request: Request, transport: typeof fetch = fetch) {
  const uri = new URL(request.url).searchParams.get('session_uri');
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName() + '='))
    ?.slice(cookieName().length + 1);
  assert(
    value && uri && uri.length < 8192,
    400,
    'invalid_oauth_state',
    'Start the app connection again from your dashboard.',
  );
  let state: { attempt: string; org: string; user: string; connection: string; expires: number };
  try {
    state = unseal(decodeURIComponent(value));
  } catch {
    assert(false, 400, 'invalid_oauth_state', 'Connection state is invalid.');
  }
  assert(state.expires > Date.now(), 400, 'oauth_expired', 'This connection attempt expired.');
  const p = await identify(
    new Request(request.url, {
      method: request.method,
      headers: new Headers([...request.headers, ['x-organization-id', state.org]]),
    }),
  );
  requireScopes(p, ['connections:write']);
  assert(
    p.kind === 'user' && p.userId === state.user,
    403,
    'invalid_oauth_state',
    'Sign in with the account that started this connection.',
  );
  const attempt = await transaction(state.org, async (tx) => {
    assertConnectionOwner(p, await resources.get(tx, 'connections', state.connection, p));
    const result = await tx.query(
      "UPDATE oauth_attempts SET consumed_at=now() WHERE id=$1 AND provider='composio' AND user_id=$2 AND expires_at>now() AND consumed_at IS NULL RETURNING data",
      [state.attempt, p.userId],
    );
    assert(result.rowCount, 400, 'invalid_oauth_state', 'This connection attempt was already used.');
    return result.rows[0].data;
  });
  assert(
    process.env.COMPOSIO_API_KEY,
    503,
    'integration_not_configured',
    'Configure Composio before accepting connections.',
  );
  const result = await transport('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth', {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.COMPOSIO_API_KEY },
    body: JSON.stringify({ session_uri: uri, user_id: `${p.organizationId}:${p.userId}` }),
    signal: AbortSignal.timeout(15000),
  });
  assert(
    result.ok,
    409,
    'connection_verification_failed',
    'The provider could not verify the returning account. Start a new connection.',
  );
  const completed = z
    .object({ connected_account_id: z.string(), toolkit_slug: z.string() })
    .parse(await boundedJSON(result, 65536));
  await transaction(state.org, async (tx) => {
    const c = await resources.get(tx, 'connections', state.connection, p);
    assertConnectionOwner(p, c);
    assert(
      c.external_account_id === completed.connected_account_id &&
        attempt.external_account_id === completed.connected_account_id &&
        c.provider === completed.toolkit_slug &&
        !c.deleted,
      409,
      'connection_changed',
      'The app connection changed during authorization.',
    );
    await resources.update(tx, 'connections', c.id, { identity_verified: true, status: 'healthy' });
  });
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      'set-cookie': cookie(),
      location: config.origin + '/connections?authorized=' + state.connection,
    },
  });
}
