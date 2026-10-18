/** Content-free, optional process diagnostics. These identifiers never grant authority. */
export const performanceStages = [
  'http.total',
  'http.parameter_validation',
  'http.authentication',
  'http.rate_limit',
  'http.body_read',
  'http.body_validation',
  'http.fingerprint',
  'http.replay_lookup',
  'http.preparation',
  'http.admission',
  'http.response',
  'inference.finalization',
  'provider.model',
  'provider.tool',
  'trace.initialize',
  'trace.record',
  'storage.read',
  'storage.write',
  'storage.restore',
  'storage.checkpoint',
] as const;
export type PerformanceStage = (typeof performanceStages)[number];
export type PerformanceOperation =
  'rest' | 'mcp' | 'model' | 'tool' | 'run' | 'maintenance' | 'background' | 'storage';
export type PerformancePhase = 'foreground' | 'stream_owner' | 'background' | 'job' | 'unattributed';
export type PerformancePool = 'domain' | 'identity' | 'credential';
export type PerformanceCounter =
  | 'statements'
  | 'groups'
  | 'checkouts'
  | 'rows'
  | 'parameter_bytes'
  | 'unknown_parameters'
  | 'transactions'
  | 'commits'
  | 'rollbacks'
  | 'commit_unknown'
  | 'failures'
  | 'unsupported_driver_form';
export type PerformanceAggregate = { count: number; total_ms: number; min_ms: number; max_ms: number };
export type PerformanceIdentity = { requestId?: string; runId?: string; organizationId?: string };
export type PerformanceRecord = {
  component: 'performance';
  version: 1;
  capture_id: string;
  instance_id: string;
  type: 'operation' | 'capture';
  operation?: PerformanceOperation;
  phase?: PerformancePhase;
  request_id?: string;
  run_id?: string;
  organization_id?: string;
  operation_id?: string;
  parent_id?: string;
  started_at: string;
  duration_ms: number;
  sample_rate: number;
  truncated?: boolean;
  counters: Partial<Record<PerformanceCounter, number>>;
  stages: Partial<
    Record<
      | PerformanceStage
      | 'db.query'
      | 'db.checkout'
      | 'db.group'
      | 'db.transaction'
      | 'db.commit'
      | 'db.rollback',
      PerformanceAggregate
    >
  >;
  pools?: Partial<
    Record<
      PerformancePool,
      {
        statements: number;
        groups: number;
        checkouts: number;
        query_ms: number;
        checkout_ms: number;
        peak_checked_out: number;
        peak_waiting: number;
      }
    >
  >;
  transactions?: { id: string; pool?: PerformancePool; outcome: string; duration_ms: number }[];
  groups?: {
    id: number;
    transaction_id?: string;
    pool?: PerformancePool;
    statements: number;
    duration_ms: number;
  }[];
  dropped?: Readonly<Record<string, number>>;
  unattributed?: { statements: number; checkouts: number };
  sampling?: { seen: number; sampled: number; skipped: number };
  state?: 'started' | 'completed';
  duration_seconds?: number;
};
export interface PerformanceSink {
  enqueue(record: PerformanceRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  stats?(): { dropped: number; written: number; outstanding_bytes: number; outstanding_records: number };
}
export type DatabaseMeasurement = {
  kind: 'query' | 'checkout' | 'group' | 'transaction' | 'commit' | 'rollback' | 'unsupported_driver_form';
  durationMs: number;
  pool?: PerformancePool;
  transactionId?: string;
  groupId?: number;
  checkedOut?: number;
  waiting?: number;
  statements?: number;
  rows?: number;
  parameterBytes?: number;
  unknownParameters?: number;
  grouped?: boolean;
  outcome?: 'committed' | 'rolled_back' | 'commit_unknown' | 'failed';
};
export type PerformanceTicket = { record(measurement: DatabaseMeasurement): void };
