import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { id, seal, sha256 } from '../../packages/core/src/crypto';
import * as r from '../../packages/core/src/resources';
import {
  maintainStorage,
  requireStorageCapacity,
  storageReport,
} from '../../packages/core/src/storage-maintenance';
import { credit } from '../../packages/core/src/ledger';
import { reconcileFinance } from '../../packages/core/src/maintenance';
import type { ObjectStore } from '../../packages/providers/src/storage';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const DAY = 86400000;
function memoryStore(at: Date) {
  const objects = new Map<string, { bytes: Buffer; size: number; modified_at: string }>();
  const store: ObjectStore = {
    async put(key, bytes) {
      objects.set(key, { bytes, size: bytes.length, modified_at: at.toISOString() });
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error('Missing object');
      return value.bytes;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix, cursor, limit = 1000) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
      return {
        objects: keys
          .slice(0, limit)
          .map((key) => ({ key, size: objects.get(key)!.size, modified_at: objects.get(key)!.modified_at })),
        next_cursor: keys.length > limit ? keys[limit - 1] : undefined,
      };
    },
  };
  return { store, objects };
}
it('retains current, pinned and sampled checkpoints and collects only unreachable content after grace', async () => {
  const org = id(),
    at = new Date(),
    fixture = memoryStore(new Date(at.getTime() - 100 * DAY));
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Storage retention fixture']);
  const key = org + '/content/' + sha256('kept'),
    orphan = org + '/content/' + sha256('orphan'),
    manifest = org + '/manifest/' + sha256('manifest');
  await fixture.store.put(key, Buffer.from(seal({ bytes: Buffer.from('kept').toString('base64') })));
  await fixture.store.put(orphan, Buffer.from(seal({ bytes: 'b3JwaGFu' })));
  await fixture.store.put(
    manifest,
    Buffer.from(
      seal({
        version: 2,
        sha256: sha256('kept'),
        size: 4,
        chunks: [{ key, sha256: sha256('kept'), size: 4 }],
      }),
    ),
  );
  const values = await transaction(org, async (tx) => {
    const project = await r.create(tx, 'projects', org, { name: 'Retained files' });
    const ws = await r.create(tx, 'workspaces', org, {
      project_id: project.id,
      files: [{ key: manifest, path: 'kept.txt', sha256: sha256('kept'), type: 'file', size_bytes: '4' }],
      git_files: [],
    });
    const current = await r.create(tx, 'checkpoints', org, { workspace_id: ws.id, files: [], pinned: false });
    const pinned = await r.create(tx, 'checkpoints', org, { workspace_id: ws.id, files: [], pinned: true });
    const old = await r.create(tx, 'checkpoints', org, { workspace_id: ws.id, files: [], pinned: false });
    await tx.query('UPDATE checkpoints SET created_at=$1', [new Date(at.getTime() - 100 * DAY)]);
    await r.update(tx, 'workspaces', ws.id, { latest_checkpoint_id: current.id });
    return { ws, current, pinned, old };
  });
  expect((await maintainStorage(org, fixture.store, at)).deleted).toBe(0);
  await transaction(org, async (tx) => {
    expect((await r.get(tx, 'checkpoints', values.old.id)).deleted).toBe(true);
    expect((await r.get(tx, 'checkpoints', values.pinned.id)).deleted).not.toBe(true);
    expect((await r.get(tx, 'checkpoints', values.current.id)).deleted).not.toBe(true);
    expect(
      (await tx.query('SELECT unreferenced_since FROM storage_objects WHERE key=$1', [key])).rows[0]
        .unreferenced_since,
    ).toBeNull();
  });
  expect((await maintainStorage(org, fixture.store, new Date(at.getTime() + 15 * DAY))).deleted).toBe(1);
  expect(fixture.objects.has(orphan)).toBe(false);
  expect(fixture.objects.has(key)).toBe(true);
  expect(fixture.objects.has(manifest)).toBe(true);
  // Tenant publication holds a shared lock. An exclusive maintenance pass waits for it.
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((r) => {
      entered = r;
    }),
    hold = new Promise<void>((r) => {
      release = r;
    });
  const writer = transaction(org, async () => {
    entered();
    await hold;
  });
  await ready;
  let completed = false;
  const sweep = maintainStorage(org, fixture.store, new Date(at.getTime() + 16 * DAY)).then(() => {
    completed = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(completed).toBe(false);
  release();
  await writer;
  await sweep;
});
it('meters physical bytes once, caps overage to explicit funds and blocks new writes without deleting files', async () => {
  const org = id(),
    at = new Date(),
    fixture = memoryStore(at),
    key = org + '/content/' + sha256('large');
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Storage billing fixture']);
  await fixture.store.put(key, Buffer.from(seal({ bytes: 'ZmFrZSBzaXpl' })));
  fixture.objects.get(key)!.size = 2 * 1024 ** 3; // Metadata fixture, no giant allocation or paid object write.
  await transaction(org, (tx) => credit(tx, org, 1000000n, 'fixture:funding'));
  await maintainStorage(org, fixture.store, at);
  await expect(transaction(org, (tx) => requireStorageCapacity(tx, org))).rejects.toMatchObject({
    code: 'storage_quota_exceeded',
  });
  await transaction(org, (tx) =>
    tx.query(
      'UPDATE organizations SET settings=settings||\'{"storage_overage_enabled":true,"storage_monthly_budget_micro_usd":"200"}\' WHERE id=$1',
      [org],
    ),
  );
  const later = new Date(at.getTime() + 3600000);
  await maintainStorage(org, fixture.store, later);
  await transaction(org, async (tx) => {
    const usage = (await tx.query('SELECT sum(charged_micro_usd)::text AS sum FROM storage_usage')).rows[0];
    expect(usage.sum).toBe('138'); // $0.10 / 720 hours, integer fraction carried.
    expect((await reconcileFinance(tx, org)).status).toBe('balanced');
    expect((await storageReport(tx, org)).over_quota).toBe(false);
  });
  await maintainStorage(org, fixture.store, new Date(at.getTime() + 2 * 3600000));
  await transaction(org, async (tx) => {
    expect(
      (await tx.query('SELECT sum(charged_micro_usd)::text AS sum FROM storage_usage')).rows[0].sum,
    ).toBe('200');
    expect((await storageReport(tx, org)).over_quota).toBe(true);
    expect((await reconcileFinance(tx, org)).status).toBe('balanced');
  });
  expect(fixture.objects.has(key)).toBe(true);
});
