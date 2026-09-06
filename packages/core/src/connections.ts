import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Composio } from '@composio/core';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { assert, AppError } from './errors';
import { seal, unseal } from './crypto';
import { config } from './config';
import * as resources from './resources';
import { safeFetch, validatePublicURL } from '../../providers/src/network';
import type { components } from '../../contracts/api';
import { withConnectionOAuth } from './mcp-oauth';
import { approvedStdio } from './stdio-catalog';
import { searchKey, searchTool } from '../../providers/src/search';
import { collectToolPages } from '../../providers/src/tool-catalog';
type Schema = components['schemas'];
export function composio() {
  assert(
    process.env.COMPOSIO_API_KEY,
    503,
    'integration_not_configured',
    'The operator needs to configure Composio.',
  );
  return new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    allowTracking: false,
    disableVersionCheck: true,
    fileUploadDirs: false,
    toolkitVersions: JSON.parse(process.env.COMPOSIO_TOOLKIT_VERSIONS_JSON || '{}'),
  });
}
export function assertConnectionOwner(p: Principal, c: resources.Document) {
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
  if (merged.url) await validatePublicURL(String(merged.url));
  if (merged.kind === 'search') {
    assert(
      merged.provider === 'brave' && !merged.url && ['api_key', 'none'].includes(String(merged.auth_method)),
      400,
      'invalid_search_connection',
      'Choose Brave Search with your API key or managed funding.',
    );
    assert(
      merged.auth_method !== 'api_key' || input.secret || existing?.secret_ciphertext,
      400,
      'credentials_required',
      'Provide your Brave Search API key.',
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
      ['openai', 'anthropic', 'openrouter'].includes(String(merged.provider)),
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
  if (input.subject_id)
    assert(
      input.subject_id === p.userId,
      403,
      'subject_mismatch',
      'A connection must be authorized by its owner.',
    );
  const { secret, secret_headers, secret_env, ...safe } = input;
  const data = {
    ...safe,
    owner_subject_id: p.userId,
    status:
      merged.kind === 'model' ||
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
    : resources.create(tx, 'connections', p.organizationId, {
        ...data,
        grants: { version: 1, subject_type: 'user', subject_id: p.userId, tools: [] },
      });
}
export function connectionHeaders(c: resources.Document) {
  const headers = c.headers_ciphertext ? unseal<Record<string, string>>(String(c.headers_ciphertext)) : {};
  if (c.secret_ciphertext) headers.Authorization = `Bearer ${unseal<string>(String(c.secret_ciphertext))}`;
  return headers;
}
export async function withMcp<T>(connection: resources.Document, fn: (client: Client) => Promise<T>) {
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
      fetch: safeFetch,
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
export async function connectionTools(c: resources.Document): Promise<Schema['Tool'][]> {
  const grants = (c.grants as Schema['ConnectionGrantSet']).tools;
  if (c.kind === 'model') return [];
  if (c.kind === 'search') return [{ ...searchTool, granted: grants.includes(searchTool.name) }];
  if (c.kind === 'mcp_stdio')
    return approvedStdio(c.package, c.package_version).tools.map((t) => ({
      ...t,
      granted: grants.includes(t.name),
    }));
  if (c.kind === 'composio') {
    const sdk = composio();
    // The high-level raw-tools helper discards next_cursor. Use its public API
    // client so a large toolkit does not silently hide tools after the first page.
    return collectToolPages(async (cursor, signal) => {
      const page = await sdk.getClient().tools.list(
        {
          toolkit_slug: String(c.provider),
          toolkit_versions: sdk.getConfig().toolkitVersions,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
        { signal },
      );
      return {
        items: page.items.map((t) => ({
          name: t.slug,
          description: t.description,
          input_schema: t.input_parameters || {},
          granted: grants.includes(t.slug),
        })),
        nextCursor: page.next_cursor,
      };
    });
  }
  return withMcp(c, (client) =>
    collectToolPages(async (cursor, signal) => {
      const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
      return {
        items: result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
          granted: grants.includes(t.name),
        })),
        nextCursor: result.nextCursor,
      };
    }),
  );
}
export async function authorizeConnection(_tx: Tx, p: Principal, c: resources.Document) {
  assertConnectionOwner(p, c);
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
export async function testConnection(tx: Tx, p: Principal, c: resources.Document) {
  assertConnectionOwner(p, c);
  let status: 'healthy' | 'error' | 'unknown' = 'healthy';
  let message = 'Connection is available.';
  try {
    if (c.kind === 'model') {
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
      const account = await composio().connectedAccounts.get(String(c.external_account_id));
      assert(
        account.status === 'ACTIVE',
        409,
        'authorization_required',
        'Authorization is incomplete or expired.',
      );
    } else await connectionTools(c);
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
export async function setGrants(
  tx: Tx,
  p: Principal,
  c: resources.Document,
  input: Schema['ConnectionGrantSet'],
) {
  assertConnectionOwner(p, c);
  assert(
    input.subject_type !== 'external_subject',
    400,
    'subject_unsupported',
    'External subjects require a separately provisioned trusted identity binding.',
  );
  if (input.subject_type === 'organization')
    assert(
      ['owner', 'admin'].includes(p.role),
      403,
      'forbidden',
      'Only organization administrators may share a connection.',
    );
  else
    assert(
      input.subject_id === p.userId,
      403,
      'forbidden',
      'User grants must belong to the authorizing user.',
    );
  const catalog = await connectionTools(c);
  // OAuth discovery may refresh credentials in a separate transaction. Lock
  // only after discovery, then re-read authorization/revision before the write.
  await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [c.id]);
  c = await resources.get(tx, 'connections', c.id, p);
  assertConnectionOwner(p, c);
  const old = c.grants as Schema['ConnectionGrantSet'];
  assert(
    input.version === old.version,
    412,
    'stale_revision',
    'Connection grants changed. Reload before saving.',
  );
  assert(
    input.tools.every((t) => catalog.some((a) => a.name === t)),
    400,
    'unknown_tool',
    'The grant contains a tool absent from the current catalog.',
  );
  const grants = { ...input, version: old.version + 1 };
  await resources.update(tx, 'connections', c.id, { grants, shared: input.subject_type === 'organization' });
  return grants;
}
