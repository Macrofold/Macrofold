import * as sandboxes from './sandboxes';
import type { SandboxProviderKind } from '../../contracts/sandbox-control';
import { initialReceipt } from './inference-receipt';
import { defaultRunBudgetMicroUsd } from '../../contracts/run-defaults';
import { resolveRunAttachments } from './run-attachments';
import type { RunAttachment } from '../../contracts/media';
import { admitPermissions } from './agent-permissions';
import { type PermissionLayers } from '../../contracts/permissions';
import type { ExecutionState } from './cloud-engine';
import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import { lock } from '../../db';
import { assert } from './errors';
import { id, canonical } from './crypto';
import { validateModelParameters, type ModelParameters } from './model-parameters';
import { config, isLocal, isSimulated, realExecutionEnabled } from './config';
import { getExecutionPolicy, QUEUE_TIMEOUT_SECONDS } from './plans';
import { queueObservations, type WaitingReason } from './scheduling';
import { models, computeRate, computeMaximum, type Model } from './catalog';
import { emit } from './events';
import * as resources from './resources';
import { reserve, settle } from './ledger';
import { createWorktree, nameWorktreeForRun } from './files';
import { requireWorkspace, requireScopes, type Principal } from './auth';
import { admitConnections, type ConnectionAccessSnapshot } from './connection-access-resolution';
import { isToolConnection } from './connection-access-policy';
import { requireClaudeSubscriptionExecution, validateClaudeFallback } from './claude-connections';

type Schema = components['schemas'];
export type RunConfig = Schema['SessionCreate'] & {
  permission_layers?: PermissionLayers;
  attachments?: RunAttachment[];
  agent_id: string | null;
  agent_version: number | null;
  connection_access: ConnectionAccessSnapshot[];
  prompt: string;
  instructions?: string;
  harness_prompt_mode?: 'replace' | 'extend';
  user_id: string;
  principal_id: string;
  principal_kind: Principal['kind'];
  workspace_ids: string[];
  webhook_endpoint_ids?: string[];
  client_type?: Schema['Run']['client_type'];
  scheduling_class?: 'background' | 'interactive';
  rate_card?: Model;
  compute_rate_micro_usd_per_minute?: string;
  oauth_token_id?: string;
  oauth_audience?: string;
  execution_provider?: string;
  sandbox_id?: string;
  sandbox_provider?: SandboxProviderKind;
  keep_warm_seconds?: number | null;
};
type RunEnvelope = {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  status: Schema['Run']['status'];
  result: Partial<Omit<Schema['RunResult'], 'execution_outcome' | 'persistence_status'>> &
    Pick<Schema['Run'], 'execution_outcome' | 'persistence_status' | 'sync_status' | 'failure_code'> & {
      last_verified_checkpoint_id?: string;
    };
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
  execution_binding: ExecutionState | null;
  input_request: { id: string; answer?: Record<string, unknown> } | null;
};
export type InferenceConfig = Pick<RunConfig,
  'user_id' | 'principal_id' | 'principal_kind' | 'workspace_ids' | 'oauth_token_id' |
  'oauth_audience' | 'client_type' | 'scheduling_class' | 'webhook_endpoint_ids'> & {
  executor_version: '1';
  task_id?: string;
  context_reference?: Schema['ContextReference'];
  definition_reference?: Schema['DefinitionReference'];
  transformation_version: string;
  admission_ms: number;
  context_resolution_ms?: number;
  provider_cost_rate_card: Model;
  model: string;
  model_parameters?: ModelParameters;
  billing_mode: 'managed' | 'byok';
  provider_connection_id?: string;
  rate_card: Model;
  limits: Schema['InferenceLimits'];
  definition: Schema['InferenceDefinition'];
  definition_digest: string;
  input: unknown;
  context: import('./decision').ResolvedContext;
  context_digest: string;
};
export type NativeRunRow = RunEnvelope & { kind: 'native_agent'; workspace_id: string; worktree_id: string; session_id: string; config: RunConfig };
export type InferenceRunRow = RunEnvelope & { kind: 'inference' | 'bounded_agent'; worktree_id: null; session_id: null; config: InferenceConfig };
export type RunRow = NativeRunRow | InferenceRunRow;
export function requireNativeRun(run: RunRow): asserts run is NativeRunRow {
  assert(run.kind === 'native_agent', 409, 'run_kind_mismatch', 'This operation requires a native-agent run.');
}
export async function getNativeRun(tx: Tx, runId: string, p?: Principal) {
  const run = await getRun(tx, runId, p);
  requireNativeRun(run);
  return run;
}
/** Client attribution is descriptive, never an authorization input. */
export function requestClientType(request: Request): NonNullable<Schema['Run']['client_type']> {
  const type = request.headers.get('x-client-type');
  switch (type) {
    case 'dashboard':
    case 'cli':
    case 'sdk':
    case 'api':
    case 'internal':
      return type;
    default:
      return 'api';
  }
}
export const terminal = (status: string) =>
  ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status);
export function presentRun(row: RunRow, waitingReason: WaitingReason | null = null) {
  return {
    id: row.id,
    kind: row.kind,
    task_id: row.kind === 'native_agent' ? null : row.config.task_id || null,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    session_id: row.session_id,
    worktree_id: row.worktree_id,
    sandbox_id: row.kind === 'native_agent' ? row.config.sandbox_id || null : null,
    harness: row.kind === 'native_agent' ? row.config.harness : null,
    model: row.config.model,
    agent_id: row.kind === 'native_agent' ? row.config.agent_id : null,
    agent_version: row.kind === 'native_agent' ? row.config.agent_version : null,
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
    permission_layers: row.kind === 'native_agent' ? row.config.permission_layers || [] : [],
  };
}
export function waitingFields(row: RunRow, reason: WaitingReason | null = null) {
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
  if (p) requireWorkspace(p, row.workspace_id);
  return row;
}
export async function validateConfiguration(
  tx: Tx,
  p: Principal,
  configuration: Omit<Schema['SessionCreate'], 'worktree_id'>,
  purpose: 'execution' | 'preset' = 'execution',
) {
  const model = (await models(tx)).find(
    (m) => m.id === configuration.model && m.enabled && m.harnesses.includes(configuration.harness),
  );
  assert(model, 400, 'model_unavailable', 'Choose an enabled model compatible with the harness.');
  validateModelParameters(configuration.model_parameters, model.provider, model.id);
  assert(
    ['byok', 'managed', 'subscription'].includes(configuration.billing_mode),
    400,
    'invalid_request',
    'Choose a billing mode.',
  );
  if (configuration.billing_mode === 'subscription') {
    assert(
      configuration.harness === 'claude-code' && model.provider === 'anthropic',
      400,
      'credentials_incompatible',
      'Claude subscription connections require Claude Code and an Anthropic model.',
    );
    assert(
      configuration.provider_connection_id,
      400,
      'credentials_required',
      'Select a named Claude subscription connection.',
    );
    const connection = await resources.get(tx, 'connections', configuration.provider_connection_id, p);
    assert(
      connection.owner_subject_id === p.userId,
      403,
      'forbidden',
      'This subscription connection belongs to another user.',
    );
    assert(
      connection.kind === 'claude_subscription',
      400,
      'credentials_incompatible',
      'Select a Claude subscription connection.',
    );
    await validateClaudeFallback(tx, p, connection.api_fallback as Schema['ClaudeApiFallback'] | null);
    if (purpose === 'execution') requireClaudeSubscriptionExecution();
  }
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
        // Local simulation never reads or sends the selected key. Native runs
        // still require an exact provider match, including after profile changes.
        (connection.provider === model.provider || (isSimulated() && model.provider === 'fixture')) &&
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
  // Saved defaults validate references, not a fabricated execution context. Actual
  // workspace/preset authority and current readiness are resolved at each admission.
  for (const grant of configuration.connection_grants || []) {
    const connection = await resources.get(tx, 'connections', grant.connection_id, p);
    assert(
      isToolConnection(connection.kind),
      400,
      'connection_access_unsupported',
      'Choose a tool-bearing connection.',
    );
  }
  const policy = await getExecutionPolicy(tx, p.organizationId);
  const limits = {
    timeout_seconds: Math.min(900, policy.max_timeout_seconds),
    max_cost_micro_usd: defaultRunBudgetMicroUsd,
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
  return { ...configuration, limits, rate_card: model };
}
export async function createSession(tx: Tx, p: Principal, input: Schema['SessionCreate']) {
  const worktree = await resources.get(tx, 'worktrees', input.worktree_id, p);
  const { rate_card: _rateCard, ...configuration } = await validateConfiguration(tx, p, input);
  return resources.create(tx, 'sessions', p.organizationId, {
    ...configuration,
    worktree_id: worktree.id,
    workspace_id: worktree.workspace_id,
    agent_id: null,
    agent_version: null,
  });
}
export async function admitRun(
  tx: Tx,
  p: Principal,
  input: Schema['RunCreate'] & { queue_if_busy?: boolean },
  clientType: NonNullable<Schema['Run']['client_type']> = 'api',
  recordActivity = true,
) {
  assert(
    process.env.RUN_ADMISSION_ENABLED !== 'false',
    503,
    'admission_paused',
    'New agent runs are temporarily paused. Existing runs and saved files remain available.',
  );
  await (await import('./storage-maintenance')).requireStorageCapacity(tx, p.organizationId);
  requireScopes(p, ['runs:write']);
  assert(p.userId, 403, 'forbidden', 'A run requires a current organization member.');
  assert(
    (isLocal() && config.execution === 'simulator') || realExecutionEnabled(),
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
  let session: resources.Document<'sessions'>;
  if (input.session_id) {
    session = await resources.get(tx, 'sessions', input.session_id, p);
    assert(
      input.model_parameters === undefined ||
        canonical(input.model_parameters) === canonical(session.model_parameters ?? {}),
      409, 'session_configuration_immutable', 'Start a new session to change model parameters.',
    );
    assert(
      !input.harness || input.harness === session.harness,
      409,
      'session_harness_immutable',
      'A session keeps its original harness.',
    );
    assert(
      !input.agent_id && !input.billing_mode && !input.provider_connection_id,
      400,
      'session_configuration_immutable',
      'Start a new session to change credentials or agent origin.',
    );
  } else {
    let worktreeId = input.worktree_id;
    if (input.workspace_id) {
      const workspace = await resources.get(tx, 'workspaces', input.workspace_id, p);
      assert(!workspace.archived, 409, 'workspace_archived', 'Restore the workspace before starting work.');
      worktreeId = workspace.default_worktree_id as string | undefined;
      if (!worktreeId) {
        const op = await createWorktree(tx, p, workspace.id, { name: 'main', branch: 'main' });
        worktreeId = (op.result as { worktree_id: string }).worktree_id;
      }
    }
    assert(worktreeId, 400, 'worktree_required', 'Choose a workspace, worktree, or session.');
    const preset: Partial<resources.Document<'agents'>> = input.agent_id
      ? await resources.get(tx, 'agents', input.agent_id, p)
      : {};
    const configuration = {
      harness: input.harness ?? preset.harness,
      model: input.model ?? preset.model,
      model_parameters: input.model_parameters,
      billing_mode: input.billing_mode ?? preset.billing_mode,
      provider_connection_id: input.provider_connection_id ?? preset.provider_connection_id,
      limits: { ...preset.limits, ...input.limits },
    };
    assert(
      configuration.harness && configuration.model && configuration.billing_mode,
      400,
      'configuration_required',
      'Provide a harness, model, and billing mode, or an agent preset.',
    );
    // Run selections/exceptions must never become future session defaults. Only
    // a verified preset's saved default is copied into this conversation.
    const checked = await validateConfiguration(
      tx,
      p,
      configuration as Omit<Schema['SessionCreate'], 'worktree_id'>,
    );
    const worktree = await resources.get(tx, 'worktrees', worktreeId, p);
    const { rate_card: _rateCard, ...saved } = checked;
    session = await resources.create(tx, 'sessions', p.organizationId, {
      ...saved,
      worktree_id: worktree.id,
      workspace_id: worktree.workspace_id,
      instructions: preset.instructions,
      ...(preset.connection_grants !== undefined ? { connection_grants: preset.connection_grants } : {}),
      agent_id: preset.id || null,
      agent_version: preset.version || null,
    });
  }
  const worktree = await resources.get(tx, 'worktrees', String(session.worktree_id), p);
  const workspace = await resources.get(tx, 'workspaces', String(worktree.workspace_id), p);
  assert(
    !workspace.archived && !['deleting', 'degraded', 'restoring'].includes(String(worktree.status)),
    409,
    'workspace_archived',
    'This worktree is unavailable.',
  );
  await lock(tx, `workspace-permissions:${workspace.id}`);
  await lock(tx, `workspace-worktrees:${worktree.workspace_id}`);
  await lock(tx, `worktree:${worktree.id}`);
  const pending = await tx.query(
    "SELECT id,session_id FROM runs WHERE worktree_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting')",
    [worktree.id],
  );
  assert(
    !pending.rowCount || Boolean(input.session_id && input.queue_if_busy),
    409,
    'worktree_busy',
    'This worktree has pending work. Queue a session follow-up or create an independent worktree.',
  );
  assert(
    pending.rows.filter((r) => r.session_id === session.id).length < 11,
    429,
    'queue_full',
    'This session already has ten queued follow-ups.',
  );
  const configured = await validateConfiguration(tx, p, {
    ...session,
    connection_grants: undefined,
    ...(input.model ? { model: input.model } : {}),
    limits: { ...(session.limits as Schema['Limits']), ...input.limits },
  } as unknown as Schema['SessionCreate']);
  assert(input.harness_prompt_mode === undefined || configured.harness === 'opencode',
    400, 'unsupported_prompt_mode', 'Harness prompt mode is currently supported by OpenCode only.');
  for (const endpoint of input.webhook_endpoint_ids || []) await resources.get(tx, 'webhooks', endpoint, p);
  const permissionLayers = await admitPermissions(
    tx,
    workspace,
    worktree,
    session,
    input.permissions,
    configured.harness,
  );
  if (input.attachments?.length) requireScopes(p, ['files:read']);
  const attachments = input.attachments?.length
    ? resolveRunAttachments(
        input.attachments,
        (await resources.get(tx, 'worktrees', worktree.id, p)).files || [],
        permissionLayers,
        configured,
      )
    : [];
  const resolved = await admitConnections(
    tx,
    p,
    {
      workspace_id: workspace.id,
      agent_id: session.agent_id || null,
      worktree_id: worktree.id,
      defaults: session.connection_grants,
      permissions: permissionLayers,
    },
    input.connection_grants,
    input.connection_access_overrides,
  );
  const simulated = isLocal() && config.execution === 'simulator';
  let sandbox = input.sandbox_id ? await sandboxes.getSandbox(tx, input.sandbox_id, p) : undefined;
  if (!sandbox && (input.keep_warm_seconds || 0) > 0) {
    const created = await sandboxes.createSandbox(tx, p, { worktree_id: worktree.id, keep_warm_seconds: input.keep_warm_seconds,
      max_cost_micro_usd: input.sandbox_max_cost_micro_usd || '5000000' });
    sandbox = await sandboxes.getSandbox(tx, created.id);
  }
  if (sandbox) {
    assert(sandbox.worktree_id === worktree.id, 409, 'sandbox_worktree_mismatch', 'Select a sandbox belonging to this worktree.');
    if (sandbox.status === 'paused') {
      await sandboxes.changeSandbox(tx, p, sandbox.id, 'resume');
      sandbox = await sandboxes.getSandbox(tx, sandbox.id);
    }
    assert(['ready','creating'].includes(sandbox.status), 409, 'sandbox_unavailable', 'This sandbox is not available for runs.');
    assert(BigInt(sandbox.reserved_micro_usd) - sandboxes.sandboxCost(sandbox) >= computeMaximum(configured.limits.timeout_seconds, sandbox.rate_micro_usd_per_minute),
      402, 'sandbox_budget_too_small', 'Pause and resume with a fresh allocation, or shorten this run.');
  }
  const rate = sandbox ? '0' : computeRate();
  const minimum = computeMaximum(configured.limits.timeout_seconds, rate);
  assert(
    simulated || BigInt(configured.limits.max_cost_micro_usd) >= minimum,
    400,
    'run_budget_too_small',
    'Increase the run budget or shorten its timeout to cover the compute window.',
    { minimum_micro_usd: minimum.toString() },
  );
  // BYOK usage still consumes the run budget, but local compute has no prepaid liability.
  // Billable connector fees are reserved atomically at dispatch by the tool broker.
  const reservation = simulated || (isLocal() && config.execution === 'docker' && configured.billing_mode === 'byok')
    ? 0n
    : BigInt(configured.limits.max_cost_micro_usd);
  await reserve(tx, p.organizationId, reservation);
  await nameWorktreeForRun(tx, p, worktree.id, input.prompt);
  const runId = id();
  const runConfig: RunConfig = {
    ...configured,
    worktree_id: worktree.id,
    instructions: session.instructions,
    ...(configured.harness === 'opencode' ? { harness_prompt_mode: input.harness_prompt_mode ?? 'replace' } : {}),
    agent_id: session.agent_id || null,
    agent_version: session.agent_version || null,
    connection_grants: resolved.grants,
    connection_access: resolved.snapshots,
    permission_layers: permissionLayers,
    prompt: input.prompt,
    attachments,
    user_id: p.userId,
    principal_id: p.id,
    principal_kind: p.kind,
    oauth_token_id: p.oauthTokenId,
    oauth_audience: p.oauthAudience,
    workspace_ids: p.workspaceIds,
    webhook_endpoint_ids: input.webhook_endpoint_ids,
    client_type: clientType,
    scheduling_class: input.scheduling_class || 'background',
    rate_card: configured.rate_card,
    compute_rate_micro_usd_per_minute: rate,
    execution_provider: config.execution,
    sandbox_id: sandbox?.id,
    sandbox_provider: sandbox?.provider,
    keep_warm_seconds: input.keep_warm_seconds,
  };
  await tx.query(
    "INSERT INTO runs(id,organization_id,worktree_id,session_id,workspace_id,status,config,reservation_micro_usd,queue_expires_at) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,now()+($8::integer*interval '1 second'))",
    [
      runId,
      p.organizationId,
      worktree.id,
      session.id,
      worktree.workspace_id,
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
  if (recordActivity && p.kind === 'user')
    await tx.query(
      "INSERT INTO actor_activity(id,organization_id,user_id,action) VALUES($1,$2,$3,'run.created')",
      [id(), p.organizationId, p.userId],
    );
  const reasons = await queueObservations(tx, [runId]);
  return {
    run_id: runId,
    sandbox_id: sandbox?.id || null,
    session_id: session.id,
    worktree_id: worktree.id,
    status: 'queued' as const,
    ...waitingFields(row, reasons.get(runId)),
    queue_expires_at: row.queue_expires_at.toISOString(),
    urls: {
      status: `${config.origin}/v1/runs/${runId}`,
      events: `${config.origin}/v1/runs/${runId}/events`,
      stream: `${config.origin}/v1/runs/${runId}/stream`,
      result: `${config.origin}/v1/runs/${runId}/result`,
      cancel: `${config.origin}/v1/runs/${runId}/cancel`,
    },
  };
}
export async function cancelRun(tx: Tx, p: Principal, runId: string) {
  let row = await getRun(tx, runId, p);
  await lock(tx, row.kind === 'native_agent' ? `worktree:${row.worktree_id}` : `run:${row.id}`);
  row = await getRun(tx, runId, p);
  if (terminal(row.status)) return presentRun(row);
  await tx.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [runId]);
  if (row.status === 'queued') {
    await tx.query("UPDATE runs SET status='cancelled',completed_at=now(),result=$2 WHERE id=$1", [
      runId,
      JSON.stringify({ execution_outcome: 'cancelled', persistence_status: 'not_required', ...(row.kind === 'native_agent' ? {} : { inference: { ...initialReceipt(row.config, row.id), outcome: 'failed' } }) }),
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
