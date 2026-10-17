import { transaction, type Tx } from '../../db';
import { canonical, id, sealJSON, sha256 } from './crypto';
import { assert } from './errors';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import { boundedRequest } from './bounded-decisions';
import { inferenceInputBound } from './decision';
import { emptyUsage } from './model-protocol';
import { costForUsage } from './model-gateway';
import { emit } from './events';
import { getRun, terminal, type InferenceRunRow } from './runs';
import { initialReceipt } from './inference-receipt';
import { digest, schemaValidator } from './explicit-context';
import { settle } from './ledger';
import type { DecisionResponse, InferenceReceipt } from './decision';

/** Private evidence envelope. Provider failures retain metering independently
 * from public diagnostics and never imply that no upstream work occurred. */
export type StoredDecisionResponse = DecisionResponse & {
  failure_code?: string;
  transport_complete?: boolean;
};

// Live owners already hold the admitted immutable configuration. Fetch current
// lifecycle/accounting facts without repeatedly transferring its large context.
export const inferenceRunStateColumns = `id,organization_id,workspace_id,worktree_id,session_id,
 kind,status,result,created_at,started_at,completed_at,queue_expires_at,deadline,
 lease_generation,heartbeat_at,cancel_requested,model_error_request_id,event_sequence,
 reservation_micro_usd,cost_micro_usd,execution_binding,input_request`;

export async function currentInferenceRun(tx: Tx, admitted: InferenceRunRow) {
  const row = (
    await tx.query<Omit<InferenceRunRow, 'config'> & { deadline_passed: boolean | null }>(
      `SELECT ${inferenceRunStateColumns},deadline<=clock_timestamp() AS deadline_passed
       FROM runs WHERE id=$1 FOR UPDATE`,
      [admitted.id],
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Run not found.');
  assert(
    ['inference', 'bounded_agent'].includes(row.kind),
    409,
    'run_kind_mismatch',
    'This is not an inference.',
  );
  // Retention may erase stored config; these immutable in-memory terms are only
  // used for accounting. Current result/generation still fence publication.
  return { ...row, config: admitted.config };
}

export type PreparedInvocation = {
  id: string;
  step: number;
  body: Record<string, unknown>;
  ciphertext: string;
  digest: string;
  bound: string;
  outputBound: number;
  dependencyTokens: Record<string, string>;
  contextDigest: string;
  expiresAt: Date | null;
};

/** Pure preparation and encryption happen before admission locks. */
export function prepareInvocation(
  configuration: InferenceRunRow['config'],
  step = 0,
  steps: { artifact_id: string; context: import('./decision').ExplicitContext }[] = [],
  outputBound = configuration.limits.max_output_tokens,
): PreparedInvocation {
  const provider = configuration.rate_card.provider;
  const dependencyTokens = { ...configuration.context.dependency_tokens };
  for (const entry of steps)
    for (const [key, value] of Object.entries(entry.context.dependency_tokens)) {
      assert(
        !Object.hasOwn(dependencyTokens, key) || dependencyTokens[key] === value,
        409,
        'context_revision_conflict',
        'Read evidence has conflicting dependency tokens.',
      );
      dependencyTokens[key] = value;
    }
  const expirations = [configuration.context, ...steps.map((entry) => entry.context)].flatMap((context) =>
    context.expires_at ? [Date.parse(context.expires_at)] : [],
  );
  const expiresAt = expirations.length ? new Date(Math.min(...expirations)) : null;
  assert(
    !expiresAt || expiresAt.getTime() > Date.now(),
    409,
    'stale_input',
    'Context expired before dispatch.',
  );
  const body = decisionProtocol(provider, configuration.model).prepare(
    boundedRequest({
      model: configuration.model,
      stream: configuration.stream,
      modelParameters: configuration.model_parameters,
      definition: configuration.definition,
      input: configuration.input,
      context: configuration.context,
      maxOutputTokens: outputBound,
      rates: {
        inputMicroUsdPerMillion: configuration.rate_card.input_micro_usd_per_million,
        outputMicroUsdPerMillion: configuration.rate_card.output_micro_usd_per_million,
      },
      ...(steps.length ? { steps } : {}),
    }),
  );
  // The same immutable JSON supplies size, encrypted evidence and digest;
  // large contexts should not be serialized separately for each boundary.
  const serialized = canonical(body);
  const inputBound = inferenceInputBound(
    body,
    provider,
    configuration.model,
    configuration.definition.question.kind === 'provider',
    serialized,
  );
  const bound = costForUsage(configuration.rate_card, {
    ...emptyUsage(),
    input: inputBound,
    output: outputBound,
    cacheWrite:
      provider === 'anthropic' && configuration.definition.question.kind === 'provider' ? inputBound : 0,
  });
  return {
    id: id(),
    step,
    body,
    ciphertext: sealJSON(serialized),
    digest: sha256(serialized),
    bound: bound.toString(),
    outputBound,
    dependencyTokens,
    contextDigest: steps.length
      ? digest({ context: configuration.context, steps })
      : configuration.context_digest,
    expiresAt,
  };
}

/** Shared gateway/decision intent; only a confirmed immediate A commit dispatches it. */
export async function insertInvocation(
  tx: Tx,
  run: InferenceRunRow,
  prepared: PreparedInvocation,
  dispatchStarted = false,
) {
  const current = (
    await tx.query<{ budget_used_micro_usd: string }>('SELECT budget_used_micro_usd FROM runs WHERE id=$1', [
      run.id,
    ])
  ).rows[0];
  assert(
    BigInt(prepared.bound) + BigInt(current.budget_used_micro_usd) <=
      BigInt(run.config.limits.max_cost_micro_usd),
    402,
    'run_budget_exhausted',
    'The request exceeds the authorized budget.',
  );
  assert(
    !prepared.expiresAt || prepared.expiresAt.getTime() > Date.now(),
    409,
    'stale_input',
    'Context expired before dispatch.',
  );
  await tx.query(
    "INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight',$8)",
    [
      prepared.id,
      run.organization_id,
      run.id,
      run.lease_generation,
      run.config.model,
      run.config.rate_card.provider,
      run.config.billing_mode,
      prepared.bound,
    ],
  );
  await tx.query("UPDATE runs SET model_reserved_micro_usd=$2,status='running' WHERE id=$1", [
    run.id,
    prepared.bound,
  ]);
  const saved = (
    await tx.query<InvocationEvidence>(
      `INSERT INTO decision_invocations(id,organization_id,run_id,step,state,provider_request_digest,body_ciphertext,context_digest,output_token_bound,dependency_tokens,context_expires_at,dispatch_started_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $5='dispatch_started' THEN clock_timestamp() ELSE NULL END) RETURNING ${invocationEvidenceColumns}`,
      [
        prepared.id,
        run.organization_id,
        run.id,
        prepared.step,
        dispatchStarted ? 'dispatch_started' : 'prepared',
        prepared.digest,
        prepared.ciphertext,
        prepared.contextDigest,
        prepared.outputBound,
        JSON.stringify(prepared.dependencyTokens),
        prepared.expiresAt,
      ],
    )
  ).rows[0];
  const call = { ...saved, body_ciphertext: prepared.ciphertext };
  await emit(tx, run.organization_id, run.id, 'inference.prepared', { invocation_id: call.id });
  return call;
}

export type Invocation = {
  id: string;
  run_id: string;
  step: number;
  context_digest: string;
  context_expires_at: Date | null;
  dependency_tokens: Record<string, string>;
  dispatch_started_at: Date | null;
  responded_at: Date | null;
  provider_completed_at: Date | null;
  state: 'prepared' | 'dispatch_started' | 'responded' | 'uncertain';
  body_ciphertext: string;
  provider_request_digest: string;
  response_ciphertext: string | null;
  timings_ms: Record<string, number>;
};
export type InvocationEvidence = Omit<Invocation, 'body_ciphertext'> & { body_available: boolean };
const invocationEvidenceColumns = `id,run_id,step,context_digest,context_expires_at,dependency_tokens,
 dispatch_started_at,responded_at,provider_completed_at,state,provider_request_digest,
 response_ciphertext,timings_ms,body_ciphertext<>'' AS body_available`;

/** Response publication needs only body presence, never the encrypted request. */
export async function invocationEvidence(tx: Tx, runId: string) {
  return (
    await tx.query<InvocationEvidence>(
      `SELECT ${invocationEvidenceColumns} FROM decision_invocations
       WHERE run_id=$1 AND handled_at IS NULL ORDER BY step DESC LIMIT 1`,
      [runId],
    )
  ).rows[0];
}

export async function recordInvocationResponse(
  tx: Tx,
  invocationId: string,
  ciphertext: string,
  completedAt: Date | null,
  timings: Record<string, number>,
) {
  return (
    await tx.query<InvocationEvidence>(
      `UPDATE decision_invocations SET state='responded',response_ciphertext=$2,
       responded_at=clock_timestamp(),provider_completed_at=$3,timings_ms=$4
       WHERE id=$1 AND state='dispatch_started' AND body_ciphertext<>''
       RETURNING ${invocationEvidenceColumns}`,
      [invocationId, ciphertext, completedAt, JSON.stringify(timings)],
    )
  ).rows[0];
}
export async function invocation(tx: Tx, runId: string) {
  return (
    await tx.query<Invocation>(
      'SELECT * FROM decision_invocations WHERE run_id=$1 AND handled_at IS NULL ORDER BY step DESC LIMIT 1',
      [runId],
    )
  ).rows[0];
}
export async function finish(org: string, runId: string, receipt: InferenceReceipt, failureCode?: string) {
  return transaction(org, (tx) => finishInferenceInTransaction(tx, org, runId, receipt, failureCode));
}

/** The caller may compose model settlement with Run completion in this transaction.
 * A live owner's admitted config avoids another context download; mutable costs
 * are always refreshed after settlement, never taken from that admitted object. */
export async function finishInferenceInTransaction(
  tx: Tx,
  org: string,
  runId: string,
  receipt: InferenceReceipt,
  failureCode?: string,
  providerCompletedAt?: Date | null,
  admitted?: InferenceRunRow,
) {
  const current = admitted ? await currentInferenceRun(tx, admitted) : undefined;
  const clock =
    current ??
    (
      await tx.query<{ deadline_passed: boolean }>(
        'SELECT deadline<=clock_timestamp() AS deadline_passed FROM runs WHERE id=$1 FOR UPDATE',
        [runId],
      )
    ).rows[0];
  const run = current ?? (await getRun(tx, runId));
  assert(run.kind !== 'native_agent', 409, 'run_kind_mismatch', 'This is not an inference.');
  // Late evidence is retained by the invocation owner. It cannot change a
  // terminal status or replay the ledger settlement.
  if (terminal(run.status)) return run;
  const status = run.cancel_requested
    ? 'cancelled'
    : run.deadline &&
        (run.kind === 'inference' && run.config.execution_owner === 'request'
          ? clock.deadline_passed
          : run.deadline.getTime() <= Date.now()) &&
        !(
          run.kind === 'inference' &&
          providerCompletedAt &&
          providerCompletedAt.getTime() <= run.deadline.getTime()
        )
      ? 'timed_out'
      : ['value', 'unknown', 'refused', 'stale_input'].includes(receipt.outcome)
        ? 'succeeded'
        : 'failed';
  if (status === 'cancelled' || status === 'timed_out') {
    const { value: _value, ...evidence } = receipt;
    receipt = {
      ...evidence,
      outcome: receipt.provider_outcome === 'uncertain' ? 'uncertain' : 'failed',
      reason_code: status,
    };
  }
  const updatedRow = (
    await tx.query<Omit<InferenceRunRow, 'config'>>(
      `UPDATE runs SET status=$2,completed_at=now(),result=$3 WHERE id=$1 RETURNING ${inferenceRunStateColumns}`,
      [
        runId,
        status,
        JSON.stringify({
          inference: receipt,
          execution_outcome: status === 'succeeded' ? 'success' : status === 'failed' ? 'failure' : status,
          persistence_status: 'not_required',
          ...(failureCode ? { failure_code: failureCode } : {}),
        }),
      ],
    )
  ).rows[0];
  const updated: InferenceRunRow = { ...updatedRow, config: run.config };
  await settle(tx, org, runId, BigInt(run.reservation_micro_usd), BigInt(run.cost_micro_usd));
  await tx.query(
    "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
    [runId],
  );
  await emit(tx, org, runId, `run.${status}`, { status, outcome: receipt.outcome }, undefined, updated);
  return updated;
}
export function capability(run: InferenceRunRow) {
  return {
    purpose: 'runtime' as const,
    organization: run.organization_id,
    run: run.id,
    lease: run.lease_generation,
    expires: Date.now(),
  };
}
export function checkedReceipt(
  run: InferenceRunRow,
  call: Omit<Invocation, 'body_ciphertext'>,
  response: StoredDecisionResponse,
): InferenceReceipt {
  const validationStarted = performance.now();
  const receipt = initialReceipt(run.config, call.id);
  const question = run.config.definition.question;
  const valid =
    !response.failure_code &&
    !response.incomplete &&
    response.value !== undefined &&
    schemaValidator(run.config.definition.output_schema)(response.value) &&
    (question.kind !== 'choice' ||
      (typeof response.value === 'string' && Object.hasOwn(question.criteria, response.value))) &&
    (question.kind !== 'score' ||
      (typeof response.value === 'number' &&
        Number.isFinite(response.value) &&
        response.value >= 0 &&
        response.value <= question.criteria.length - 1));
  const stale = call.context_expires_at && call.context_expires_at.getTime() <= Date.now();
  const unknown =
    valid && run.config.definition.unknown_values?.some((value) => digest(value) === digest(response.value));
  return {
    ...receipt,
    timings_ms: {
      admission: run.config.admission_ms,
      ...(run.config.context_resolution_ms === undefined
        ? {}
        : { context_resolution: run.config.context_resolution_ms }),
      queue_wait:
        run.config.execution_owner === 'request'
          ? 0
          : run.started_at
            ? run.started_at.getTime() - run.created_at.getTime()
            : 0,
      ...call.timings_ms,
      validation: performance.now() - validationStarted,
    },
    context_digest: call.context_digest,
    dependency_tokens: call.dependency_tokens,
    provider_request_digest: call.provider_request_digest,
    provider_outcome: response.transport_complete || !response.incomplete ? 'responded' : 'uncertain',
    provider_request_id: response.requestId,
    model_revision: response.modelRevision,
    model_revision_status: response.modelRevision ? 'reported' : 'unavailable',
    usage_request_id: call.id,
    outcome:
      response.failure_code || response.incomplete
        ? 'failed'
        : stale
          ? 'stale_input'
          : response.refused
            ? 'refused'
            : unknown
              ? 'unknown'
              : valid
                ? 'value'
                : 'invalid_output',
    reason_code:
      response.failure_code ??
      response.incomplete ??
      (stale
        ? 'context_expired'
        : response.refused
          ? 'provider_refused'
          : unknown
            ? 'declared_unknown'
            : !valid
              ? 'output_schema_mismatch'
              : undefined),
    provider_evidence: response.evidence,
    ...(valid && !stale && !response.refused && !unknown ? { value: response.value } : {}),
    validation: {
      ...receipt.validation,
      status: response.refused || response.failure_code ? 'not_run' : valid ? 'passed' : 'failed',
    },
  };
}
