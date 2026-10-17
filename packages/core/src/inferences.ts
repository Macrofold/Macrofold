import type { Tx } from '../../db';
import { transaction, lock } from '../../db';
import { requireInferenceCaller, requireDecisionWorkspace } from './decision-authority';
import { getDefinition } from './decision-definitions';
import { storedContextReader, authorizeContext } from './context-artifacts';
import { requireScopes, type Principal } from './auth';
import { assert } from './errors';
import { id } from './crypto';
import { config } from './config';
import { validateContext, digest } from './explicit-context';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import { decisionModel, decisionOnlyModel } from './decision-models';
import { models } from './catalog';
import { refreshExpiredOpenRouterCatalog } from './model-catalog';
import { providerModelCatalog } from '../../providers/src/model-catalog';
import { validateModelParameters } from './model-parameters';
import { modelCredential } from './model-credentials';
import { reserve } from './ledger';
import { executionCapacity } from './execution-admission';
import {
  prepareInvocation,
  insertInvocation,
  inferenceRunStateColumns,
  type PreparedInvocation,
} from './inference-invocations';
import { immediateInferencePolicy, inferenceEnvelope, type InvocationPermit } from './direct-inference';
import { runTraceContext } from './run-tracing';
import { tracingEnabled } from './tracing';
import { actorAuthorized } from './actor-authorization';
import { getExecutionPolicy } from './plans';
import { emit } from './events';
import { waitingFields, runUrls, type InferenceConfig, type InferenceRunRow } from './runs';
import type { PreparedHandler, ApiResult } from './api-types';
import { normalizeInferenceInput } from './inference-input';
import type { InferenceCreate, InferenceDefinition, ExplicitContext } from './decision';

async function admitInferenceState(
  tx: Tx,
  p: Principal,
  input: ResolvedInferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
  prepared?: PreparedImmediateInference,
) {
  const admissionStarted = performance.now();
  assert(
    process.env.RUN_ADMISSION_ENABLED !== 'false',
    503,
    'inference_disabled',
    'Direct inference admission is not enabled on this deployment.',
  );
  assert(config.allowPaid, 503, 'execution_disabled', 'Paid execution is disabled.');
  requireScopes(p, input.stream ? ['runs:write', 'runs:read'] : ['runs:write']);
  requireInferenceCaller(p, input.workspace_id);
  if (input.workspace_id) await requireDecisionWorkspace(tx, p, input.workspace_id);
  await (await import('./storage-maintenance')).requireStorageCapacity(tx, p.organizationId);
  if (!prepared) validateContext(input.definition, input.input, input.context);
  assert(
    kind === 'bounded_agent' ? !!input.definition.bounded_agent : !input.definition.bounded_agent,
    400,
    'execution_kind_mismatch',
    'Use the bounded-agent endpoint for a definition with tool steps.',
  );
  if (kind === 'bounded_agent') {
    assert(
      decisionProtocol(input.model_binding.provider, input.model_binding.model).capabilities.brokeredTools &&
        input.definition.question.kind === 'json',
      400,
      'unsupported_bounded_model',
      'The bounded executor requires a generative JSON model.',
    );
    for (const reference of input.definition.bounded_agent!.context_artifacts) {
      assert(
        digest(reference.audience) === digest(input.context.audience),
        403,
        'context_audience_mismatch',
        'All tool evidence must share this invocation’s audience.',
      );
      await authorizeContext(tx, p, input.workspace_id, reference);
    }
  }
  const model = decisionModel(
      input.model_binding,
      input.model_binding.provider === 'openrouter' &&
        !decisionOnlyModel('openrouter', input.model_binding.model)
        ? await models(tx)
        : [],
    ),
    protocol = decisionProtocol(input.model_binding.provider, input.model_binding.model);
  assert(
    !input.stream || protocol.capabilities.streaming,
    400,
    'streaming_not_supported',
    'This model protocol does not support incremental output. Omit stream for a completed response.',
  );
  if (input.definition.question.kind !== 'provider')
    validateModelParameters(input.model_parameters, model.provider, model.id);
  assert(
    protocol.kinds.includes(input.definition.question.kind),
    400,
    'unsupported_decision',
    'This provider cannot execute the definition’s decision kind.',
  );
  assert(
    input.definition.allowed_models.some(
      (entry) => entry.provider === model.provider && entry.model === model.id,
    ),
    403,
    'model_not_authorized',
    'Choose a model permitted by the definition.',
  );
  const limits = input.limits || input.definition.limits;
  assert(
    limits.timeout_seconds <= input.definition.limits.timeout_seconds &&
      limits.max_output_tokens <= input.definition.limits.max_output_tokens &&
      BigInt(limits.max_cost_micro_usd) <= BigInt(input.definition.limits.max_cost_micro_usd),
    400,
    'definition_limit_exceeded',
    'Request limits may only narrow the definition’s ceilings.',
  );
  const policy = await getExecutionPolicy(tx, p.organizationId);
  assert(
    limits.timeout_seconds <= policy.max_timeout_seconds,
    400,
    'execution_limit_exceeded',
    'The timeout exceeds the account execution policy.',
  );
  const secret = await modelCredential(tx, p.userId, input.model_binding);
  const configuration = prepared?.configuration ?? inferenceConfiguration(p, input, model);
  assert(
    !prepared || digest(prepared.configuration.rate_card) === digest(model),
    409,
    'model_terms_changed',
    'Model terms changed during preparation. Submit the same intended request again.',
  );
  // Validate the provider shape before admission. Token-window validation belongs
  // to the provider; the execution-time billing bound is not an exact token count.
  if (!prepared)
    protocol.prepare({
      model: model.id,
      stream: input.stream,
      modelParameters: input.model_parameters,
      definition: input.definition,
      input: input.input,
      context: configuration.context,
      maxOutputTokens: limits.max_output_tokens,
      rates: {
        inputMicroUsdPerMillion: model.input_micro_usd_per_million,
        outputMicroUsdPerMillion: model.output_micro_usd_per_million,
      },
    });
  configuration.admission_ms = performance.now() - admissionStarted;
  const reservation = configuration.billing_mode === 'byok' ? '0' : limits.max_cost_micro_usd;
  await reserve(tx, p.organizationId, BigInt(reservation));
  if (prepared) {
    const breaker = await tx.query(
      'SELECT 1 FROM provider_circuit_breakers WHERE key=$1 AND resolved_at IS NULL',
      [`model:${model.provider}:${model.id}`],
    );
    assert(!breaker.rowCount, 503, 'model_paused', 'This model is paused for metering review.');
    await lock(tx, 'capacity:global');
    const capacity = await executionCapacity(tx, p.organizationId, 'inference', policy);
    if (!capacity.allowed)
      assert(
        false,
        429,
        input.stream ? 'streaming_capacity_unavailable' : 'inference_capacity_unavailable',
        'Inference capacity is busy. Retry with the same idempotency key.',
        { reason: capacity.reason },
      );
    assert(
      Date.now() +
        limits.timeout_seconds * 1000 +
        immediateInferencePolicy.completionMs +
        immediateInferencePolicy.deliveryMs <=
        prepared.hostDeadline,
      503,
      'inference_host_budget_exhausted',
      'The requested execution window cannot fit this host lifetime.',
    );
  }
  const runId = id();
  // Anchor before the SQL statement so wire latency can only shorten, never
  // extend, the provider window relative to PostgreSQL's accepted deadline.
  const providerDeadlineMonotonicMs = performance.now() + limits.timeout_seconds * 1000;
  const saved = (
    await tx.query<Omit<InferenceRunRow, 'config'>>(
      `INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,reservation_micro_usd,queue_expires_at,started_at,heartbeat_at,lease_generation,deadline)
     VALUES($1,$2,$3,$7,$8,$4,$5,now()+($6::integer*interval '1 second'),
       CASE WHEN $8='running' THEN clock_timestamp() ELSE NULL END,
       CASE WHEN $8='running' THEN clock_timestamp() ELSE NULL END,
       CASE WHEN $8='running' THEN 1 ELSE 0 END,
       CASE WHEN $8='running' THEN clock_timestamp()+($9::integer*interval '1 second') ELSE NULL END) RETURNING ${inferenceRunStateColumns}`,
      [
        runId,
        p.organizationId,
        input.workspace_id,
        JSON.stringify(configuration),
        reservation,
        'queue_timeout_seconds' in input ? (input.queue_timeout_seconds ?? 60) : 60,
        kind,
        prepared ? 'running' : 'queued',
        limits.timeout_seconds,
      ],
    )
  ).rows[0];
  const row: InferenceRunRow = { ...saved, config: configuration };
  assert(
    row.status === 'running' || row.status === 'queued',
    500,
    'invalid_inference_state',
    'Admission returned an invalid execution state.',
  );
  await emit(tx, p.organizationId, runId, prepared ? 'run.accepted' : 'run.queued', {
    kind,
    status: row.status,
  });
  await tx.query(
    `INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,available_at,lease_until,state)
     VALUES($1,$2,'run',$3,$4,$4,$5)`,
    [
      id(),
      p.organizationId,
      runId,
      prepared && row.deadline
        ? new Date(row.deadline.getTime() + immediateInferencePolicy.completionMs)
        : new Date(),
      prepared ? 'running' : 'pending',
    ],
  );
  const receipt = {
    run_id: runId,
    kind,
    session_id: null,
    worktree_id: null,
    status: row.status,
    ...waitingFields(row),
    ...(prepared ? {} : { queue_expires_at: row.queue_expires_at.toISOString() }),
    urls: runUrls(runId),
  };
  return { receipt, run: row, secret, providerDeadlineMonotonicMs };
}

export async function admitInference(
  tx: Tx,
  p: Principal,
  input: ResolvedInferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
) {
  return (await admitInferenceState(tx, p, input, kind)).receipt;
}

type PreparedImmediateInference = {
  configuration: InferenceConfig;
  invocation: PreparedInvocation;
  hostDeadline: number;
};

export type ResolvedInferenceCreate = Omit<InferenceCreate, 'definition' | 'context'> & {
  /** Queued internal Tasks/bounded work only; absent from immediate API input. */
  queue_timeout_seconds?: number;
  definition: InferenceDefinition;
  context: ExplicitContext;
  context_resolution_ms?: number;
  context_reference?: import('../../contracts/api').components['schemas']['ContextReference'];
  definition_reference?: import('../../contracts/api').components['schemas']['DefinitionReference'];
};
/** Object reads occur outside the commit transaction. References are authorized
 * again at commit; admitted evidence is an immutable copy, never an alias. */
export function prepareInference(
  p: Principal,
  submitted: InferenceCreate,
  kind?: 'inference' | 'bounded_agent',
  direct?: false,
  hostDeadline?: number,
): ReturnType<PreparedHandler<'createBoundedAgentRun'>>;
export function prepareInference(
  p: Principal,
  submitted: InferenceCreate,
  kind: 'inference',
  direct: true,
  hostDeadline?: number,
): ReturnType<PreparedHandler<'createInference'>>;
export async function prepareInference(
  p: Principal,
  submitted: InferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
  direct = false,
  hostDeadline = Date.now() + immediateInferencePolicy.hostMs,
): Promise<{
  inferencePermit?: () => InvocationPermit | undefined;
  commit(
    tx: Tx,
    principal: Principal,
  ): Promise<ApiResult<'createInference'> | ApiResult<'createBoundedAgentRun'>>;
  dispose(): Promise<void>;
}> {
  requireScopes(p, ['runs:write']);
  const input = normalizeInferenceInput(submitted, p.organizationId, kind);
  requireInferenceCaller(p, input.workspace_id);
  const preparationBudget = (timeoutSeconds: number) => {
    if (!direct) return undefined;
    assert(
      timeoutSeconds <= 240,
      400,
      input.stream ? 'streaming_timeout_unsupported' : 'direct_timeout_exceeded',
      'Immediate inference supports up to 240 seconds.',
    );
    const deadlineAtMs =
      hostDeadline -
      (immediateInferencePolicy.admissionMs +
        timeoutSeconds * 1000 +
        immediateInferencePolicy.completionMs +
        immediateInferencePolicy.deliveryMs);
    assert(
      deadlineAtMs > Date.now(),
      503,
      'inference_host_budget_exhausted',
      'The requested execution window cannot fit this host lifetime.',
    );
    return { deadlineAtMs, signal: AbortSignal.timeout(Math.max(1, Math.floor(deadlineAtMs - Date.now()))) };
  };
  let preparation = preparationBudget(
    input.limits?.timeout_seconds ??
      ('limits' in input.definition ? input.definition.limits.timeout_seconds : 240),
  );
  const readPrepared = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      if (preparation?.signal.aborted || (preparation && Date.now() >= preparation.deadlineAtMs))
        assert(
          false,
          503,
          'inference_host_budget_exhausted',
          'Preparation exceeded the time available before execution.',
        );
      throw error;
    }
  };
  assert(
    input.workspace_id ||
      (kind === 'inference' && !('definition_id' in input.definition) && !('artifact_id' in input.context)),
    400,
    'workspace_required',
    'Saved references and bounded agents require a workspace. Supply inline data for a stateless inference.',
  );
  if (
    input.model_binding.provider === 'openrouter' &&
    !decisionOnlyModel('openrouter', input.model_binding.model)
  )
    await readPrepared(() => refreshExpiredOpenRouterCatalog(providerModelCatalog(), preparation));
  const definition =
    'definition_id' in input.definition
      ? (
          await readPrepared(() =>
            transaction(p.organizationId, (tx) => resolveDefinition(tx, p, input), preparation),
          )
        ).definition
      : input.definition;
  preparation = preparationBudget(input.limits?.timeout_seconds ?? definition.limits.timeout_seconds);
  const contextStarted = performance.now();
  const contextInput = input.context;
  const context =
    'artifact_id' in contextInput
      ? await readPrepared(() => storedContextReader.read(p, input.workspace_id, contextInput, preparation))
      : contextInput;
  const context_resolution_ms = performance.now() - contextStarted;
  const resolved: ResolvedInferenceCreate = {
    ...input,
    definition,
    context,
    context_resolution_ms,
    context_reference: 'artifact_id' in input.context ? input.context : undefined,
    definition_reference: 'definition_id' in input.definition ? input.definition : undefined,
  };
  let prepared: PreparedImmediateInference | undefined;
  let permit: InvocationPermit | undefined;
  if (direct) {
    validateContext(definition, input.input, context);
    const model = decisionModel(
      input.model_binding,
      input.model_binding.provider === 'openrouter' &&
        !decisionOnlyModel('openrouter', input.model_binding.model)
        ? await readPrepared(() => transaction(p.organizationId, models, preparation))
        : [],
    );
    const configuration = inferenceConfiguration(p, resolved, model);
    configuration.execution_owner = 'request';
    assert(
      configuration.limits.timeout_seconds <= 240,
      400,
      input.stream ? 'streaming_timeout_unsupported' : 'direct_timeout_exceeded',
      'Immediate inference supports up to 240 seconds. Use the separately documented agent APIs for longer multi-step work.',
    );
    assert(
      Date.now() +
        immediateInferencePolicy.admissionMs +
        configuration.limits.timeout_seconds * 1000 +
        immediateInferencePolicy.completionMs +
        immediateInferencePolicy.deliveryMs <=
        hostDeadline,
      503,
      'inference_host_budget_exhausted',
      'The requested execution window cannot fit this host lifetime.',
    );
    prepared = { configuration, invocation: prepareInvocation(configuration), hostDeadline };
  }
  return {
    inferencePermit: () => permit,
    async commit(tx: Tx, principal: Principal) {
      // This is also the API-key revocation guard: a concurrent revocation cannot
      // miss a newly admitted Run in its dependent-cancellation scan.
      if (direct) await lock(tx, `organization:${principal.organizationId}`);
      if ('definition_id' in input.definition) await resolveDefinition(tx, principal, input);
      if ('artifact_id' in input.context)
        await authorizeContext(tx, principal, input.workspace_id, input.context);
      const admitted = await admitInferenceState(tx, principal, resolved, kind, prepared);
      if (prepared) {
        const actorCheckedAtMonotonicMs = performance.now();
        assert(
          await actorAuthorized(tx, admitted.run),
          403,
          'authorization_revoked',
          'The initiating credential is no longer authorized.',
        );
        if (input.stream)
          assert(
            await actorAuthorized(tx, admitted.run, 'runs:read'),
            403,
            'authorization_revoked',
            'Stream read permission is no longer authorized.',
          );
        const call = await insertInvocation(tx, admitted.run, prepared.invocation, true);
        permit = {
          run: admitted.run,
          call,
          body: prepared.invocation.body,
          secret: admitted.secret,
          hostDeadline,
          providerDeadlineMonotonicMs: admitted.providerDeadlineMonotonicMs,
          actorCheckedAtMonotonicMs,
          traceContext: tracingEnabled() ? await runTraceContext(tx, admitted.run) : undefined,
        };
        return inferenceEnvelope(admitted.run).body;
      }
      return admitted.receipt;
    },
    async dispose() {},
  };
}

async function resolveDefinition(tx: Tx, p: Principal, input: ReturnType<typeof normalizeInferenceInput>) {
  assert(
    'definition_id' in input.definition,
    400,
    'definition_reference_required',
    'Supply a definition reference.',
  );
  const saved = await getDefinition(tx, p, input.definition.definition_id);
  assert(
    saved.workspace_id === input.workspace_id && saved.definition.revision === input.definition.revision,
    409,
    'definition_revision_mismatch',
    'Use a definition revision belonging to this workspace.',
  );
  return saved;
}

export function inferenceConfiguration(
  p: Principal,
  input: ResolvedInferenceCreate,
  model: import('./catalog').Model,
): InferenceConfig {
  const protocol = decisionProtocol(model.provider, model.id);
  const limits = input.limits || input.definition.limits;
  const context = {
    ...input.context,
    organization_id: p.organizationId,
    workspace_id: input.workspace_id ?? null,
    application_namespace: input.workspace_id ?? p.organizationId,
    admitted_at: new Date().toISOString(),
  };
  return {
    stream: input.stream ?? false,
    executor_version: '1',
    transformation_version: protocol.version,
    user_id: p.userId || p.id,
    principal_id: p.id,
    principal_kind: p.kind,
    workspace_ids: p.workspaceIds,
    model: model.id,
    model_parameters: input.model_parameters,
    billing_mode: input.model_binding.billing_mode,
    provider_connection_id: input.model_binding.provider_connection_id,
    rate_card: model,
    provider_cost_rate_card: { ...model },
    admission_ms: 0,
    context_resolution_ms: input.context_resolution_ms,
    limits,
    definition: input.definition,
    definition_digest: digest(input.definition),
    input: input.input,
    context,
    context_digest: digest(context),
    context_reference: input.context_reference,
    definition_reference: input.definition_reference,
    client_type: 'api',
    scheduling_class: 'interactive',
  };
}
