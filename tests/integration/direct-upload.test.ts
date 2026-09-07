import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { createHmac, createHash } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, sha256 } from '../../packages/core/src/crypto';
import { handleApi } from '../../packages/core/src/http';
import { storage, R2Store, readContent } from '../../packages/providers/src/storage';
import * as resources from '../../packages/core/src/resources';
import { cleanupTransfers } from '../../packages/core/src/transfers';
const raw = new Map<string, Buffer>();
const secret = 'fixture-secret-not-an-account';
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// This fixture validates actual AWS SigV4 presigned PUTs independently of the SDK.
// GET/DELETE exercise the SDK's real HTTP serialization against a local S3 protocol peer.
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (req.method === 'PUT') {
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!;
    const credential = url.searchParams.get('X-Amz-Credential')!,
      scope = credential.slice(credential.indexOf('/') + 1);
    const [date, region, service] = scope.split('/');
    const params = new URLSearchParams(url.search);
    params.delete('X-Amz-Signature');
    const encode = (v: string) =>
      encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const query = [...params]
      .map(([k, v]) => [encode(k), encode(v)])
      .sort(([a, av], [b, bv]) => (a! < b! ? -1 : a! > b! ? 1 : av! < bv! ? -1 : av! > bv! ? 1 : 0))
      .map((v) => v.join('='))
      .join('&');
    const headers = signed
      .split(';')
      .map((k) => `${k}:${String(req.headers[k] || '').trim()}\n`)
      .join('');
    const canonical = ['PUT', url.pathname, query, headers, signed, 'UNSIGNED-PAYLOAD'].join('\n');
    const key = hmac(hmac(hmac(hmac('AWS4' + secret, date!), region!), service!), 'aws4_request');
    const signature = hmac(
      key,
      ['AWS4-HMAC-SHA256', url.searchParams.get('X-Amz-Date'), scope, hash(canonical)].join('\n'),
    ).toString('hex');
    if (signature !== url.searchParams.get('X-Amz-Signature')) {
      res.writeHead(403).end();
      return;
    }
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    raw.set(url.pathname, Buffer.concat(parts));
    res.writeHead(200).end();
    return;
  }
  if (req.method === 'DELETE') {
    raw.delete(url.pathname);
    res.writeHead(204).end();
    return;
  }
  const value = raw.get(url.pathname);
  if (!value) {
    res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
    return;
  }
  res
    .writeHead(200, { 'Content-Length': value.length, 'Content-Type': 'application/octet-stream' })
    .end(value);
});
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;
let account: Awaited<ReturnType<typeof fixtureAccount>>, r2: R2Store;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  r2 = new R2Store(
    new S3Client({
      endpoint: `http://127.0.0.1:${port}`,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: secret },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      maxAttempts: 1,
    }),
    'fixture',
  );
  storage.uploadURL = r2.uploadURL.bind(r2);
  storage.readUpload = r2.readUpload.bind(r2);
  const original = storage.delete.bind(storage);
  vi.spyOn(storage, 'delete').mockImplementation((key) =>
    key.startsWith('staging/') ? r2.delete(key) : original(key),
  );
  account = await fixtureAccount('Direct upload');
});
afterAll(async () => {
  delete storage.uploadURL;
  delete storage.readUpload;
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await authPool.end();
});
async function request(method: string, path: string, body?: unknown) {
  const response = await handleApi(
    new Request(config.origin + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + account.key,
        'Idempotency-Key': id(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
it('uploads above Vercel body limits directly, verifies before atomic publication and expires staging', async () => {
  const project = (await request('POST', '/v1/projects', { name: 'Large direct upload' })).body;
  const workspace = (await request('GET', '/v1/workspaces/' + project.default_workspace_id)).body;
  const bytes = Buffer.alloc(6 * 1024 * 1024, 42),
    digest = sha256(bytes);
  const plan = (
    await request('POST', `/v1/workspaces/${workspace.id}/transfers`, {
      direction: 'push',
      base_revision: workspace.revision,
      paths: ['large.bin'],
      manifest: [
        {
          path: 'large.bin',
          local_sha256: digest,
          local_size_bytes: bytes.length,
          baseline_known: true,
          baseline_sha256: null,
        },
      ],
    })
  ).body;
  const action = plan.actions[0],
    url = new URL(action.url);
  expect(url.origin).not.toBe(config.origin);
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  expect(plan.uploads).toBeUndefined(); // Internal raw keys are never exposed as API fields.
  const wrongHeaders = new Headers(action.required_headers);
  const wrongSize = await fetch(action.url, { method: 'PUT', headers: wrongHeaders, body: 'bad' });
  expect(wrongSize.status).toBe(403);
  expect(
    (await request('POST', `/v1/transfers/${plan.id}/apply`, { expected_revision: workspace.revision }))
      .status,
  ).toBe(409);
  expect(
    (
      await fetch(action.url, {
        method: 'PUT',
        headers: action.required_headers,
        body: Buffer.alloc(bytes.length, 41),
      })
    ).ok,
  ).toBe(true);
  expect(
    (await request('POST', `/v1/transfers/${plan.id}/apply`, { expected_revision: workspace.revision }))
      .status,
  ).toBe(422);
  expect((await fetch(action.url, { method: 'PUT', headers: action.required_headers, body: bytes })).ok).toBe(
    true,
  );
  expect(
    (await request('POST', `/v1/transfers/${plan.id}/apply`, { expected_revision: workspace.revision }))
      .status,
  ).toBe(202);
  const state = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'workspaces', workspace.id),
  );
  const file = (state.files as { key: string; sha256: string }[])[0]!;
  expect((await readContent(file.key, file.sha256)).equals(bytes)).toBe(true);
  // Reusing the still-live raw upload capability cannot mutate a published encrypted checkpoint.
  await fetch(action.url, {
    method: 'PUT',
    headers: action.required_headers,
    body: Buffer.alloc(bytes.length, 0),
  });
  expect((await readContent(file.key, file.sha256)).equals(bytes)).toBe(true);
  await transaction(account.p.organizationId, async (tx) => {
    await resources.update(tx, 'transfers', plan.id, {
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    await tx.query(
      "UPDATE dispatch_jobs SET available_at=now()-interval '1 second' WHERE resource_id=$1 AND kind='transfer_cleanup'",
      [plan.id],
    );
  });
  await cleanupTransfers(10000);
  expect(raw.has(url.pathname)).toBe(false);
  expect((await readContent(file.key, file.sha256)).equals(bytes)).toBe(true);
  // Multi-megabyte encryption and real Git checkpoints take longer under V8 coverage.
  // Keep the same payload and integrity assertions with a bounded instrumentation allowance.
}, 180000);
