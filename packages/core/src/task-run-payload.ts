import type { Tx } from '../../db';
import type { ExplicitContext, ResolvedContext } from './decision';
import type { RunRow, InferenceConfig, ExecutableInferenceRunRow } from './runs';
import { assert } from './errors';
import { digest } from './explicit-context';
import { unseal } from './crypto';

export type TaskRunSource = {
  task_id: string;
  task_wake_id: string;
  context_appendix?: ExplicitContext['items'];
};
export type TaskInferenceConfig = Omit<InferenceConfig, 'input' | 'context'> & {
  payload_kind: 'task_wake';
  task_id: string;
  task_wake_id: string;
  task_input_digest: string;
  context_control: Pick<
    ResolvedContext,
    'organization_id' | 'workspace_id' | 'application_namespace' | 'admitted_at'
  >;
  context_appendix: ExplicitContext['items'];
};
export type StoredTaskRunRow = Omit<ExecutableInferenceRunRow, 'config'> & { config: TaskInferenceConfig };

/** The wake owns common input/evidence. Each child owns only its accepted
 * provenance and (for investigation) the one additional decision record. */
export function taskQueuedConfiguration(
  configuration: InferenceConfig,
  source: TaskRunSource,
): TaskInferenceConfig {
  const { input, context, ...metadata } = configuration;
  return {
    ...metadata,
    payload_kind: 'task_wake',
    task_id: source.task_id,
    task_wake_id: source.task_wake_id,
    task_input_digest: digest(input),
    context_control: {
      organization_id: context.organization_id,
      workspace_id: context.workspace_id,
      application_namespace: context.application_namespace,
      admitted_at: context.admitted_at,
    },
    context_appendix: source.context_appendix ?? [],
  };
}

function storedTaskRun(run: RunRow | StoredTaskRunRow): run is StoredTaskRunRow {
  return (
    run.kind !== 'native_agent' && 'payload_kind' in run.config && run.config.payload_kind === 'task_wake'
  );
}

/** Explicit executable-input read. One tenant-scoped page decrypts each wake
 * once and verifies every child binding before reconstructing its exact input. */
export async function hydrateTaskRunPayloads(tx: Tx, runs: (RunRow | StoredTaskRunRow)[]): Promise<RunRow[]> {
  const requested = runs.filter(storedTaskRun);
  if (!requested.length) return runs.filter((run): run is RunRow => !storedTaskRun(run));
  const rows = await tx.query<{
    run_id: string;
    organization_id: string;
    task_id: string;
    wake_id: string;
    workspace_id: string;
    input_ciphertext: string;
  }>(
    `SELECT t.run_id,t.organization_id,t.task_id,t.wake_id,d.workspace_id,w.input_ciphertext
     FROM decision_task_runs t JOIN decision_tasks d ON d.id=t.task_id AND d.organization_id=t.organization_id
     JOIN decision_task_wakes w ON w.id=t.wake_id AND w.task_id=t.task_id AND w.organization_id=t.organization_id
     WHERE t.run_id=ANY($1::uuid[])`,
    [requested.map((run) => run.id)],
  );
  const bindings = new Map(rows.rows.map((row) => [row.run_id, row]));
  const inputs = new Map<string, { input: unknown; context: ExplicitContext }>();
  return runs.map((run): RunRow => {
    if (!storedTaskRun(run)) return run;
    const binding = bindings.get(run.id);
    assert(
      binding &&
        binding.organization_id === run.organization_id &&
        binding.workspace_id === run.workspace_id &&
        binding.task_id === run.config.task_id &&
        binding.wake_id === run.config.task_wake_id &&
        binding.input_ciphertext,
      409,
      'task_input_unavailable',
      'The Task input is no longer available.',
    );
    let evidence = inputs.get(binding.wake_id);
    if (!evidence) {
      evidence = unseal<{ input: unknown; context: ExplicitContext }>(binding.input_ciphertext);
      inputs.set(binding.wake_id, evidence);
    }
    const {
      payload_kind: _kind,
      task_input_digest,
      context_control,
      context_appendix,
      ...configuration
    } = run.config;
    const context = {
      ...evidence.context,
      ...context_control,
      items: [...evidence.context.items, ...context_appendix],
    };
    assert(
      digest(evidence.input) === task_input_digest && digest(context) === configuration.context_digest,
      409,
      'task_input_changed',
      'The saved Task input does not match its accepted child.',
    );
    return { ...run, config: { ...configuration, input: evidence.input, context } };
  });
}

/** A shared wake cannot be removed while another child's retained history or
 * an active Task cycle still depends on it. Purge remains an explicit erasure. */
export async function redactReleasedTaskPayloads(tx: Tx, runIds?: string[], taskId?: string) {
  await tx.query(
    `UPDATE decision_task_wakes w SET input_ciphertext=''
     WHERE w.input_ciphertext<>'' AND ($2::uuid IS NULL OR w.task_id=$2) AND ($1::uuid[] IS NULL OR EXISTS(
       SELECT 1 FROM decision_task_runs selected WHERE selected.wake_id=w.id AND selected.run_id=ANY($1::uuid[])))
       AND NOT EXISTS(SELECT 1 FROM decision_task_runs t JOIN runs r ON r.id=t.run_id
         WHERE t.wake_id=w.id AND coalesce((r.result->>'content_expired')::boolean,false)=false)
       AND NOT EXISTS(SELECT 1 FROM decision_tasks t WHERE t.id=w.task_id AND t.latest_wake_id=w.id
         AND t.status IN ('running','needs_investigation','publishing') AND t.evidence_expires_at>now())`,
    [runIds ?? null, taskId ?? null],
  );
}
