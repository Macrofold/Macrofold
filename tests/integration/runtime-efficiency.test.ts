import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import * as resources from '../../packages/core/src/resources';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun, getNativeRun } from '../../packages/core/src/runs';
import { readRestoreInventoryPage } from '../../packages/core/src/execution-hydration';
import { emitBatch, eventsAfter, streamEvents } from '../../packages/core/src/events';
import { storagePreparation } from '../../packages/core/src/storage-preparation';
import {
  describeContent,
  readContent,
  saveContent,
  saveChunkManifest,
  storage,
} from '../../packages/providers/src/storage';
import { id, sha256 } from '../../packages/core/src/crypto';
import { listenRunEvents } from '../../packages/core/src/run-event-notifications';
let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  account = await fixtureAccount('Runtime efficiency');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await retireFixtureRuns(account.p.organizationId);
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function runFixture() {
  return transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, { name: 'Events' });
    const operation = await createWorktree(tx, account.p, workspace.id, { name: 'main', branch: 'main' });
    const worktreeId = operation.result.worktree_id;
    if (typeof worktreeId !== 'string') throw new Error('Missing Worktree');
    return admitRun(tx, account.p, {
      worktree_id: worktreeId,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    });
  });
}
it('notifies another process listener only after a durable event commit, never after rollback', async () => {
  const run = await runFixture(),
    org = account.p.organizationId;
  const received: string[][] = [];
  const listener = listenRunEvents((...ids) => received.push(ids));
  expect(listener).toBeDefined();
  try {
    const readyBy = Date.now() + 3000;
    while (!listener!.connected() && Date.now() < readyBy)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listener!.connected()).toBe(true);
    await expect(
      transaction(org, async (tx) => {
        await emitBatch(tx, org, run.run_id, [{ type: 'output.delta', data: { text: 'rolled back' } }]);
        throw new Error('rollback fixture');
      }),
    ).rejects.toThrow('rollback fixture');
    await transaction(org, (tx) =>
      emitBatch(tx, org, run.run_id, [{ type: 'output.delta', data: { text: 'committed' } }]),
    );
    const receivedBy = Date.now() + 3000;
    while (!received.length && Date.now() < receivedBy)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual([[org, run.run_id]]);
  } finally {
    listener?.close();
  }
});
it('publishes a native event page and its cursor once, rejects changed identity and stale ownership', async () => {
  const run = await runFixture(),
    org = account.p.organizationId,
    claim = id();
  await transaction(org, (tx) =>
    tx.query('UPDATE runs SET execution_binding=$2 WHERE id=$1', [
      run.run_id,
      JSON.stringify({ phase: 'poll', lock: claim, eventOffset: 0 }),
    ]),
  );
  const events = [1, 2, 3].map((sequence) => ({
    type: 'output.delta',
    data: { text: `part ${sequence}` },
    producer: { id: 'native:1', sequence },
  }));
  const first = await transaction(org, (tx) =>
    emitBatch(tx, org, run.run_id, events, { execution: { claim, offset: 128 } }),
  );
  const repeated = await transaction(org, (tx) =>
    emitBatch(tx, org, run.run_id, events, { execution: { claim, offset: 128 } }),
  );
  expect(repeated.map((event) => event.id)).toEqual(first.map((event) => event.id));
  expect(first.map((event) => event.sequence)).toEqual(['2', '3', '4']);
  await expect(
    transaction(org, (tx) =>
      emitBatch(tx, org, run.run_id, [{ ...events[0], data: { text: 'different' } }], {
        execution: { claim, offset: 256 },
      }),
    ),
  ).rejects.toMatchObject({ code: 'event_identity_conflict' });
  await expect(
    transaction(org, (tx) =>
      emitBatch(tx, org, run.run_id, [{ ...events[0], producer: { id: 'native:1', sequence: 4 } }], {
        execution: { claim: id(), offset: 256 },
      }),
    ),
  ).rejects.toMatchObject({ code: 'lease_lost' });
  const saved = await transaction(
    org,
    async (tx) =>
      (await tx.query('SELECT event_sequence,execution_binding FROM runs WHERE id=$1', [run.run_id])).rows[0],
  );
  expect(saved.event_sequence).toBe('4');
  expect(saved.execution_binding.eventOffset).toBe(128);
  expect((await eventsAfter(org, run.run_id, '1')).map((event) => event.data.text)).toEqual([
    'part 1',
    'part 2',
    'part 3',
  ]);
});
it('allocates contiguous sequences for mixed events and deduplicates repeated identities inside a page', async () => {
  const run = await runFixture(),
    org = account.p.organizationId;
  const produced = {
    type: 'tool.completed',
    data: { result: 'once' },
    producer: { id: 'tool', sequence: 0 },
  };
  const saved = await transaction(org, (tx) =>
    emitBatch(tx, org, run.run_id, [produced, { type: 'output.delta', data: { text: 'text' } }, produced]),
  );
  expect(saved.map((event) => event.sequence)).toEqual(['2', '3', '2']);
  expect(await eventsAfter(org, run.run_id, '1')).toHaveLength(2);
});
it('wakes a live backpressured reader for committed output and releases it on cancel', async () => {
  const run = await runFixture(),
    org = account.p.organizationId;
  const stream = await streamEvents(org, run.run_id, '1', new AbortController().signal);
  const reader = stream.getReader();
  try {
    const next = reader.read();
    await transaction(org, (tx) =>
      emitBatch(tx, org, run.run_id, [{ type: 'output.delta', data: { text: 'committed output' } }]),
    );
    const result = await next;
    expect(result.done).toBe(false);
    expect(new TextDecoder().decode(result.value)).toContain('committed output');
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
});
it('reuses verified small chunk identity without uploading it again, including empty files', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('small')]) {
    const saved = await saveContent(account.p.organizationId, bytes);
    const put = vi.spyOn(storage, 'put');
    expect(await describeContent(saved.key, saved.sha256)).toEqual([
      { key: saved.key, sha256: saved.sha256, size: bytes.length },
    ]);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
  }
});
it('snapshots stable indexed restore metadata pages once and rejects a changed source revision', async () => {
  const accepted = await runFixture(),
    org = account.p.organizationId;
  const run = await transaction(org, (tx) => getNativeRun(tx, accepted.run_id));
  const saved = await saveContent(org, Buffer.from('same durable bytes'));
  await transaction(org, (tx) =>
    resources.update(tx, 'worktrees', run.worktree_id, {
      git_files: [],
      files: Array.from({ length: 20 }, (_, i) => ({
        ...saved,
        path: `file-${String(i).padStart(2, '0')}.txt`,
        type: 'file' as const,
        modified_at: new Date().toISOString(),
        git_ignored: false,
      })),
    }),
  );
  const source = { organization: org, run: run.id, worktree: run.worktree_id, session: run.session_id };
  const first = await transaction(org, (tx) => readRestoreInventoryPage(tx, source, 0));
  expect(first.files).toHaveLength(16);
  expect(first.complete).toBe(false);
  const second = await transaction(org, (tx) => readRestoreInventoryPage(tx, source, 16, first.revision));
  expect(second.files.map((file) => file.path)).toEqual([
    'file-16.txt',
    'file-17.txt',
    'file-18.txt',
    'file-19.txt',
  ]);
  expect(second.complete).toBe(true);
  expect(
    (
      await transaction(org, (tx) =>
        tx.query("SELECT 1 FROM execution_objects WHERE run_id=$1 AND kind='input_source'", [run.id]),
      )
    ).rowCount,
  ).toBe(2);
  await transaction(org, (tx) => resources.update(tx, 'worktrees', run.worktree_id, { files: [] }));
  await expect(
    transaction(org, (tx) => readRestoreInventoryPage(tx, source, 16, first.revision)),
  ).rejects.toMatchObject({ code: 'restore_source_changed' });
});
it('reuses content verification only inside its active publication guard', async () => {
  const org = account.p.organizationId,
    bytes = Buffer.from('verified only during this publication'),
    saved = await saveContent(org, bytes);
  const preparation = await storagePreparation(org, async () => null);
  const get = vi.spyOn(storage, 'get'),
    put = vi.spyOn(storage, 'put');
  const chunks = [{ key: saved.key, sha256: saved.sha256, size: bytes.length }];
  const [manifest, duplicate] = await Promise.all([
    preparation.verification.manifest(saved.sha256, bytes.length, chunks),
    preparation.verification.manifest(saved.sha256, bytes.length, chunks),
  ]);
  expect(duplicate).toEqual(manifest);
  expect(put).toHaveBeenCalledTimes(1);
  const reads = get.mock.calls.length;
  await preparation.verification.verify(manifest);
  expect(get).toHaveBeenCalledTimes(reads);
  await expect(
    preparation.verification.verify({ ...manifest, size_bytes: String(bytes.length + 1) }),
  ).rejects.toMatchObject({ code: 'content_size_mismatch' });
  await preparation.dispose();
  await expect(preparation.verification.verify(manifest)).rejects.toMatchObject({
    code: 'preparation_expired',
  });
  const next = await storagePreparation(org, async () => null);
  await next.verification.verify(manifest);
  expect(get.mock.calls.length).toBeGreaterThan(reads);
  await next.dispose();
  expect(manifest.sha256).toBe(sha256(bytes));
});
it('preserves a previous verified manifest when a new candidate claims its hash with incorrect bytes', async () => {
  const org = account.p.organizationId,
    bytes = Buffer.from('previous durable content');
  const good = await saveContent(org, bytes),
    bad = await saveContent(org, Buffer.from('incorrect new content'));
  const manifest = await saveChunkManifest(org, good.sha256, bytes.length, [
    { key: good.key, sha256: good.sha256, size: bytes.length },
  ]);
  await expect(
    saveChunkManifest(org, good.sha256, Number(bad.size_bytes), [
      { key: bad.key, sha256: bad.sha256, size: Number(bad.size_bytes) },
    ]),
  ).rejects.toThrow();
  expect(await readContent(manifest.key, manifest.sha256)).toEqual(bytes);
});
