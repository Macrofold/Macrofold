import { describe, it, expect } from 'vitest';
import { collectToolPages } from '../../packages/providers/src/tool-catalog';

describe('remote tool catalog pagination', () => {
  it('keeps tools and grants on later pages and passes one deadline through every request', async () => {
    const cursors: (string | undefined)[] = [];
    const signals: AbortSignal[] = [];
    const result = await collectToolPages(async (cursor, signal) => {
      cursors.push(cursor);
      signals.push(signal);
      return cursor
        ? { items: [{ name: 'second', granted: true }] }
        : { items: [{ name: 'first', granted: false }], nextCursor: 'opaque-next' };
    });
    expect(cursors).toEqual([undefined, 'opaque-next']);
    expect(signals[0]).toBe(signals[1]);
    expect(result).toEqual([
      { name: 'first', granted: false },
      { name: 'second', granted: true },
    ]);
  });
  it('rejects repeated cursors, duplicate names, and oversized catalogs instead of silently truncating', async () => {
    await expect(
      collectToolPages(async (cursor) => ({ items: [{ name: cursor || 'first' }], nextCursor: 'cycle' })),
    ).rejects.toMatchObject({ code: 'invalid_tool_catalog' });
    await expect(
      collectToolPages(async (cursor) => ({
        items: [{ name: 'duplicate' }],
        nextCursor: cursor ? undefined : 'next',
      })),
    ).rejects.toMatchObject({ code: 'invalid_tool_catalog' });
    await expect(
      collectToolPages(async () => ({
        items: Array.from({ length: 5001 }, (_, i) => ({ name: String(i) })),
      })),
    ).rejects.toMatchObject({ code: 'tool_catalog_too_large' });
  });
  it('does not return a partial catalog when a subsequent page fails', async () => {
    await expect(
      collectToolPages(async (cursor) => {
        if (cursor) throw new Error('provider unavailable');
        return { items: [{ name: 'first' }], nextCursor: 'next' };
      }),
    ).rejects.toThrow('provider unavailable');
  });
});
