import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { customerDataServer } from '../../examples/integrations/mcp';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { saveConnection, connectionTools, withMcp } from '../../packages/core/src/connections';
import { ConnectionOAuth } from '../../packages/core/src/mcp-oauth';
import { safeFetch } from '../../packages/providers/src/network';

const readNotes = vi.fn(async () => [{ id: 'note-1', title: 'Preference', body: 'Quiet hotels' }]);
const server = customerDataServer(readNotes, async (token) =>
  token === 'local-fixture-key' ? 'alice' : undefined,
);
let origin: string;
let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  origin = `http://127.0.0.1:${address.port}`;
  account = await fixtureAccount('Local MCP');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it('saves, discovers and invokes an authenticated loopback MCP; removing its allowance blocks later calls', async () => {
  vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', origin);
  const input = {
    name: 'Local notes',
    kind: 'mcp_remote' as const,
    auth_method: 'bearer' as const,
    secret: 'local-fixture-key',
    url: origin + '/mcp',
  };
  const connection = await transaction(account.p.organizationId, (tx) =>
    saveConnection(tx, account.p, input),
  );
  const tools = await connectionTools(connection);
  expect(tools.map((tool) => tool.name)).toEqual(['read_customer_notes']);
  expect(tools[0].granted).toBe(false);
  const result = await withMcp(connection, (client) =>
    client.callTool({ name: tools[0].name, arguments: {} }),
  );
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify([{ id: 'note-1', title: 'Preference', body: 'Quiet hotels' }]) },
  ]);
  expect(readNotes).toHaveBeenCalledWith('alice');
  await expect(safeFetch(input.url)).rejects.toMatchObject({ code: 'unsafe_url' });
  vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', '');
  await expect(connectionTools(connection)).rejects.toMatchObject({ code: 'unsafe_url' });
  await expect(
    transaction(account.p.organizationId, (tx) => saveConnection(tx, account.p, input)),
  ).rejects.toMatchObject({ code: 'unsafe_url' });
  expect(readNotes).toHaveBeenCalledTimes(1);
});

it('applies the local policy to OAuth authorization and pins discovery identity', async () => {
  vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', origin);
  const provider = new ConnectionOAuth({}, 'fixture-state');
  await provider.redirectToAuthorization(new URL(origin + '/authorize?state=fixture-state'));
  expect(provider.redirect?.origin).toBe(origin);
  await provider.saveDiscoveryState({ authorizationServerUrl: origin });
  provider.saveClientInformation({ client_id: 'fixture-client' });
  await expect(
    provider.saveDiscoveryState({ authorizationServerUrl: 'http://localhost:59621' }),
  ).rejects.toMatchObject({ code: 'oauth_issuer_changed' });
  vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', '');
  await expect(provider.redirectToAuthorization(new URL(origin + '/authorize'))).rejects.toMatchObject({
    code: 'unsafe_url',
  });
});
