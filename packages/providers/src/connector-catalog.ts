import { Composio } from '@composio/core';
import snapshot from '../data/connector-catalog.json';
import {
  parseConnectorCatalog,
  type Connector,
  type ConnectorCatalog,
  type ConnectorCatalogSource,
} from '../../core/src/connector-catalog';

type Page = { items: Connector[]; nextCursor?: string | null };
export async function collectConnectorPages(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<Page>,
) {
  const signal = AbortSignal.timeout(15000);
  const entries: Connector[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;
  do {
    const page = await fetchPage(cursor, signal);
    entries.push(...page.items);
    bytes += Buffer.byteLength(JSON.stringify(page.items));
    if (entries.length > 10000 || bytes > 8 * 1024 * 1024)
      throw new Error('Connector catalog exceeds its limit.');
    cursor = page.nextCursor || undefined;
    if (cursor && (seen.has(cursor) || seen.size >= 99))
      throw new Error('Connector catalog pagination did not finish.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return parseConnectorCatalog(entries);
}

/** Cache metadata only, never per-user accounts or permissions. A failed/partial
 * upstream read leaves the last complete catalog intact, with bounded retries. */
export function createConnectorCatalogSource(
  fetchPage?: (cursor: string | undefined, signal: AbortSignal) => Promise<Page>,
  now = Date.now,
): ConnectorCatalogSource {
  let cached: ConnectorCatalog = {
    data: parseConnectorCatalog(snapshot.data),
    source: 'snapshot',
    updated_at: snapshot.updated_at,
  };
  let expires = 0;
  let pending: Promise<ConnectorCatalog> | undefined;
  return {
    async read() {
      if (!fetchPage || now() < expires) return cached;
      if (pending) return pending;
      pending = (async () => {
        try {
          const data = await collectConnectorPages(fetchPage);
          cached = { data, source: 'live', updated_at: new Date(now()).toISOString() };
          expires = now() + 60 * 60 * 1000;
        } catch {
          expires = now() + 5 * 60 * 1000;
        } finally {
          pending = undefined;
        }
        return cached;
      })();
      return pending;
    },
  };
}

let source: ConnectorCatalogSource | undefined;
export function connectorCatalogSource(): ConnectorCatalogSource {
  if (!source) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    const client = apiKey
      ? new Composio({
          apiKey,
          allowTracking: false,
          disableVersionCheck: true,
          fileUploadDirs: false,
        }).getClient()
      : undefined;
    source = createConnectorCatalogSource(
      client
        ? async (cursor, signal) => {
            // The high-level SDK helper loses pagination. Use the pinned public SDK
            // client and consume every page of native (Composio-managed) toolkits.
            const page = await client.toolkits.list(
              { limit: 1000, managed_by: 'composio', sort_by: 'usage', ...(cursor ? { cursor } : {}) },
              { signal, maxRetries: 0 },
            );
            return {
              items: page.items
                .filter((entry) => entry.type === 'native')
                .map((entry) => ({
                  slug: entry.slug,
                  name: entry.name,
                  description: entry.meta.description || '',
                  logo: entry.meta.logo || '',
                  categories: entry.meta.categories.map((category) => category.name),
                  tool_count: entry.meta.tools_count,
                })),
              nextCursor: page.next_cursor,
            };
          }
        : undefined,
    );
  }
  return source;
}
