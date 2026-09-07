import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { R2Store } from '../../packages/providers/src/storage';
import { charge, check, report } from './guard';

// Class A operations round up to $4.50/million after the free allowance. A tiny
// write is not necessarily below the user's $1 budget without this confirmation.
assert.equal(
  process.env.LIVE_R2_FREE_CLASS_A,
  '1',
  'Confirm at least 25 free R2 Class A requests remain before setting LIVE_R2_FREE_CLASS_A=1.',
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
const id = randomUUID(),
  prefix = `live-smoke/${id}`,
  object = `${prefix}/object.bin`,
  upload = `staging/live-smoke-${id}/upload.bin`;
const bytes = Buffer.from('Synthetic storage acceptance\n');
try {
  await check('r2', 'round-trip', async () => {
    // Conservatively reserve another complete Class B billing block. Class A is
    // permitted only against the explicitly confirmed free allowance above.
    charge('r2', 'round-trip', 360_000);
    report('r2', 'fixture-resources', { keys: [object, upload] });
    try {
      await store.put(object, bytes);
      assert((await store.get(object)).equals(bytes));
      const listed = await store.list(prefix, undefined, 2);
      assert.deepEqual(
        listed.objects.map((o) => [o.key, o.size]),
        [[object, bytes.length]],
      );
      assert(!listed.next_cursor);
      const plan = await store.uploadURL(upload, bytes.length, Date.now() + 60_000);
      assert(!Object.keys(plan.headers).some((key) => key.toLowerCase() === 'authorization'));
      const put = await fetch(plan.url, {
        method: 'PUT',
        headers: plan.headers,
        body: new Uint8Array(bytes),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(put.status, 200);
      assert((await store.readUpload(upload, bytes.length)).equals(bytes));
      await assert.rejects(store.readUpload(upload, bytes.length + 1), /Upload size mismatch/);
      return {
        putGetList: true,
        signedUpload: true,
        exactSizeValidation: true,
        bytesPerObject: bytes.length,
        browserCorsVerified: false,
      };
    } finally {
      // Delete only random keys owned by this invocation, including ambiguous PUTs.
      await store.delete(object);
      await store.delete(upload);
      assert.equal((await store.list(prefix, undefined, 1)).objects.length, 0);
      await assert.rejects(store.get(upload), { name: 'NoSuchKey' });
      report('r2', 'fixture-cleanup', { complete: true });
    }
  });
} finally {
  client.destroy();
}
