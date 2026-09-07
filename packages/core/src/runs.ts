import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import { lock } from '../../db';
import { assert } from './errors';
import { id } from './crypto';
import { config, isLocal } from './config';
import { getExecutionPolicy, QUEUE_TIMEOUT_SECONDS } from './plans';
import { queueObservations } from './scheduling';
import { models, computeRate, computeMaximum, type Model } from './catalog';
import { emit } from './events';
import * as resources from './resources';
import { reserve, settle } from './ledger';
import { createWorkspace } from './files';
import { requireProject, type Principal } from './auth';

type Schema = components['schemas'];
export type RunConfig = Schema['SessionCreate'] & {
  prompt: string;
  instructions?: string;
  user_id: string;
  principal_id: string;
  principal_kind: Principal['kind'];
  project_ids: string[];
  webhook_endpoint_ids?: string[];
  client_type?: string;
  scheduling_class?: 'background' | 'interactive';
  rate_card?: Model;
  compute_rate_micro_usd_per_minute?: string;
  oauth_token_id?: string;
};
export type RunRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  session_id: string;
  project_id: string;
  status: Schema['Run']['status'];
  config: RunConfig;
  result: Record<string, unknown>;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  queue_expires_at: Date;
  deadline: Date | null;
  lease_generation: string;
  heartbeat_at: Date | null;
  cancel_requested: boolean;
  event_sequence: string;
  reservation_micro_usd: string;
  cost_micro_usd: string;
  execution_binding: Record<string, unknown> | null;
  input_request: { id: string; answer?: Record<string, unknown> } | null;
};
export const terminal = (status: string) =>
  ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status);
export function presentRun(row: RunRow, waitingReason: string | null = null) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    session_id: row.session_id,
    workspace_id: row.workspace_id,
    harness: row.config.harness,
    model: row.config.model,
    status: row.status,
    created_at: row.created_at.toISOString(),
    ...(row.started_at ? { started_at: row.started_at.toISOString() } : {}),
    ...(row.completed_at ? { completed_at: row.completed_at.toISOString() } : {}),
    queue_expires_at: row.queue_expires_at.toISOString(),
    limits: row.config.limits,
    execution_deadline: row.deadline?.toISOString() || null,
    ...waitingFields(row, waitingReason),
    cost_micro_usd: row.cost_micro_usd,
    execution_outcome: row.result.execution_outcome || 'pending',
    persistence_status: row.result.persistence_status || 'pending',
    sync_status: row.result.sync_status || 'disabled',
    ...(row.result.failure_code ? { failure_code: row.result.failure_code } : {}),
    client_type: row.config.client_type || 'api',
  };
}
export function waitingFields(row: RunRow, reason: string | null = null) {
  return {
    wait_seconds:
      Math.max(
        0,
        ((row.started_at || row.completed_at)?.getTime() || Date.now()) - row.created_at.getTime(),
      ) / 1000,
    waiting_reason: row.status === 'queued' ? reason || 'scheduler_turn' : null,
    scheduling_class: row.config.scheduling_class || 'background',
    reserved_micro_usd: terminal(row.status) ? '0' : row.reservation_micro_usd,
  };
}
export async function presentRuns(tx: Tx, rows: RunRow[]) {
  const reasons = await queueObservations(
    tx,
    rows.filter((r) => r.status === 'queued').map((r) => r.id),
  );
  return rows.map((row) => presentRun(row, reasons.get(row.id) || null));
}
export async function getRun(tx: Tx, runId: string, p?: Principal): Promise<RunRow> {
  const row = (await tx.query<RunRow>('SELECT * FROM runs WHERE id=$1', [runId])).rows[0];
  assert(row, 404, 'not_found', 'Run not found.');
  if (p) requireProject(p, row.project_id);
  return row;
}
export async function validateConfiguration(tx: Tx, p: Principal, configuration: Schema['SessionCreate']) {
  const model = models().find(
    (m) => m.id === configuration.model && m.enabled && m.harnesses.includes(configuration.harness),
  );
  assert(model, 400, 'model_unavailable', 'Choose an enabled model compatible with the harness.');
  assert(
    ['byok', 'managed'].includes(configuration.billing_mode),
    400,
    'invalid_request',
    'Choose a billing mode.',
  );
  if (configuration.billing_mode === 'byok') {
    assert(
      configuration.provider_connection_id,
      400,
      'credentials_required',
      'BYOK requires a provider connection.',
    );
    const connection = await resources.get(tx, 'connections', configuration.provider_connection_id, p);
    assert(
      connection.kind === 'model' &&
        connection.provider === model.provider &&
        connection.status === 'healthy',
      400,
      'credentials_incompatible',
      'The provider connection is unavailable or incompatible with this model.',
    );
    assert(
      connection.owner_subject_id === p.userId,
      403,
      'forbidden',
      'This connection belongs to another user.',
    );
  }
  for (const grant of configuration.connection_grants || []) {
    const connection = await resources.get(tx, 'connections', grant.connection_id, p);
    assert(
      connection.status === 'healthy',
      400,
      'connection_unavailable',
      'A requested connection needs attention.',
    );
    const allowed = connection.grants as Schema['ConnectionGrantSet'] | undefined;
    assert(
      allowed && grant.tools.every((t) => allowed.tools.includes(t)),
      403,
      'tool_not_granted',
      'A requested tool is outside the approved connection grants.',
    );
    assert(
      allowed.subject_type === 'organization' || allowed.subject_id === p.userId,
      403,
      'forbidden',
      'The connection is not granted to this user.',
    );
  }
  const policy = await getExecutionPolicy(tx, p.organizationId);
  const limits = {
    timeout_seconds: Math.min(900, policy.max_timeout_seconds),
    max_cost_micro_usd: '2000000',
    ...configuration.limits,
  };
  assert(
    Number.isInteger(limits.timeout_seconds) &&
      limits.timeout_seconds >= 1 &&
      limits.timeout_seconds <= policy.max_timeout_seconds,
    400,
    'invalid_request',
    `Run timeout must be between 1 and ${policy.max_timeout_seconds} seconds for this account.`,
  );
  assert(
    /^\d{1,12}$/.test(limits.max_cost_micro_usd) && BigInt(limits.max_cost_micro_usd) > 0n,
    400,
    'invalid_request',
    'Provide a positive budget of at most 999999999999 micro-USD.',
  );
  return { ...configuration, limits };
}
export async function createSession(tx: Tx, p: Principal, input: Schema['SessionCreate']) {
  const workspace = await resources.get(tx, 'workspaces', input.workspace_id, p);
  const configuration = await validateConfiguration(tx, p, input);
  return resources.create(tx, 'sessions', p.organizationId, {
    ...configuration,
    project_id: workspace.project_id,
  });
}
export async function admitRun(
  tx: Tx,
  p: Principal,
  input: Schema['RunCreate'] & { queue_if_busy?: boolean },
  clientType = 'api',
) {
  assert(
    process.env.RUN_ADMISSION_ENABLED !== 'false',
    503,
    'admission_paused',
    'New agent runs are temporarily paused. Existing runs and saved files remain available.',
  );
  await (await import('./storage-maintenance')).requireStorageCapacity(tx, p.organizationId);
  assert(p.userId, 403, 'forbidden', 'A run requires a current organization member.');
  assert(
    isLocal() || config.allowPaid,
    503,
    'execution_disabled',
    'Live execution is disabled until the operator enables paid execution.',
  );
  const queueTimeout = input.queue_timeout_seconds ?? QUEUE_TIMEOUT_SECONDS;
  assert(
    Number.isInteger(queueTimeout) && queueTimeout >= 1 && queueTimeout <= QUEUE_TIMEOUT_SECONDS,
    400,
    'invalid_request',
    'Queue timeout must be between 1 and 86400 seconds.',
  );
  assert(
    !input.scheduling_class || ['background', 'interactive'].includes(input.scheduling_class),
    400,
    'invalid_request',
    'Choose background or interactive scheduling.',
  );
  let session: resources.Document;
  if (input.session_id) {
    session = await resources.get(tx, 'sessions', input.session_id, p);
    assert(
      !input.harness || input.harness === session.harness,
      409,
      'session_harness_immutable',
      'A session keeps its original harness.',
    );
    assert(
      !input.agent_id && !input.billing_mode && !input.provider_connection_id && !input.connection_grants,
      400,
      'session_configuration_immutable',
      'Start a new session to change credentials or tool grants.',
    );
  } else {
    let workspaceId = input.workspace_id;
    if (input.project_id) {
      const project = await resources.get(tx, 'projects', input.project_id, p);
      assert(!project.archived, 409, 'project_archived', 'Restore the project before starting work.');
      workspaceId = project.default_workspace_id as string | undefined;
      if (!workspaceId) {
        const op = await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' });
        workspaceId = (op.result as { workspace_id: string }).workspace_id;
      }
    }
    assert(workspaceId, 400, 'workspace_required', 'Choose a project, workspace, or session.');
    const preset = input.agent_id ? await resources.get(tx, 'agents', input.agent_id, p) : {};
    const merged = { ...preset, ...input, workspace_id: workspaceId };
    assert(
      merged.harness && merged.model && merged.billing_mode,
      400,
      'configuration_required',
      'Provide a harness, model, and billing mode, or an agent preset.',
    );
    session = await createSession(tx, p, merged as Schema['SessionCreate']);
  }
  const workspace = await resources.get(tx, 'workspaces', String(session.workspace_id), p);
  const project = await resources.get(tx, 'projects', String(workspace.project_id), p);
  assert(
    !project.archived && !['deleting', 'degraded', 'restoring'].includes(String(workspace.status)),
    409,
    'project_archived',
    'This workspace is unavailable.',
  );
  await lock(tx, `workspace:${workspace.id}`);
  const pending = await tx.query(
    "SELECT id,session_id FROM runs WHERE workspace_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting')",
    [workspace.id],
  );
  assert(
    !pending.rowCount || Boolean(input.session_id && input.queue_if_busy),
    409,
    'workspace_busy',
    'This workspace has pending work. Queue a session follow-up or create an independent workspace.',
  );
  assert(
    pending.rows.filter((r) => r.session_id === session.id).length < 11,
    429,
    'queue_full',
    'This session already has ten queued follow-ups.',
  );
  const configured = await validateConfiguration(tx, p, {
    ...session,
    ...(input.model ? { model: input.model } : {}),
    limits: { ...(session.limits as Schema['Limits']), ...input.limits },
  } as unknown as Schema['SessionCreate']);
  for (const endpoint of input.webhook_endpoint_ids || []) await resources.get(tx, 'webhooks', endpoint, p);
  const simulated = isLocal() && config.execution === 'simulator';
  const rate = computeRate();
  const minimum = computeMaximum(configured.limits.timeout_seconds, rate);
  assert(
    simulated || BigInt(configured.limits.max_cost_micro_usd) >= minimum,
    400,
    'run_budget_too_small',
    'Increase the run budget or shorten its timeout to cover the compute window.',
    { minimum_micro_usd: minimum.toString() },
  );
  const reservation = simulated ? 0n : BigInt(configured.limits.max_cost_micro_usd);
  await reserve(tx, p.organizationId, reservation);
  const runId = id();
  const runConfig: RunConfig = {
    ...configured,
    prompt: input.prompt,
    user_id: p.userId,
    principal_id: p.id,
    principal_kind: p.kind,
    oauth_token_id: p.oauthTokenId,
    project_ids: p.projectIds,
    webhook_endpoint_ids: input.webhook_endpoint_ids,
    client_type: clientType,
    scheduling_class: input.scheduling_class || 'background',
    rate_card: models().find((m) => m.id === configured.model),
    compute_rate_micro_usd_per_minute: rate,
  };
  await tx.query(
    "INSERT INTO runs(id,organization_id,workspace_id,session_id,project_id,status,config,reservation_micro_usd,queue_expires_at) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,now()+($8::integer*interval '1 second'))",
    [
      runId,
      p.organizationId,
      workspace.id,
      session.id,
      workspace.project_id,
      JSON.stringify(runConfig),
      reservation.toString(),
      queueTimeout,
    ],
  );
  const row = await getRun(tx, runId);
  await emit(tx, p.organizationId, runId, 'run.queued', {
    queue_expires_at: row.queue_expires_at.toISOString(),
    reserved_micro_usd: row.reservation_micro_usd,
    scheduling_class: runConfig.scheduling_class,
    status: 'queued',
    simulated: isLocal() && config.execution === 'simulator',
  });
  await tx.query("INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'run',$3)", [
    id(),
    p.organizationId,
    runId,
  ]);
  if (p.kind === 'user')
    await tx.query(
      "INSERT INTO actor_activity(id,organization_id,user_id,action) VALUES($1,$2,$3,'run.created')",
      [id(), p.organizationId, p.userId],
    );
  const reasons = await queueObservations(tx, [runId]);
  return {
    run_id: runId,
    session_id: session.id,
    workspace_id: workspace.id,
    status: 'queued',
    ...waitingFields(row, reasons.get(runId)),
    queue_expires_at: row.queue_expires_at.toISOString(),
    urls: Object.fromEntries(
      ['status', 'events', 'stream', 'result', 'cancel'].map((k) => [
        k,
        `${config.origin}/v1/runs/${runId}${k === 'status' ? '' : `/${k}`}`,
      ]),
    ),
  };
}
export async function cancelRun(tx: Tx, p: Principal, runId: string) {
  let row = await getRun(tx, runId, p);
  await lock(tx, `workspace:${row.workspace_id}`);
  row = await getRun(tx, runId, p);
  if (terminal(row.status)) return presentRun(row);
  await tx.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [runId]);
  if (row.status === 'queued') {
    await tx.query("UPDATE runs SET status='cancelled',completed_at=now(),result=$2 WHERE id=$1", [
      runId,
      JSON.stringify({ execution_outcome: 'cancelled', persistence_status: 'not_required' }),
    ]);
    await settle(tx, p.organizationId, runId, BigInt(row.reservation_micro_usd), 0n);
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [runId]);
    await emit(tx, p.organizationId, runId, 'run.cancelled', { status: 'cancelled' });
  } else await emit(tx, p.organizationId, runId, 'run.cancel_requested', {});
  return presentRun(await getRun(tx, runId));
}
export async function submitInput(tx: Tx, p: Principal, runId: string, input: Schema['RunInput']) {
  await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
  const row = await getRun(tx, runId, p);
  assert(
    row.status === 'waiting_for_input' &&
      !row.cancel_requested &&
      row.input_request?.id === input.input_request_id,
    409,
    'input_expired',
    'This input request is no longer active.',
  );
  assert(!row.input_request.answer, 409, 'input_already_answered', 'An answer has already been submitted.');
  await tx.query('UPDATE runs SET input_request=$2 WHERE id=$1', [
    runId,
    JSON.stringify({ ...row.input_request, answer: input.answer }),
  ]);
  await emit(tx, p.organizationId, runId, 'input.received', { input_request_id: input.input_request_id });
  return presentRun(row);
}
