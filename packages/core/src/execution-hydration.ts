import type { Tx } from '../../db';
import type { FileRecord } from './files';
import type { MachineBinding, MachineProvider } from './ports';
import type { SnapshotEntry } from '../../runtime/src/manifest';
import { readContent, type StoredChunk } from '../../providers/src/storage';
import { assert } from './errors';
import { mapConcurrent } from './concurrent';

export const RESTORE_BATCH_OBJECTS = 32;
// Fits both the Vercel upload and Docker's five-MiB write limit, including one full chunk.
const RESTORE_BATCH_BYTES = 4 * 1024 ** 2;
const RESTORE_READ_CONCURRENCY = 8;
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
  const files = await mapConcurrent(batch, RESTORE_READ_CONCURRENCY, async ({ item, size, page }) => {
    const content =
      item.kind === 'input_chunk' ? await readContent(item.data.key, item.data.sha256) : Buffer.from(page);
    assert(content.length === size, 502, 'restore_failed', 'Restore object size mismatch.');
    const dest = item.kind === 'input_chunk' ? `chunks/${item.name}` : `page-${item.name}.json`;
    return { path: `/platform-control/restore/${dest}`, content };
  });
  if (files.length) await provider.stage(machine, files);
  return batch.map(({ item }) => item);
}

export type RestoreSourceRevision = { worktree: string; session: string };
type RestoreFile = FileRecord & { namespace: 'workspace' | 'home'; git: boolean };

const RESTORE_INVENTORY_PAGE = 16;
type RestoreInventorySource = { organization: string; run: string; worktree: string; session: string };

/** Snapshot metadata pages once under the accepted source revisions. Indexed
 * reads then avoid repeatedly expanding/sorting a large JSONB file inventory.
 * The engine deletes these temporary pages with its final input progress commit. */
export async function readRestoreInventoryPage(
  tx: Tx,
  source: RestoreInventorySource,
  offset: number,
  expected?: RestoreSourceRevision,
) {
  type Page = { files: RestoreFile[]; revision: RestoreSourceRevision; total: number };
  async function read() {
    return (
      await tx.query<{ data: Page; worktree_revision: string; session_revision: string }>(
        `SELECT e.data,w.revision::text AS worktree_revision,s.revision::text AS session_revision
       FROM execution_objects e JOIN worktrees w ON w.id=$3 JOIN sessions s ON s.id=$4 AND s.worktree_id=w.id
       WHERE e.run_id=$1 AND e.kind='input_source' AND e.name=$2`,
        [source.run, String(offset), source.worktree, source.session],
      )
    ).rows[0];
  }
  let page = await read();
  if (!page) {
    assert(offset === 0, 409, 'restore_inventory_missing', 'The saved restore inventory is unavailable.');
    await tx.query(
      `WITH source AS MATERIALIZED (
      SELECT w.revision::text AS worktree_revision,s.revision::text AS session_revision,
        coalesce(w.data->'files','[]'::jsonb) AS files,coalesce(w.data->'git_files','[]'::jsonb) AS git,
        coalesce(s.data->'state_files','[]'::jsonb) AS home
      FROM worktrees w JOIN sessions s ON s.id=$4 AND s.worktree_id=w.id WHERE w.id=$3
    ), inventory AS MATERIALIZED (
      SELECT files.value||jsonb_build_object('namespace',files.namespace,'git',files.git) AS file,
        row_number() OVER (ORDER BY files.namespace,files.value->>'path')-1 AS position
      FROM source CROSS JOIN LATERAL (
        SELECT value,'workspace' AS namespace,false AS git FROM jsonb_array_elements(source.files)
        UNION ALL SELECT value,'workspace',true FROM jsonb_array_elements(source.git)
        UNION ALL SELECT value,'home',false FROM jsonb_array_elements(source.home)
      ) files
    ), pages AS (
      SELECT (position/$5::bigint)*$5::bigint AS offset,jsonb_agg(file ORDER BY position) AS files FROM inventory GROUP BY position/$5::bigint
      UNION ALL SELECT 0,'[]'::jsonb WHERE NOT EXISTS(SELECT 1 FROM inventory)
    ) INSERT INTO execution_objects(id,organization_id,run_id,kind,name,data)
      SELECT gen_random_uuid(),$1,$2,'input_source',pages.offset::text,jsonb_build_object('files',pages.files,
        'revision',jsonb_build_object('worktree',source.worktree_revision,'session',source.session_revision),
        'total',(SELECT count(*) FROM inventory)) FROM pages CROSS JOIN source
      ON CONFLICT(run_id,kind,name) DO NOTHING`,
      [source.organization, source.run, source.worktree, source.session, RESTORE_INVENTORY_PAGE],
    );
    page = await read();
  }
  assert(page, 409, 'execution_context_missing', 'The restore source is unavailable.');
  const revision = page.data.revision;
  assert(
    revision.worktree === page.worktree_revision &&
      revision.session === page.session_revision &&
      (!expected || (expected.worktree === revision.worktree && expected.session === revision.session)),
    409,
    'restore_source_changed',
    'The restore source changed while preparing its inventory.',
  );
  return {
    revision,
    files: page.data.files,
    nextOffset: offset + page.data.files.length,
    complete: offset + page.data.files.length >= page.data.total,
  };
}
