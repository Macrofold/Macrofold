import { transaction, TransactionCommitUnknownError, DatabaseBudgetError } from '../../db';
import type { Principal } from './auth';
import { actorAuthorized } from './actor-authorization';
import { assert, AppError } from './errors';
import { getRun, terminal, waitingFields, runUrls, type InferenceRunRow } from './runs';
import { seal, unseal } from './crypto';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import { DecisionProviderError, type InferenceOutputSink, type InferenceReceipt } from './decision';
import { emptyUsage } from './model-protocol';
import {
  invocation,
  checkedReceipt,
  capability,
  finishInferenceInTransaction,
  type Invocation,
  type StoredDecisionResponse,
} from './inference-invocations';
import { settleModelRequestInTransaction, inferenceUsage, inferenceBilling } from './model-gateway';
import { observeInference } from './inference-control';
import type { TraceContext } from './trace';
import { recordTrace, tracingEnabled } from './tracing';
import { runTraceContext } from './run-tracing';
import { authorizeContext } from './context-artifacts';
import { principalFor } from './engine';
import type { components } from '../../contracts/api';
import { digest } from './explicit-context';
import { initialReceipt } from './inference-receipt';

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
  run: InferenceRunRow;
  call: Invocation;
  body: Record<string, unknown>;
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
  call: Invocation,
  response: StoredResponse,
  receipt: InferenceReceipt | undefined,
  input?: Record<string, unknown>,
) {
  recordTrace({
    context,
    id: call.id,
    name: 'decision.generate',
    type: 'generation',
    startedAt: call.dispatch_started_at ?? run.created_at,
    endedAt: call.responded_at ?? new Date(),
    firstOutputAt:
      call.dispatch_started_at && call.timings_ms.first_output !== undefined
        ? new Date(call.dispatch_started_at.getTime() + call.timings_ms.first_output)
        : undefined,
    input,
    output: response,
    model: run.config.model,
    usage: response.usage,
    chargedMicroUsd: receipt?.billing.charged_micro_usd ?? undefined,
    level: response.incomplete || response.failure_code ? 'ERROR' : 'DEFAULT',
    metadata: {
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
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timed_out')
    return {
      status: 200,
      body: {
        ...base,
        status,
        result: {
          ...run.result,
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
        await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [permit.run.id]);
        const run = await getRun(tx, permit.run.id);
        const current = await invocation(tx, run.id);
        assert(
          current && run.lease_generation === permit.run.lease_generation,
          409,
          'inference_owner_changed',
          'Recovery owns this invocation.',
        );
        if (!current.body_ciphertext || run.result.content_expired) return current;
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
        return (
          await tx.query<Invocation>(
            `UPDATE decision_invocations SET state='responded',response_ciphertext=$2,responded_at=clock_timestamp(),provider_completed_at=$3,timings_ms=$4
       WHERE id=$1 AND state='dispatch_started' AND body_ciphertext<>'' RETURNING *`,
            [current.id, ciphertext, completedAt, JSON.stringify(permit.call.timings_ms)],
          )
        ).rows[0];
      },
      { deadlineAtMs: Math.min(deadline, Date.now() + immediateInferencePolicy.persistenceAttemptMs) },
    );
  return persist(deadline, write, () =>
    transaction(
      permit.run.organization_id,
      async (tx) => {
        const current = await invocation(tx, permit.run.id);
        return current?.state === 'responded' ? current : undefined;
      },
      { deadlineAtMs: deadline },
    ),
  );
}

/** Recovery consumes evidence only. Its generation fence prevents a late live
 * owner from writing after handoff or process loss; it never creates a permit. */
export async function recoverImmediateInference(run: InferenceRunRow) {
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
      const billing = await settleModelRequestInTransaction(
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
        run: await finishInferenceInTransaction(tx, run.organization_id, run.id, receipt),
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
  if (tracingEnabled() && !completed.run.result.content_expired) {
    try {
      const context = await transaction(run.organization_id, (tx) => runTraceContext(tx, completed.run), {
        deadlineAtMs: deadline,
      });
      if (context)
        traceCompletedInference(
          context,
          claimed.run,
          claimed.call,
          response,
          completed.receipt,
          claimed.call.body_ciphertext
            ? unseal<Record<string, unknown>>(claimed.call.body_ciphertext)
            : undefined,
        );
    } catch {
      console.warn(JSON.stringify({ code: 'inference_trace_attribution_failed', run_id: run.id }));
    }
  }
  return completed.run;
}

/** This same finalizer is used by the live owner and evidence-only recovery. */
export async function finalizeImmediateInference(
  run: InferenceRunRow,
  call: Invocation,
  response: StoredResponse,
  deadline: number,
) {
  let receipt = checkedReceipt(run, call, response);
  if (response.failure_code)
    receipt = {
      ...receipt,
      outcome: 'failed',
      reason_code: response.failure_code,
      provider_outcome: response.transport_complete ? 'responded' : 'uncertain',
      validation: { ...receipt.validation, status: 'not_run' },
    };
  const preparedReceipt = receipt;
  const write = () =>
    transaction(
      run.organization_id,
      async (tx) => {
        await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [run.id]);
        const current = await getRun(tx, run.id);
        assert(current.kind === 'inference', 409, 'run_kind_mismatch', 'This is not a direct inference.');
        const saved = await invocation(tx, run.id);
        assert(
          saved && saved.id === call.id && saved.response_ciphertext === call.response_ciphertext,
          409,
          'inference_evidence_changed',
          'The saved response identity changed.',
        );
        let finalReceipt = preparedReceipt;
        if (!terminal(current.status)) {
          assert(
            current.lease_generation === run.lease_generation,
            409,
            'inference_owner_changed',
            'Recovery owns this invocation.',
          );
          let allowed = await actorAuthorized(tx, current);
          if (allowed && current.config.context_reference) {
            try {
              allowed = await actorAuthorized(tx, current, 'files:read');
              if (allowed)
                await authorizeContext(
                  tx,
                  principalFor(current),
                  current.workspace_id,
                  current.config.context_reference,
                );
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              allowed = false;
            }
          }
          if (!allowed) {
            const { value: _value, ...rest } = finalReceipt;
            finalReceipt = { ...rest, outcome: 'failed', reason_code: 'authorization_revoked' };
          }
          if (
            saved.context_expires_at &&
            saved.context_expires_at.getTime() <= Date.now() &&
            finalReceipt.outcome === 'value'
          ) {
            const { value: _value, ...rest } = finalReceipt;
            finalReceipt = { ...rest, outcome: 'stale_input', reason_code: 'context_expired' };
          }
        }
        const billing = await settleModelRequestInTransaction(
          tx,
          capability(current),
          call.id,
          run.config.rate_card,
          response.usage,
          false,
          run.config.provider_cost_rate_card,
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
              saved.provider_completed_at,
            );
        return { run: finished, receipt: finalReceipt };
      },
      { deadlineAtMs: Math.min(deadline, Date.now() + immediateInferencePolicy.persistenceAttemptMs) },
    );
  return persist<{ run: InferenceRunRow; receipt: InferenceReceipt | undefined }>(deadline, write, () =>
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
}

/** One retained producer, three durable boundaries. A replay has no dispatch permit. */
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
  try {
    response = await decisionProtocol(run.config.rate_card.provider, run.config.model).invoke(
      permit.body,
      permit.secret,
      controller.signal,
      (value) => {
        rawResponse = value;
      },
      run.config.definition.question.kind === 'provider',
      async (event) => {
        if (event.type === 'output.delta' && call.timings_ms.first_output === undefined)
          call.timings_ms.first_output = performance.now() - started;
        await output?.({ ...event, data: { ...event.data, invocation_id: call.id } });
      },
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
  const deadline = Math.min(
    Date.now() + immediateInferencePolicy.completionMs,
    Date.now() +
      (permit.providerDeadlineMonotonicMs - performance.now()) +
      immediateInferencePolicy.completionMs,
    permit.hostDeadline - immediateInferencePolicy.deliveryMs,
  );
  try {
    const persistenceStarted = performance.now();
    const saved = await persistImmediateResponse(permit, response, deadline);
    assert(saved, 409, 'inference_evidence_unavailable', 'Response evidence is unavailable.');
    saved.timings_ms.response_persistence = performance.now() - persistenceStarted;
    const completed = await finalizeImmediateInference(run, saved, response, deadline);
    const traceContext = permit.traceContext;
    if (traceContext) {
      const trace = () =>
        traceCompletedInference(traceContext, run, saved, response, completed.receipt, permit.body);
      if (background)
        background(async () => {
          trace();
        });
      else trace();
    }
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
    // A durable response survives C failure. Wake evidence-only recovery without
    // manufacturing a new provider request or erasing accepted liability.
    try {
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
