import type { components } from '../../contracts/api';
import { transaction, type Tx } from '../../db';
import { requireScopes, requireWorkspace, type Principal } from './auth';
import { requireApplication, requireDecisionWorkspace } from './decision-authority';
import { assert } from './errors';
import { id, seal } from './crypto';
import { digest, schemaValidator, validateContext } from './explicit-context';
import { authorizeContext, storedContextReader } from './context-artifacts';
import { admitInference, type ResolvedInferenceCreate } from './inferences';
import * as resources from './resources';

type Schema = components['schemas'];
export type TaskRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  recipe: Schema['DecisionTaskCreate'];
  principal: Principal;
  status: Schema['DecisionTask']['status'];
  close_requested: boolean;
  latest_wake_id: string | null;
  proposal_artifact_id: string | null;
  failure_code: string | null;
  evidence_expires_at: Date;
};
export async function taskRow(tx: Tx, p: Principal, taskId: string, lock = false) {
  const row = (
    await tx.query<TaskRow>(`SELECT * FROM decision_tasks WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [taskId])
  ).rows[0];
  assert(row, 404, 'not_found', 'Task not found.');
  requireWorkspace(p, row.workspace_id);
  await resources.get(tx, 'workspaces', row.workspace_id, p);
  return row;
}
export async function taskTotals(tx: Tx, taskId: string) {
  return (
    await tx.query<{ committed: string; outstanding: string; count: number }>(
      'SELECT coalesce(sum(committed_micro_usd),0)::text AS committed,coalesce(sum(allocated_micro_usd) FILTER(WHERE committed_micro_usd IS NULL),0)::text AS outstanding,count(*)::integer AS count FROM decision_task_runs WHERE task_id=$1',
      [taskId],
    )
  ).rows[0];
}
export async function getTask(tx: Tx, p: Principal, taskId: string): Promise<Schema['DecisionTask']> {
  requireScopes(p, ['runs:read']);
  return presentTask(tx, p, taskId);
}
/** Authorized mutations return their receipt without requiring a separate read grant. */
async function presentTask(tx: Tx, p: Principal, taskId: string): Promise<Schema['DecisionTask']> {
  const row = await taskRow(tx, p, taskId),
    totals = await taskTotals(tx, taskId);
  const runs = (
    await tx.query<Schema['TaskRun']>(
      'SELECT t.run_id,t.wake_id,t.step,t.allocated_micro_usd::text,t.committed_micro_usd::text,r.status FROM decision_task_runs t JOIN runs r ON r.id=t.run_id WHERE t.task_id=$1 ORDER BY r.created_at,r.id',
      [taskId],
    )
  ).rows;
  const outcomes = (
    await tx.query<{ id: string; created_at: Date; receipt: Schema['ApplicationOutcome'] }>(
      'SELECT id,created_at,receipt FROM decision_task_outcomes WHERE task_id=$1 ORDER BY created_at,id LIMIT 100',
      [taskId],
    )
  ).rows;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    objective: row.recipe.objective,
    status: row.status,
    next_step:
      row.status === 'waiting'
        ? 'Observe the next application event'
        : row.status === 'proposal'
          ? 'Application review'
          : row.status.replaceAll('_', ' '),
    max_cost_micro_usd: row.recipe.max_cost_micro_usd,
    max_runs: row.recipe.max_runs,
    committed_micro_usd: totals.committed,
    outstanding_micro_usd: totals.outstanding,
    latest_wake_id: row.latest_wake_id,
    proposal_artifact_id: row.proposal_artifact_id,
    failure_code: row.failure_code,
    evidence_expires_at: row.evidence_expires_at.toISOString(),
    runs,
    outcomes: outcomes.map((outcome) => ({ ...outcome, created_at: outcome.created_at.toISOString() })),
  };
}
export async function createTask(tx: Tx, p: Principal, input: Schema['DecisionTaskCreate']) {
  requireScopes(p, ['runs:write']);
  requireApplication(p, input.workspace_id);
  await requireDecisionWorkspace(tx, p, input.workspace_id);
  assert(
    !input.decide.definition.bounded_agent,
    400,
    'invalid_task_recipe',
    'The decision step must be a single inference.',
  );
  assert(
    !!input.investigate === Object.hasOwn(input, 'investigate_when'),
    400,
    'invalid_task_recipe',
    'An investigation requires an explicit decision value to match.',
  );
  if (input.investigate)
    assert(
      input.investigate.definition.bounded_agent,
      400,
      'invalid_task_recipe',
      'The investigation must use a bounded-agent definition.',
    );
  for (const step of [input.decide, ...(input.investigate ? [input.investigate] : [])]) {
    schemaValidator(step.definition.input_schema);
    schemaValidator(step.definition.output_schema);
    assert(
      BigInt(step.definition.limits.max_cost_micro_usd) <= BigInt(input.max_cost_micro_usd),
      400,
      'task_budget_exceeded',
      'A child ceiling cannot exceed the total task ceiling.',
    );
    for (const reference of step.definition.bounded_agent?.context_artifacts || [])
      await authorizeContext(tx, p, input.workspace_id, reference);
  }
  const taskId = id();
  await tx.query(
    "INSERT INTO decision_tasks(id,organization_id,workspace_id,recipe,principal,evidence_expires_at) VALUES($1,$2,$3,$4,$5,now()+($6::integer*interval '1 second'))",
    [
      taskId,
      p.organizationId,
      input.workspace_id,
      JSON.stringify(input),
      JSON.stringify(p),
      input.evidence_horizon_seconds,
    ],
  );
  for (const reference of input.investigate?.definition.bounded_agent?.context_artifacts || [])
    await holdEvidence(tx, p.organizationId, taskId, reference.artifact_id);
  await queueTaskProgress(tx, p.organizationId, taskId);
  return presentTask(tx, p, taskId);
}
export async function holdEvidence(tx: Tx, org: string, taskId: string, artifactId: string) {
  await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE', [artifactId]);
  await resources.get(tx, 'artifacts', artifactId);
  await tx.query(
    'INSERT INTO decision_task_evidence(organization_id,task_id,artifact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [org, taskId, artifactId],
  );
}
export async function queueTaskProgress(tx: Tx, org: string, taskId: string) {
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'decision_task',$3) ON CONFLICT(kind,resource_id) DO UPDATE SET state='pending',available_at=now(),lease_until=NULL",
    [id(), org, taskId],
  );
}
/** Call while holding the task row. This records allocation, not a second wallet
 * reservation. admitInference alone owns the existing reserve/settle journals. */
export async function admitTaskChild(
  tx: Tx,
  task: TaskRow,
  wakeId: string,
  step: 'decide' | 'investigate',
  input: ResolvedInferenceCreate,
) {
  const totals = await taskTotals(tx, task.id),
    allocation = BigInt(input.definition.limits.max_cost_micro_usd);
  assert(
    totals.count < task.recipe.max_runs &&
      BigInt(totals.committed) + BigInt(totals.outstanding) + allocation <=
        BigInt(task.recipe.max_cost_micro_usd),
    402,
    'task_budget_exhausted',
    'The task’s remaining run or spend allowance cannot cover this child.',
  );
  const run = await admitInference(
    tx,
    task.principal,
    input,
    step === 'decide' ? 'inference' : 'bounded_agent',
  );
  await tx.query("UPDATE runs SET config=config||jsonb_build_object('task_id',$2::text) WHERE id=$1", [
    run.run_id,
    task.id,
  ]);
  await tx.query(
    'INSERT INTO decision_task_runs(organization_id,task_id,wake_id,run_id,step,allocated_micro_usd) VALUES($1,$2,$3,$4,$5,$6)',
    [task.organization_id, task.id, wakeId, run.run_id, step, allocation.toString()],
  );
  await tx.query(
    "UPDATE decision_tasks SET status='running',latest_wake_id=$2,proposal_artifact_id=NULL,failure_code=NULL WHERE id=$1",
    [task.id, wakeId],
  );
  await queueTaskProgress(tx, task.organization_id, task.id);
  return run;
}
function requireTaskApplication(task: TaskRow, p: Principal) {
  requireApplication(p, task.workspace_id);
  assert(
    task.principal.id === p.id,
    403,
    'task_owner_required',
    'Use the creating application credential for task wakes and outcomes.',
  );
}
async function receivedWake(tx: Tx, taskId: string, input: Schema['DecisionTaskWake']) {
  const prior = (
    await tx.query<{ fingerprint: string }>(
      'SELECT fingerprint FROM decision_task_wakes WHERE task_id=$1 AND event_id=$2',
      [taskId, input.event_id],
    )
  ).rows[0];
  if (prior)
    assert(
      prior.fingerprint === digest(input),
      409,
      'idempotency_conflict',
      'This event was already received with different evidence.',
    );
  return !!prior;
}
export async function prepareTaskWake(p: Principal, taskId: string, input: Schema['DecisionTaskWake']) {
  requireScopes(p, ['runs:write']);
  const { task, received } = await transaction(p.organizationId, async (tx) => {
    const task = await taskRow(tx, p, taskId);
    requireTaskApplication(task, p);
    return { task, received: await receivedWake(tx, taskId, input) };
  });
  // Replays rely on the committed fingerprint, not expired or released evidence.
  // Recheck under the task lock below to serialize concurrent first deliveries.
  const context = received
    ? undefined
    : 'artifact_id' in input.context
      ? await storedContextReader.read(p, task.workspace_id, input.context)
      : input.context;
  if (context) validateContext(task.recipe.decide.definition, input.input, context);
  return {
    async commit(tx: Tx, principal: Principal) {
      requireScopes(principal, ['runs:write']);
      const current = await taskRow(tx, principal, taskId, true);
      requireTaskApplication(current, principal);
      if (await receivedWake(tx, taskId, input)) {
        return presentTask(tx, principal, taskId);
      }
      assert(context, 409, 'task_changed', 'The wake receipt changed during admission. Retry the request.');
      assert(
        current.status === 'waiting' &&
          !current.close_requested &&
          current.evidence_expires_at.getTime() > Date.now(),
        409,
        'task_not_waiting',
        'Review or close the current cycle before waking this task. Expired evidence requires a new task.',
      );
      if ('artifact_id' in input.context) {
        await authorizeContext(tx, principal, current.workspace_id, input.context);
        await holdEvidence(tx, principal.organizationId, taskId, input.context.artifact_id);
      }
      const wakeId = id();
      await tx.query(
        'INSERT INTO decision_task_wakes(id,organization_id,task_id,event_id,fingerprint,input_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',
        [
          wakeId,
          principal.organizationId,
          taskId,
          input.event_id,
          digest(input),
          seal({
            input: input.input,
            context,
            context_reference: 'artifact_id' in input.context ? input.context : undefined,
          }),
        ],
      );
      await admitTaskChild(tx, current, wakeId, 'decide', {
        workspace_id: current.workspace_id,
        ...current.recipe.decide,
        input: input.input,
        context,
        context_reference: 'artifact_id' in input.context ? input.context : undefined,
      });
      return presentTask(tx, principal, taskId);
    },
    async dispose() {},
  };
}
export async function recordOutcome(
  tx: Tx,
  p: Principal,
  taskId: string,
  input: Schema['ApplicationOutcome'],
) {
  requireScopes(p, ['runs:write']);
  const task = await taskRow(tx, p, taskId, true);
  requireTaskApplication(task, p);
  const prior = (
    await tx.query<{ fingerprint: string }>(
      'SELECT fingerprint FROM decision_task_outcomes WHERE task_id=$1 AND event_id=$2',
      [taskId, input.event_id],
    )
  ).rows[0];
  if (prior)
    assert(
      prior.fingerprint === digest(input),
      409,
      'idempotency_conflict',
      'This outcome event has different content.',
    );
  else {
    assert(
      task.status === 'proposal' && task.latest_wake_id === input.wake_id,
      409,
      'proposal_required',
      'Review the current published proposal first.',
    );
    await tx.query(
      'INSERT INTO decision_task_outcomes(id,organization_id,task_id,wake_id,event_id,fingerprint,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id(), p.organizationId, taskId, input.wake_id, input.event_id, digest(input), JSON.stringify(input)],
    );
    await tx.query("UPDATE decision_tasks SET status='waiting' WHERE id=$1", [taskId]);
    // The application receipt is independent; provider evidence stays unchanged.
    await releaseTaskEvidence(tx, task);
  }
  return presentTask(tx, p, taskId);
}
export async function releaseTaskEvidence(tx: Tx, task: TaskRow) {
  await tx.query('DELETE FROM decision_task_evidence WHERE task_id=$1', [task.id]);
  if (!task.close_requested && task.evidence_expires_at.getTime() > Date.now())
    for (const ref of task.recipe.investigate?.definition.bounded_agent?.context_artifacts || [])
      await holdEvidence(tx, task.organization_id, task.id, ref.artifact_id);
  await tx.query("UPDATE decision_task_wakes SET input_ciphertext='' WHERE task_id=$1", [task.id]);
}
export async function closeTask(tx: Tx, p: Principal, taskId: string) {
  requireScopes(p, ['runs:write']);
  await taskRow(tx, p, taskId, true);
  await tx.query('UPDATE decision_tasks SET close_requested=true WHERE id=$1', [taskId]);
  // Cancellation never frees an allocation. The coordinator waits for committed settlement.
  await tx.query(
    "UPDATE runs SET cancel_requested=true WHERE id IN (SELECT run_id FROM decision_task_runs WHERE task_id=$1) AND status IN ('queued','provisioning','running')",
    [taskId],
  );
  await queueTaskProgress(tx, p.organizationId, taskId);
  return presentTask(tx, p, taskId);
}
