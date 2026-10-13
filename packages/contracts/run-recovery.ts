/** Safe diagnostics in run.recovery_required. A failed step does not prove
 * successful persistence, settlement or shutdown. See docs/features/api/events.md. */
export type RunRecoveryStep = 'dispatch' | 'checkpoint' | 'billing' | 'finalization' | 'cleanup';

export type RunRecoveryData = {
  code: 'run_recovery_required';
  step: RunRecoveryStep;
  cause: string;
  attempts: number;
  /** Earlier run failure, distinct from the operation that exhausted retries. */
  original_failure_code?: string;
};
