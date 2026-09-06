import { writeFile } from 'node:fs/promises';
import { parseConnectorCatalog } from '../packages/core/src/connector-catalog';
import { boundedJSON } from '../packages/core/src/body';
import { z } from 'zod';

// Public metadata only. This command never loads .env, sends credentials,
// creates connected accounts, or executes connector tools.
const base = 'https://raw.githubusercontent.com/ComposioHQ/composio';
const response = await fetch(`${base}/next/docs/public/data/toolkits.json`, {
  signal: AbortSignal.timeout(30000),
  redirect: 'error',
});
if (!response.ok) throw new Error(`Public catalog request failed (${response.status}).`);
const rows = z
  .array(
    z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string(),
      logo: z.string().nullable(),
      category: z.string().nullable(),
      toolCount: z.number(),
    }),
  )
  .parse(await boundedJSON(response, 32 * 1024 * 1024));
const data = parseConnectorCatalog(
  rows.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    description: entry.description.slice(0, 2000),
    logo: entry.logo || '',
    categories: [entry.category || 'Other'],
    tool_count: entry.toolCount,
  })),
);
await writeFile(
  new URL('../packages/providers/data/connector-catalog.json', import.meta.url),
  JSON.stringify(
    {
      source_url: `${base}/next/docs/public/data/toolkits.json`,
      updated_at: new Date().toISOString(),
      data,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Refreshed ${data.length} connector descriptions, categories, and logo URLs from Composio's public catalog.`,
);
