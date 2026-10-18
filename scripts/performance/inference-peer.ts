import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { Client } from '../../sdk/typescript/src/index';
import { fixtureCpuAffinity, fixturePeerCpus } from './fixture-affinity';

/** Fixture-only SDK driver and OTLP drain. Keeping these outside the API process
 * prevents caller serialization and export-receiver CPU from diluting its cost. */
export type PeerConfiguration = {
  origin: string;
  key: string;
  body: Parameters<Client['inferences']['create']>[0];
  expected: unknown;
  calls: number;
  warmups: number;
  rate: number;
  concurrency: number;
};
export type PeerSample = {
  index: number;
  runId: string;
  adapterMs: number;
  e2eMs: number;
  arrivalLagMs: number;
  intendedStartMs: number;
  submittedStartMs: number;
  submittedRequestMs: number;
};
export type PeerCommand =
  | { type: 'configure'; configuration: PeerConfiguration }
  | { type: 'invoke'; warmup: boolean }
  | { type: 'stats' }
  | { type: 'stop' };
export type PeerReply =
  | { type: 'ready'; traceURL: string | null; cpuAffinity: string | null }
  | { type: 'configured' }
  | { type: 'result'; samples: PeerSample[] }
  | { type: 'stats'; counters: { exports: number; bytes: number; rejected: number; peak_active: number } }
  | { type: 'stopped' }
  | { type: 'failed' };

assert(process.env.INFERENCE_PROFILE_PEER === '1' && process.send);
assert(process.env.PLATFORM_MODE === 'local' && process.env.ALLOW_PAID_EXECUTION === 'false');
assert(process.env.OPENROUTER_API_KEY === 'synthetic-inference-profile');
assert(process.env.ANTHROPIC_API_KEY === 'synthetic-inference-profile');
const peerCpus = fixturePeerCpus();
if (peerCpus)
  // Pin existing loader/V8 threads too; the peer inherits the API mask at fork.
  execFileSync('taskset', ['--all-tasks', '--pid', '--cpu-list', peerCpus, String(process.pid)], {
    stdio: 'ignore',
  });
const tracing = process.env.PROFILE_INFERENCE_TRACING === '1';
const counters = { exports: 0, bytes: 0, rejected: 0, peak_active: 0 };
let active = 0;
const server = tracing
  ? createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/v1/traces' || active >= 8) {
        counters.rejected++;
        request.resume();
        response.writeHead(503).end();
        return;
      }
      active++;
      counters.peak_active = Math.max(counters.peak_active, active);
      let bytes = 0,
        rejected = false;
      request.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        counters.bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024 && !rejected) {
          rejected = true;
          counters.rejected++;
          response.writeHead(413).end();
          request.destroy();
        }
      });
      request.once('end', () => {
        if (rejected) return;
        counters.exports++;
        response
          .writeHead(200, {
            'content-type':
              request.headers['content-type'] === 'application/x-protobuf'
                ? 'application/x-protobuf'
                : 'application/json',
          })
          .end();
      });
      request.once('close', () => active--);
      request.once('error', () => {
        if (!rejected) counters.rejected++;
        rejected = true;
        response.destroy();
      });
    })
  : undefined;
if (server) {
  server.requestTimeout = server.headersTimeout = 5000;
  server.maxConnections = 8;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
}
const address = server?.address();
assert(!address || typeof address === 'object');
process.send({
  type: 'ready',
  traceURL: address && typeof address === 'object' ? `http://127.0.0.1:${address.port}/v1/traces` : null,
  cpuAffinity: fixtureCpuAffinity(),
} satisfies PeerReply);

let configuration: PeerConfiguration | undefined;
let client: Client | undefined;
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert(configuration && url.origin === configuration.origin && url.pathname === '/v1/inferences');
  assert.equal(init?.method, 'POST');
  return networkFetch(input, { ...init, redirect: 'error' });
};
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (server)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
}
process.once('disconnect', () => {
  // An aborted owner must not leave a driver alive on pending HTTP deadlines.
  void stop().finally(() => process.exit(0));
});

process.on('message', (command: PeerCommand) => {
  void (async () => {
    if (command.type === 'configure') {
      const next = command.configuration;
      const origin = new URL(next.origin);
      assert.equal(origin.hostname, '127.0.0.1');
      assert.equal(origin.protocol, 'http:');
      assert.equal(origin.href, `${origin.origin}/`);
      assert(Number.isSafeInteger(next.calls) && next.calls > 0 && next.calls <= 10000);
      assert(Number.isSafeInteger(next.warmups) && next.warmups >= 0 && next.warmups <= 200);
      assert(Number.isSafeInteger(next.rate) && next.rate >= 0 && next.rate <= 100);
      assert(Number.isSafeInteger(next.concurrency) && next.concurrency >= 1 && next.concurrency <= 64);
      configuration = next;
      client = new Client({ baseURL: next.origin, apiKey: next.key, retries: 0 });
      process.send?.({ type: 'configured' } satisfies PeerReply);
      return;
    }
    if (command.type === 'stats') {
      process.send?.({ type: 'stats', counters: { ...counters } } satisfies PeerReply);
      return;
    }
    if (command.type === 'stop') {
      await stop();
      process.send?.({ type: 'stopped' } satisfies PeerReply);
      process.disconnect?.();
      return;
    }
    assert(command.type === 'invoke' && configuration && client);
    const settings = configuration,
      sdk = client;
    const began = performance.now();
    const invoke = async (index: number): Promise<PeerSample> => {
      const intended = index >= 0 && settings.rate ? began + (index * 1000) / settings.rate : undefined;
      if (intended !== undefined)
        while (performance.now() < intended)
          await new Promise((resolve) => setTimeout(resolve, Math.max(1, intended - performance.now())));
      const submitted = performance.now();
      const receipt = await sdk.inferences.create(settings.body, { idempotencyKey: `profile-${index}` });
      const completed = performance.now();
      assert.equal(receipt.status, 'succeeded');
      assert.deepEqual(receipt.result?.inference?.value, settings.expected);
      const adapterMs = receipt.result?.inference?.timings_ms?.provider;
      assert(typeof adapterMs === 'number');
      const arrival = intended ?? submitted;
      return {
        index,
        runId: receipt.run_id,
        adapterMs,
        e2eMs: completed - arrival,
        arrivalLagMs: submitted - arrival,
        intendedStartMs: arrival - began,
        submittedStartMs: submitted - began,
        submittedRequestMs: completed - submitted,
      };
    };
    const samples: PeerSample[] = [];
    if (command.warmup) {
      for (let index = -settings.warmups; index < 0; index++) samples.push(await invoke(index));
    } else {
      const pending = new Set<Promise<void>>();
      for (let index = 0; index < settings.calls; index++) {
        if (pending.size >= settings.concurrency) await Promise.race(pending);
        const task = invoke(index)
          .then((sample) => {
            samples.push(sample);
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      }
      await Promise.all(pending);
    }
    samples.sort((a, b) => a.index - b.index);
    process.send?.({ type: 'result', samples } satisfies PeerReply);
  })().catch(() => process.send?.({ type: 'failed' } satisfies PeerReply));
});
