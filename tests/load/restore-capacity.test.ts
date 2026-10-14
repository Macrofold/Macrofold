import { afterEach, expect, it, vi } from 'vitest';
import { stageRestoreObjects, type RestoreObject } from '../../packages/core/src/execution-hydration';
import { mapConcurrent } from '../../packages/core/src/concurrent';
import { seal, sha256 } from '../../packages/core/src/crypto';
import { storage } from '../../packages/providers/src/storage';
import { FaultMachine } from '../fixtures/cloud-machine';

afterEach(() => vi.restoreAllMocks());

it.each([4, 8, 16])('measures verified 4-MiB restores with %i simultaneous steps', async (concurrency) => {
  const content = Buffer.alloc(128 * 1024, 7),
    hash = sha256(content);
  const encrypted = Buffer.from(seal({ bytes: content.toString('base64') }));
  const objects: RestoreObject[] = Array.from({ length: 32 }, (_, i) => ({
    id: String(i),
    name: hash,
    kind: 'input_chunk',
    data: { key: String(i), size: content.length, sha256: hash },
  }));
  let active = 0,
    peak = 0,
    reads = 0,
    uploads = 0,
    verifiedBytes = 0;
  vi.spyOn(storage, 'get').mockImplementation(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    reads++;
    return encrypted;
  });
  const provider = new FaultMachine();
  vi.spyOn(provider, 'stage').mockImplementation(async (_binding, files) => {
    expect(files).toHaveLength(32);
    for (const file of files) {
      expect(sha256(file.content)).toBe(hash);
      verifiedBytes += file.content.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    uploads++;
  });
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 10);
  const started = performance.now();
  try {
    await mapConcurrent(Array.from({ length: 32 }), concurrency, async () => {
      expect(
        await stageRestoreObjects(
          provider,
          { name: 'fixture', sessionId: 'fixture', createdAt: new Date().toISOString() },
          objects,
        ),
      ).toHaveLength(32);
    });
  } finally {
    clearInterval(sample);
  }
  expect(reads).toBe(1024);
  expect(uploads).toBe(32);
  expect(verifiedBytes).toBe(128 * 1024 ** 2);
  expect(peak).toBe(concurrency * 8);
  console.log(
    JSON.stringify({
      experiment: 'restore-capacity',
      concurrency,
      decoded_mib: 128,
      elapsed_ms: Math.round(performance.now() - started),
      peak_reads: peak,
      peak_rss_mib: Math.round(peakRss / 1024 ** 2),
    }),
  );
});
