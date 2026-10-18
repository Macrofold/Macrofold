import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../../packages/providers/src/storage';
import { configurePerformance, runPerformanceRoot } from '../../packages/core/src/performance';
import type { PerformanceRecord } from '../../packages/contracts/performance';

it('observes storage I/O without exposing keys/content and stops timing after capture closes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'performance-storage-'));
  const records: PerformanceRecord[] = [];
  const collector = configurePerformance({
    sampleRate: 1,
    durationSeconds: 300,
    sink: {
      enqueue(record) {
        if (record.state !== 'started') records.push(record);
      },
      flush: async () => {},
      close: async () => {},
    },
  });
  try {
    const store = new LocalStore(directory);
    const payload = Buffer.from('synthetic-private-storage-content');
    await runPerformanceRoot('storage', {}, async () => {
      await store.put('synthetic-private-object-key', payload);
      expect(await store.get('synthetic-private-object-key')).toEqual(payload);
      await expect(store.get('missing-private-object-key')).rejects.toMatchObject({ code: 'ENOENT' });
    });
    expect(records[0].stages['storage.read']?.count).toBe(2);
    expect(records[0].stages['storage.write']?.count).toBe(1);
    expect(JSON.stringify(records)).not.toContain('private');
    await collector.close();
    const now = vi.spyOn(performance, 'now');
    try {
      await store.put('after-capture', payload);
      expect(await store.get('after-capture')).toEqual(payload);
      expect(now).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  } finally {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  }
});
