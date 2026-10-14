import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { config, isLocal } from '../../packages/core/src/config';
import { R2Store } from '../../packages/providers/src/storage';
import { seal, unseal, sha256 } from '../../packages/core/src/crypto';
import { mapConcurrent } from '../../packages/core/src/concurrent';
import { safeError } from './guard';

// Separate paid acceptance: at most 641 reads, 129 writes and their cleanup.
// Reserve whole R2 billing blocks ($4.50 Class A + $0.36 Class B), plus storage.
// Never launch this through ordinary CI or against pre-existing object keys.
assert(process.env.LIVE_API_TESTS === '1' && isLocal() && !config.allowPaid);
assert(Number(process.env.CAPACITY_R2_BUDGET_USD) >= 5, 'This probe reserves $5 of the authorized budget.');
const directory = path.resolve(process.env.CAPACITY_OUTPUT || `.data/r2-capacity-${Date.now()}`);
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, 'budget.json'),
  JSON.stringify({ reserved_usd: 5, at: new Date().toISOString() }),
  { flag: 'wx', mode: 0o600 },
);
const endpoint = new URL(process.env.R2_ENDPOINT!);
assert(endpoint.protocol === 'https:' && endpoint.hostname.endsWith('.r2.cloudflarestorage.com'));
const client = new S3Client({
  region: 'auto',
  endpoint: endpoint.href,
  maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const store = new R2Store(client);
const prefix = `capacity/${randomUUID()}`;
const keys = new Set<string>();
const bytes = Buffer.alloc(128 * 1024, 7),
  hash = sha256(bytes);
const encrypted = Buffer.from(seal({ bytes: bytes.toString('base64') }));
const results: Record<string, unknown>[] = [];
let cleanup = false;
try {
  const key = `${prefix}/read.bin`;
  keys.add(key);
  await store.put(key, encrypted);
  await store.get(key);
  for (const concurrency of [4, 8, 16, 32, 64]) {
    const latency: number[] = [];
    const started = performance.now();
    await mapConcurrent(Array.from({ length: 128 }), concurrency, async () => {
      const at = performance.now();
      const value = unseal<{ bytes: string }>((await store.get(key)).toString());
      assert.equal(sha256(Buffer.from(value.bytes, 'base64')), hash);
      latency.push(performance.now() - at);
    });
    latency.sort((a, b) => a - b);
    results.push({
      kind: 'read',
      concurrency,
      count: 128,
      bytes_per_object: bytes.length,
      elapsed_ms: Math.round(performance.now() - started),
      p95_ms: Math.round(latency[Math.ceil(latency.length * 0.95) - 1]),
    });
  }
  for (const concurrency of [4, 8, 16, 32]) {
    const started = performance.now();
    await mapConcurrent(
      Array.from({ length: 32 }, (_, i) => i),
      concurrency,
      async (i) => {
        const key = `${prefix}/write-${concurrency}-${i}.bin`;
        keys.add(key);
        await store.put(key, encrypted);
      },
    );
    results.push({
      kind: 'write',
      concurrency,
      count: 32,
      bytes_per_object: bytes.length,
      elapsed_ms: Math.round(performance.now() - started),
    });
  }
} catch (error) {
  results.push({ failure: safeError(error) });
  process.exitCode = 1;
} finally {
  try {
    await mapConcurrent([...keys], 8, (key) => store.delete(key));
    assert.equal((await store.list(prefix, undefined, 1)).objects.length, 0);
    cleanup = true;
  } finally {
    client.destroy();
    await writeFile(
      path.join(directory, 'results.json'),
      JSON.stringify({ results, cleanup, reserved_usd: 5 }, null, 2),
    );
  }
}
