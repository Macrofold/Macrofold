import { assert } from '../../core/src/errors';

/** A catalog is untrusted and must finish completely before users can change grants. */
export async function collectToolPages<T extends { name: string }>(
  fetchPage: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<{
    items: T[];
    nextCursor?: string | null;
  }>,
): Promise<T[]> {
  const signal = AbortSignal.timeout(15000);
  const items: T[] = [];
  const cursors = new Set<string>();
  const names = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;
  do {
    const page = await fetchPage(cursor, signal);
    bytes += Buffer.byteLength(JSON.stringify(page.items));
    assert(
      items.length + page.items.length <= 5000 && bytes <= 8 * 1024 * 1024,
      502,
      'tool_catalog_too_large',
      'The remote catalog exceeds 5,000 tools or 8 MiB. Configure a smaller toolkit or MCP catalog.',
    );
    for (const tool of page.items) {
      assert(
        !names.has(tool.name),
        502,
        'invalid_tool_catalog',
        'The remote catalog returned duplicate tool names. Retry after the service catalog is stable.',
      );
      names.add(tool.name);
      items.push(tool);
    }
    cursor = page.nextCursor || undefined;
    if (cursor) {
      assert(
        !cursors.has(cursor) && cursors.size < 99,
        502,
        'invalid_tool_catalog',
        'The remote catalog repeated a cursor or exceeded 100 pages. Configure a bounded catalog.',
      );
      cursors.add(cursor);
    }
  } while (cursor);
  return items;
}
