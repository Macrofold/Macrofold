import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, type Schema } from '../sdk/typescript/src/index';

export const hello = 'Hello from the agent\n';
export type JourneyOptions = {
  harness: 'codex' | 'claude-code' | 'opencode';
  model: string;
  timeoutSeconds: number;
  runBudget: string;
  connectionId?: string;
  beforeRun?: (key: string, body: Schema['RunCreate']) => Promise<void>;
  accepted?: (run: Schema['RunAccepted']) => Promise<void>;
  observed?: (event: Schema['Event']) => Promise<void>;
};

/** Customer-only HTTP journey, shared by deterministic Docker and opt-in live staging. */
export async function agentJourney(client: Client, options: JourneyOptions) {
  const signal = AbortSignal.timeout((options.timeoutSeconds * 2 + 600) * 1000);
  const catalog = await client.request('listModels', { signal });
  assert(
    catalog.data.some((m) => m.id === options.model && m.enabled && m.harnesses.includes(options.harness)),
    'Select an enabled model compatible with this harness.',
  );
  const billing = await client.request('getBilling', { signal });
  assert.equal(billing.reserved_micro_usd, '0', 'Use an idle synthetic customer for acceptance.');
  const project = await client.request('createProject', {
    signal,
    body: { name: `Agent acceptance ${randomUUID()}`, persistence: 'persistent' },
  });
  const runs: Schema['RunAccepted'][] = [];
  const events: Schema['Event'][][] = [];
  try {
    for (let turn = 0; turn < 2; turn++) {
      const body: Schema['RunCreate'] = {
        ...(turn
          ? { session_id: runs[0].session_id }
          : {
              project_id: project.id,
              harness: options.harness,
              model: options.model,
              billing_mode: options.connectionId ? 'byok' : 'managed',
              ...(options.connectionId ? { provider_connection_id: options.connectionId } : {}),
            }),
        prompt: turn
          ? 'Read hello.txt from the prior task. Copy its exact bytes into continued.txt without changing hello.txt. Read continued.txt back, then finish.'
          : 'Create hello.txt containing exactly "Hello from the agent" followed by one newline. Read it back using a tool, then finish.',
        limits: { timeout_seconds: options.timeoutSeconds, max_cost_micro_usd: options.runBudget },
        queue_timeout_seconds: 120,
      };
      const key = randomUUID();
      await options.beforeRun?.(key, body);
      const run = await client.request('createRun', { body, idempotencyKey: key, signal });
      runs.push(run);
      await options.accepted?.(run);
      const observed: Schema['Event'][] = [];
      // Deliberately detach and reconnect from a real cursor, then read through terminal history.
      for await (const event of client.stream(run.run_id, { signal })) {
        observed.push(event);
        await options.observed?.(event);
        break;
      }
      assert(observed.length);
      for await (const event of client.stream(run.run_id, { after: observed[0].sequence, signal })) {
        observed.push(event);
        await options.observed?.(event);
      }
      assert.equal(new Set(observed.map((e) => e.sequence)).size, observed.length);
      const status = await client.request('getRun', { params: { path: { run_id: run.run_id } }, signal });
      assert.equal(status.harness, options.harness);
      assert.equal(status.model, options.model);
      assert.equal(
        status.status,
        'succeeded',
        `Run ${run.run_id} failed: ${status.failure_code || status.status}`,
      );
      assert.equal(status.reserved_micro_usd, '0');
      const result = await client.request('getRunResult', {
        params: { path: { run_id: run.run_id } },
        signal,
      });
      assert.equal(result.persistence_status, 'verified');
      assert(result.checkpoint_id);
      assert(observed.some((e) => e.type === 'runtime.started' && e.data.harness === options.harness));
      assert(observed.some((e) => e.type === 'tool.completed'));
      assert(observed.some((e) => e.type === 'output.delta'));
      assert(observed.some((e) => e.type === 'checkpoint.created'));
      const bytes = await client.request('readFile', {
        params: {
          path: { workspace_id: run.workspace_id },
          query: { path: turn ? 'continued.txt' : 'hello.txt' },
        },
        signal,
      });
      assert.equal(Buffer.from(bytes).toString(), hello);
      const replay: Schema['Event'][] = [];
      for await (const event of client.stream(run.run_id, { signal })) replay.push(event);
      assert.deepEqual(
        replay.map((e) => e.sequence),
        observed.map((e) => e.sequence),
      );
      events.push(observed);
    }
    const native = events.map(
      (batch) => batch.find((e) => e.type === 'runtime.started')!.data.native_session_id,
    );
    assert(native[0], 'The harness must expose a native session identity.');
    assert.equal(native[1], native[0], 'Continuation must restore native session state.');
    assert.equal((await client.request('getBilling')).reserved_micro_usd, '0');
    return {
      harness: options.harness,
      model: options.model,
      projectId: project.id,
      runs: runs.map((r) => r.run_id),
      passed: true,
    };
  } finally {
    const cleanup = AbortSignal.timeout(60_000);
    // Detaching never cancels work. Explicitly cancel owned runs on failure, retaining diagnostic history.
    for (const run of runs) {
      const status = await client.request('getRun', {
        params: { path: { run_id: run.run_id } },
        signal: cleanup,
      });
      if (!['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status.status))
        await client.request('cancelRun', { params: { path: { run_id: run.run_id } }, signal: cleanup });
    }
    await client.request('updateProject', {
      params: { path: { project_id: project.id } },
      body: { archived: true },
      signal: cleanup,
    });
  }
}
