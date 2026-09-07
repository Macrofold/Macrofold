import {
  auth as authenticate,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { lock, transaction, credentialTransaction } from '../../db';
import { identify, requireScopes, type Principal } from './auth';
import { config, isLocal } from './config';
import { assert, AppError } from './errors';
import { id, seal, unseal, sameSecret } from './crypto';
import * as resources from './resources';
import { safeFetch, validatePublicURL } from '../../providers/src/network';
import { enqueueWebhook } from './webhooks';

type Stored = {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expires?: number;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
};
export class ConnectionOAuth implements OAuthClientProvider {
  redirect?: URL;
  constructor(
    readonly data: Stored,
    readonly flowState?: string,
  ) {}
  get redirectUrl() {
    return config.origin + '/integrations/mcp/callback';
  }
  get clientMetadata() {
    return {
      client_name: config.name,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.data.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.data.client = client;
  }
  tokens() {
    return this.data.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.data.tokens = { ...tokens, refresh_token: tokens.refresh_token || this.data.tokens?.refresh_token };
    this.data.expires = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  }
  async redirectToAuthorization(url: URL) {
    assert(this.flowState, 409, 'connection_expired', 'Reconnect this MCP server from Connections.');
    await validatePublicURL(url.href);
    this.redirect = url;
  }
  state() {
    assert(this.flowState, 409, 'connection_expired', 'Reconnect this MCP server from Connections.');
    return this.flowState;
  }
  saveCodeVerifier(verifier: string) {
    this.data.verifier = verifier;
  }
  codeVerifier() {
    assert(
      this.data.verifier,
      400,
      'invalid_oauth_state',
      'The PKCE verifier is unavailable. Start authorization again.',
    );
    return this.data.verifier;
  }
  discoveryState() {
    return this.data.discovery;
  }
  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    // Pin the initial issuer and endpoints through the callback/refresh cycle. Rediscovery that
    // changes an issuer must never forward an old client secret or refresh token to the new one.
    if (this.data.discovery && (this.data.tokens || this.data.client))
      assert(
        this.data.discovery.authorizationServerUrl === discovery.authorizationServerUrl &&
          this.data.discovery.authorizationServerMetadata?.token_endpoint ===
            discovery.authorizationServerMetadata?.token_endpoint,
        409,
        'oauth_issuer_changed',
        'The authorization server changed. Create a new connection.',
      );
    await validatePublicURL(discovery.authorizationServerUrl);
    this.data.discovery = discovery;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens') {
      delete this.data.tokens;
      delete this.data.expires;
    }
    if (scope === 'all' || scope === 'client') delete this.data.client;
    if (scope === 'all' || scope === 'verifier') delete this.data.verifier;
    // Discovery remains pinned while credentials exist. Explicit reconnection can register afresh.
    if ((scope === 'all' || scope === 'discovery') && !this.data.tokens && !this.data.client)
      delete this.data.discovery;
  }
}
function stored(connection: resources.Document): Stored {
  if (connection.oauth_ciphertext) return unseal<Stored>(String(connection.oauth_ciphertext));
  const clients = JSON.parse(process.env.MCP_OAUTH_CLIENTS_JSON || '{}') as Record<
    string,
    OAuthClientInformationMixed
  >;
  return { client: clients[new URL(String(connection.url)).origin] };
}
function own(p: Principal, connection: resources.Document) {
  requireScopes(p, ['connections:write']);
  assert(
    p.kind === 'user' &&
      p.userId === connection.owner_subject_id &&
      connection.kind === 'mcp_remote' &&
      connection.auth_method === 'oauth' &&
      !connection.deleted,
    403,
    'forbidden',
    'Sign in as the connection owner to authorize this MCP server.',
  );
}
const cookieName = () => (isLocal() ? 'mcp-state' : '__Host-mcp-state');
const responseHeaders = (state = '', age = 0) => ({
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'set-cookie': `${cookieName()}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${isLocal() ? '' : '; Secure'}`,
});
export async function startMcpOAuth(request: Request, transport: typeof fetch = safeFetch) {
  const url = new URL(request.url),
    org = url.searchParams.get('organization_id') || '',
    connectionId = url.searchParams.get('connection_id') || '';
  const p = await identify(
    new Request(request.url, { headers: new Headers([...request.headers, ['x-organization-id', org]]) }),
  );
  return transaction(p.organizationId, async (tx) => {
    const connection = await resources.get(tx, 'connections', connectionId, p);
    own(p, connection);
    await lock(tx, `mcp-oauth:${connection.id}`);
    const attempt = id(),
      state = seal({
        attempt,
        org: p.organizationId,
        user: p.userId,
        connection: connection.id,
        expires: Date.now() + 600000,
      });
    const provider = new ConnectionOAuth({ client: stored(connection).client }, state);
    await authenticate(provider, { serverUrl: String(connection.url), fetchFn: transport });
    assert(
      provider.redirect,
      502,
      'authorization_failed',
      'The MCP server did not return an authorization URL.',
    );
    await tx.query(
      "INSERT INTO oauth_attempts(id,organization_id,user_id,provider,data,expires_at) VALUES($1,$2,$3,'mcp',$4,now()+interval '10 minutes')",
      [
        attempt,
        p.organizationId,
        p.userId,
        JSON.stringify({
          connection_id: connection.id,
          url: connection.url,
          oauth_ciphertext: seal(provider.data),
        }),
      ],
    );
    return new Response(null, {
      status: 302,
      headers: { ...responseHeaders(state, 600), location: provider.redirect.href },
    });
  });
}
export async function finishMcpOAuth(request: Request, transport: typeof fetch = safeFetch) {
  const url = new URL(request.url),
    state = url.searchParams.get('state') || '',
    code = url.searchParams.get('code');
  const cookie = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName() + '='))
    ?.slice(cookieName().length + 1);
  assert(
    cookie && sameSecret(cookie, encodeURIComponent(state)) && code,
    400,
    'invalid_oauth_state',
    'Authorization state did not match. Start again.',
  );
  let data: { attempt: string; org: string; user: string; connection: string; expires: number };
  try {
    data = unseal(state);
  } catch {
    throw new AppError(400, 'invalid_oauth_state', 'Authorization state is invalid.');
  }
  assert(data.expires > Date.now(), 400, 'oauth_expired', 'Authorization expired. Start again.');
  const p = await identify(
    new Request(request.url, { headers: new Headers([...request.headers, ['x-organization-id', data.org]]) }),
  );
  assert(
    p.userId === data.user,
    403,
    'invalid_oauth_state',
    'Sign in with the account that started this connection.',
  );
  // Consume before exchanging the one-time code: an ambiguous token response is not replayed.
  const attempt = await transaction(data.org, async (tx) => {
    own(p, await resources.get(tx, 'connections', data.connection, p));
    const result = await tx.query(
      "UPDATE oauth_attempts SET consumed_at=now() WHERE id=$1 AND user_id=$2 AND provider='mcp' AND consumed_at IS NULL AND expires_at>now() RETURNING data",
      [data.attempt, p.userId],
    );
    assert(result.rowCount, 400, 'invalid_oauth_state', 'This authorization was already used or expired.');
    return result.rows[0].data;
  });
  return transaction(data.org, async (tx) => {
    await lock(tx, `mcp-oauth:${data.connection}`);
    const c = await resources.get(tx, 'connections', data.connection, p);
    own(p, c);
    assert(
      attempt.connection_id === c.id && attempt.url === c.url,
      409,
      'connection_changed',
      'The connection changed during authorization.',
    );
    const provider = new ConnectionOAuth(unseal<Stored>(attempt.oauth_ciphertext));
    assert(
      (await authenticate(provider, {
        serverUrl: String(c.url),
        authorizationCode: code,
        fetchFn: transport,
      })) === 'AUTHORIZED',
      400,
      'authorization_failed',
      'The server did not authorize this connection.',
    );
    delete provider.data.verifier;
    await resources.update(tx, 'connections', c.id, {
      oauth_ciphertext: seal(provider.data),
      status: 'healthy',
    });
    return new Response(null, {
      status: 302,
      headers: { ...responseHeaders(), location: config.origin + '/connections?authorized=' + c.id },
    });
  });
}
/** Serialize refresh-token rotation per connection; persist rotated credentials even if a subsequent
 * tool request fails. Client secrets never enter the agent sandbox. */
export async function withConnectionOAuth<T>(
  connection: resources.Document,
  fn: (provider: ConnectionOAuth) => Promise<T>,
): Promise<T> {
  const result = await credentialTransaction(connection.organization_id, async (tx) => {
    await lock(tx, `mcp-oauth:${connection.id}`);
    const current = await resources.get(tx, 'connections', connection.id);
    assert(
      current.status === 'healthy',
      409,
      'connection_expired',
      'Reconnect this MCP server from Connections.',
    );
    const provider = new ConnectionOAuth(stored(current));
    try {
      if (provider.data.expires && provider.data.expires < Date.now() + 30000)
        await authenticate(provider, { serverUrl: String(current.url), fetchFn: safeFetch });
      const value = await fn(provider);
      await resources.update(tx, 'connections', current.id, { oauth_ciphertext: seal(provider.data) });
      return { value };
    } catch (error) {
      const expired =
        !provider.data.tokens || (error instanceof AppError && error.code === 'connection_expired');
      await resources.update(tx, 'connections', current.id, {
        oauth_ciphertext: seal(provider.data),
        ...(expired ? { status: 'expired' } : {}),
      });
      if (expired)
        await enqueueWebhook(tx, current.organization_id, 'connection.expired', {
          connection_id: current.id,
        });
      return { error };
    }
  });
  if ('error' in result) throw result.error;
  return result.value;
}
