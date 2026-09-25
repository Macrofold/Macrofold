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
import { decisionModel } from './decision-models';
import { models } from './catalog';
import { validateModelParameters } from './model-parameters';
import { modelCredential } from './model-credentials';
import { reserve } from './ledger';
import { claimRunInTransaction } from './engine';
import { getExecutionPolicy } from './plans';
import { emit } from './events';
import { getRun, waitingFields, type InferenceConfig } from './runs';
import { normalizeInferenceInput } from './inference-input';
import type { InferenceCreate, InferenceDefinition, ExplicitContext } from './decision';

export async function admitInference(
  tx: Tx,
  p: Principal,
  input: ResolvedInferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
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
  validateContext(input.definition, input.input, input.context);
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
      input.model_binding.provider === 'openrouter' && input.model_binding.model !== 'typesafe/jev-1.13'
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
  await modelCredential(tx, p.userId, input.model_binding);
  const context = {
    ...input.context,
    organization_id: p.organizationId,
    workspace_id: input.workspace_id ?? null,
    application_namespace: input.workspace_id ?? p.organizationId,
    admitted_at: new Date().toISOString(),
  };
  const configuration: InferenceConfig = {
    stream: input.stream ?? false,
    executor_version: '1',
    transformation_version: protocol.version,
    user_id: p.userId,
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
  // Validate the provider shape before admission. Token-window validation belongs
  // to the provider; the execution-time billing bound is not an exact token count.
  protocol.prepare({
    model: model.id,
    stream: input.stream,
    modelParameters: input.model_parameters,
    definition: input.definition,
    input: input.input,
    context,
    maxOutputTokens: limits.max_output_tokens,
    rates: {
      inputMicroUsdPerMillion: model.input_micro_usd_per_million,
      outputMicroUsdPerMillion: model.output_micro_usd_per_million,
    },
  });
  configuration.admission_ms = performance.now() - admissionStarted;
  const reservation = configuration.billing_mode === 'byok' ? '0' : limits.max_cost_micro_usd;
  await reserve(tx, p.organizationId, BigInt(reservation));
  const runId = id();
  await tx.query(
    "INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,reservation_micro_usd,queue_expires_at) VALUES($1,$2,$3,$7,'queued',$4,$5,now()+($6::integer*interval '1 second'))",
    [
      runId,
      p.organizationId,
      input.workspace_id,
      JSON.stringify(configuration),
      reservation,
      input.queue_timeout_seconds ?? 60,
      kind,
    ],
  );
  await emit(tx, p.organizationId, runId, 'run.queued', { kind, status: 'queued' });
  await tx.query("INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'run',$3)", [
    id(),
    p.organizationId,
    runId,
  ]);
  const row = await getRun(tx, runId);
  return {
    run_id: runId,
    kind,
    session_id: null,
    worktree_id: null,
    status: 'queued' as const,
    ...waitingFields(row),
    queue_expires_at: row.queue_expires_at.toISOString(),
    urls: {
      status: `${config.origin}/v1/runs/${runId}`,
      result: `${config.origin}/v1/runs/${runId}/result`,
      events: `${config.origin}/v1/runs/${runId}/events`,
      stream: `${config.origin}/v1/runs/${runId}/stream`,
      cancel: `${config.origin}/v1/runs/${runId}/cancel`,
    },
  };
}

export type ResolvedInferenceCreate = Omit<InferenceCreate, 'definition' | 'context'> & {
  definition: InferenceDefinition;
  context: ExplicitContext;
  context_resolution_ms?: number;
  context_reference?: import('../../contracts/api').components['schemas']['ContextReference'];
  definition_reference?: import('../../contracts/api').components['schemas']['DefinitionReference'];
};
/** Object reads occur outside the commit transaction. References are authorized
 * again at commit; admitted evidence is an immutable copy, never an alias. */
export async function prepareInference(
  p: Principal,
  submitted: InferenceCreate,
  kind: 'inference' | 'bounded_agent' = 'inference',
  direct = false,
) {
  requireScopes(p, ['runs:write']);
  const input = normalizeInferenceInput(submitted, p.organizationId, kind);
  requireInferenceCaller(p, input.workspace_id);
  assert(
    input.workspace_id ||
      (kind === 'inference' && !('definition_id' in input.definition) && !('artifact_id' in input.context)),
    400,
    'workspace_required',
    'Saved references and bounded agents require a workspace. Supply inline data for a stateless inference.',
  );
  const definition =
    'definition_id' in input.definition
      ? (await transaction(p.organizationId, (tx) => resolveDefinition(tx, p, input))).definition
      : input.definition;
  const contextStarted = performance.now();
  const context =
    'artifact_id' in input.context
      ? await storedContextReader.read(p, input.workspace_id, input.context)
      : input.context;
  const context_resolution_ms = performance.now() - contextStarted;
  return {
    async commit(tx: Tx, principal: Principal) {
      // Match the scheduler's lock order before admission reserves wallet rows.
      if (direct) await lock(tx, `organization:${principal.organizationId}`);
      if ('definition_id' in input.definition) await resolveDefinition(tx, principal, input);
      if ('artifact_id' in input.context)
        await authorizeContext(tx, principal, input.workspace_id, input.context);
      const accepted = await admitInference(
        tx,
        principal,
        {
          ...input,
          definition,
          context,
          context_resolution_ms,
          context_reference: 'artifact_id' in input.context ? input.context : undefined,
          definition_reference: 'definition_id' in input.definition ? input.definition : undefined,
        },
        kind,
      );
      if (direct) {
        assert(
          kind === 'inference',
          400,
          'unsupported_execution_mode',
          'Only single-call inference supports direct execution.',
        );
        assert(
          (input.limits ?? definition.limits).timeout_seconds <= 240,
          400,
          input.stream ? 'streaming_timeout_unsupported' : 'direct_timeout_exceeded',
          'Direct requests support up to 240 seconds. Use Prefer: respond-async for longer requests.',
        );
        const claimed = await claimRunInTransaction(tx, principal.organizationId, accepted.run_id, true);
        assert(
          claimed,
          429,
          input.stream ? 'streaming_capacity_unavailable' : 'inference_capacity_unavailable',
          'Inference capacity is busy. Retry later or use Prefer: respond-async.',
        );
      }
      return accepted;
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
