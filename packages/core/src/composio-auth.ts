import { completeComposioConsent } from '../../providers/src/composio-consent';
import { transaction } from '../../db';
import { identify, requireScopes } from './auth';
import { config } from './config';
import { assert } from './errors';
import { seal, unseal, id } from './crypto';
import * as resources from './resources';
import { composio, assertConnectionOwner } from './connections';
import { enabledConnector } from './connector-enablement';
import { connectionCookie, connectionCookieName, startConnectionCookies } from './connection-cookies';

const cookieName = () => connectionCookieName('dashboard');
const cookie = () => connectionCookie('dashboard');
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
    await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [
      url.searchParams.get('connection_id') || '',
    ]);
    const c = await resources.get(tx, 'connections', url.searchParams.get('connection_id') || '', p);
    assertConnectionOwner(p, c);
    assert(
      !(await tx.query('SELECT connection_id FROM customer_agent_connections WHERE connection_id=$1', [c.id]))
        .rowCount,
      409,
      'customer_connection',
      'Reconnect this customer account from the application that created it.',
    );
    assert(c.kind === 'composio' && !c.deleted, 400, 'invalid_connection', 'Choose a connected app.');
    const setup = await enabledConnector(String(c.provider), tx);
    const sdk = composio();
    const callbackUrl = config.origin + '/integrations/composio/callback';
    const requestOptions = { signal: AbortSignal.timeout(15000) };
    const refreshed = c.external_account_id
      ? await sdk.connectedAccounts.refresh(
          String(c.external_account_id),
          { redirectUrl: callbackUrl },
          requestOptions,
        )
      : undefined;
    if (refreshed)
      assert(
        refreshed.id === c.external_account_id,
        502,
        'connection_changed',
        'Reconnect must preserve the connected account.',
      );
    if (refreshed?.status === 'ACTIVE' && c.identity_verified) {
      await resources.update(tx, 'connections', c.id, { status: 'healthy' });
      return new Response(null, {
        status: 302,
        headers: { ...headers, location: config.origin + '/connections' },
      });
    }
    const link = refreshed
      ? { id: refreshed.id, redirectUrl: refreshed.redirect_url }
      : await sdk.connectedAccounts.link(
          `${p.organizationId}:${p.userId}`,
          setup.auth_config_id,
          {
            callbackUrl,
            allowMultiple: true,
            // The immutable local ID is also a unique upstream alias. Display names
            // can change without renaming provider accounts or retargeting agents.
            alias: c.id,
          },
          requestOptions,
        );
    assert(
      link.redirectUrl && new URL(link.redirectUrl).protocol === 'https:',
      502,
      'authorization_failed',
      'The provider did not return a secure authorization URL.',
    );
    const attempt = id();
    await tx.query(
      "UPDATE oauth_attempts SET consumed_at=now() WHERE organization_id=$1 AND provider='composio' AND data->>'connection_id'=$2 AND consumed_at IS NULL",
      [p.organizationId, c.id],
    );
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
      authorization_attempt_id: attempt,
      identity_verified: false,
      account_identity: null,
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
      headers: startConnectionCookies('dashboard', state, { ...headers, location: link.redirectUrl }),
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
  const verified = await completeComposioConsent(uri, `${p.organizationId}:${p.userId}`, transport);
  const completed = { connected_account_id: verified.accountId, toolkit_slug: verified.toolkit };
  await transaction(state.org, async (tx) => {
    await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [state.connection]);
    const c = await resources.get(tx, 'connections', state.connection, p);
    assertConnectionOwner(p, c);
    assert(
      c.external_account_id === completed.connected_account_id &&
        c.authorization_attempt_id === state.attempt &&
        attempt.connection_id === c.id &&
        attempt.external_account_id === completed.connected_account_id &&
        c.provider === completed.toolkit_slug &&
        !c.deleted,
      409,
      'connection_changed',
      'The app connection changed during authorization.',
    );
    await resources.update(tx, 'connections', c.id, {
      identity_verified: true,
      status: 'healthy',
      account_identity: completed.connected_account_id,
      authorization_attempt_id: null,
    });
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
