import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pool, authPool, credentialPool, transaction, afterCommit } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { fixtureHttpApi } from '../fixtures/http-api';
import { createWorktree } from '../../packages/core/src/files';
import { credit } from '../../packages/core/src/ledger';
import { id, sha256 } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import type { ExecutionState } from '../../packages/core/src/cloud-engine';
import * as runs from '../../packages/core/src/runs';
import { configurePerformance, capturePerformanceTicket } from '../../packages/core/src/performance';
import { observeDatabasePools } from '../../packages/db/diagnostics';
import type { PerformanceRecord } from '../../packages/contracts/performance';

const apiProfiles = new Map<string, PerformanceRecord>();
let apiCollector: ReturnType<typeof configurePerformance> | undefined;
beforeAll(() => {
  const collector = configurePerformance({
    sampleRate: 1,
    durationSeconds: 3600,
    sink: {
      enqueue(record) {
        if (
          record.type === 'operation' &&
          record.operation === 'rest' &&
          record.phase === 'foreground' &&
          record.request_id
        )
          apiProfiles.set(record.request_id, record);
      },
      flush: async () => {},
      close: async () => {},
    },
  });
  apiCollector = collector;
  collector.onClose(
    observeDatabasePools(
      [
        [pool, 'domain'],
        [authPool, 'identity'],
        [credentialPool, 'credential'],
      ],
      capturePerformanceTicket,
      collector.unattributed,
    ),
  );
});

const messages = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), pid: z.number() }),
  z.object({ type: z.literal('idle'), at: z.number() }),
  z.object({ type: z.literal('provision'), run_id: z.string(), at: z.number() }),
  z.object({ type: z.literal('closed'), run_id: z.string(), at: z.number() }),
  z.object({ type: z.literal('restore_waiting') }),
  z.object({
    type: z.literal('step'),
    observation: z.string(),
    duration_ms: z.number(),
    timestamp: z.string(),
    run_id: z.string().optional(),
  }),
  z.object({
    type: z.literal('prepared'),
    run_id: z.string(),
    prompt_bytes: z.number(),
    prompt_sha256: z.string(),
  }),
  z.object({
    type: z.literal('metrics'),
    statements: z.number(),
    unattributed_statements: z.number(),
    groups: z.number(),
    commits: z.number(),
    sql_ms: z.number(),
    slow_operations: z
      .array(
        z
          .object({
            component: z.literal('performance'),
            type: z.literal('operation'),
            run_id: z.string(),
            started_at: z.string(),
            duration_ms: z.number().min(80),
          })
          .passthrough(),
      )
      .max(64),
    launches: z.number(),
    pid: z.number(),
    node: z.string(),
  }),
]);
type WorkerMessage = z.infer<typeof messages>;
const children: ChildProcess[] = [];
const organizations: string[] = [];
async function until(check: () => boolean | Promise<boolean>, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Native scheduling fixture did not progress.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await exited;
    if (code !== 0 || signal !== null) throw new Error('The fixture poller did not drain cleanly.');
  } finally {
    clearTimeout(deadline);
  }
}
async function worker(baseline?: string, settings: Partial<NodeJS.ProcessEnv> = {}) {
  const received: WorkerMessage[] = [];
  const errors: string[] = [];
  const child = fork(new URL('../fixtures/native-scheduling-worker.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      ...settings,
      NATIVE_SCHEDULING_BASELINE_ROOT: baseline ?? '',
      DATABASE_LISTENER_URL: process.env.DATABASE_URL,
      WORKER_DIAGNOSTICS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  child.stderr?.on('data', (data) => errors.push(String(data)));
  let logBuffer = '';
  child.stdout?.on('data', (data) => {
    logBuffer += String(data);
    const lines = logBuffer.split('\n');
    logBuffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object') continue;
        const parsed = messages.safeParse({ ...value, type: 'step' });
        if (parsed.success && parsed.data.type === 'step' && parsed.data.observation.endsWith('.completed'))
          received.push(parsed.data);
      } catch {
        /* Only the content-free worker progress protocol is collected. */
      }
    }
  });
  child.on('message', (value: unknown) => {
    const parsed = messages.safeParse(value);
    if (parsed.success) received.push(parsed.data);
    else errors.push('Invalid fixture IPC message.');
  });
  await until(() => {
    if (errors.length || child.exitCode !== null) throw new Error(errors.join('\n') || 'Worker exited.');
    return received.some((message) => message.type === 'ready');
  });
  return {
    child,
    received,
    errors,
    async nextIdle() {
      const before = received.length;
      // If the worker just announced idle, submit in that same idle window.
      const last = received.at(-1);
      if (last?.type === 'idle' && Date.now() - last.at < 100) return;
      await until(() => received.slice(before).some((message) => message.type === 'idle'));
    },
    async metrics() {
      const before = received.length;
      child.send({ type: 'metrics' });
      await until(() => {
        if (errors.length) throw new Error(errors.join('\n'));
        return received.slice(before).some((message) => message.type === 'metrics');
      });
      const result = received.slice(before).find((message) => message.type === 'metrics');
      if (!result || result.type !== 'metrics') throw new Error('Missing fixture metrics.');
      return result;
    },
  };
}
async function account() {
  const value = await fixtureAccount('Native scheduling qualification');
  organizations.push(value.p.organizationId);
  const workspace = await transaction(value.p.organizationId, async (tx) => {
    await credit(tx, value.p.organizationId, 100_000_000n, 'native-scheduling-qualification');
    await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1", [value.p.organizationId]);
    return resources.create(tx, 'workspaces', value.p.organizationId, { name: 'Scheduling fixture' });
  });
  return {
    ...value,
    async worktree() {
      const operation = await transaction(value.p.organizationId, (tx) =>
        createWorktree(tx, value.p, workspace.id, {}),
      );
      const worktree = operation.result.worktree_id;
      if (typeof worktree !== 'string') throw new Error('Fixture Worktree was not created.');
      return worktree;
    },
  };
}
type Sample = {
  api_ms: number;
  created_to_claim_ms: number;
  created_to_provision_ms: number;
  request_to_provision_ms: number;
  admission_transaction_ms: number;
  committed_to_claim_ms: number;
  committed_to_provision_ms: number;
  claim_to_provision_ms: number;
  api_cpu_ms: number;
  api_event_loop_active_ms: number;
  api_profile?: PerformanceRecord;
  worker_steps: Extract<WorkerMessage, { type: 'step' }>[];
  response_to_provision_ms: number;
  handoffs_ms: Record<string, number>;
};
const smallPrompt = 'Synthetic native scheduling qualification.';
function fixturePrompt(bytes: number) {
  return Array.from(
    { length: Math.ceil(bytes / 80) },
    (_, index) =>
      `Evidence record ${index}: the synthetic account has an available resource and one bounded task.\n`,
  )
    .join('')
    .slice(0, bytes);
}
async function submit(origin: string, key: string, worktree: string, prompt = smallPrompt) {
  const requestStartedAt = Date.now();
  const cpu = process.cpuUsage();
  const utilization = performance.eventLoopUtilization();
  const began = performance.now();
  const response = await fetch(origin + '/v1/runs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'idempotency-key': id(),
    },
    body: JSON.stringify({
      worktree_id: worktree,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt,
    }),
  });
  const acceptedAt = Date.now();
  const apiMs = performance.now() - began;
  const accepted: unknown = await response.json();
  expect(response.status, JSON.stringify(accepted)).toBe(202);
  const used = process.cpuUsage(cpu);
  return {
    ...z.object({ run_id: z.string() }).parse(accepted),
    requestStartedAt,
    acceptedAt,
    apiMs,
    requestId: response.headers.get('x-request-id'),
    cpuMs: (used.user + used.system) / 1000,
    eventLoopActiveMs: performance.eventLoopUtilization(utilization).active,
  };
}
async function state(organization: string, run: string) {
  return transaction(
    organization,
    async (tx) =>
      (
        await tx.query<{
          status: string;
          created_at: Date;
          started_at: Date | null;
          execution_binding: ExecutionState | null;
          result: { persistence_status?: string; checkpoint_id?: string; execution_outcome?: string };
        }>('SELECT status,created_at,started_at,execution_binding,result FROM runs WHERE id=$1', [run])
      ).rows[0],
  );
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return {
    n: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
}
async function cohort(count: number, baseline?: string, replicas = 1, prompt = smallPrompt) {
  const fixture = await account();
  const worktrees = await Promise.all(Array.from({ length: count }, () => fixture.worktree()));
  const api = await fixtureHttpApi({ retainBackground: true });
  const committed = new Map<string, number>();
  const actualAdmission = runs.admitRun;
  // Observe the real owner's existing commit callback; do not replace admission,
  // grant capacity or infer a commit from response/notification network timing.
  const admissionObserver = vi.spyOn(runs, 'admitRun').mockImplementation(async (...args) => {
    const accepted = await actualAdmission(...args);
    afterCommit(args[0], () => committed.set(accepted.run_id, Date.now()));
    return accepted;
  });
  const firstOwnedChild = children.length;
  const samples: Sample[] = [];
  try {
    const pollers = await Promise.all(Array.from({ length: replicas }, () => worker(baseline)));
    for (const worktree of worktrees) {
      await Promise.all(pollers.map((poller) => poller.nextIdle()));
      const identity = await submit(api.origin, fixture.key, worktree, prompt);
      const row = () => state(fixture.p.organizationId, identity.run_id);
      // Do not add a SQL status-polling workload to the path being measured.
      // The machine's final close signal precedes only its fenced publication.
      await until(() =>
        pollers.some((poller) =>
          poller.received.some((message) => message.type === 'closed' && message.run_id === identity.run_id),
        ),
      );
      await until(async () => (await row()).execution_binding?.phase === 'done');
      const final = await row();
      expect(final.status).toBe('succeeded');
      expect(final.result).toMatchObject({
        persistence_status: 'verified',
        execution_outcome: 'success',
        checkpoint_id: expect.any(String),
      });
      expect(
        pollers
          .flatMap((poller) => poller.received)
          .find((message) => message.type === 'prepared' && message.run_id === identity.run_id),
      ).toMatchObject({
        prompt_bytes: Buffer.byteLength(prompt),
        prompt_sha256: sha256(prompt),
      });
      if (!final.started_at) throw new Error('The completed Run has no execution claim.');
      const provision = pollers
        .flatMap((poller) => poller.received)
        .find((message) => message.type === 'provision' && message.run_id === identity.run_id);
      if (!provision || provision.type !== 'provision') throw new Error('Missing provider boundary.');
      const committedAt = committed.get(identity.run_id);
      if (committedAt === undefined) throw new Error('Missing actual admission commit observation.');
      const timings = final.execution_binding?.phaseTimings;
      const pairs = [
        ['provision', 'input'],
        ['restore', 'restore_wait'],
        ['poll', 'index'],
        ['publish', 'close'],
      ] as const;
      const handoffs: Record<string, number> = {};
      for (const [from, to] of pairs) {
        const completed = timings?.[from]?.completedAt;
        const started = timings?.[to]?.startedAt;
        if (completed !== undefined && started !== undefined)
          handoffs[from + '->' + to] = started - completed;
      }
      expect(Object.keys(handoffs)).toHaveLength(4);
      samples.push({
        api_ms: identity.apiMs,
        created_to_claim_ms: final.started_at.getTime() - final.created_at.getTime(),
        // A stronger bound than commit-to-first-phase: includes the admission
        // transaction and all successful-claim SQL before actual provider work.
        created_to_provision_ms: provision.at - final.created_at.getTime(),
        request_to_provision_ms: provision.at - identity.requestStartedAt,
        admission_transaction_ms: committedAt - final.created_at.getTime(),
        committed_to_claim_ms: final.started_at.getTime() - committedAt,
        committed_to_provision_ms: provision.at - committedAt,
        claim_to_provision_ms: provision.at - final.started_at.getTime(),
        api_cpu_ms: identity.cpuMs,
        api_event_loop_active_ms: identity.eventLoopActiveMs,
        api_profile: identity.requestId ? apiProfiles.get(identity.requestId) : undefined,
        worker_steps: pollers
          .flatMap((poller) => poller.received)
          .filter(
            (message): message is Extract<WorkerMessage, { type: 'step' }> =>
              message.type === 'step' && message.run_id === identity.run_id,
          ),
        response_to_provision_ms: provision.at - identity.acceptedAt,
        handoffs_ms: handoffs,
      });
    }
    await api.drainBackground();
    expect(pollers.flatMap((poller) => poller.errors)).toEqual([]);
    const metrics = await Promise.all(pollers.map((poller) => poller.metrics()));
    expect(metrics.reduce((sum, metric) => sum + metric.launches, 0)).toBe(count);
    expect(metrics.reduce((sum, metric) => sum + metric.statements, 0)).toBeGreaterThan(0);
    return {
      mode: baseline ? 'baseline' : 'current',
      replicas,
      prompt_bytes: Buffer.byteLength(prompt),
      workload:
        'one-at-a-time submission immediately after poller idle; empty Worktree; scripted native machine',
      samples,
      summary: {
        api_ms: summary(samples.map((sample) => sample.api_ms)),
        created_to_claim_ms: summary(samples.map((sample) => sample.created_to_claim_ms)),
        created_to_provision_ms: summary(samples.map((sample) => sample.created_to_provision_ms)),
        request_to_provision_ms: summary(samples.map((sample) => sample.request_to_provision_ms)),
        admission_transaction_ms: summary(samples.map((sample) => sample.admission_transaction_ms)),
        committed_to_claim_ms: summary(samples.map((sample) => sample.committed_to_claim_ms)),
        committed_to_provision_ms: summary(samples.map((sample) => sample.committed_to_provision_ms)),
        claim_to_provision_ms: summary(samples.map((sample) => sample.claim_to_provision_ms)),
        api_cpu_ms: summary(samples.map((sample) => sample.api_cpu_ms)),
        api_event_loop_active_ms: summary(samples.map((sample) => sample.api_event_loop_active_ms)),
        worker_steps_ms: Object.fromEntries(
          [...new Set(samples.flatMap((sample) => sample.worker_steps.map((step) => step.observation)))].map(
            (observation) => [
              observation,
              summary(
                samples.flatMap((sample) =>
                  sample.worker_steps
                    .filter((step) => step.observation === observation)
                    .map((step) => step.duration_ms),
                ),
              ),
            ],
          ),
        ),
        response_to_provision_ms: summary(samples.map((sample) => sample.response_to_provision_ms)),
        handoffs_ms: summary(samples.flatMap((sample) => Object.values(sample.handoffs_ms))),
        handoffs_by_pair_ms: Object.fromEntries(
          Object.keys(samples[0]?.handoffs_ms ?? {}).map((pair) => [
            pair,
            summary(samples.map((sample) => sample.handoffs_ms[pair])),
          ]),
        ),
      },
      metrics,
    };
  } finally {
    admissionObserver.mockRestore();
    // Children are registered before readiness; a failed startup must release
    // the same resources as a completed cohort, including partially ready peers.
    try {
      await Promise.all(children.slice(firstOwnedChild).map(stop));
    } finally {
      await api.close();
    }
  }
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
  for (const organization of organizations.splice(0)) await retireFixtureRuns(organization);
});
afterAll(async () => {
  await apiCollector?.close();
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it.each([1, 2])(
  'dispatches API-admitted native Runs through %i poller(s) with one launch and complete handoffs',
  async (replicas) => {
    const result = await cohort(2, undefined, replicas);
    expect(result.summary.created_to_claim_ms.n).toBe(2);
    expect(result.summary.handoffs_ms.n).toBe(8);
  },
);

it('preserves near-limit native input through API admission and prepared execution', async () => {
  const result = await cohort(1, undefined, 1, fixturePrompt(96 * 1024));
  expect(result.prompt_bytes).toBe(96 * 1024);
});

it('yields to a full transfer pool without blocking provisioning and resumes once its slot is free', async () => {
  const fixture = await account();
  const worktrees = await Promise.all([fixture.worktree(), fixture.worktree()]);
  const api = await fixtureHttpApi({ retainBackground: true });
  const poller = await worker(undefined, {
    NATIVE_SCHEDULING_HOLD_RESTORE: '1',
    DISPATCH_TRANSFER_CONCURRENCY: '1',
  });
  try {
    const first = await submit(api.origin, fixture.key, worktrees[0]);
    await until(() => poller.received.some((message) => message.type === 'restore_waiting'));
    const second = await submit(api.origin, fixture.key, worktrees[1]);
    await until(
      async () => (await state(fixture.p.organizationId, second.run_id)).execution_binding?.phase === 'input',
    );
    const blocked = await state(fixture.p.organizationId, second.run_id);
    expect(blocked.execution_binding?.phaseTimings?.input).toBeUndefined();
    expect((await state(fixture.p.organizationId, first.run_id)).execution_binding?.phase).toBe('restore');
    poller.child.send({ type: 'release' });
    await until(() => poller.received.filter((message) => message.type === 'closed').length === 2);
    for (const run of [first, second]) {
      await until(
        async () => (await state(fixture.p.organizationId, run.run_id)).execution_binding?.phase === 'done',
      );
      expect((await state(fixture.p.organizationId, run.run_id)).status).toBe('succeeded');
    }
    expect((await poller.metrics()).launches).toBe(2);
    expect(poller.errors).toEqual([]);
  } finally {
    if (poller.child.connected) poller.child.send({ type: 'release' });
    await stop(poller.child);
    await api.close();
  }
});

it.skipIf(process.env.NATIVE_SCHEDULING_PROFILE !== '1')(
  'qualifies matched empty-queue scheduling and free-pool handoff intervals',
  async () => {
    const diagnostic = process.env.NATIVE_SCHEDULING_DIAGNOSTIC === '1';
    const baseline = resolve('.data/native-scheduling-20261031/baseline');
    if (!diagnostic) await access(baseline + '/packages/core/src/portable-dispatch.ts');
    const count = Number(process.env.NATIVE_SCHEDULING_PROFILE_COUNT ?? 20);
    if (!Number.isSafeInteger(count) || count < 5 || count > 100)
      throw new Error('Invalid profile cohort size.');
    // RunCreate permits at most 100,000 characters. ASCII 96 KiB stays inside that
    // public limit while exercising TOAST-sized frozen native configuration.
    const cohorts = [];
    for (const prompt of [smallPrompt, fixturePrompt(96 * 1024)]) {
      const before = diagnostic ? undefined : await cohort(count, baseline, 1, prompt);
      const after = await cohort(count, undefined, 1, prompt);
      cohorts.push({ prompt_bytes: Buffer.byteLength(prompt), before, after });
    }
    const directory = resolve('.data/native-scheduling-20261031');
    await mkdir(directory, { recursive: true });
    const output =
      process.env.NATIVE_SCHEDULING_PROFILE_OUTPUT ??
      (diagnostic ? 'profile-diagnostic.json' : 'profile.json');
    if (basename(output) !== output) throw new Error('Use an artifact filename, not a path.');
    const result = {
      topology: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        host_cpu: cpus()[0]?.model,
        host_logical_cpus: availableParallelism(),
        host_memory_bytes: totalmem(),
        postgres_version: (await pool.query<{ server_version: string }>('SHOW server_version')).rows[0]
          .server_version,
        profiler_sample_rate: 1,
        provider_boundary: 'scripted native machine; no Docker/model startup or paid provider call',
      },
      cohorts,
    };
    await writeFile(directory + '/' + output, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(
      JSON.stringify({
        native_scheduling_qualification: cohorts.map(({ prompt_bytes, before, after }) => ({
          prompt_bytes,
          before: before?.summary,
          after: after.summary,
        })),
      }),
    );
    for (const { after } of diagnostic ? [] : cohorts) {
      expect(after.summary.committed_to_provision_ms.p95).toBeLessThan(100);
      expect(after.summary.handoffs_ms.p95).toBeLessThan(100);
      for (const handoff of Object.values(after.summary.handoffs_by_pair_ms))
        expect(handoff.p95).toBeLessThan(100);
    }
  },
  180000,
);
