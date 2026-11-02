import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryProfileAccumulator } from '../../packages/runtime/src/memory-profile';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
import {
  nativeMemoryProfileSchema,
  nativeDiagnosticFrameSchema,
  memoryFailureSchema,
} from '../../packages/contracts/native-diagnostics';

function fixture(monitored = true) {
  let now = 1000;
  const capture = {
    capture_id: randomUUID(),
    origin_instance_id: randomUUID(),
    sample_rate: 1,
    expires_at_ms: 61_000,
  };
  const configuration: NativeConfiguration = {
    runId: randomUUID(),
    harness: 'opencode',
    model: 'fixture',
    modelLimits: { contextTokens: 128000, maxOutputTokens: 8192 },
    provider: 'openrouter',
    prompt: 'synthetic',
    workspace: '/workspace',
    stateHome: '/home',
    gatewayURL: 'http://127.0.0.1',
    toolURL: '',
    token: 'synthetic',
    deadline: new Date(61_000).toISOString(),
    toolGrants: false,
    ...(monitored
      ? {
          hostRun: {
            assignmentId: randomUUID(),
            handleId: randomUUID(),
            worktreeId: randomUUID(),
            sessionId: randomUUID(),
            uid: 20000,
            memoryMiB: 1024,
          },
        }
      : {}),
  };
  const profile = new MemoryProfileAccumulator({
    configuration,
    capture,
    reused: false,
    clock: () => now,
    wallClock: () => 1000,
  });
  return {
    profile,
    configuration,
    capture,
    advance: (ms: number) => {
      now += ms;
    },
    sample: (rss: number) => ({
      observedAtMs: now,
      rssBytes: rss,
      processCount: 1,
      unavailableProcessCount: 0,
      processes: new Map([[10, { rssBytes: rss, kind: 'node' as const }]]),
    }),
  };
}
it('samples at one second, bounds recent observations and preserves aggregates/peak', () => {
  const f = fixture();
  expect(f.profile.observe(f.sample(10))).toBe(true);
  expect(f.profile.observe(f.sample(99))).toBe(false);
  f.advance(1000);
  f.profile.stage('server_start');
  for (let i = 0; i < 20; i++) {
    f.profile.observe(f.sample(20 + i));
    f.advance(1000);
  }
  const record = f.profile.finish('turn_end');
  expect(record).toMatchObject({
    samples_seen: 21,
    peak_observed_rss_bytes: 39,
    dropped: { recent_samples: 5 },
  });
  expect(record?.recent).toHaveLength(16);
  expect(record?.stages).toContainEqual({
    stage: 'process_start',
    observations: 1,
    duration_ms: 1000,
    rss_max_bytes: 10,
  });
  expect(nativeMemoryProfileSchema.safeParse(record).success).toBe(true);
  expect(f.profile.finish('turn_end')).toBeUndefined();
});
it('expires once, rejects late enrichment and distinguishes unavailable/unobserved from zero', () => {
  const f = fixture();
  f.advance(60_000);
  expect(f.profile.active()).toBe(false);
  expect(f.profile.expired()).toBe(true);
  expect(f.profile.observe(f.sample(100))).toBe(false);
  const record = f.profile.finish('capture_expired');
  f.profile.pss({
    offset_ms: 0,
    age_ms: 0,
    read_ms: 0,
    covered_processes: 1,
    observed_processes: 1,
    covered_rss_bytes: 1,
    pss_bytes: 1,
    complete: true,
  });
  expect(record).toMatchObject({
    memory_status: 'not_observed',
    peak_observed_rss_bytes: null,
    duration_ms: 60_000,
  });
  expect(record?.pss).toBeUndefined();
  expect(fixture(false).profile.finish('turn_end')?.memory_status).toBe('allocation_monitor_unavailable');
});
it('keeps worker heap distinct from RSS and limits frames to one bounded turn', () => {
  const f = fixture();
  const frame = {
    run_id: f.configuration.runId,
    capture_id: f.capture.capture_id,
    kind: 'heap' as const,
    mark: 'after_adapter_load' as const,
    worker_offset_ms: 5,
    adapter_load_ms: 4,
    rss_bytes: 10,
    heap_used_bytes: 3,
    heap_total_bytes: 6,
    external_bytes: 4,
    array_buffers_bytes: 2,
  };
  f.profile.frame(frame);
  for (let i = 0; i < 33; i++)
    f.profile.frame({
      run_id: frame.run_id,
      capture_id: frame.capture_id,
      kind: 'stage',
      stage: 'turn_execute',
      worker_offset_ms: 5,
    });
  const result = f.profile.finish('turn_end');
  expect(result?.heap_marks).toHaveLength(1);
  expect(result?.adapter_load_ms).toBe(4);
  expect(result?.peak_observed_rss_bytes).toBeNull();
  expect(result?.dropped.frames).toBe(2);
});
it('rejects forged labels, raw fields and invalid numbers at the shared boundary', () => {
  const f = fixture();
  const record = f.profile.finish('turn_end');
  expect(nativeMemoryProfileSchema.safeParse({ ...record, command: 'private' }).success).toBe(false);
  expect(
    nativeDiagnosticFrameSchema.safeParse({
      kind: 'stage',
      run_id: f.configuration.runId,
      capture_id: f.capture.capture_id,
      stage: 'private-stage',
      worker_offset_ms: 0,
    }).success,
  ).toBe(false);
  expect(
    memoryFailureSchema.safeParse({
      measurement: 'process_rss_sum',
      limit_bytes: 1,
      observed_rss_bytes: Infinity,
      peak_observed_rss_bytes: 1,
      process_count: 1,
      unavailable_process_count: 0,
      largest_processes: [],
    }).success,
  ).toBe(false);
});

it('retains a partial proportional observation with its age after later reads fail', () => {
  const f = fixture();
  f.profile.observe(f.sample(100));
  f.profile.pss({
    offset_ms: 0,
    age_ms: 0,
    read_ms: 2,
    covered_processes: 1,
    observed_processes: 3,
    covered_rss_bytes: 20,
    pss_bytes: 12,
    complete: false,
  });
  f.advance(5000);
  f.profile.pssUnavailable('permissions');
  const result = f.profile.finish('turn_end');
  expect(result?.pss).toMatchObject({ age_ms: 5000, pss_bytes: 12, complete: false });
  expect(result?.pss_unavailable_reason).toBe('permissions');
  expect(result?.peak_observed_rss_bytes).toBe(100);
  expect(nativeMemoryProfileSchema.safeParse(result).success).toBe(true);
});

it('bounds heap marks independently and resets all state for a new warm turn', () => {
  const first = fixture();
  const heap = {
    run_id: first.configuration.runId,
    capture_id: first.capture.capture_id,
    kind: 'heap' as const,
    mark: 'turn_start' as const,
    worker_offset_ms: 0,
    rss_bytes: 1,
    heap_used_bytes: 1,
    heap_total_bytes: 1,
    external_bytes: 1,
    array_buffers_bytes: 1,
  };
  for (let index = 0; index < 4; index++) first.profile.frame(heap);
  const done = first.profile.finish('turn_end');
  expect(done?.heap_marks).toHaveLength(3);
  expect(done?.dropped.frames).toBe(1);
  const next = fixture();
  next.profile.dispose();
  next.profile.frame(heap);
  expect(next.profile.observe(next.sample(9))).toBe(false);
  expect(next.profile.finish('turn_end')).toBeUndefined();
});

it('freezes content-free turn identity without retaining mutable execution configuration', () => {
  const f = fixture(),
    captureId = f.capture.capture_id;
  f.configuration.harness = 'codex';
  f.configuration.prompt = 'private later turn';
  f.capture.capture_id = randomUUID();
  const result = f.profile.finish('turn_end');
  expect(result).toMatchObject({ harness: 'opencode', capture_id: captureId });
  expect(JSON.stringify(result)).not.toContain('private later turn');
});
