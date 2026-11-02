import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { nativeMemoryProfileSchema, type NativeProfileCapture } from '../../contracts/native-diagnostics';
import type { HarnessName } from '../../contracts/harnesses';
import type {
  PerformanceCounter,
  PerformanceIdentity,
  PerformanceOperation,
  PerformancePhase,
  PerformancePool,
  PerformanceRecord,
  PerformanceSink,
  PerformanceStage,
  PerformanceTicket,
} from '../../contracts/performance';

type State = {
  identity: PerformanceIdentity;
  id: string;
  parent?: string;
  operation: PerformanceOperation;
  phase: PerformancePhase;
  started: number;
  at: string;
  closed: boolean;
  spans: number;
  counters: PerformanceRecord['counters'];
  stages: PerformanceRecord['stages'];
  pools: NonNullable<PerformanceRecord['pools']>;
  transactions: NonNullable<PerformanceRecord['transactions']>;
  groups: NonNullable<PerformanceRecord['groups']>;
};
type Configuration = { sampleRate: number; durationSeconds: number };
type Options = Configuration & { sink: PerformanceSink; clock?: () => number; random?: () => number };
const noop = () => {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let current: ReturnType<typeof createPerformanceCollector> | undefined;

/** No ALS, clock, context, or sampling work exists until explicitly configured. */
export function performanceEnabled() {
  return !!current?.active();
}
export function configurePerformance(options: Options) {
  if (current) throw new Error('Performance profiling is already configured.');
  current = createPerformanceCollector(options);
  return current;
}
export function profilingConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): Configuration | undefined {
  if (env.PERF_PROFILING_ENABLED === undefined || env.PERF_PROFILING_ENABLED === 'false') return;
  if (env.PERF_PROFILING_ENABLED !== 'true') throw new Error('Invalid profiling configuration.');
  if (env.PERF_PROFILING_SAMPLE_RATE?.trim() === '' || env.PERF_PROFILING_DURATION_SECONDS?.trim() === '')
    throw new Error('Invalid profiling configuration.');
  const sampleRate = Number(env.PERF_PROFILING_SAMPLE_RATE ?? 1);
  const durationSeconds = Number(env.PERF_PROFILING_DURATION_SECONDS ?? 300);
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 0 ||
    sampleRate > 1 ||
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 3600
  )
    throw new Error('Invalid profiling configuration.');
  return { sampleRate, durationSeconds };
}
export function runPerformanceRoot<T>(
  operation: PerformanceOperation,
  identity: PerformanceIdentity,
  action: () => T,
  phase: PerformancePhase = 'foreground',
): T {
  return current?.active() ? current.run(operation, identity, action, phase, false) : action();
}
export function runPerformanceChild<T>(phase: PerformancePhase, action: () => T): T {
  return current?.active() ? current.child(phase, action) : action();
}
export function runPerformanceJob<T>(
  operation: PerformanceOperation,
  identity: PerformanceIdentity,
  action: () => T,
): T {
  return current?.active() ? current.job(operation, identity, action) : action();
}
/** Capture IDs now, not a Request/parent context inside a retained callback. */
export function performanceBackground<T>(action: () => T): () => T {
  return current?.active() ? current.background(action) : action;
}
export function startPerformanceStage(stage: PerformanceStage) {
  return current?.stage(stage) ?? noop;
}
export function capturePerformanceTicket(): PerformanceTicket | undefined {
  return current?.ticket();
}
export function linkPerformanceRun(runId: string) {
  current?.linkRun(runId);
}
export function flushPerformance() {
  return current?.flush() ?? Promise.resolve();
}
export function shutdownPerformance() {
  return current?.close() ?? Promise.resolve();
}

/** Whole-turn sampling is independent from the enclosing poller's scope. */
export function nativeProfileCapture(runId: string, deadlineMs: number): NativeProfileCapture | undefined {
  return current?.nativeCapture(runId, deadlineMs);
}
export function importNativeMemoryProfile(
  payload: unknown,
  expected: { organizationId: string; runId: string; harness: HarnessName },
) {
  return current?.importNative(payload, expected) ?? false;
}

/** Factory is for isolated fixtures. Serving uses exactly one composition instance. */
export function createPerformanceCollector(options: Options) {
  // Keep one negative sampling decision through nested/deferred work without
  // allocating a profile tree. Explicit independent roots still sample anew.
  const skipped = Symbol('unsampled');
  const storage = new AsyncLocalStorage<State | typeof skipped>();
  const clock = options.clock ?? (() => performance.now());
  const random = options.random ?? Math.random;
  const captureId = randomUUID(),
    instanceId = randomUUID(),
    began = clock();
  const beganAt = new Date().toISOString();
  const states = new Set<State>();
  const dropped: Record<string, number> = {};
  const cleanups: (() => void)[] = [];
  let enabled = true,
    closed = false,
    collectionEnded: number | undefined,
    receiveExpiry: NodeJS.Timeout | undefined,
    closing: Promise<void> | undefined;
  const expiresAt = Date.now() + options.durationSeconds * 1000;
  let exemplars = 0;
  const unattributed = { statements: 0, checkouts: 0 };
  const sampling = { seen: 0, sampled: 0, skipped: 0 };
  const countDrop = (reason: string) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  function aggregate(state: State, stage: keyof State['stages'], duration: number) {
    if (state.closed || !enabled || !Number.isFinite(duration)) return;
    const previous = state.stages[stage];
    if (previous) {
      previous.count++;
      previous.total_ms += duration;
      previous.min_ms = Math.min(previous.min_ms, duration);
      previous.max_ms = Math.max(previous.max_ms, duration);
    } else state.stages[stage] = { count: 1, total_ms: duration, min_ms: duration, max_ms: duration };
  }
  function add(state: State, key: PerformanceCounter, value = 1) {
    if (!state.closed && enabled) state.counters[key] = (state.counters[key] ?? 0) + value;
  }
  function enqueue(record: PerformanceRecord) {
    try {
      options.sink.enqueue(record);
    } catch {
      countDrop('sink_failed');
    }
  }
  function finish(state: State, truncated = false) {
    if (state.closed) return;
    state.closed = true;
    states.delete(state);
    enqueue({
      component: 'performance',
      version: 1,
      type: 'operation',
      capture_id: captureId,
      instance_id: instanceId,
      operation: state.operation,
      phase: state.phase,
      operation_id: state.id,
      parent_id: state.parent,
      request_id: state.identity.requestId,
      run_id: state.identity.runId,
      organization_id: state.identity.organizationId,
      started_at: state.at,
      duration_ms: Math.max(0, clock() - state.started),
      sample_rate: options.sampleRate,
      ...(truncated ? { truncated: true } : {}),
      counters: state.counters,
      stages: state.stages,
      pools: state.pools,
      transactions: state.transactions,
      groups: state.groups,
    });
  }
  function outside<T>(action: () => T) {
    return storage.exit(action);
  }
  function run<T>(
    operation: PerformanceOperation,
    identity: PerformanceIdentity,
    action: () => T,
    phase: PerformancePhase,
    inherit: boolean,
    parent?: string,
  ): T {
    if (!enabled) return action();
    const inherited = inherit ? storage.getStore() : undefined;
    if (inherited === skipped) return action();
    if (!inherited && !parent) {
      sampling.seen++;
      if (random() >= options.sampleRate) {
        sampling.skipped++;
        return storage.run(skipped, action);
      }
      sampling.sampled++;
    }
    if (states.size >= 256) {
      countDrop('scope_limit');
      return storage.run(skipped, action);
    }
    const safe: PerformanceIdentity = {};
    if (identity.requestId && uuid.test(identity.requestId)) safe.requestId = identity.requestId;
    if (identity.runId && uuid.test(identity.runId)) safe.runId = identity.runId;
    if (identity.organizationId && uuid.test(identity.organizationId))
      safe.organizationId = identity.organizationId;
    const state: State = {
      identity: safe,
      id: randomUUID(),
      parent: parent ?? inherited?.id,
      operation,
      phase,
      started: clock(),
      at: new Date().toISOString(),
      closed: false,
      spans: 0,
      counters: {},
      stages: {},
      pools: {},
      transactions: [],
      groups: [],
    };
    states.add(state);
    return storage.run(state, () => {
      try {
        const value = action();
        if (value instanceof Promise)
          return value.then(
            (result) => {
              finish(state);
              return result;
            },
            (error: unknown) => {
              add(state, 'failures');
              finish(state);
              throw error;
            },
          ) as T;
        finish(state);
        return value;
      } catch (error) {
        add(state, 'failures');
        finish(state);
        throw error;
      }
    });
  }
  function child<T>(phase: PerformancePhase, action: () => T): T {
    if (!enabled) return action();
    const parent = storage.getStore();
    if (parent === skipped) return action();
    return parent && !parent.closed
      ? run(parent.operation, parent.identity, action, phase, true)
      : outside(action);
  }
  function background<T>(action: () => T): () => T {
    if (!enabled) return action;
    const parent = storage.getStore();
    if (!parent) return action;
    if (parent === skipped) return () => (enabled ? storage.run(skipped, action) : action());
    const ids = { ...parent.identity },
      parentId = parent.id;
    return () => run('background', ids, action, 'background', false, parentId);
  }
  function job<T>(operation: PerformanceOperation, identity: PerformanceIdentity, action: () => T): T {
    if (!enabled) return action();
    const parent = storage.getStore();
    if (parent === skipped) return action();
    return run(operation, { ...parent?.identity, ...identity }, action, 'job', !!parent && !parent.closed);
  }
  function stage(name: PerformanceStage) {
    const state = enabled ? storage.getStore() : undefined;
    if (!state || state === skipped || state.closed) return noop;
    if (state.spans >= 8) {
      countDrop('span_limit');
      return noop;
    }
    state.spans++;
    const start = clock();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      state.spans--;
      aggregate(state, name, clock() - start);
    };
  }
  function ticket(): PerformanceTicket | undefined {
    const state = enabled ? storage.getStore() : undefined;
    if (!state || state === skipped || state.closed) return;
    return {
      record(m) {
        if (!enabled || state.closed) return;
        if (m.kind === 'unsupported_driver_form') {
          add(state, 'unsupported_driver_form');
          return;
        }
        aggregate(state, `db.${m.kind}`, m.durationMs);
        if (m.pool) {
          const stats = (state.pools[m.pool] ??= {
            statements: 0,
            groups: 0,
            checkouts: 0,
            query_ms: 0,
            checkout_ms: 0,
            peak_checked_out: 0,
            peak_waiting: 0,
          });
          stats.peak_checked_out = Math.max(stats.peak_checked_out, m.checkedOut ?? 0);
          stats.peak_waiting = Math.max(stats.peak_waiting, m.waiting ?? 0);
          if (m.kind === 'query') {
            stats.statements++;
            stats.query_ms += m.durationMs;
            if (!m.grouped) stats.groups++;
          } else if (m.kind === 'group') stats.groups++;
          else if (m.kind === 'checkout') {
            stats.checkouts++;
            stats.checkout_ms += m.durationMs;
          }
        }
        if (m.kind === 'query') {
          add(state, 'statements');
          if (!m.grouped) add(state, 'groups');
          if (m.rows !== undefined) add(state, 'rows', m.rows);
          if (m.parameterBytes) add(state, 'parameter_bytes', m.parameterBytes);
          if (m.unknownParameters) add(state, 'unknown_parameters', m.unknownParameters);
        } else if (m.kind === 'group') add(state, 'groups');
        else if (m.kind === 'checkout') add(state, 'checkouts');
        else if (m.kind === 'transaction') {
          add(state, 'transactions');
          add(
            state,
            m.outcome === 'committed'
              ? 'commits'
              : m.outcome === 'rolled_back'
                ? 'rollbacks'
                : m.outcome === 'commit_unknown'
                  ? 'commit_unknown'
                  : 'failures',
          );
          if (m.transactionId && state.transactions.length < 8)
            state.transactions.push({
              id: m.transactionId,
              pool: m.pool,
              outcome: m.outcome ?? 'failed',
              duration_ms: m.durationMs,
            });
        }
        if (m.kind === 'group' && m.groupId !== undefined && state.groups.length < 16 && exemplars < 128) {
          exemplars++;
          state.groups.push({
            id: m.groupId,
            transaction_id: m.transactionId,
            pool: m.pool,
            statements: m.statements ?? 0,
            duration_ms: m.durationMs,
          });
        }
      },
    };
  }
  function stopCollection() {
    if (!enabled) return;
    enabled = false;
    collectionEnded = Math.min(clock(), began + options.durationSeconds * 1000);
    clearTimeout(expiry);
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        countDrop('detach_failed');
      }
    }
    for (const state of states) finish(state, true);
  }
  async function close() {
    if (closing) return closing;
    stopCollection();
    closed = true;
    clearInterval(timer);
    clearTimeout(receiveExpiry);
    let sinkDrops = 0;
    try {
      sinkDrops = options.sink.stats?.().dropped ?? 0;
    } catch {
      countDrop('sink_failed');
    }
    enqueue({
      component: 'performance',
      version: 1,
      type: 'capture',
      capture_id: captureId,
      instance_id: instanceId,
      started_at: beganAt,
      duration_ms: Math.max(0, (collectionEnded ?? clock()) - began),
      sample_rate: options.sampleRate,
      counters: {},
      stages: {},
      dropped: { ...dropped, sink: sinkDrops },
      state: 'completed',
      unattributed: { ...unattributed },
      sampling: { ...sampling },
    });
    closing = Promise.resolve()
      .then(() => options.sink.close())
      .catch(() => {
        countDrop('sink_failed');
      });
    return closing;
  }
  function flush() {
    try {
      return options.sink.flush().catch(() => {
        countDrop('sink_failed');
      });
    } catch {
      countDrop('sink_failed');
      return Promise.resolve();
    }
  }
  const timer = setInterval(() => {
    void flush();
  }, 1000);
  timer.unref();
  const expiry = setTimeout(() => {
    stopCollection();
    // Native expiry reports can arrive on a different normal probe. Keep only
    // import/flush alive; scopes and instrumentation have already detached.
    receiveExpiry = setTimeout(
      () => {
        void close();
      },
      Math.max(0, began + options.durationSeconds * 1000 + 10_000 - clock()),
    );
    receiveExpiry.unref();
  }, options.durationSeconds * 1000);
  expiry.unref();
  enqueue({
    component: 'performance',
    version: 1,
    type: 'capture',
    capture_id: captureId,
    instance_id: instanceId,
    state: 'started',
    started_at: beganAt,
    duration_ms: 0,
    duration_seconds: options.durationSeconds,
    sample_rate: options.sampleRate,
    counters: {},
    stages: {},
  });
  return {
    active: () => enabled && clock() < began + options.durationSeconds * 1000,
    nativeCapture(runId: string, deadlineMs: number): NativeProfileCapture | undefined {
      if (
        !enabled ||
        clock() >= began + options.durationSeconds * 1000 ||
        options.sampleRate === 0 ||
        !uuid.test(runId) ||
        !Number.isFinite(deadlineMs)
      )
        return;
      const expires = Math.min(expiresAt, deadlineMs);
      if (expires <= Date.now()) return;
      const draw =
        createHash('sha256')
          .update(captureId + ':' + runId)
          .digest()
          .readUInt32BE(0) /
        2 ** 32;
      if (draw >= options.sampleRate) return;
      return {
        capture_id: captureId,
        origin_instance_id: instanceId,
        sample_rate: options.sampleRate,
        expires_at_ms: expires,
      };
    },
    importNative(
      payload: unknown,
      expected: { organizationId: string; runId: string; harness: HarnessName },
    ) {
      if (
        closed ||
        clock() >= began + options.durationSeconds * 1000 + 10_000 ||
        !uuid.test(expected.organizationId) ||
        !uuid.test(expected.runId)
      )
        return false;
      try {
        const parsed = nativeMemoryProfileSchema.safeParse(payload);
        if (
          !parsed.success ||
          parsed.data.run_id !== expected.runId ||
          parsed.data.harness !== expected.harness
        ) {
          countDrop('native_invalid');
          return false;
        }
        const {
          capture_id,
          origin_instance_id,
          run_id,
          sample_rate,
          started_at,
          duration_ms,
          ...measurements
        } = parsed.data;
        enqueue({
          component: 'performance',
          version: 1,
          type: 'operation',
          operation: 'run',
          phase: 'job',
          capture_id,
          instance_id: origin_instance_id,
          receiver_instance_id: instanceId,
          organization_id: expected.organizationId,
          run_id,
          operation_id: run_id,
          sample_rate,
          started_at,
          duration_ms,
          counters: {},
          stages: {},
          native_memory: measurements,
        });
        return true;
      } catch {
        countDrop('native_invalid');
        return false;
      }
    },
    run,
    child,
    background,
    stage,
    ticket,
    close,
    job,
    unattributed: (kind: 'query' | 'checkout', _pool: PerformancePool) => {
      if (enabled) {
        if (kind === 'query') unattributed.statements++;
        else unattributed.checkouts++;
      }
    },
    linkRun: (runId: string) => {
      const state = enabled ? storage.getStore() : undefined;
      if (state && state !== skipped && !state.closed && uuid.test(runId)) state.identity.runId = runId;
    },
    flush,
    onClose: (cleanup: () => void) => {
      if (enabled) cleanups.push(cleanup);
      else cleanup();
    },
  };
}
