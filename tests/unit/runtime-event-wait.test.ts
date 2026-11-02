import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { waitForRuntimeEvents } from '../../packages/runtime/src/manifest';
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it('delivers existing output immediately and wakes for newly appended output', async () => {
  // Real filesystem notifications must resolve while the deadline clock stays
  // frozen; wall-clock scheduling under coverage is not a runtime guarantee.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const directory = await mkdtemp(path.join(tmpdir(), 'macrofold-output-wait-'));
  directories.push(directory);
  const first = JSON.stringify({ sequence: 1, type: 'output.delta', data: { text: 'first' } }) + '\n';
  await writeFile(path.join(directory, 'events.jsonl'), first);
  const old = await waitForRuntimeEvents(directory, 0, 1000);
  expect(old.events).toHaveLength(1);
  const waiting = waitForRuntimeEvents(directory, old.nextOffset, 1000);
  const second = JSON.stringify({ sequence: 2, type: 'output.delta', data: { text: 'second' } }) + '\n';
  await writeFile(path.join(directory, 'events.jsonl'), first + second);
  const next = await waiting;
  expect(next.events).toEqual([{ sequence: 2, type: 'output.delta', data: { text: 'second' } }]);
  expect(vi.getTimerCount()).toBe(0);
  expect(next.nextOffset).toBe(Buffer.byteLength(first + second));
});
it('uses a bounded quiet repair wait and rejects unsupported waits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'macrofold-output-idle-'));
  directories.push(directory);
  expect((await waitForRuntimeEvents(directory, 0, 10)).events).toEqual([]);
  await expect(waitForRuntimeEvents(directory, 0, 1001)).rejects.toThrow('invalid_probe_wait');
});
it('returns a completed runtime immediately and supports a zero-wait probe', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const directory = await mkdtemp(path.join(tmpdir(), 'macrofold-output-ready-'));
  directories.push(directory);
  expect((await waitForRuntimeEvents(directory, 0, 0)).events).toEqual([]);
  const result = { output: 'done', outcome: 'success' };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result));
  expect((await waitForRuntimeEvents(directory, 0, 1000)).result).toEqual(result);
  expect(vi.getTimerCount()).toBe(0);
});
