import type { MachineBinding, MachineProvider } from './ports';
import type { SnapshotEntry } from '../../runtime/src/manifest';
import { readContent, type StoredChunk } from '../../providers/src/storage';
import { assert } from './errors';

export const RESTORE_BATCH_OBJECTS = 32;
// Fits both the Vercel upload and Docker's five-MiB write limit, including one full chunk.
const RESTORE_BATCH_BYTES = 4 * 1024 ** 2;
const RESTORE_READ_CONCURRENCY = 4;
export type RestoreObject = { id: string; name: string } & (
  { kind: 'input_chunk'; data: StoredChunk } | { kind: 'input_page'; data: { entries: SnapshotEntry[] } }
);

/** Bound bytes as well as file count; small files share one session lookup/upload.
 * SQL progress belongs to the caller and must only commit after this succeeds. */
export async function stageRestoreObjects(
  provider: MachineProvider,
  machine: MachineBinding,
  objects: RestoreObject[],
): Promise<RestoreObject[]> {
  const batch: { item: RestoreObject; size: number; page: string }[] = [];
  let bytes = 0;
  for (const item of objects.slice(0, RESTORE_BATCH_OBJECTS)) {
    const page = item.kind === 'input_page' ? JSON.stringify(item.data.entries) : '';
    const size = item.kind === 'input_chunk' ? item.data.size : Buffer.byteLength(page);
    assert(
      Number.isSafeInteger(size) && size >= 0 && size <= RESTORE_BATCH_BYTES,
      502,
      'restore_failed',
      'Invalid restore object size.',
    );
    if (bytes + size > RESTORE_BATCH_BYTES) break;
    batch.push({ item, size, page });
    bytes += size;
  }
  const files: { path: string; content: Buffer }[] = [];
  for (let offset = 0; offset < batch.length; offset += RESTORE_READ_CONCURRENCY) {
    // Drain in-flight reads before releasing the phase lease on any failure.
    const results = await Promise.allSettled(
      batch.slice(offset, offset + RESTORE_READ_CONCURRENCY).map(async ({ item, size, page }) => {
        const content =
          item.kind === 'input_chunk'
            ? await readContent(item.data.key, item.data.sha256)
            : Buffer.from(page);
        assert(content.length === size, 502, 'restore_failed', 'Restore object size mismatch.');
        const dest = item.kind === 'input_chunk' ? `chunks/${item.name}` : `page-${item.name}.json`;
        return { path: `/platform-control/restore/${dest}`, content };
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      files.push(result.value);
    }
  }
  if (files.length) await provider.stage(machine, files);
  return batch.map(({ item }) => item);
}
