import type { Tx } from '../../db';
import { transaction, lock, lockQuery, queryGroup } from '../../db';
import { requireInferenceCaller, requireDecisionWorkspace } from './decision-authority';
import { getDefinition } from './decision-definitions';
import { storedContextReader, authorizeContext } from './context-artifacts';
import { requireScopes, type Principal } from './auth';
import { assert } from './errors';
import { id } from './crypto';
import { config } from './config';
import { validateContext, digest } from './explicit-context';
import { createJsonPreparation, type JsonPreparation } from './prepared-json';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import { decisionModel, decisionOnlyModel } from './decision-models';
import {
  prepareOpenRouterModel,
  selectedModel,
  currentSelectedModelQuery,
  currentSelectedModelFromResult,
  type ModelSelection,
} from './model-catalog';
import type { Model } from './model-policy';
import { providerModelCatalog } from '../../providers/src/model-catalog';
import { validateModelParameters } from './model-parameters';
import { modelCredential } from './model-credentials';
import {
  reserve,
  creditStateQueries,
  creditStateFromResults,
  prepareReservation,
  reservationQuery,
  checkReservationResult,
} from './ledger';
import { executionCapacityQuery, capacityDecision } from './execution-admission';
import {
  prepareInvocation,
  insertInvocation,
  inferenceRunStateColumns,
  type PreparedInvocation,
} from './inference-invocations';
import { immediateInferencePolicy, inferenceEnvelope, type InvocationPermit } from './direct-inference';
import { runTraceContext } from './run-tracing';
import { tracingEnabled } from './tracing';
import { actorAuthorizationQueries, actorAuthorizationFromResults } from './actor-authorization';
import { executionPolicy } from './plans';
import { emit } from './events';
import {
  waitingFields,
  runUrls,
  type InferenceConfig,
  type ImmediateInferenceConfig,
  type ExecutableInferenceRunRow,
} from './runs';
import type { PreparedHandler, ApiResult } from './api-types';
import { taskQueuedConfiguration, type TaskRunSource } from './task-run-payload';
import { normalizeInferenceInput } from './inference-input';
import type { InferenceCreate, InferenceDefinition, ExplicitContext } from './decision';

async function admitInferenceState(
  tx: Tx,
  p: Principal,
  input: ResolvedInferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
  prepared?: PreparedImmediateInference,
  source?: TaskRunSource,
  organizationLocked = false,
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
  let selected: Model | undefined;
  if (
    input.model_binding.provider === 'openrouter' &&
    !decisionOnlyModel('openrouter', input.model_binding.model)
  )
    selected = prepared?.modelSelection
      ? prepared.modelSelection.model
      : (await selectedModel(tx, input.model_binding.model, 'openrouter'))?.model;
  const model = decisionModel(input.model_binding, selected ? [selected] : []),
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
  const reservation = input.model_binding.billing_mode === 'byok' ? '0' : limits.max_cost_micro_usd;
  // Stateless immediate admission can share organization and wallet acquisition.
  // Reference paths retain their earlier organization guard before reference authorization.
  const financial = prepared
    ? await queryGroup(tx, [
        ...(organizationLocked ? [] : [lockQuery(`organization:${p.organizationId}`)]),
        ...creditStateQueries(p.organizationId),
      ])
    : undefined;
  const reservationPlan = financial
    ? prepareReservation(
        creditStateFromResults(tx, p.organizationId, financial.slice(organizationLocked ? 0 : 1)),
        BigInt(reservation),
      )
    : undefined;
  const account = reservationPlan?.account ?? (await reserve(tx, p.organizationId, BigInt(reservation)));
  (await import('./storage-maintenance')).assertStorageCapacity(account.settings);
  const policy = executionPolicy(account);
  assert(
    limits.timeout_seconds <= policy.max_timeout_seconds,
    400,
    'execution_limit_exceeded',
    'The timeout exceeds the account execution policy.',
  );
  const secret = await modelCredential(tx, p.userId, input.model_binding);
  const configuration = prepared?.configuration ?? { ...inferenceConfiguration(p, input, model), ...source };
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
  const actorCheckedAtMonotonicMs = performance.now();
  if (prepared) {
    const actor = {
      organization_id: p.organizationId,
      workspace_id: input.workspace_id ?? null,
      config: configuration,
    };
    const actorQueries = actorAuthorizationQueries(
      actor,
      input.stream ? ['runs:write', 'runs:read'] : ['runs:write'],
    );
    const guards = await queryGroup(tx, [
      lockQuery('capacity:global'),
      executionCapacityQuery(p.organizationId, 'inference', policy),
      {
        text: 'SELECT 1 FROM provider_circuit_breakers WHERE key=$1 AND resolved_at IS NULL',
        values: [`model:${model.provider}:${model.id}`],
      },
      ...actorQueries,
      ...(prepared.modelSelection ? [currentSelectedModelQuery(prepared.modelSelection)] : []),
    ]);
    const capacity = capacityDecision(guards[1]);
    if (!capacity.allowed)
      assert(
        false,
        429,
        input.stream ? 'streaming_capacity_unavailable' : 'inference_capacity_unavailable',
        'Inference capacity is busy. Retry with the same idempotency key.',
        { reason: capacity.reason },
      );
    assert(!guards[2].rowCount, 503, 'model_paused', 'This model is paused for metering review.');
    assert(
      actorAuthorizationFromResults(actor, guards.slice(3, 3 + actorQueries.length)),
      403,
      'authorization_revoked',
      'The initiating credential is no longer authorized.',
    );
    if (prepared.modelSelection)
      decisionModel(input.model_binding, [
        currentSelectedModelFromResult(prepared.modelSelection, guards[3 + actorQueries.length]),
      ]);
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
  const insertion = {
    text: `WITH admitted AS (INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,reservation_micro_usd,queue_expires_at,started_at,heartbeat_at,lease_generation,deadline)
     VALUES($1,$2,$3,$7,$8,$4,$5,now()+($6::integer*interval '1 second'),
       CASE WHEN $8='running' THEN clock_timestamp() ELSE NULL END,
       CASE WHEN $8='running' THEN clock_timestamp() ELSE NULL END,
       CASE WHEN $8='running' THEN 1 ELSE 0 END,
       CASE WHEN $8='running' THEN clock_timestamp()+($9::integer*interval '1 second') ELSE NULL END) RETURNING ${inferenceRunStateColumns}
     ), scheduled AS (
       INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,available_at,lease_until,state)
       SELECT $10,organization_id,'run',id,
         CASE WHEN $8='running' THEN deadline+($11::integer*interval '1 millisecond') ELSE now() END,
         CASE WHEN $8='running' THEN deadline+($11::integer*interval '1 millisecond') ELSE now() END,
         CASE WHEN $8='running' THEN 'running' ELSE 'pending' END FROM admitted RETURNING resource_id
     ) SELECT admitted.* FROM admitted JOIN scheduled ON scheduled.resource_id=admitted.id`,
    values: [
      runId,
      p.organizationId,
      input.workspace_id,
      JSON.stringify(
        prepared
          ? compactConfiguration(configuration)
          : source
            ? taskQueuedConfiguration(configuration, source)
            : configuration,
      ),
      reservation,
      'queue_timeout_seconds' in input ? (input.queue_timeout_seconds ?? 60) : 60,
      kind,
      prepared ? 'running' : 'queued',
      limits.timeout_seconds,
      id(),
      immediateInferencePolicy.completionMs,
    ],
  };
  const financialWrite = reservationPlan ? reservationQuery(tx, reservationPlan) : undefined;
  const writes = await queryGroup<Omit<ExecutableInferenceRunRow, 'config'>>(tx, [
    ...(financialWrite ? [financialWrite] : []),
    insertion,
  ]);
  if (reservationPlan) checkReservationResult(reservationPlan, financialWrite ? writes[0] : undefined);
  const saved = writes[writes.length - 1].rows[0];
  assert(saved, 500, 'invalid_inference_state', 'Admission did not publish its Run identity.');
  const row: ExecutableInferenceRunRow = { ...saved, config: configuration };
  assert(
    row.status === 'running' || row.status === 'queued',
    500,
    'invalid_inference_state',
    'Admission returned an invalid execution state.',
  );
  // Immediate accepted/prepared events publish together after invocation
  // identity insertion, in the same admission commit and original order.
  if (!prepared)
    await emit(tx, p.organizationId, runId, 'run.queued', { kind, status: row.status }, undefined, row);
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
  return { receipt, run: row, secret, providerDeadlineMonotonicMs, actorCheckedAtMonotonicMs };
}

export async function admitInference(
  tx: Tx,
  p: Principal,
  input: ResolvedInferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
  source?: TaskRunSource,
) {
  return (await admitInferenceState(tx, p, input, kind, undefined, source)).receipt;
}

type PreparedImmediateInference = {
  configuration: InferenceConfig;
  invocation: PreparedInvocation;
  hostDeadline: number;
  modelSelection?: ModelSelection;
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
  const modelSelection =
    input.model_binding.provider === 'openrouter' &&
    !decisionOnlyModel('openrouter', input.model_binding.model)
      ? await readPrepared(() =>
          prepareOpenRouterModel(input.model_binding.model, providerModelCatalog(), preparation),
        )
      : undefined;
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
    // The encoding memo lives only in this synchronous segment, after reference
    // reads and before admission; waiting requests retain no extra fragments.
    const json = createJsonPreparation();
    try {
      validateContext(definition, input.input, context, json);
      const model = decisionModel(input.model_binding, modelSelection ? [modelSelection.model] : []);
      const configuration = inferenceConfiguration(p, resolved, model, json);
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
      prepared = {
        configuration,
        invocation: prepareInvocation(configuration, 0, [], configuration.limits.max_output_tokens, json),
        hostDeadline,
        modelSelection,
      };
    } finally {
      json.dispose();
    }
  }
  return {
    inferencePermit: () => permit,
    async commit(tx: Tx, principal: Principal) {
      // This is also the API-key revocation guard: a concurrent revocation cannot
      // miss a newly admitted Run in its dependent-cancellation scan.
      const organizationLocked =
        direct &&
        (!!input.workspace_id || 'definition_id' in input.definition || 'artifact_id' in input.context);
      if (organizationLocked) await lock(tx, `organization:${principal.organizationId}`);
      if ('definition_id' in input.definition) await resolveDefinition(tx, principal, input);
      if ('artifact_id' in input.context)
        await authorizeContext(tx, principal, input.workspace_id, input.context);
      const admitted = await admitInferenceState(
        tx,
        principal,
        resolved,
        kind,
        prepared,
        undefined,
        organizationLocked,
      );
      if (prepared) {
        const call = await insertInvocation(tx, admitted.run, prepared.invocation, {
          dispatchStarted: true,
          admission: { type: 'run.accepted', data: { kind, status: admitted.run.status } },
        });
        permit = {
          run: admitted.run,
          call,
          body: prepared.invocation.body,
          bodyBytes: prepared.invocation.bytes,
          bodyJSON: prepared.invocation.serialized,
          secret: admitted.secret,
          hostDeadline,
          providerDeadlineMonotonicMs: admitted.providerDeadlineMonotonicMs,
          actorCheckedAtMonotonicMs: admitted.actorCheckedAtMonotonicMs,
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
  preparation?: JsonPreparation,
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
  preparation?.remember(context);
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
    definition_digest: digest(input.definition, preparation?.stringify),
    input: input.input,
    context,
    context_digest: digest(context, preparation?.stringify),
    context_reference: input.context_reference,
    definition_reference: input.definition_reference,
    client_type: 'api',
    scheduling_class: 'interactive',
  };
}

/** Only fields used by authority/accounting/replay survive immediate admission. */
export function compactConfiguration(configuration: InferenceConfig): ImmediateInferenceConfig {
  const { definition, input: _input, context, model_parameters: _parameters, ...control } = configuration;
  return {
    ...control,
    payload_kind: 'compact',
    definition_revision: definition.revision,
    schema_digest: digest(definition.output_schema),
    dependency_tokens: context.dependency_tokens,
    context_audience: context.audience,
    application_namespace: context.application_namespace,
  };
}
