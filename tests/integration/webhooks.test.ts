import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, seal } from '../../packages/core/src/crypto';
import { handleApi } from '../../packages/core/src/http';
import { executeRun } from '../../packages/core/src/engine';
import * as resources from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';
import { deliverWebhook, enqueueWebhook } from '../../packages/core/src/webhooks';
let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  account = await fixtureAccount('Webhook fixture');
  vi.spyOn(network, 'validatePublicURL').mockImplementation(async (value) => ({
    url: new URL(value),
    addresses: [{ address: '93.184.216.34', family: 4 }],
  }));
});
afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
  await authPool.end();
});
async function request(method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(config.origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${account.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}
it('commits a run completion delivery, signs exact bytes, retries, rotates and creates a distinct replay', async () => {
  const created = await request('POST', '/v1/webhook-endpoints', {
    url: 'https://receiver.example.test/events',
    events: ['run.completed'],
  });
  expect(created.status).toBe(201);
  expect(created.body.signing_secret).toMatch(/^whsec_/);
  expect(created.body.secret_ciphertext).toBeUndefined();
  const project = await request('POST', '/v1/projects', { name: 'Webhook lifecycle' });
  const admitted = await request('POST', '/v1/runs', {
    project_id: project.body.id,
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    prompt: 'private prompt must not enter webhook',
  });
  expect(admitted.status).toBe(202);
  await executeRun(account.p.organizationId, admitted.body.run_id);
  const list = await request('GET', '/v1/webhook-deliveries');
  expect(list.body.data).toHaveLength(1);
  const d = list.body.data[0],
    requests: { timestamp: string; signature: string; body: string; eventId: string }[] = [];
  const transport: typeof fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      timestamp: headers.get('Webhook-Timestamp')!,
      signature: headers.get('Webhook-Signature')!,
      body: String(init?.body),
      eventId: headers.get('Webhook-Id')!,
    });
    return new Response(null, { status: requests.length === 1 ? 503 : 204 });
  };
  await deliverWebhook(account.p.organizationId, d.id, transport);
  expect((await request('GET', '/v1/webhook-deliveries')).body.data[0]).toMatchObject({
    status: 'retrying',
    attempts: 1,
    last_status_code: 503,
  });
  const rotated = await request('POST', `/v1/webhook-endpoints/${created.body.id}/rotate-secret`, {});
  await deliverWebhook(account.p.organizationId, d.id, transport);
  expect(requests[0].body).not.toContain('private prompt');
  expect(requests[1].body).toBe(requests[0].body);
  for (const secret of [created.body.signing_secret, rotated.body.signing_secret])
    expect(requests[1].signature).toContain(
      'v1,' +
        createHmac('sha256', secret)
          .update(requests[1].timestamp + '.' + requests[1].body)
          .digest('hex'),
    );
  await deliverWebhook(account.p.organizationId, d.id, transport);
  expect(requests).toHaveLength(2);
  const replay = await request('POST', `/v1/webhook-deliveries/${d.id}/replay`, {});
  expect(replay.status).toBe(202);
  const newId = replay.body.result.delivery_id;
  expect(newId).not.toBe(d.id);
  await deliverWebhook(account.p.organizationId, newId, transport);
  expect(requests[2].eventId).toBe(requests[0].eventId);
  expect((await request('GET', `/v1/operations/${replay.body.id}`)).body.status).toBe('succeeded');
  const rows = (await request('GET', '/v1/webhook-deliveries')).body.data;
  expect(rows).toHaveLength(2);
  expect(rows.every((r: { status: string }) => r.status === 'delivered')).toBe(true);
}, 30000);
it('deduplicates producer events, exhausts failures and stops disabled destinations', async () => {
  const endpoint = await transaction(account.p.organizationId, (tx) =>
    resources.create(tx, 'webhooks', account.p.organizationId, {
      url: 'https://receiver.example.test/events',
      events: ['connection.expired'],
      enabled: true,
      secret_ciphertext: seal('fixture-secret'),
    }),
  );
  const event = id();
  await transaction(account.p.organizationId, async (tx) => {
    await enqueueWebhook(
      tx,
      account.p.organizationId,
      'connection.expired',
      { connection_id: id() },
      { eventId: event },
    );
    await enqueueWebhook(tx, account.p.organizationId, 'connection.expired', {}, { eventId: event });
  });
  const d = await transaction(account.p.organizationId, (tx) =>
    resources.list(tx, 'deliveries', account.p, new URLSearchParams(), { event_id: event }),
  );
  expect(d.data).toHaveLength(1);
  let calls = 0;
  const fail: typeof fetch = async () => {
    calls++;
    throw new Error('secret in destination error');
  };
  for (let i = 0; i < 9; i++) await deliverWebhook(account.p.organizationId, d.data[0].id, fail);
  expect(calls).toBe(8);
  expect(
    await transaction(account.p.organizationId, (tx) => resources.get(tx, 'deliveries', d.data[0].id)),
  ).toMatchObject({ status: 'exhausted', attempts: 8, error_code: 'delivery_unreachable' });
  await transaction(account.p.organizationId, (tx) =>
    resources.update(tx, 'webhooks', endpoint.id, { enabled: false }),
  );
  await transaction(account.p.organizationId, (tx) =>
    enqueueWebhook(tx, account.p.organizationId, 'connection.expired', {}, { eventId: id() }),
  );
  expect(
    (
      await transaction(account.p.organizationId, (tx) =>
        resources.list(tx, 'deliveries', account.p, new URLSearchParams(), { endpoint_id: endpoint.id }),
      )
    ).data,
  ).toHaveLength(1);
});
