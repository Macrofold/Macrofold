import { transaction, transactionIdentity, queryGroup, type Tx } from '../../db';
import type { QueryResult } from 'pg';
import { id, sealJSON, sha256 } from './crypto';
import { createJsonPreparation, type JsonPreparation } from './prepared-json';
import { assert } from './errors';
import { inferenceProtocol } from './inference-protocol';
import { boundedRequest } from './bounded-decisions';
import { inferenceInputBound } from './decision';
import { emptyUsage } from './model-protocol';
import {
  costForUsage,
  modelSettlementQuery,
  modelSettlementFromResult,
  consumeSettlementRunControl,
  type SettlementRunControl,
} from './model-gateway';
import { prepareEventAppend, eventAppendQueries, finishEventAppend, type EventInput } from './events';
import {
  getRun,
  currentRunControl,
  runControlColumns,
  currentRunControlQuery,
  mergeCurrentRunControl,
  type RunControl,
  terminal,
  type InferenceRunRow,
  type ExecutableInferenceRunRow,
  type InferenceConfig,
} from './runs';
import { initialReceipt } from './inference-receipt';
import { digest, schemaValidator } from './explicit-context';
import { prepareSettlement, settlementQueries, finishSettlement } from './ledger';
import type { DecisionResponse, InferenceReceipt } from './decision';
import { inferencePublicationReceipt } from './inference-publication';

/** Private evidence envelope. Provider failures retain metering independently
 * from public diagnostics and never imply that no upstream work occurred. */
export type StoredDecisionResponse = DecisionResponse & {
  failure_code?: string;
  transport_complete?: boolean;
  /** Validation is performed before publication; recovery needs no original prompt/schema. */
  validated_receipt?: Omit<InferenceReceipt, 'value'>;
};

// Live owners already hold the admitted immutable configuration. Fetch current
// lifecycle/accounting facts without repeatedly transferring its large context.
export const inferenceRunStateColumns = runControlColumns;
export async function currentInferenceRun<R extends InferenceRunRow>(tx: Tx, admitted: R) {
  return currentRunControl(tx, admitted);
}

export type PreparedInvocation = {
  id: string;
  step: number;
  body: Record<string, unknown>;
  bytes: number;
  serialized: string;
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
  configuration: InferenceConfig,
  step = 0,
  steps: { artifact_id: string; context: import('./decision').ExplicitContext }[] = [],
  outputBound = configuration.limits.max_output_tokens,
  preparation?: JsonPreparation,
): PreparedInvocation {
  const json = preparation ?? createJsonPreparation();
  try {
    return prepareInvocationBody(configuration, step, steps, outputBound, json);
  } finally {
    if (!preparation) json.dispose();
  }
}

function prepareInvocationBody(
  configuration: InferenceConfig,
  step: number,
  steps: { artifact_id: string; context: import('./decision').ExplicitContext }[],
  outputBound: number,
  preparation: JsonPreparation,
): PreparedInvocation {
  const encode = preparation.stringify;
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
  // Native requests rewrite the input root and ignore explicit context, so
  // pre-encoding those roots adds work rather than reusable subtrees.
  if (configuration.definition.question.kind !== 'provider') {
    if (configuration.input !== null && typeof configuration.input === 'object')
      preparation.remember(configuration.input);
    preparation.remember(configuration.context.items);
    preparation.remember(configuration.context);
    for (const entry of steps) {
      preparation.remember(entry.context.items);
      preparation.remember(entry.context);
    }
  }
  const body = inferenceProtocol(configuration).prepare(
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
    encode,
  );
  // The same immutable JSON supplies size, encrypted evidence and digest;
  // large contexts should not be serialized separately for each boundary.
  const encoded = preparation.remember(body);
  const { json: serialized, bytes } = encoded;
  // Deployment native capabilities validate text/media at preparation. Its zero
  // request fee needs no second token-price/media walk through opaque schemas.
  const inputBound = configuration.deployment_target
    ? 0
    : inferenceInputBound(
        body,
        provider,
        configuration.model,
        configuration.definition.question.kind === 'provider',
        encoded,
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
    bytes,
    serialized,
    ciphertext: configuration.execution_owner === 'request' ? '' : sealJSON(serialized),
    digest: sha256(serialized),
    bound: bound.toString(),
    outputBound,
    dependencyTokens,
    contextDigest: steps.length
      ? digest({ context: configuration.context, steps }, encode)
      : configuration.context_digest,
    expiresAt,
  };
}

/** Shared gateway/decision intent. The caller supplies a newly inserted Run or
 * currentRunControl under this transaction's Run lock, including current budget.
 * Only a confirmed immediate A commit dispatches that request-owned intent. */
export async function prepareInvocationInsert(
  tx: Tx,
  run: Pick<
    ExecutableInferenceRunRow,
    'id' | 'organization_id' | 'lease_generation' | 'budget_used_micro_usd' | 'config'
  >,
  prepared: PreparedInvocation,
  options: { dispatchStarted?: boolean; admission?: EventInput; currentRun?: ExecutableInferenceRunRow } = {},
) {
  const dispatchStarted = options.dispatchStarted ?? false;
  assert(
    BigInt(prepared.bound) + BigInt(run.budget_used_micro_usd) <=
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
  const identity = transactionIdentity(tx);
  const ciphertext = prepared.ciphertext;
  const events = await prepareEventAppend(
    tx,
    run.organization_id,
    run.id,
    [
      ...(options.admission ? [options.admission] : []),
      { type: 'inference.prepared', data: { invocation_id: prepared.id } },
    ],
    { currentRun: options.currentRun },
  );
  const statements = [
    {
      text: "INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight',$8)",
      values: [
        prepared.id,
        run.organization_id,
        run.id,
        run.lease_generation,
        run.config.model,
        run.config.rate_card.provider,
        run.config.billing_mode,
        prepared.bound,
      ],
    },
    {
      text: "UPDATE runs SET model_reserved_micro_usd=$2,status='running' WHERE id=$1",
      values: [run.id, prepared.bound],
    },
    {
      text: `INSERT INTO decision_invocations(id,organization_id,run_id,step,state,provider_request_digest,body_ciphertext,context_digest,output_token_bound,dependency_tokens,context_expires_at,dispatch_started_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $5='dispatch_started' THEN clock_timestamp() ELSE NULL END) RETURNING ${invocationEvidenceColumns}`,
      values: [
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
    },
    ...eventAppendQueries(tx, events),
  ];
  let submitted = false;
  let finished = false;
  return {
    queries() {
      assert(
        !submitted && identity === transactionIdentity(tx),
        500,
        'inference_intent_stale',
        'Prepare invocation insertion in its current transaction.',
      );
      submitted = true;
      return statements;
    },
    async finish(writes: readonly QueryResult<Record<string, unknown>>[]) {
      assert(
        submitted && !finished && identity === transactionIdentity(tx),
        500,
        'inference_intent_stale',
        'Apply invocation insertion once in its current transaction.',
      );
      finished = true;
      const saved = writes[2]?.rows[0];
      assert(
        writes[0]?.rowCount === 1 &&
          writes[1]?.rowCount === 1 &&
          saved?.id === prepared.id &&
          saved.run_id === run.id &&
          saved.state === (dispatchStarted ? 'dispatch_started' : 'prepared'),
        409,
        'inference_owner_changed',
        'The invocation could not be admitted.',
      );
      assert(
        !prepared.expiresAt || prepared.expiresAt.getTime() > Date.now(),
        409,
        'stale_input',
        'Context expired before dispatch.',
      );
      await finishEventAppend(tx, events, writes.slice(3));
      // The rows come from the owned RETURNING projection above; no request body
      // is reloaded, and any failed insertion/event rolls the entire group back.
      return { ...(saved as InvocationEvidence), body_ciphertext: ciphertext };
    },
  };
}

/** Ordinary queued callers share the same insertion/event owner. Immediate A
 * composes it after its new Run insert, avoiding a wait for already-known IDs. */
export async function insertInvocation(
  tx: Tx,
  run: ExecutableInferenceRunRow,
  prepared: PreparedInvocation,
  options: { dispatchStarted?: boolean; admission?: EventInput } = {},
) {
  const plan = await prepareInvocationInsert(tx, run, prepared, { ...options, currentRun: run });
  return plan.finish(await queryGroup(tx, plan.queries()));
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
const invocationControlColumns = `id,run_id,step,context_digest,context_expires_at,dependency_tokens,
 dispatch_started_at,responded_at,provider_completed_at,state,provider_request_digest,
 timings_ms,(body_ciphertext<>'') AS body_available`;
const invocationEvidenceColumns = `${invocationControlColumns},response_ciphertext`;

function invocationEvidenceQuery(runId: string) {
  return {
    text: `SELECT ${invocationEvidenceColumns} FROM decision_invocations
       WHERE run_id=$1 AND handled_at IS NULL ORDER BY step DESC LIMIT 1`,
    values: [runId],
  };
}
/** Response publication needs only body presence, never the encrypted request. */
export async function invocationEvidence(tx: Tx, runId: string) {
  return (await tx.query<InvocationEvidence>(invocationEvidenceQuery(runId))).rows[0];
}
/** Ordered Run lock and current invocation read share one wire wait. Both
 * statements use known identity; decisions still consume their actual rows. */
export async function currentInferenceState<R extends InferenceRunRow>(
  tx: Tx,
  admitted: R,
  requestId?: string,
) {
  const results = await queryGroup<RunControl | InvocationEvidence>(tx, [
    currentRunControlQuery(admitted.id),
    invocationEvidenceQuery(admitted.id),
    ...(requestId ? [modelSettlementQuery(admitted.id, requestId)] : []),
  ]);
  const control = results[0].rows[0],
    call = results[1].rows[0];
  assert(control && 'organization_id' in control, 404, 'not_found', 'Run not found.');
  assert(
    !call || 'provider_request_digest' in call,
    500,
    'inference_intent_missing',
    'The invocation identity is unavailable.',
  );
  return {
    run: mergeCurrentRunControl(admitted, control),
    call,
    settlement: requestId
      ? modelSettlementFromResult(
          tx,
          { organization: admitted.organization_id, run: admitted.id },
          requestId,
          results[2],
        )
      : undefined,
  };
}

export type InvocationResponseRow = Omit<InvocationEvidence, 'response_ciphertext'>;
export function invocationResponseQuery(
  invocationId: string,
  ciphertext: string,
  completedAt: Date | null,
  timings: Record<string, number>,
) {
  return {
    text: `UPDATE decision_invocations SET state='responded',response_ciphertext=$2,
       responded_at=clock_timestamp(),provider_completed_at=$3,timings_ms=$4
       WHERE id=$1 AND state='dispatch_started'
       RETURNING ${invocationControlColumns}`,
    values: [invocationId, ciphertext, completedAt, JSON.stringify(timings)],
  };
}
export function invocationResponseFromResult(result: QueryResult<InvocationResponseRow>, ciphertext: string) {
  const saved = result.rows[0];
  assert(saved, 409, 'inference_owner_changed', 'The invocation is no longer dispatching.');
  // The live owner already has these bytes; avoid returning the large ciphertext from SQL.
  return { ...saved, response_ciphertext: ciphertext };
}
export async function recordInvocationResponse(
  tx: Tx,
  invocationId: string,
  ciphertext: string,
  completedAt: Date | null,
  timings: Record<string, number>,
) {
  return invocationResponseFromResult(
    await tx.query<InvocationResponseRow>(
      invocationResponseQuery(invocationId, ciphertext, completedAt, timings),
    ),
    ciphertext,
  );
}

export async function invocation(tx: Tx, runId: string) {
  return (
    await tx.query<Invocation>(
      'SELECT * FROM decision_invocations WHERE run_id=$1 AND handled_at IS NULL ORDER BY step DESC LIMIT 1',
      [runId],
    )
  ).rows[0];
}
export async function finish(
  admitted: ExecutableInferenceRunRow,
  receipt: InferenceReceipt,
  failureCode?: string,
  contextExpiresAt?: Date | null,
) {
  return transaction(admitted.organization_id, async (tx) => {
    const current = await currentInferenceRun(tx, admitted);
    if (terminal(current.status)) return current;
    const publishable = await inferencePublicationReceipt(
      tx,
      current,
      admitted.lease_generation,
      receipt,
      contextExpiresAt,
    );
    return finishInferenceInTransaction(
      tx,
      admitted.organization_id,
      admitted.id,
      publishable,
      failureCode,
      undefined,
      current,
    );
  });
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
  settledControl?: SettlementRunControl,
) {
  const current = admitted
    ? settledControl
      ? mergeCurrentRunControl(admitted, consumeSettlementRunControl(tx, org, runId, settledControl))
      : await currentInferenceRun(tx, admitted)
    : undefined;
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
  const { value: _value, ...receiptMetadata } = receipt;
  const settlement = prepareSettlement(
    tx,
    org,
    `run:${runId}`,
    BigInt(run.reservation_micro_usd),
    BigInt(run.cost_micro_usd),
  );
  const result: InferenceRunRow['result'] = {
    ...(run.result.content_expired ? run.result : { inference: receiptMetadata }),
    ...(!run.result.content_expired && receipt.outcome === 'value'
      ? {
          inference_output_id: receipt.invocation_id,
          ...(run.kind === 'bounded_agent' ? { inference_output_path: 'bounded_finish' as const } : {}),
        }
      : {}),
    execution_outcome: status === 'succeeded' ? 'success' : status === 'failed' ? 'failure' : status,
    persistence_status: 'not_required',
    ...(failureCode ? { failure_code: failureCode } : {}),
  };
  // Append with the decided transition, but run publication effects only after
  // its row checks and settlement succeed. Both timestamp defaults use this
  // transaction's now(), preserving the completion trace without another read.
  const event = await prepareEventAppend(
    tx,
    org,
    runId,
    [{ type: `run.${status}`, data: { status, outcome: receipt.outcome } }],
    { currentRun: { ...run, status, result } },
  );
  const financialQueries = settlementQueries(tx, settlement);
  const writes = await queryGroup<Omit<InferenceRunRow, 'config'>>(tx, [
    {
      text: `UPDATE runs SET status=$2,completed_at=now(),result=$3 WHERE id=$1 RETURNING ${inferenceRunStateColumns}`,
      values: [runId, status, JSON.stringify(result)],
    },
    {
      text: "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
      values: [runId],
    },
    ...financialQueries,
    ...eventAppendQueries(tx, event),
  ]);
  const updatedRow = writes[0].rows[0];
  assert(
    updatedRow && writes[0].rowCount === 1,
    409,
    'inference_owner_changed',
    'Run completion lost its owner.',
  );
  const { kind: _kind, ...currentFields } = updatedRow;
  const updated = {
    ...run,
    ...currentFields,
    result: run.result.content_expired ? updatedRow.result : { ...updatedRow.result, inference: receipt },
  };
  await finishSettlement(tx, settlement, writes.slice(2, 2 + financialQueries.length));
  await finishEventAppend(tx, event, writes.slice(2 + financialQueries.length));
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
  run: ExecutableInferenceRunRow,
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
