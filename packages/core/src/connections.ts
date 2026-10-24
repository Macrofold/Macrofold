import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { composio } from '../../providers/src/composio';
import { composioTools } from '../../providers/src/composio-consent';
export { composio } from '../../providers/src/composio';
import { enabledConnector } from './connector-enablement';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { assert, AppError } from './errors';
import { seal, unseal, canonical, sha256 } from './crypto';
import { config } from './config';
import * as resources from './resources';
import {
  mcpFetch,
  validateMcpURL,
  validatePublicURL,
  validateModelEndpointURL,
} from '../../providers/src/network';
import type { components } from '../../contracts/api';
import { withConnectionOAuth } from './mcp-oauth';
import { approvedStdio } from './stdio-catalog';
import { searchKey, searchIdentity } from './search';
import { searchTool, searchProviders } from '../../contracts/search';
import { collectToolPages } from '../../providers/src/tool-catalog';
import { requireClaudeSubscriptionExecution, validateClaudeFallback } from './claude-connections';
import { connectionToolCatalog, type RawConnectionTool } from './connection-tool-catalog';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
type Schema = components['schemas'];
export function assertConnectionOwner(p: Principal, c: resources.Document<'connections'>) {
  assert(
    c.owner_subject_id === p.userId,
    403,
    'forbidden',
    'Only the connection owner can edit credentials or authorize access.',
  );
}
export async function saveConnection(
  tx: Tx,
  p: Principal,
  input: Schema['ConnectionPatch'],
  connectionId?: string,
) {
  if (connectionId) await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [connectionId]);
  const existing = connectionId ? await resources.get(tx, 'connections', connectionId, p) : undefined;
  if (existing) assertConnectionOwner(p, existing);
  if (existing)
    for (const field of ['kind', 'provider', 'url', 'auth_method', 'package', 'package_version'] as const)
      assert(
        input[field] === undefined || input[field] === existing[field],
        409,
        'connection_identity_immutable',
        'Create a new connection to change its service or authentication method.',
      );
  const merged = { ...existing, ...input };
  assert(
    typeof merged.name === 'string' && merged.name.trim().length > 0 && merged.name.length <= 120,
    400,
    'invalid_connection_name',
    'Give the connection a name between 1 and 120 characters.',
  );
  assert(
    !input.api_fallback || merged.kind === 'claude_subscription',
    400,
    'invalid_fallback',
    'API fallback is only available on a Claude subscription connection.',
  );
  let apiFallback;
  if (merged.kind === 'claude_subscription') {
    assert(
      merged.provider === 'anthropic' &&
        merged.auth_method === 'claude_code' &&
        !merged.url &&
        !input.secret &&
        !input.secret_headers &&
        !input.secret_env,
      400,
      'invalid_subscription_connection',
      'Claude subscriptions use native Claude Code authentication. Do not upload tokens or credential files.',
    );
    // A disconnected backup must not prevent renaming its parent connection.
    // Admission revalidates the saved policy before it can authorize spending.
    apiFallback =
      existing && input.api_fallback === undefined
        ? existing.api_fallback
        : await validateClaudeFallback(tx, p, input.api_fallback);
  }
  if (merged.url)
    await (
      merged.kind === 'mcp_remote'
        ? validateMcpURL
        : merged.kind === 'external_model'
          ? validateModelEndpointURL
          : validatePublicURL
    )(String(merged.url));
  if (['hugging_face', 'runpod', 'external_model'].includes(String(merged.kind))) {
    const external = merged.kind === 'external_model';
    assert(
      !input.secret_headers && !input.secret_env,
      400,
      'invalid_credentials',
      'Model hosting connections use their exact account key or endpoint bearer credential.',
    );
    assert(
      external
        ? !!merged.url && ['bearer', 'none'].includes(String(merged.auth_method))
        : !merged.url && merged.auth_method === 'api_key',
      400,
      'invalid_model_deployment',
      'Use a fixed provider API key, or an exact endpoint URL with bearer or no authentication.',
    );
    assert(
      merged.auth_method === 'none' ? !input.secret : !!(input.secret || existing?.secret_ciphertext),
      400,
      'credentials_required',
      'Provide the selected account or endpoint credential.',
    );
    if (external) {
      const endpoint = new URL(String(merged.url));
      assert(
        !endpoint.search && !endpoint.hash && !endpoint.pathname.endsWith('/'),
        400,
        'invalid_model_deployment',
        'Use the exact model API base URL without a trailing slash, query or fragment.',
      );
    }
  }
  if (merged.kind === 'search') {
    const provider = searchIdentity(merged);
    assert(
      !merged.url && !input.secret_headers,
      400,
      'invalid_search_connection',
      'Search connections use fixed provider endpoints and API key authentication.',
    );
    assert(
      merged.auth_method !== 'api_key' ||
        (input.secret === undefined ? existing?.secret_ciphertext : input.secret.trim()),
      400,
      'credentials_required',
      `Provide your ${searchProviders[provider].name} API key.`,
    );
    assert(
      merged.auth_method !== 'none' || !input.secret,
      400,
      'invalid_credentials',
      'Choose API key authentication for your own search credentials.',
    );
  }
  assert(
    !input.secret_env || merged.kind === 'mcp_stdio',
    400,
    'invalid_credentials',
    'Environment secrets are only available for approved stdio servers.',
  );
  if (merged.kind === 'model') {
    assert(
      ['openai', 'anthropic', 'openrouter', 'typesafe'].includes(String(merged.provider)),
      400,
      'provider_unsupported',
      'Choose a supported model provider.',
    );
    assert(!merged.url, 400, 'invalid_request', 'Model connections use reviewed provider endpoints.');
    assert(
      input.secret || existing?.secret_ciphertext,
      400,
      'credentials_required',
      'Provide a provider API key.',
    );
  }
  if (merged.kind === 'mcp_stdio') {
    assert(
      merged.auth_method === 'none' && !input.secret_headers,
      400,
      'invalid_credentials',
      'Use secret_env for approved package credentials and auth_method none for stdio.',
    );
    const entry = approvedStdio(merged.package, merged.package_version);
    assert(
      !merged.args || JSON.stringify(merged.args) === JSON.stringify(entry.args),
      400,
      'args_not_approved',
      'The approved package defines its launch arguments.',
    );
    assert(!input.secret, 400, 'invalid_credentials', 'Use secret_env for the approved package environment.');
    assert(
      Object.keys(input.secret_env || {}).every((key) => entry.environment_keys.includes(key)),
      400,
      'environment_not_approved',
      'This package does not accept one of those environment variables.',
    );
  }
  const { secret, secret_headers, secret_env, ...safe } = input;
  const data = {
    ...safe,
    name: merged.name.trim(),
    owner_subject_id: p.userId,
    ...(merged.kind === 'claude_subscription'
      ? { api_fallback: apiFallback, availability: 'pending_approval' as const }
      : {}),
    status:
      existing && secret === undefined && secret_headers === undefined && secret_env === undefined
        ? existing.status
        : merged.kind === 'model' ||
            merged.kind === 'mcp_stdio' ||
            merged.auth_method === 'none' ||
            secret ||
            secret_headers
          ? 'healthy'
          : 'pending',
    ...(secret ? { secret_ciphertext: seal(secret) } : {}),
    ...(secret_headers ? { headers_ciphertext: seal(secret_headers) } : {}),
    ...(secret_env ? { environment_ciphertext: seal(secret_env) } : {}),
  };
  return existing
    ? resources.update(tx, 'connections', existing.id, data)
    : resources.create(tx, 'connections', p.organizationId, data);
}
export function connectionHeaders(c: resources.Document<'connections'>) {
  const headers = c.headers_ciphertext ? unseal<Record<string, string>>(String(c.headers_ciphertext)) : {};
  if (c.secret_ciphertext) headers.Authorization = `Bearer ${unseal<string>(String(c.secret_ciphertext))}`;
  return headers;
}
export async function withMcp<T>(
  connection: resources.Document<'connections'>,
  fn: (client: Client) => Promise<T>,
) {
  assert(
    connection.kind === 'mcp_remote' && connection.url,
    400,
    'connection_not_remote',
    'A remote MCP URL is required.',
  );
  const execute = async (
    authProvider?: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider,
  ) => {
    const client = new Client({ name: 'hosted-agent-platform', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(String(connection.url)), {
      requestInit: { headers: connectionHeaders(connection) },
      fetch: mcpFetch,
      authProvider,
    });
    try {
      await client.connect(transport);
      return await fn(client);
    } finally {
      await client.close().catch(() => {});
    }
  };
  return connection.auth_method === 'oauth' ? withConnectionOAuth(connection, execute) : execute();
}
export async function connectionTools(
  c: resources.Document<'connections'>,
  options: { refresh?: boolean } = {},
): Promise<Schema['Tool'][]> {
  const raw = await rawConnectionTools(c, options.refresh);
  return raw.map((tool) => ({ ...tool, granted: c.access_tools.includes(tool.name) }));
}

async function rawConnectionTools(
  c: resources.Document<'connections'>,
  refresh = false,
): Promise<RawConnectionTool[]> {
  if (['model', 'claude_subscription', 'hugging_face', 'runpod', 'external_model'].includes(c.kind))
    return [];
  if (c.kind === 'search') return [searchTool];
  if (c.kind === 'mcp_stdio') return approvedStdio(c.package, c.package_version).tools;
  const setup = c.kind === 'composio' ? await enabledConnector(String(c.provider)) : undefined;
  // Include tenant, configuration and encrypted credential revisions, never
  // decrypted secrets or mutable grants. Local network policy changes also
  // invalidate discovery immediately in a running development process.
  const key = sha256(
    canonical({
      organization: c.organization_id,
      connection: c.id,
      revision: c.revision,
      kind: c.kind,
      url: c.url,
      provider: c.provider,
      account: c.external_account_id,
      auth: c.auth_method,
      credentials: [c.secret_ciphertext, c.headers_ciphertext, c.oauth_ciphertext],
      toolkit: setup?.toolkit_version,
      localOrigins: process.env.LOCAL_MCP_ALLOWED_ORIGINS,
    }),
  );
  return connectionToolCatalog.read(
    key,
    async () => {
      if (setup) return composioTools(setup.toolkit, setup.toolkit_version);
      return withMcp(c, (client) => {
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          connectionToolCatalog.invalidate(key);
        });
        return collectToolPages(async (cursor, signal) => {
          const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
          return {
            items: result.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            })),
            nextCursor: result.nextCursor,
          };
        });
      });
    },
    refresh,
  );
}
export async function authorizeConnection(_tx: Tx, p: Principal, c: resources.Document<'connections'>) {
  assertConnectionOwner(p, c);
  if (c.kind === 'claude_subscription') requireClaudeSubscriptionExecution();
  if (c.kind === 'mcp_remote' && c.auth_method === 'oauth')
    return {
      authorization_url: `${config.origin}/integrations/mcp/install?connection_id=${c.id}&organization_id=${p.organizationId}`,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    };
  assert(
    c.kind === 'composio',
    400,
    'authorization_method',
    'This connection uses its configured API key, headers, or MCP OAuth flow.',
  );
  return {
    authorization_url: `${config.origin}/integrations/composio/install?connection_id=${c.id}&organization_id=${p.organizationId}`,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  };
}
export async function testConnection(tx: Tx, p: Principal, c: resources.Document<'connections'>) {
  assertConnectionOwner(p, c);
  let status: 'healthy' | 'error' | 'unknown' = 'healthy';
  let message = 'Connection is available.';
  try {
    if (c.kind === 'claude_subscription') {
      status = 'unknown';
      message =
        'Named configuration saved. Native Claude subscription authentication is pending provider approval and runtime validation; no account was contacted.';
    } else if (['model', 'hugging_face', 'runpod', 'external_model'].includes(c.kind)) {
      status = 'unknown';
      message =
        'Credential stored. No inference request was made; the first authorized run validates it with the provider.';
    } else if (c.kind === 'search') {
      searchKey(c);
      status = 'unknown';
      message =
        'Search credentials are configured. No paid search request was made; the first authorized run validates the key.';
    } else if (c.kind === 'mcp_stdio') {
      await connectionTools(c);
      status = 'unknown';
      message =
        'The approved package catalog is valid. The server starts inside your sandbox on its first authorized tool call.';
    } else if (c.kind === 'composio') {
      assert(
        c.external_account_id && c.identity_verified,
        409,
        'authorization_required',
        'Connect and verify your account first.',
      );
      const sdk = await composio();
      const account = await sdk.connectedAccounts.get(String(c.external_account_id), {
        signal: AbortSignal.timeout(15000),
      });
      assert(
        account.id === c.external_account_id &&
          account.toolkit.slug === c.provider &&
          account.status === 'ACTIVE' &&
          !account.isDisabled,
        409,
        'authorization_required',
        'Authorization is incomplete or expired.',
      );
    } else await connectionTools(c, { refresh: true });
  } catch (error) {
    status = 'error';
    message =
      error instanceof AppError
        ? error.message
        : 'The remote service could not be reached. Check its URL and credentials.';
  }
  const observed_at = new Date().toISOString();
  await resources.update(tx, 'connections', c.id, {
    status: status === 'unknown' ? c.status : status,
    last_checked_at: observed_at,
  });
  return { status, observed_at, message };
}
