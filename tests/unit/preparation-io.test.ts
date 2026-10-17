import { afterEach, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { boundedBody } from '../../packages/core/src/body';
import { seal, sha256 } from '../../packages/core/src/crypto';
import { LocalStore, R2Store, contentChunks } from '../../packages/providers/src/storage';
import { providerModelCatalog } from '../../packages/providers/src/model-catalog';

afterEach(() => vi.restoreAllMocks());

it('cancels a stalled body with its preparation signal without awaiting remote cleanup', async () => {
  const abort = new AbortController();
  const reason = new Error('Synthetic preparation deadline');
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ cancel });
  const pending = boundedBody(body, 1024, 60_000, abort.signal);
  const rejected = expect(pending).rejects.toBe(reason);
  abort.abort(reason);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it('stops metadata body consumption at the caller deadline instead of its longer provider deadline', async () => {
  const abort = new AbortController();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const transport = vi.fn<typeof fetch>(async () => new Response(body));
  const pending = providerModelCatalog(transport)('openrouter', { signal: abort.signal });
  const reason = new Error('Synthetic catalog preparation deadline');
  const rejected = expect(pending).rejects.toBe(reason);
  await vi.waitFor(() => expect(body.locked).toBe(true));
  abort.abort(reason);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
  expect(transport).toHaveBeenCalledOnce();
});

it('stops a real S3 SDK response body and forwards cancellation through the request handler', async () => {
  const abort = new AbortController();
  const body = new Readable({ read() {} });
  let requestOptions: unknown;
  const handler: Pick<S3Client['config']['requestHandler'], 'handle'> = {
    async handle(_request, options) {
      requestOptions = options;
      return { response: { statusCode: 200, headers: { 'content-length': '1' }, body } };
    },
  };
  const client = new S3Client({
    region: 'auto',
    credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' },
    maxAttempts: 1,
    requestHandler: handler,
  });
  const store = new R2Store(client, 'synthetic-bucket');
  const pending = store.get('synthetic/content/one', { signal: abort.signal });
  const rejected = expect(pending).rejects.toThrow('Object read interrupted');
  try {
    await vi.waitFor(() => expect(body.listenerCount('readable')).toBeGreaterThan(0));
    abort.abort(new Error('Synthetic object preparation deadline'));
    await rejected;
    expect(body.destroyed).toBe(true);
    expect(requestOptions).toMatchObject({ abortSignal: { aborted: true } });
  } finally {
    abort.abort();
    body.destroy();
    client.destroy();
  }
});

it('forwards cancellation into local file reads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'macrofold-preparation-'));
  try {
    const store = new LocalStore(directory);
    await store.put('synthetic/content/one', Buffer.from('synthetic'));
    const abort = new AbortController();
    abort.abort();
    await expect(store.get('synthetic/content/one', { signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(await store.get('synthetic/content/one')).toEqual(Buffer.from('synthetic'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not fetch subsequent content chunks after preparation is cancelled', async () => {
  const abort = new AbortController();
  const first = Buffer.from('first'),
    second = Buffer.from('second');
  const key = 'synthetic/manifest/context';
  const parts = [first, second].map((bytes, index) => ({
    key: `synthetic/content/${index}`,
    sha256: sha256(bytes),
    size: bytes.length,
  }));
  const get = vi.fn(async (requested: string) =>
    Buffer.from(
      seal(
        requested === key
          ? {
              version: 2,
              sha256: sha256(Buffer.concat([first, second])),
              size: first.length + second.length,
              chunks: parts,
            }
          : { bytes: first.toString('base64') },
      ),
    ),
  );
  const stream = contentChunks(key, undefined, { get }, abort.signal);
  expect((await stream.next()).value).toEqual(first);
  const reason = new Error('Synthetic chunk preparation deadline');
  abort.abort(reason);
  await expect(stream.next()).rejects.toBe(reason);
  expect(get.mock.calls.map(([requested]) => requested)).toEqual([key, parts[0].key]);
});
