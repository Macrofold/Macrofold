import { transaction, queryGroup, TransactionCommitUnknownError, DatabaseBudgetError } from '../../db';
import type { Principal } from './auth';
import { assert, AppError } from './errors';
import {
  getRun,
  terminal,
  waitingFields,
  runUrls,
  type InferenceRunRow,
  type ExecutableInferenceRunRow,
  compactInference,
} from './runs';
import { seal, unseal } from './crypto';
import { inferenceProtocol } from './inference-protocol';
import { DecisionProviderError, type InferenceOutputSink, type InferenceReceipt } from './decision';
import { emptyUsage } from './model-protocol';
import {
  invocation,
  invocationEvidence,
  recordInvocationResponse,
  invocationResponseQuery,
  invocationResponseFromResult,
  type InvocationResponseRow,
  currentInferenceState,
  checkedReceipt,
  capability,
  finishInferenceInTransaction,
  type Invocation,
  type StoredDecisionResponse,
} from './inference-invocations';
import { settleModelRequestForCompletion, inferenceUsage, inferenceBilling } from './model-gateway';
import { observeInference } from './inference-control';
import type { TraceContext } from './trace';
import { recordTrace, tracingEnabled, tracingContentEnabled } from './tracing';
import { runTraceContext } from './run-tracing';
import { inferencePublicationReceipt } from './inference-publication';
import { actorAuthorizationQueries, actorAuthorizationFromResults } from './actor-authorization';
import type { components } from '../../contracts/api';
import { digest } from './explicit-context';
import { initialReceipt } from './inference-receipt';
import { scheduleInferenceCapture } from './inference-capture';
import { startInferenceTiming } from './inference-timing';
import { startPerformanceStage } from './performance';

/** Infrastructure budgets are separate from the caller's accepted model deadline.
 * See docs/projects/immediate-inference-tech-design.md#clock-and-ownership-rules. */
export const immediateInferencePolicy = {
  hostMs: 300_000,
  admissionMs: 1_000,
  completionMs: 30_000,
  deliveryMs: 5_000,
  persistenceAttemptMs: 10_000,
  persistenceAttempts: 3,
} as const;

export type InvocationPermit = {
  deploymentHeaders?: Record<string, string>;
  run: ExecutableInferenceRunRow;
  call: Invocation;
  body: Record<string, unknown>;
  bodyBytes: number;
  bodyJSON: string;
  secret: string;
  hostDeadline: number;
  providerDeadlineMonotonicMs: number;
  actorCheckedAtMonotonicMs: number;
  traceContext?: TraceContext;
};
type StoredResponse = StoredDecisionResponse;

function traceCompletedInference(
  context: TraceContext,
  run: InferenceRunRow,
  call: Omit<Invocation, 'body_ciphertext'>,
  response: StoredResponse,
  receipt: InferenceReceipt | undefined,
  input?: Record<string, unknown>,
  captureContent = true,
) {
  let exportedResponse = response;
  if (captureContent && receipt) {
    // The recovery capsule precedes settlement. Export the settled receipt
    // without mutating durable evidence or duplicating the response value.
    // See docs/features/observability/implementation.md#cost-ownership.
    const { value: _value, ...settledReceipt } = receipt;
    exportedResponse = { ...response, validated_receipt: settledReceipt };
  }
  const endedAt = call.provider_completed_at ?? call.responded_at ?? new Date();
  const startedAt =
    call.timings_ms.provider === undefined
      ? (call.dispatch_started_at ?? run.created_at)
      : new Date(endedAt.getTime() - call.timings_ms.provider);
  recordTrace({
    context,
    id: call.id,
    name: 'decision.generate',
    type: 'generation',
    startedAt,
    endedAt,
    firstOutputAt:
      call.timings_ms.first_output !== undefined
        ? new Date(startedAt.getTime() + call.timings_ms.first_output)
        : undefined,
    input: captureContent ? input : undefined,
    output: captureContent ? exportedResponse : undefined,
    model: run.config.model,
    usage: response.usage,
    chargedMicroUsd: receipt?.billing.charged_micro_usd ?? undefined,
    level: response.incomplete || response.failure_code ? 'ERROR' : 'DEFAULT',
    metadata: {
      content_capture: captureContent ? 'available' : 'omitted',
      invocation_id: call.id,
      step: call.step,
      provider_request_id: response.requestId,
      provider_http_status: response.httpStatus,
      model_revision: response.modelRevision,
      transformation_version: run.config.transformation_version,
      context_digest: call.context_digest,
      provider_request_digest: call.provider_request_digest,
      usage_complete: response.usage.complete,
      ...receipt?.billing,
      ...call.timings_ms,
    },
  });
}

export function respondAsync(request: Request) {
  return (request.headers.get('prefer') || '')
    .split(',')
    .some((value) => value.trim().toLowerCase() === 'respond-async');
}

export function inferenceEnvelope(
  run: InferenceRunRow,
  recoveryReason: 'in_progress' | 'finalization_pending' | 'outcome_unknown' = 'in_progress',
): { status: 200 | 202; body: components['schemas']['InferenceResponse'] } {
  const base = {
    run_id: run.id,
    kind: run.kind,
    session_id: null,
    worktree_id: null,
    ...waitingFields(run),
    urls: runUrls(run.id),
  };
  const status = run.status;
  const { inference_output_id: _outputId, inference_output_path: _outputPath, ...publicResult } = run.result;
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timed_out')
    return {
      status: 200,
      body: {
        ...base,
        status,
        result: {
          ...publicResult,
          run_id: run.id,
          final: true,
          execution_outcome: run.result.execution_outcome || 'pending',
          persistence_status: 'not_required',
        },
      },
    };
  return { status: 202, body: { ...base, status: 'running', recovery_reason: recoveryReason } };
}

/** Only bounded, idempotent local persistence is retried. Never upstream I/O. */
async function persist<T>(
  deadline: number,
  write: () => Promise<T>,
  readAfterUnknown: () => Promise<T | undefined>,
) {
  let last: unknown;
  for (
    let attempt = 0;
    attempt < immediateInferencePolicy.persistenceAttempts && Date.now() < deadline;
    attempt++
  ) {
    try {
      return await write();
    } catch (error) {
      last = error;
      if (error instanceof TransactionCommitUnknownError) {
        const saved = await readAfterUnknown();
        if (saved !== undefined) return saved;
        // Without a successful identity read, another mutation is not justified.
        throw error;
      }
      if (error instanceof AppError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (
        !(error instanceof DatabaseBudgetError && error.rollbackConfirmed) &&
        ![
          '40001',
          '40P01',
          '55P03',
          '53300',
          '57P01',
          '08000',
          '08003',
          '08006',
          'ECONNRESET',
          'ECONNREFUSED',
        ].includes(code)
      )
        throw error;
    }
  }
  throw last ?? new AppError(503, 'inference_recovery_required', 'The saved invocation requires recovery.');
}

export async function persistImmediateResponse(
  permit: InvocationPermit,
  response: StoredResponse,
  deadline: number,
) {
  const ciphertext = seal(response);
  const completedAt =
    response.completedAt &&
    (response.transport_complete === true || (response.transport_complete !== false && !response.incomplete))
      ? new Date(response.completedAt)
      : null;
  const write = () =>
    transaction(
      permit.run.organization_id,
      async (tx) => {
        const { run, call: current } = await currentInferenceState(tx, permit.run);
        assert(
          current && run.lease_generation === permit.run.lease_generation,
          409,
          'inference_owner_changed',
          'Recovery owns this invocation.',
        );
        if (run.result.content_expired) return current;
        if (current.state === 'responded') {
          assert(
            current.response_ciphertext && digest(unseal(current.response_ciphertext)) === digest(response),
            409,
            'inference_evidence_changed',
            'Conflicting provider evidence cannot replace a saved response.',
          );
          return current;
        }
        assert(
          current.state === 'dispatch_started',
          409,
          'inference_owner_changed',
          'The invocation is no longer dispatching.',
        );
        return recordInvocationResponse(tx, current.id, ciphertext, completedAt, permit.call.timings_ms);
      },
      { deadlineAtMs: Math.min(deadline, Date.now() + immediateInferencePolicy.persistenceAttemptMs) },
    );
  return persist(deadline, write, () =>
    transaction(
      permit.run.organization_id,
      async (tx) => {
        const current = await invocationEvidence(tx, permit.run.id);
        return current?.state === 'responded' ? current : undefined;
      },
      { deadlineAtMs: deadline },
    ),
  );
}

/** Recovery consumes evidence only. Its generation fence prevents a late live
 * owner from writing after handoff or process loss; it never creates a permit. */
export async function recoverImmediateInference(
  run: InferenceRunRow,
  background?: (task: () => Promise<void>) => void,
) {
  const deadline = Date.now() + immediateInferencePolicy.completionMs;
  const claimed = await transaction(
    run.organization_id,
    async (tx) => {
      await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [run.id]);
      const current = await getRun(tx, run.id);
      assert(current.kind === 'inference', 409, 'run_kind_mismatch', 'This is not a direct inference.');
      if (terminal(current.status)) return { run: current, call: undefined };
      if (current.lease_generation !== run.lease_generation) return undefined;
      const call = await invocation(tx, run.id);
      assert(call, 500, 'inference_intent_missing', 'The admitted invocation identity is unavailable.');
      const fence = (
        await tx.query<{ due: boolean }>(
          `SELECT r.deadline+($3::integer*interval '1 millisecond')<=clock_timestamp()
          OR r.lease_generation<>g.lease_generation AS due
         FROM runs r JOIN gateway_requests g ON g.run_id=r.id AND g.id=$2 WHERE r.id=$1`,
          [run.id, call.id, immediateInferencePolicy.completionMs],
        )
      ).rows[0];
      // Cancellation aborts the live transport through the observer. It does not
      // let maintenance discard metering before the bounded owner can save it.
      // Dispatchers move available_at while claiming a job. The stable fence
      // is E+C, or a generation explicitly handed off by the original owner.
      if (!fence?.due) return undefined;
      const next = (
        await tx.query<InferenceRunRow>(
          'UPDATE runs SET lease_generation=lease_generation+1 WHERE id=$1 RETURNING *',
          [run.id],
        )
      ).rows[0];
      if (call.state === 'responded' && call.response_ciphertext) return { run: next, call };
      await tx.query(
        "UPDATE decision_invocations SET state='uncertain' WHERE id=$1 AND state='dispatch_started'",
        [call.id],
      );
      const usage = emptyUsage();
      const { billing, control } = await settleModelRequestForCompletion(
        tx,
        capability(next),
        call.id,
        next.config.rate_card,
        usage,
        false,
        next.config.provider_cost_rate_card,
      );
      const receipt: InferenceReceipt = {
        ...initialReceipt(next.config, call.id),
        outcome: 'uncertain',
        provider_outcome: 'uncertain',
        reason_code: 'provider_outcome_unknown',
        provider_request_digest: call.provider_request_digest,
        usage_request_id: call.id,
        usage: inferenceUsage(usage),
        billing: inferenceBilling(billing, next.config.billing_mode),
      };
      return {
        run: await finishInferenceInTransaction(
          tx,
          run.organization_id,
          run.id,
          receipt,
          undefined,
          undefined,
          next,
          control,
        ),
        call,
      };
    },
    { deadlineAtMs: deadline },
  );
  if (!claimed) return undefined;
  if (!claimed.call) return claimed.run;
  const response: StoredResponse = claimed.call.response_ciphertext
    ? unseal<StoredResponse>(claimed.call.response_ciphertext)
    : {
        value: null,
        refused: false,
        usage: emptyUsage(),
        requestId: null,
        modelRevision: null,
        incomplete: 'provider_outcome_unknown',
      };
  const completed = terminal(claimed.run.status)
    ? { run: claimed.run, receipt: claimed.run.result.inference }
    : await finalizeImmediateInference(claimed.run, claimed.call, response, deadline);
  if (tracingEnabled()) {
    try {
      const context = await transaction(run.organization_id, (tx) => runTraceContext(tx, completed.run), {
        deadlineAtMs: deadline,
      });
      if (context) {
        const call = claimed.call;
        if (!tracingContentEnabled())
          traceCompletedInference(context, claimed.run, call, response, completed.receipt, undefined, false);
        else
          scheduleInferenceCapture(
            {
              organizationId: run.organization_id,
              runId: run.id,
              bytes:
                Buffer.byteLength(call.body_ciphertext) + Buffer.byteLength(call.response_ciphertext ?? ''),
            },
            background,
            (content) =>
              traceCompletedInference(
                context,
                claimed.run,
                call,
                response,
                completed.receipt,
                content && call.body_ciphertext
                  ? unseal<Record<string, unknown>>(call.body_ciphertext)
                  : undefined,
                content,
              ),
          );
      }
    } catch {
      console.warn(JSON.stringify({ code: 'inference_trace_attribution_failed', run_id: run.id }));
    }
  }
  return completed.run;
}

/** This same finalizer is used by the live owner and evidence-only recovery. */
export async function finalizeImmediateInference(
  run: InferenceRunRow,
  call: Omit<Invocation, 'body_ciphertext'>,
  response: StoredResponse,
  deadline: number,
) {
  const validated = response.validated_receipt;
  let receipt: InferenceReceipt;
  if (validated)
    receipt = { ...validated, ...(validated.outcome === 'value' ? { value: response.value } : {}) };
  else {
    assert(
      !compactInference(run),
      409,
      'inference_validation_missing',
      'Saved evidence lacks its validated outcome.',
    );
    receipt = checkedReceipt(run, call, response);
  }
  if (response.failure_code)
    receipt = {
      ...receipt,
      outcome: 'failed',
      reason_code: response.failure_code,
      provider_outcome: response.transport_complete ? 'responded' : 'uncertain',
      validation: { ...receipt.validation, status: 'not_run' },
    };
  const { value: _value, ...validatedReceipt } = receipt;
  response.validated_receipt = validatedReceipt;
  const preparedReceipt = receipt;
  const ciphertext = call.response_ciphertext ?? seal(response);
  const completedAt =
    response.completedAt && (response.transport_complete || !response.incomplete)
      ? new Date(response.completedAt)
      : null;
  const write = () =>
    transaction(
      run.organization_id,
      async (tx) => {
        const { run: current, call: saved, settlement } = await currentInferenceState(tx, run, call.id);
        assert(current.kind === 'inference', 409, 'run_kind_mismatch', 'This is not a direct inference.');
        assert(
          saved &&
            saved.id === call.id &&
            (!saved.response_ciphertext || saved.response_ciphertext === call.response_ciphertext),
          409,
          'inference_evidence_changed',
          'The saved response identity changed.',
        );
        const responseWrite =
          !terminal(current.status) && !current.result.content_expired && !saved.response_ciphertext
            ? invocationResponseQuery(call.id, ciphertext, completedAt, call.timings_ms)
            : undefined;
        // Incurred response evidence may commit even when publication is denied.
        // Current disclosure facts share its ordered group, then the policy owner decides.
        const actorQueries =
          !terminal(current.status) && !current.result.content_expired
            ? actorAuthorizationQueries(current)
            : [];
        const observations =
          responseWrite || actorQueries.length
            ? await queryGroup<InvocationResponseRow>(tx, [
                ...(responseWrite ? [responseWrite] : []),
                ...actorQueries,
              ])
            : [];
        if (responseWrite) invocationResponseFromResult(observations[0], ciphertext);
        let finalReceipt = preparedReceipt;
        if (!terminal(current.status)) {
          finalReceipt = await inferencePublicationReceipt(
            tx,
            current,
            run.lease_generation,
            finalReceipt,
            saved.context_expires_at,
            current.result.content_expired
              ? false
              : actorAuthorizationFromResults(current, observations.slice(responseWrite ? 1 : 0)),
          );
        }
        const { billing, control } = await settleModelRequestForCompletion(
          tx,
          capability(current),
          call.id,
          run.config.rate_card,
          response.usage,
          false,
          run.config.provider_cost_rate_card,
          settlement,
        );
        finalReceipt = {
          ...finalReceipt,
          usage: inferenceUsage(response.usage),
          billing: inferenceBilling(billing, run.config.billing_mode),
        };
        // A terminal/purged Run may receive late accounting, never restored output.
        const finished = terminal(current.status)
          ? current
          : await finishInferenceInTransaction(
              tx,
              run.organization_id,
              run.id,
              finalReceipt,
              response.failure_code,
              saved.provider_completed_at ?? completedAt,
              current,
              control,
            );
        return { run: finished, receipt: finalReceipt };
      },
      { deadlineAtMs: Math.min(deadline, Date.now() + immediateInferencePolicy.persistenceAttemptMs) },
    );
  const completed = await persist<{ run: InferenceRunRow; receipt: InferenceReceipt | undefined }>(
    deadline,
    write,
    () =>
      transaction(
        run.organization_id,
        async (tx) => {
          const current = await getRun(tx, run.id);
          assert(current.kind === 'inference', 409, 'run_kind_mismatch', 'This is not a direct inference.');
          return terminal(current.status) ? { run: current, receipt: current.result.inference } : undefined;
        },
        { deadlineAtMs: deadline },
      ),
  );
  return { ...completed, captureBytes: Buffer.byteLength(ciphertext) };
}

/** One retained producer, compact admission and atomic completion. A replay has no dispatch permit. */
export async function completeDirectInference(
  p: Principal,
  accepted: unknown,
  permit?: InvocationPermit,
  background?: (task: () => Promise<void>) => void,
  output?: InferenceOutputSink,
) {
  assert(
    accepted && typeof accepted === 'object' && 'run_id' in accepted && typeof accepted.run_id === 'string',
    500,
    'invalid_inference_receipt',
    'The inference receipt is unavailable.',
  );
  const runId = accepted.run_id;
  if (!permit) {
    return transaction(p.organizationId, async (tx) => {
      const run = await getRun(tx, runId, p);
      assert(
        run.kind === 'inference',
        409,
        'unsupported_run_kind',
        'Direct execution requires a single inference.',
      );
      assert(
        !run.result.content_expired,
        410,
        'content_expired',
        'The referenced content was deleted or expired.',
        { run_id: runId, urls: inferenceEnvelope(run).body.urls },
      );
      const call = terminal(run.status) ? undefined : await invocation(tx, runId);
      return inferenceEnvelope(
        run,
        call?.state === 'responded'
          ? 'finalization_pending'
          : call?.state === 'uncertain'
            ? 'outcome_unknown'
            : 'in_progress',
      );
    });
  }
  const { run, call } = permit;
  assert(run.deadline, 500, 'inference_deadline_missing', 'The accepted deadline is unavailable.');
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, permit.providerDeadlineMonotonicMs - performance.now()),
  );
  const stop = observeInference({
    runId,
    organizationId: p.organizationId,
    generation: run.lease_generation,
    checkedAtMonotonicMs: permit.actorCheckedAtMonotonicMs,
    abort: controller,
  });
  const started = performance.now();
  let response: StoredResponse;
  let rawResponse: unknown;
  const stopProviderTiming = startPerformanceStage('provider.model');
  try {
    response = await inferenceProtocol(run.config, permit.deploymentHeaders).invoke(
      permit.body,
      permit.secret,
      controller.signal,
      run.config.stream && run.config.definition.question.kind !== 'provider'
        ? (value) => {
            rawResponse = value;
          }
        : undefined,
      run.config.definition.question.kind === 'provider',
      async (event) => {
        if (event.type === 'output.delta' && call.timings_ms.first_output === undefined)
          call.timings_ms.first_output = performance.now() - started;
        await output?.({ ...event, data: { ...event.data, invocation_id: call.id } });
      },
      permit.bodyJSON,
    );
    if (run.config.stream && run.config.definition.question.kind !== 'provider' && rawResponse !== undefined)
      response.providerResponse = rawResponse;
  } catch (error) {
    const evidence = error instanceof DecisionProviderError ? error.evidence : undefined;
    response = {
      value: null,
      refused: false,
      usage: evidence?.usage ?? emptyUsage(),
      requestId: evidence?.requestId ?? null,
      httpStatus: evidence?.httpStatus,
      modelRevision: evidence?.modelRevision ?? null,
      incomplete: 'provider_error',
      failure_code:
        error instanceof AppError
          ? error.code
          : controller.signal.aborted
            ? 'provider_interrupted'
            : 'provider_unavailable',
      transport_complete: evidence?.complete ?? false,
      ...(evidence
        ? {
            providerResponse: evidence.response,
            completedAt: evidence.completedAt ?? undefined,
            completedAtMonotonicMs: evidence.completedAtMonotonicMs ?? undefined,
          }
        : {}),
    };
  } finally {
    stopProviderTiming();
    clearTimeout(timeout);
    stop();
  }
  const completeMonotonicMs = response.completedAtMonotonicMs;
  if (completeMonotonicMs !== undefined && (response.transport_complete || !response.incomplete))
    response.completedAt = new Date(
      run.deadline.getTime() + completeMonotonicMs - permit.providerDeadlineMonotonicMs,
    ).toISOString();
  else response.completedAt = undefined;
  call.timings_ms.provider = performance.now() - started;
  // Background capture time is not model latency. Freeze completion before F,
  // even when optional export is delayed or the provider returned an error.
  call.responded_at = new Date();
  call.provider_completed_at = response.completedAt ? new Date(response.completedAt) : null;
  const deadline = Math.min(
    Date.now() + immediateInferencePolicy.completionMs,
    Date.now() +
      (permit.providerDeadlineMonotonicMs - performance.now()) +
      immediateInferencePolicy.completionMs,
    permit.hostDeadline - immediateInferencePolicy.deliveryMs,
  );
  try {
    const stopFinalizationTiming = startInferenceTiming('inference.finalization');
    const completed = await finalizeImmediateInference(run, call, response, deadline).finally(
      stopFinalizationTiming,
    );
    const saved = call;
    const traceContext = permit.traceContext;
    if (traceContext && (!tracingContentEnabled() || completed.run.result.content_expired))
      traceCompletedInference(traceContext, run, saved, response, completed.receipt, undefined, false);
    else if (traceContext)
      scheduleInferenceCapture(
        { organizationId: run.organization_id, runId, bytes: permit.bodyBytes + completed.captureBytes },
        background,
        (content) =>
          traceCompletedInference(
            traceContext,
            run,
            saved,
            response,
            completed.receipt,
            permit.body,
            content,
          ),
      );
    return inferenceEnvelope(completed.run);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'inference.completion_pending',
        run_id: runId,
        code:
          error instanceof AppError
            ? error.code
            : error instanceof TransactionCommitUnknownError
              ? 'commit_unknown'
              : 'persistence_unavailable',
      }),
    );
    // Completion normally persists evidence and money together. If it failed,
    // preserve the same already-validated response for evidence-only recovery.
    try {
      await persistImmediateResponse(
        permit,
        response,
        Math.min(permit.hostDeadline, Date.now() + immediateInferencePolicy.deliveryMs),
      );
      return await transaction(
        p.organizationId,
        async (tx) => {
          await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
          const current = await getRun(tx, runId, p);
          assert(
            current.kind === 'inference',
            409,
            'unsupported_run_kind',
            'Direct execution requires a single inference.',
          );
          const saved = await invocation(tx, runId);
          if (
            saved?.state === 'responded' &&
            !terminal(current.status) &&
            current.lease_generation === run.lease_generation
          ) {
            await tx.query(
              'UPDATE runs SET lease_generation=lease_generation+1 WHERE id=$1 AND lease_generation=$2',
              [runId, run.lease_generation],
            );
            await tx.query(
              "UPDATE dispatch_jobs SET available_at=now(),lease_until=NULL WHERE kind='run' AND resource_id=$1 AND state IN ('pending','running')",
              [runId],
            );
          }
          return inferenceEnvelope(
            current,
            saved?.state === 'responded' ? 'finalization_pending' : 'outcome_unknown',
          );
        },
        { deadlineAtMs: Math.min(permit.hostDeadline, Date.now() + immediateInferencePolicy.deliveryMs) },
      );
    } catch (recoveryError) {
      if (recoveryError instanceof AppError && [401, 403, 404].includes(recoveryError.status))
        throw recoveryError;
      // SQL being unavailable cannot erase the identity already acknowledged by A.
      return inferenceEnvelope(run, 'outcome_unknown');
    }
  }
}
