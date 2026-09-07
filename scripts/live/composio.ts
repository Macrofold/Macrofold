import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { composio, connectionTools } from '../../packages/core/src/connections';
import { pool, authPool } from '../../packages/db';
import type { Document } from '../../packages/core/src/resources';
import { charge, check } from './guard';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'backend.composio.dev');
  const execution = url.pathname.includes('/tools/execute/');
  if (execution) assert(url.pathname.endsWith('/HACKERNEWS_GET_ITEM'));
  charge('composio', execution ? 'public-tool-execution' : 'tool-metadata', execution ? 10_000 : 0);
  return nativeFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
};
// Stainless clients capture fetch at construction, including the no-retry tool client.
const sdk = composio();
sdk.getClient().maxRetries = 0;
try {
  await check('composio', 'public-tool', async () => {
    const page = await sdk.getClient().tools.list({ toolkit_slug: 'hackernews', limit: 20 });
    const discovered = page.items.find((t) => t.slug === 'HACKERNEWS_GET_ITEM');
    assert(discovered?.version && discovered.version !== 'latest');
    process.env.COMPOSIO_TOOLKIT_VERSIONS_JSON = JSON.stringify({ hackernews: discovered.version });
    const tools = await connectionTools({
      kind: 'composio',
      provider: 'hackernews',
      grants: { tools: [discovered.slug] },
    } as unknown as Document);
    const tool = tools.find((t) => t.name === discovered.slug);
    assert(tool?.granted && tool.input_schema);
    // Public tools have no connected account. This validates the actual SDK and
    // catalog adapter; it cannot establish private-account OAuth/broker acceptance.
    const result = await sdk.tools.execute(
      discovered.slug,
      { userId: `live-fixture:${randomUUID()}`, version: discovered.version, arguments: { id: 8863 } },
      { signal: AbortSignal.timeout(30_000) },
    );
    assert.equal(result.successful, true);
    assert.equal(result.data.id, 8863);
    assert(result.logId, 'Require a real provider execution log');
    return {
      toolkit: 'hackernews',
      tool: discovered.slug,
      version: discovered.version,
      logId: result.logId,
      responseKeys: Object.keys(result.data),
      privateAccountBrokerVerified: false,
      oauthCallbackVerified: false,
    };
  });
} finally {
  globalThis.fetch = nativeFetch;
  await pool.end();
  await authPool.end();
}
