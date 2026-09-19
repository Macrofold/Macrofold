import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TraceObservation } from '../../packages/core/src/trace';

const backend = vi.hoisted(() => ({
  construct: vi.fn(),
  record: vi.fn(),
  flush: vi.fn(),
  shutdown: vi.fn(),
}));
vi.mock('../../packages/providers/src/langfuse', () => ({
  LangfuseTraceSink: class {
    constructor() {
      backend.construct();
    }
    record = backend.record;
    flush = backend.flush;
    shutdown = backend.shutdown;
  },
}));
const observation: TraceObservation = {
  id: 'call',
  name: 'model.generate',
  type: 'generation',
  startedAt: new Date(0),
  endedAt: new Date(1),
  context: {
    organization_id: 'org',
    workspace_id: 'workspace',
    run_id: 'run',
    worktree_id: null,
    session_id: null,
    user_id: 'user',
    run_kind: 'inference',
    model: 'model',
    billing_mode: 'managed',
  },
  input: 'Private prompt',
  output: 'Private answer',
  chargedMicroUsd: '12',
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('TRACING_ENABLED', 'true');
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'public-fixture');
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'secret-fixture');
  vi.stubEnv('LANGFUSE_BASE_URL', 'https://trace.invalid');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('requires complete credentials and honors explicit disable without creating an exporter', async () => {
  const tracing = await import('../../packages/core/src/tracing');
  vi.stubEnv('TRACING_ENABLED', 'false');
  tracing.recordTrace(observation);
  vi.stubEnv('TRACING_ENABLED', 'true');
  vi.stubEnv('LANGFUSE_SECRET_KEY', '');
  tracing.recordTrace(observation);
  await tracing.flushTraces();
  expect(tracing.tracingEnabled()).toBe(false);
  expect(backend.construct).not.toHaveBeenCalled();
});
it('shares one exporter and writes content-free structured application logs', async () => {
  const tracing = await import('../../packages/core/src/tracing');
  tracing.recordTrace(observation);
  tracing.recordTrace(observation);
  await tracing.flushTraces();
  await tracing.shutdownTracing();
  expect(backend.construct).toHaveBeenCalledTimes(1);
  expect(backend.record).toHaveBeenCalledWith(observation);
  expect(backend.flush).toHaveBeenCalledOnce();
  expect(backend.shutdown).toHaveBeenCalledOnce();
  const logs = vi.mocked(console.info).mock.calls.flat().join(' ');
  expect(logs).toContain('"charged_micro_usd":"12"');
  expect(logs).not.toContain('Private');
  expect(logs).not.toContain('secret-fixture');
});
it('isolates exporter and configuration failures from execution without logging payloads', async () => {
  const tracing = await import('../../packages/core/src/tracing');
  backend.record.mockImplementation(() => {
    throw new Error('secret payload');
  });
  backend.flush.mockRejectedValue(new Error('secret payload'));
  backend.shutdown.mockRejectedValue(new Error('secret payload'));
  expect(() => tracing.recordTrace(observation)).not.toThrow();
  await expect(tracing.flushTraces()).resolves.toBeUndefined();
  await expect(tracing.shutdownTracing()).resolves.toBeUndefined();
  const logs = vi.mocked(console.warn).mock.calls.flat().join(' ');
  expect(logs).toContain('trace_record_failed');
  expect(logs).toContain('trace_flush_failed');
  expect(logs).toContain('trace_shutdown_failed');
  expect(logs).not.toContain('secret payload');
  vi.resetModules();
  backend.construct.mockImplementation(() => {
    throw new Error('private config');
  });
  const failed = await import('../../packages/core/src/tracing');
  expect(() => failed.recordTrace(observation)).not.toThrow();
  expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('tracing_configuration_failed');
  expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('private config');
});
