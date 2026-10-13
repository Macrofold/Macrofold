import type { Schema } from 'macrofold';
import type { RunRecoveryStep } from '../../../packages/contracts/run-recovery';

const steps: Record<RunRecoveryStep, { title: string; label: string; action: string }> = {
  dispatch: {
    title: 'Run processing stopped.',
    label: 'Dispatching run processing',
    action: 'Ask the operator to check run dispatch and worker availability before starting another run.',
  },
  checkpoint: {
    title: 'Couldn’t save run files.',
    label: 'Saving the worktree checkpoint',
    action: 'Ask the operator to inspect file permissions and storage before attempting to save again.',
  },
  billing: {
    title: 'Couldn’t finalize run billing.',
    label: 'Settling run charges',
    action: 'Ask the operator to reconcile this run’s charges and reserved funds before retrying.',
  },
  finalization: {
    title: 'Couldn’t finish recording this run.',
    label: 'Recording the final run result',
    action: 'Ask the operator to inspect the run record and outstanding file or billing operations.',
  },
  cleanup: {
    title: 'Couldn’t clean up the worker.',
    label: 'Releasing or stopping the execution environment',
    action: 'Ask the operator to check the execution environment and its resource holds before reuse.',
  },
};
const causes: Record<string, string> = {
  file_permission_denied: 'A file change was rejected by this run’s accepted permissions.',
  accounting_bound_failed: 'Recorded usage exceeded the funds reserved for this run.',
  budget_exceeded: 'Recorded usage exceeded the authorized reservation.',
  rate_card_unavailable: 'The model rates needed to reconcile charges were unavailable.',
  lease_lost: 'This run’s processing step no longer held execution ownership.',
  publication_revision_changed: 'The worktree changed before this run’s results could be saved.',
  docker_image_missing: 'The configured Docker runtime image was missing.',
  docker_daemon_unavailable: 'The Docker daemon was unreachable.',
  docker_disk_full: 'Docker ran out of disk space.',
  docker_command_timeout: 'Docker did not confirm the operation before its deadline.',
  execution_transport_failed: 'The execution service did not confirm the operation.',
};
// Event data is extensible and untrusted. Never display arbitrary exception text
// or guess a failed step from a broad status such as "persisting".
const safeCode = (value: unknown) =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(value) ? value : undefined;

export function runRecoveryMessage(events: Pick<Schema['Event'], 'type' | 'data'>[], persistence?: string) {
  const data = [...events].reverse().find((event) => event.type === 'run.recovery_required')?.data;
  const step =
    typeof data?.step === 'string' && Object.hasOwn(steps, data.step)
      ? (data.step as RunRecoveryStep)
      : undefined;
  const cause = safeCode(data?.cause);
  const attempts =
    typeof data?.attempts === 'number' && Number.isSafeInteger(data.attempts) && data.attempts > 0
      ? data.attempts
      : undefined;
  return {
    ...(step
      ? steps[step]
      : {
          title: 'Run processing stopped.',
          label: 'The failed step was not recorded',
          action: 'Ask the operator to inspect this run’s Events and current worker state before retrying.',
        }),
    cause,
    reason:
      cause && Object.hasOwn(causes, cause) ? causes[cause] : 'No further safe error detail was recorded.',
    attempts,
    originalFailure: safeCode(data?.original_failure_code),
    consequence:
      persistence === 'verified'
        ? 'This run’s files are saved in a verified checkpoint.'
        : persistence === 'not_required'
          ? 'This run did not require a file checkpoint.'
          : 'This run’s file changes are not confirmed saved. The last verified checkpoint remains available.',
  };
}
