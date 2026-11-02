import type { NativeConfiguration } from './types';
import type { AgentMemorySample } from './agent-processes';
import { largestMemoryProcesses } from './agent-processes';
import type {
  MemoryStage,
  NativeDiagnosticFrame,
  NativeMemoryProfile,
  NativeProfileCapture,
} from '../../contracts/native-diagnostics';

type Stage = NativeMemoryProfile['stages'][number];
type Options = {
  configuration: NativeConfiguration;
  capture: NativeProfileCapture;
  reused: boolean;
  clock?: () => number;
  wallClock?: () => number;
};

/** Fixed-size aggregation only. The supervisor owns I/O, concurrency and lifecycle.
 * See native-memory-startup-tech-design.md#42-runtime-collector-and-exact-bounds. */
export class MemoryProfileAccumulator {
  private readonly clock: () => number;
  private readonly began: number;
  private readonly expires: number;
  private readonly startedAt: string;
  private readonly capture: NativeProfileCapture;
  private readonly runId: string;
  private readonly harness: NativeConfiguration['harness'];
  private readonly limitBytes: number | null;
  private readonly stages = new Map<MemoryStage, Stage>();
  private readonly recent: NativeMemoryProfile['recent'] = [];
  private readonly heap: NativeMemoryProfile['heap_marks'] = [];
  private current: MemoryStage = 'process_start';
  private stageAt: number;
  private lastObserved = -Infinity;
  private samples = 0;
  private peak: number | null = null;
  private largest: NativeMemoryProfile['largest_processes'] = [];
  private snapshot?: NativeMemoryProfile['pss'];
  private pssReason?: NativeMemoryProfile['pss_unavailable_reason'];
  private adapterLoad?: number;
  private frames = 0;
  private stopped = false;
  readonly dropped = { frames: 0, pss_reads: 0, recent_samples: 0 };

  constructor(options: Options) {
    this.clock = options.clock ?? (() => performance.now());
    const wall = (options.wallClock ?? Date.now)();
    this.began = this.stageAt = this.clock();
    this.startedAt = new Date(wall).toISOString();
    this.expires = this.began + Math.max(0, Math.min(3_600_000, options.capture.expires_at_ms - wall));
    // A late optional read may outlive the turn. Retain numeric identity only,
    // never its prompt, capability, attachment metadata or mutable configuration.
    this.capture = { ...options.capture };
    this.runId = options.configuration.runId;
    this.harness = options.configuration.harness;
    this.limitBytes = options.configuration.hostRun
      ? options.configuration.hostRun.memoryMiB * 1024 * 1024
      : null;
    this.reused = options.reused;
  }
  private readonly reused: boolean;
  active() {
    return !this.stopped && this.clock() < this.expires;
  }
  expired() {
    return !this.stopped && this.clock() >= this.expires;
  }
  private stageValue() {
    let value = this.stages.get(this.current);
    if (!value) {
      value = { stage: this.current, observations: 0, duration_ms: 0, rss_max_bytes: null };
      this.stages.set(this.current, value);
    }
    return value;
  }
  stage(stage: MemoryStage) {
    if (!this.active()) return;
    const now = this.clock();
    this.stageValue().duration_ms += Math.max(0, now - this.stageAt);
    this.current = stage;
    this.stageAt = now;
  }
  /** Returns whether this guard observation was admitted for optional enrichment. */
  observe(sample: AgentMemorySample) {
    if (!this.active() || sample.observedAtMs - this.lastObserved < 1000) return false;
    this.lastObserved = sample.observedAtMs;
    this.samples++;
    const stage = this.stageValue();
    stage.observations++;
    stage.rss_max_bytes = Math.max(stage.rss_max_bytes ?? 0, sample.rssBytes);
    if (this.peak === null || sample.rssBytes > this.peak) {
      this.peak = sample.rssBytes;
      this.largest = largestMemoryProcesses(sample);
    }
    if (this.recent.length === 16) {
      this.recent.shift();
      this.dropped.recent_samples++;
    }
    this.recent.push({
      offset_ms: Math.max(0, sample.observedAtMs - this.began),
      stage: this.current,
      rss_bytes: sample.rssBytes,
      process_count: sample.processCount,
      unavailable_process_count: sample.unavailableProcessCount,
    });
    return true;
  }
  frame(frame: NativeDiagnosticFrame) {
    if (!this.active()) return;
    if (this.frames++ >= 32) {
      this.dropped.frames++;
      return;
    }
    if (frame.kind === 'stage') this.stage(frame.stage);
    else {
      if (this.heap.length >= 3) {
        this.dropped.frames++;
        return;
      }
      const { run_id: _run, capture_id: _capture, kind: _kind, mark, adapter_load_ms, ...values } = frame;
      this.heap.push({ kind: mark, ...values });
      if (mark === 'after_adapter_load' && adapter_load_ms !== undefined) this.adapterLoad = adapter_load_ms;
    }
  }
  pss(snapshot: NonNullable<NativeMemoryProfile['pss']>) {
    if (!this.active()) return;
    this.snapshot = snapshot;
    this.pssReason = undefined;
  }
  pssUnavailable(reason: NonNullable<NativeMemoryProfile['pss_unavailable_reason']>) {
    if (this.active()) this.pssReason = reason;
  }
  offset() {
    return Math.max(0, this.clock() - this.began);
  }
  finish(endedBy: NativeMemoryProfile['ended_by']): NativeMemoryProfile | undefined {
    if (this.stopped) return;
    const end = Math.min(this.clock(), this.expires);
    this.stageValue().duration_ms += Math.max(0, end - this.stageAt);
    this.stopped = true;
    const record: NativeMemoryProfile = {
      capture_id: this.capture.capture_id,
      origin_instance_id: this.capture.origin_instance_id,
      sample_rate: this.capture.sample_rate,
      run_id: this.runId,
      harness: this.harness,
      reused: this.reused,
      started_at: this.startedAt,
      duration_ms: Math.max(0, end - this.began),
      ended_by: endedBy,
      memory_status:
        this.limitBytes === null
          ? 'allocation_monitor_unavailable'
          : this.samples
            ? 'observed'
            : 'not_observed',
      limit_bytes: this.limitBytes,
      peak_observed_rss_bytes: this.peak,
      samples_seen: this.samples,
      recent: [...this.recent],
      stages: [...this.stages.values()].map((value) => ({ ...value })),
      largest_processes: this.largest,
      ...(this.snapshot
        ? { pss: { ...this.snapshot, age_ms: Math.max(0, end - this.began - this.snapshot.offset_ms) } }
        : {}),
      ...(this.pssReason ? { pss_unavailable_reason: this.pssReason } : {}),
      ...(this.adapterLoad === undefined ? {} : { adapter_load_ms: this.adapterLoad }),
      heap_marks: this.heap,
      dropped: { ...this.dropped },
    };
    while (record.recent.length && Buffer.byteLength(JSON.stringify(record)) > 7 * 1024) {
      record.recent.shift();
      record.dropped.recent_samples++;
    }
    return Buffer.byteLength(JSON.stringify(record)) <= 7 * 1024 ? record : undefined;
  }
  dispose() {
    this.stopped = true;
  }
}
