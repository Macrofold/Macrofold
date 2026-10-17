import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, ApiError, type Schema } from '../../sdk/typescript/src/client';

const id = '01900000-0000-7000-8000-000000000001';
const urls = Object.fromEntries(
  ['status', 'result', 'events', 'stream', 'cancel'].map((key) => [
    key,
    `https://example.test/v1/runs/${id}/${key}`,
  ]),
);
const recovery = {
  run_id: id,
  session_id: null,
  worktree_id: null,
  status: 'running',
  recovery_reason: 'in_progress',
  urls,
};
const body: Schema['InferenceCreate'] = {
  input: { messages: [] },
  model_binding: { provider: 'openrouter', model: 'fixture', billing_mode: 'managed' },
  limits: { max_cost_micro_usd: '1000', max_output_tokens: 10, timeout_seconds: 10 },
};
const refusal = (code = 'inference_service_unavailable') => ({
  error: { code, message: 'Busy', request_id: id, retryable: true, details: { reason: 'local_capacity' } },
});
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});
async function clientFor(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  return new Client({ baseURL: `http://127.0.0.1:${address.port}`, apiKey: 'synthetic' });
}
function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
}

describe('immediate inference transport', () => {
  it('makes one attempt by default and retains an HTTP refusal identity', async () => {
    let calls = 0;
    const client = await clientFor((_request, response) => {
      calls++;
      json(response, 503, refusal(), { 'retry-after': '1', 'x-run-id': id });
    });
    await expect(client.inferences.create(body, { idempotencyKey: 'saved-key' })).rejects.toMatchObject({
      status: 503,
      idempotencyKey: 'saved-key',
      runId: id,
    });
    expect(calls).toBe(1);
  });
  it('does not replay an ambiguous network failure even with explicit retries', async () => {
    let calls = 0;
    const client = await clientFor((request) => {
      calls++;
      request.socket.destroy();
    });
    await expect(
      client.inferences.create(body, { idempotencyKey: 'saved-key', inferenceRetries: 2 }),
    ).rejects.toMatchObject({ idempotencyKey: 'saved-key', cause: expect.any(Error) });
    expect(calls).toBe(1);
  });
  it('retries only confirmed pre-admission refusal under the same identity', async () => {
    const keys: unknown[] = [];
    const client = await clientFor((request, response) => {
      keys.push(request.headers['idempotency-key']);
      json(response, keys.length === 1 ? 503 : 202, keys.length === 1 ? refusal() : recovery);
    });
    expect(
      await client.inferences.create(body, { idempotencyKey: 'saved-key', inferenceRetries: 1 }),
    ).toMatchObject({ status: 'running', recovery_reason: 'in_progress' });
    expect(keys).toEqual(['saved-key', 'saved-key']);
  });
  it('does not shorten Retry-After or reset the caller deadline', async () => {
    let calls = 0;
    const client = await clientFor((_request, response) => {
      calls++;
      json(response, 503, refusal(), { 'retry-after': new Date(Date.now() + 60_000).toUTCString() });
    });
    await expect(
      client.inferences.create(body, { inferenceRetries: 2, timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });
  it('does not retry an unknown admission or administrative disablement', async () => {
    let calls = 0;
    const client = await clientFor((_request, response) => {
      calls++;
      json(response, 503, refusal('inference_admission_unknown'));
    });
    await expect(client.inferences.create(body, { inferenceRetries: 2 })).rejects.toMatchObject({
      code: 'inference_admission_unknown',
    });
    expect(calls).toBe(1);
  });
  it('keeps identity and abort classification before headers', async () => {
    const client = await clientFor(() => {});
    const controller = new AbortController();
    controller.abort(new DOMException('Stop', 'AbortError'));
    await expect(
      client.inferences.create(body, { signal: controller.signal, idempotencyKey: 'aborted-key' }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      idempotencyKey: 'aborted-key',
      cause: controller.signal.reason,
    });
  });
  it('times out a stalled token supplier without dispatching and observes its late rejection', async () => {
    let reject!: (cause: unknown) => void,
      calls = 0;
    const token = new Promise<string>((_resolve, fail) => {
      reject = fail;
    });
    const client = new Client({
      token: () => token,
      fetch: async () => {
        calls++;
        return Response.json(recovery);
      },
    });
    await expect(
      client.inferences.create(body, { idempotencyKey: 'stalled-token', timeoutMs: 25 }),
    ).rejects.toMatchObject({
      idempotencyKey: 'stalled-token',
      name: 'TimeoutError',
      cause: expect.any(DOMException),
    });
    reject(new Error('Late credential rejection'));
    await Promise.resolve();
    expect(calls).toBe(0);
  });
  it('keeps identity after a malformed success body without resubmitting', async () => {
    let calls = 0;
    const client = await clientFor((_request, response) => {
      calls++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{');
    });
    await expect(
      client.inferences.create(body, { idempotencyKey: 'decode-key', inferenceRetries: 2 }),
    ).rejects.toMatchObject({ idempotencyKey: 'decode-key', cause: expect.any(Error) });
    expect(calls).toBe(1);
  });
  it('retains identity for preparation failures and a null error body', async () => {
    const cause = new Error('Credential lookup failed');
    const client = new Client({
      token: async () => {
        throw cause;
      },
    });
    await expect(client.inferences.create(body, { idempotencyKey: 'credential-key' })).rejects.toMatchObject({
      idempotencyKey: 'credential-key',
      cause,
    });
    const circular = { ...body };
    circular.input = circular;
    await expect(client.inferences.create(circular, { idempotencyKey: 'encode-key' })).rejects.toMatchObject({
      idempotencyKey: 'encode-key',
      cause: expect.any(TypeError),
    });
    const service = await clientFor((_request, response) => json(response, 502, null));
    await expect(service.inferences.create(body, { idempotencyKey: 'null-error-key' })).rejects.toMatchObject(
      {
        status: 502,
        code: 'http_error',
        idempotencyKey: 'null-error-key',
      },
    );
  });
  it('retains accepted Run and URLs after a direct stream ends without a terminal frame', async () => {
    const client = await clientFor((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': id });
      response.end(
        `data: ${JSON.stringify({ schema_version: 1, run_id: id, type: 'run.accepted', occurred_at: '2026-10-16T00:00:00Z', data: { run_id: id, session_id: null, worktree_id: null, status: 'running', urls, delivery: 'live' } })}\n\n`,
      );
    });
    const stream = client.inferences.stream(body, { idempotencyKey: 'stream-key' });
    expect((await stream.next()).value).toMatchObject({ type: 'run.accepted' });
    await expect(stream.next()).rejects.toMatchObject({ idempotencyKey: 'stream-key', runId: id, urls });
  });
});

describe('inference wire variants', () => {
  it('accepts recovery variants and rejects contradictory result/recovery fields', async () => {
    const specification = JSON.parse(
      await readFile(new URL('../../docs/api/openapi.json', import.meta.url), 'utf8'),
    );
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile({
      ...specification.components.schemas.InferenceResponse,
      components: specification.components,
    });
    for (const example of specification.components.schemas.InferenceResponse.examples)
      expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    const bad = structuredClone(specification.components.schemas.InferenceResponse.examples[0]);
    bad.result.execution_outcome = 'failure';
    expect(validate(bad)).toBe(false);
    for (const reason of ['in_progress', 'finalization_pending', 'outcome_unknown'])
      expect(validate({ ...recovery, recovery_reason: reason }), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({
        ...recovery,
        result: { run_id: id, final: true, execution_outcome: 'success', persistence_status: 'not_required' },
      }),
    ).toBe(false);
    expect(validate({ ...recovery, recovery_reason: undefined })).toBe(false);
    expect(validate({ ...recovery, urls: { ...urls, cancel: undefined } })).toBe(false);
  });
  it('validates stream categories and rejects contradictory terminal/recovery data', async () => {
    const specification = JSON.parse(
      await readFile(new URL('../../docs/api/openapi.json', import.meta.url), 'utf8'),
    );
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile({
      ...specification.components.schemas.InferenceStreamEvent,
      components: specification.components,
    });
    const frame = (type: string, data: unknown) => ({
      schema_version: 1,
      run_id: id,
      type,
      occurred_at: '2026-10-16T00:00:00Z',
      data,
    });
    const terminal = specification.components.schemas.InferenceResponse.examples[0];
    expect(validate(frame('run.succeeded', terminal)), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(frame('run.failed', terminal))).toBe(false);
    const error = { code: 'inference_recovery_required', message: 'Recover', idempotency_key: 'saved', urls };
    expect(validate(frame('transport.error', { ...error, recovery_reason: 'outcome_unknown' }))).toBe(true);
    expect(validate(frame('transport.error', { ...error, reason: 'result_available' }))).toBe(true);
    expect(
      validate(
        frame('transport.error', { ...error, reason: 'result_available', recovery_reason: 'in_progress' }),
      ),
    ).toBe(false);
    expect(validate(frame('output.delta', { message_id: 'message', content_index: 0, text: 'Hello' }))).toBe(
      true,
    );
    expect(validate(frame('output.delta', { message_id: 'message', content_index: 0 }))).toBe(false);
  });
});
