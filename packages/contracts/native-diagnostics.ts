import { z } from 'zod';
import { harnessNames } from './harnesses';

/** Fixed, content-free labels shared by the protected runtime and control plane. */
export const runtimeStages = [
  'transport_start',
  'permissions_prepare',
  'attachments_prepare',
  'adapter_load',
  'harness_initialize',
  'server_start',
  'session_create',
  'event_subscribe',
  'turn_execute',
] as const;
export const runtimeStageSchema = z.enum(runtimeStages);
export type RuntimeStage = z.infer<typeof runtimeStageSchema>;
export const memoryStageSchema = z.enum(['process_start', ...runtimeStages]);
export type MemoryStage = z.infer<typeof memoryStageSchema>;

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const milliseconds = z.number().finite().nonnegative().max(3_600_000);
const processKind = z.enum(['node', 'opencode', 'bun', 'python', 'other']);
const largestProcesses = z
  .array(
    z.strictObject({
      pid: integer.positive(),
      kind: processKind,
      rss_bytes: integer,
    }),
  )
  .max(5);
const boundedJSON = (bytes: number) => (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8') <= bytes;

export const memoryFailureSchema = z
  .strictObject({
    measurement: z.literal('process_rss_sum'),
    limit_bytes: integer,
    observed_rss_bytes: integer,
    peak_observed_rss_bytes: integer,
    process_count: integer,
    unavailable_process_count: integer,
    largest_processes: largestProcesses,
  })
  .refine(boundedJSON(2048), 'Resource summary exceeds its diagnostic bound.');
export type MemoryFailure = z.infer<typeof memoryFailureSchema>;

export const nativeProfileCaptureSchema = z.strictObject({
  capture_id: z.uuid(),
  origin_instance_id: z.uuid(),
  sample_rate: z.number().finite().positive().max(1),
  expires_at_ms: integer,
});
export type NativeProfileCapture = z.infer<typeof nativeProfileCaptureSchema>;

const heapMark = z.enum(['before_adapter_load', 'after_adapter_load', 'turn_start', 'turn_end']);
const heapValues = {
  worker_offset_ms: milliseconds,
  rss_bytes: integer,
  heap_used_bytes: integer,
  heap_total_bytes: integer,
  external_bytes: integer,
  array_buffers_bytes: integer,
};
const frameIdentity = { run_id: z.uuid(), capture_id: z.uuid() };
export const nativeDiagnosticFrameSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...frameIdentity,
      kind: z.literal('stage'),
      stage: runtimeStageSchema,
      worker_offset_ms: milliseconds,
    }),
    z.strictObject({
      ...frameIdentity,
      kind: z.literal('heap'),
      mark: heapMark,
      ...heapValues,
      adapter_load_ms: milliseconds.optional(),
    }),
  ])
  .refine(boundedJSON(1024), 'Native diagnostic frame exceeds its bound.');
export type NativeDiagnosticFrame = z.infer<typeof nativeDiagnosticFrameSchema>;

export const nativeMemoryProfileSchema = z
  .strictObject({
    capture_id: z.uuid(),
    origin_instance_id: z.uuid(),
    run_id: z.uuid(),
    harness: z.enum(harnessNames),
    sample_rate: z.number().finite().positive().max(1),
    reused: z.boolean(),
    started_at: z.iso.datetime(),
    duration_ms: milliseconds,
    ended_by: z.enum(['turn_end', 'capture_expired']),
    memory_status: z.enum(['observed', 'not_observed', 'allocation_monitor_unavailable']),
    limit_bytes: integer.nullable(),
    peak_observed_rss_bytes: integer.nullable(),
    samples_seen: integer,
    recent: z
      .array(
        z.strictObject({
          offset_ms: milliseconds,
          stage: memoryStageSchema,
          rss_bytes: integer,
          process_count: integer,
          unavailable_process_count: integer,
        }),
      )
      .max(16),
    stages: z
      .array(
        z.strictObject({
          stage: memoryStageSchema,
          observations: integer,
          duration_ms: milliseconds,
          rss_max_bytes: integer.nullable(),
        }),
      )
      .max(runtimeStages.length + 1),
    largest_processes: largestProcesses,
    pss_unavailable_reason: z
      .enum(['permissions', 'unsupported', 'busy', 'deadline', 'vanished', 'read_failed'])
      .optional(),
    pss: z
      .strictObject({
        offset_ms: milliseconds,
        age_ms: milliseconds,
        read_ms: milliseconds,
        covered_processes: integer,
        observed_processes: integer,
        covered_rss_bytes: integer,
        pss_bytes: integer,
        complete: z.boolean(),
      })
      .optional(),
    adapter_load_ms: milliseconds.optional(),
    heap_marks: z.array(z.strictObject({ kind: heapMark, ...heapValues })).max(3),
    dropped: z.strictObject({ frames: integer, pss_reads: integer, recent_samples: integer }),
  })
  .refine(boundedJSON(7 * 1024), 'Native memory profile exceeds its bound.');
export type NativeMemoryProfile = z.infer<typeof nativeMemoryProfileSchema>;
