import { durableInferenceOutput } from './inference-output';
import type { InferenceOutputSink } from './decision';
import { DecisionProviderError } from './decision';
import { evidenceSteps, applyBoundedResponse } from './bounded-decisions';
import { transaction } from '../../db';
import { seal, unseal } from './crypto';
import { assert, AppError } from './errors';
import { getRun, terminal, compactInference, type ExecutableInferenceRunRow } from './runs';
import { initialReceipt } from './inference-receipt';
import { claimRun, principalFor } from './engine';
import { authorizeContext } from './context-artifacts';
import { actorAuthorized } from './actor-authorization';
import { modelCredential } from './model-credentials';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import {
  settleModelRequest,
  settleModelRequestInTransaction,
  inferenceUsage,
  inferenceBilling,
  type ModelBillingReceipt,
} from './model-gateway';
import { emptyUsage } from './model-protocol';
import { runTraceContext } from './run-tracing';
import { recordTrace, tracingEnabled, tracingContentEnabled } from './tracing';
import { startPerformanceStage } from './performance';
import { providerErrorDetails } from './provider-diagnostics';
import { observeWorkerStep } from './worker-diagnostics';
import { recoverImmediateInference } from './direct-inference';
import { observeInference, inferenceControl } from './inference-control';
import { inferencePublicationReceipt } from './inference-publication';
import {
  invocation,
  finish,
  finishInferenceInTransaction,
  checkedReceipt,
  capability,
  prepareInvocation,
  insertInvocation,
  currentInferenceRun,
  currentInferenceState,
  type PreparedInvocation,
  type StoredDecisionResponse,
} from './inference-invocations';

type Advance = { done: boolean; delaySeconds: number; queued?: boolean };
/** One request, persisted intent and response, no automatic provider replay.
 * A competing worker waits until the accepted deadline before classifying a
 * lost dispatch as uncertain. No connection/transaction is held during HTTP. */
export async function advanceInference(
  org: string,
  runId: string,
  background?: (task: () => Promise<void>) => void,
  output?: InferenceOutputSink,
): Promise<Advance> {
  const initial = await transaction(org, (tx) => getRun(tx, runId));
  assert(
    initial.kind !== 'native_agent',
    409,
    'unsupported_run_kind',
    'This executor supports single-request inference.',
  );
  if (initial.kind === 'inference' && initial.config.execution_owner === 'request') {
    // Request-owned recovery consumes evidence, never queued paid dispatch.
    const recovered = await recoverImmediateInference(initial, background);
    return { done: recovered ? terminal(recovered.status) : false, delaySeconds: recovered ? 0 : 1 };
  }
  assert(
    !compactInference(initial),
    409,
    'inference_input_unavailable',
    'Queued execution input is unavailable.',
  );
  let owner: ExecutableInferenceRunRow = initial;
  if (terminal(owner.status)) return { done: true, delaySeconds: 0 };
  if (owner.status === 'queued') {
    const claimed = await claimRun(org, runId);
    if (!claimed) {
      const current = await transaction(org, (tx) => currentInferenceRun(tx, owner));
      return { done: terminal(current.status), queued: current.status === 'queued', delaySeconds: 1 };
    }
    assert(
      claimed.kind !== 'native_agent' && !compactInference(claimed),
      409,
      'run_kind_mismatch',
      'The claimed execution has an incompatible input.',
    );
    owner = claimed;
  }
  const settled = new Map<string, ModelBillingReceipt>();
  const preparedBodies = new Map<string, PreparedInvocation>();
  const quantumStarted = performance.now();
  // Continue ready transitions under one retained owner while preserving each
  // invocation's durable prepared -> dispatch_started compare-and-swap. Yield
  // after finite work so unrelated Runs and cancellation retain headroom.
  for (let transition = 0; transition < 16; transition++) {
    const result = await advanceInferenceStep(org, runId, owner, settled, preparedBodies, background, output);
    if (result.done || result.delaySeconds > 0 || result.queued) return result;
    if (performance.now() - quantumStarted >= 5000) return result;
    const current = await transaction(org, (tx) => currentInferenceRun(tx, owner));
    if (terminal(current.status)) return { done: true, delaySeconds: 0 };
    if (current.lease_generation !== owner.lease_generation) return { done: false, delaySeconds: 1 };
    owner = current;
  }
  return { done: false, delaySeconds: 0 };
}

async function advanceInferenceStep(
  org: string,
  runId: string,
  admitted: ExecutableInferenceRunRow,
  settled: Map<string, ModelBillingReceipt>,
  preparedBodies: Map<string, PreparedInvocation>,
  background?: (task: () => Promise<void>) => void,
  output?: InferenceOutputSink,
): Promise<Advance> {
  const run = admitted;
  if (terminal(run.status)) return { done: true, delaySeconds: 0 };
  const currentRun = run;
  let call = await transaction(org, (tx) => invocation(tx, runId));
  const baseReceipt = () => initialReceipt(currentRun.config, call?.id || runId);
  const stopped = run.cancel_requested || (run.deadline && run.deadline.getTime() <= Date.now());
  if (call?.state === 'responded' && call.response_ciphertext) {
    const response = unseal<StoredDecisionResponse>(call.response_ciphertext);
    const settlement =
      settled.get(call.id) ??
      (await settleModelRequest(
        capability(run),
        call.id,
        run.config.rate_card,
        response.usage,
        false,
        run.config.provider_cost_rate_card,
      ));
    settled.delete(call.id);
    const billing = settlement;
    const context = tracingEnabled() ? await transaction(org, (tx) => runTraceContext(tx, run)) : undefined;
    if (context)
      recordTrace({
        context,
        id: call.id,
        name: 'decision.generate',
        type: 'generation',
        startedAt: call.dispatch_started_at || run.created_at,
        endedAt: call.responded_at || new Date(),
        firstOutputAt:
          call.dispatch_started_at && call.timings_ms.first_output !== undefined
            ? new Date(call.dispatch_started_at.getTime() + call.timings_ms.first_output)
            : undefined,
        level: response.incomplete || response.failure_code ? 'ERROR' : 'DEFAULT',
        input: tracingContentEnabled() ? unseal<Record<string, unknown>>(call.body_ciphertext) : undefined,
        output: tracingContentEnabled() ? response : undefined,
        model: run.config.model,
        usage: response.usage,
        chargedMicroUsd: billing?.charged_micro_usd ?? undefined,
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
          incomplete: response.incomplete,
          ...call.timings_ms,
          ...billing,
        },
      });
    try {
      const result =
        response.incomplete || response.failure_code
          ? response
          : await applyBoundedResponse(run, call, response);
      if (!result) return { done: false, delaySeconds: 0 };
      await finish(
        run,
        {
          ...checkedReceipt(run, call, result),
          usage: inferenceUsage(response.usage),
          billing: inferenceBilling(settlement, run.config.billing_mode),
        },
        undefined,
        call.context_expires_at,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'inference_owner_changed')
        return { done: false, delaySeconds: 1 };
      const code = error instanceof AppError ? error.code : 'tool_read_failed';
      await finish(
        run,
        {
          ...baseReceipt(),
          provider_request_digest: call.provider_request_digest,
          provider_outcome: 'responded',
          usage_request_id: call.id,
          usage: inferenceUsage(response.usage),
          billing: inferenceBilling(settlement, run.config.billing_mode),
          outcome: code === 'stale_input' ? 'stale_input' : 'failed',
        },
        code,
      );
    }
    return { done: true, delaySeconds: 0 };
  }
  if (stopped || call?.state === 'uncertain') {
    const sent = call && call.state !== 'prepared';
    const billing = call
      ? await settleModelRequest(
          capability(run),
          call.id,
          run.config.rate_card,
          emptyUsage(),
          !sent,
          run.config.provider_cost_rate_card,
        )
      : undefined;
    if (sent) {
      const context = tracingEnabled() ? await transaction(org, (tx) => runTraceContext(tx, run)) : undefined;
      if (context)
        recordTrace({
          context,
          id: call.id,
          name: 'decision.generate',
          type: 'generation',
          startedAt: call.dispatch_started_at || run.created_at,
          endedAt: new Date(),
          model: run.config.model,
          input:
            tracingContentEnabled() && call.body_ciphertext
              ? unseal<Record<string, unknown>>(call.body_ciphertext)
              : undefined,
          output: tracingContentEnabled() ? { outcome: 'uncertain' } : undefined,
          level: 'ERROR',
          chargedMicroUsd: billing?.charged_micro_usd ?? undefined,
          metadata: {
            invocation_id: call.id,
            step: call.step,
            usage_complete: false,
            outcome: 'uncertain',
            ...billing,
          },
        });
    }
    if (sent)
      await transaction(org, (tx) =>
        tx.query(
          "UPDATE decision_invocations SET state='uncertain' WHERE id=$1 AND state='dispatch_started'",
          [call.id],
        ),
      );
    await finish(run, {
      ...baseReceipt(),
      outcome: sent ? 'uncertain' : 'failed',
      provider_outcome: sent ? 'uncertain' : 'not_invoked',
      provider_request_digest: sent ? call.provider_request_digest : null,
      usage_request_id: call?.id || null,
      usage: inferenceUsage(emptyUsage(), !sent),
      billing: inferenceBilling(billing, run.config.billing_mode, !sent),
    });
    return { done: true, delaySeconds: 0 };
  }
  if (call?.state === 'dispatch_started') return { done: false, delaySeconds: 1 };
  try {
    if (!call) {
      const preparation = await transaction(org, async (tx) => {
        assert(
          await actorAuthorized(tx, run),
          403,
          'authorization_revoked',
          'The initiating credential is no longer authorized.',
        );
        const steps = await evidenceSteps(tx, runId);
        const history = (
          await tx.query<{ count: string; output: string }>(
            `SELECT count(*)::text AS count,
             coalesce(sum(CASE WHEN u.completeness='complete' THEN u.output_tokens ELSE i.output_token_bound END),0)::text AS output
             FROM decision_invocations i LEFT JOIN model_usage u ON u.request_id=i.id::text WHERE i.run_id=$1`,
            [runId],
          )
        ).rows[0];
        return { steps, history };
      });
      const step = Number(preparation.history.count);
      assert(
        step < (run.config.definition.bounded_agent?.max_model_calls || 1),
        409,
        'model_call_limit_exceeded',
        'The model-call limit was reached.',
      );
      // Missing usage keeps the original output bound. Complete metering frees
      // unused output allowance; body construction/encryption holds no SQL lock.
      const maxOutputTokens = run.config.limits.max_output_tokens - Number(preparation.history.output);
      assert(
        maxOutputTokens > 0,
        409,
        'output_limit_exceeded',
        'The aggregate output-token limit was reached.',
      );
      const preparedInvocation = prepareInvocation(
        run.config,
        step,
        run.kind === 'bounded_agent' ? preparation.steps : [],
        maxOutputTokens,
      );
      const inserted = await transaction(org, async (tx) => {
        const latest = await currentInferenceRun(tx, run);
        if (await invocation(tx, runId)) return;
        assert(
          latest.lease_generation === run.lease_generation &&
            !latest.cancel_requested &&
            !terminal(latest.status),
          409,
          'run_stopped',
          'Execution has stopped.',
        );
        assert(
          await actorAuthorized(tx, latest),
          403,
          'authorization_revoked',
          'The initiating credential is no longer authorized.',
        );
        const current = (
          await tx.query<{ count: string; tools: string }>(
            `SELECT count(*)::text AS count,
           (SELECT count(*)::text FROM decision_tool_steps WHERE run_id=$1) AS tools
           FROM decision_invocations WHERE run_id=$1`,
            [runId],
          )
        ).rows[0];
        // Another retained owner can advance between preparation and this lock.
        // Discard stale preparation; the next ready transition reloads evidence.
        if (current.count !== preparation.history.count || Number(current.tools) !== preparation.steps.length)
          return;
        await insertInvocation(tx, latest, preparedInvocation);
        return true;
      });
      if (inserted) preparedBodies.set(preparedInvocation.id, preparedInvocation);
      return { done: false, delaySeconds: 0 };
    }
    const prepared = call;
    if (!inferenceControl.available()) return { done: false, delaySeconds: 1 };
    const authorization = await transaction(org, async (tx) => {
      const latest = await currentInferenceRun(tx, run);
      assert(
        latest.lease_generation === run.lease_generation &&
          !latest.cancel_requested &&
          !terminal(latest.status) &&
          latest.deadline &&
          latest.deadline.getTime() > Date.now(),
        409,
        'run_stopped',
        'Execution has stopped.',
      );
      assert(
        await actorAuthorized(tx, latest),
        403,
        'authorization_revoked',
        'The initiating credential is no longer authorized.',
      );
      assert(
        !prepared.context_expires_at || prepared.context_expires_at.getTime() > Date.now(),
        409,
        'stale_input',
        'Context expired before dispatch.',
      );
      if (run.config.context_reference) {
        assert(
          await actorAuthorized(tx, latest, 'files:read'),
          403,
          'authorization_revoked',
          'Context access was revoked.',
        );
        await authorizeContext(tx, principalFor(run), run.workspace_id, run.config.context_reference);
      }
      const steps = await evidenceSteps(tx, runId);
      if (steps.length) {
        assert(
          await actorAuthorized(tx, latest, 'files:read'),
          403,
          'authorization_revoked',
          'Evidence access was revoked.',
        );
        for (const step of steps) {
          const reference = run.config.definition.bounded_agent?.context_artifacts.find(
            (ref) => ref.artifact_id === step.artifact_id,
          );
          assert(reference, 403, 'tool_not_granted', 'The evidence is outside this run’s grants.');
          await authorizeContext(tx, principalFor(run), run.workspace_id, reference);
        }
      }
      const organization = (await tx.query('SELECT settings FROM organizations WHERE id=$1', [org])).rows[0];
      assert(
        !organization.settings.billing_hold &&
          !organization.settings.payment_dispute_hold &&
          !organization.settings.reconciliation_hold,
        402,
        'billing_hold',
        'The account is not eligible to spend.',
      );
      const breaker = await tx.query(
        'SELECT 1 FROM provider_circuit_breakers WHERE key=$1 AND resolved_at IS NULL',
        [`model:${run.config.rate_card.provider}:${run.config.model}`],
      );
      assert(!breaker.rowCount, 503, 'model_paused', 'This model is paused for metering review.');
      const secret = await modelCredential(tx, run.config.user_id, {
        provider: run.config.rate_card.provider,
        billing_mode: run.config.billing_mode,
        provider_connection_id: run.config.provider_connection_id,
      });
      const won = await tx.query(
        "UPDATE decision_invocations SET state='dispatch_started',dispatch_started_at=now() WHERE id=$1 AND state='prepared' RETURNING id",
        [prepared.id],
      );
      return won.rowCount
        ? {
            secret,
            deadline: latest.deadline,
            traceContext: tracingEnabled() ? await runTraceContext(tx, run) : undefined,
          }
        : undefined;
    });
    if (!authorization) return { done: false, delaySeconds: 1 };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, authorization.deadline.getTime() - Date.now()),
    );
    const stopCancellationChecks = observeInference({
      runId,
      organizationId: org,
      generation: run.lease_generation,
      abort: controller,
    });
    const durable =
      run.kind === 'bounded_agent' && run.config.stream ? durableInferenceOutput(org, runId) : undefined;
    let firstOutputMs: number | undefined;
    const attemptStarted = performance.now();
    let failureStage = 'provider_request';
    const startedAt = new Date();
    let rawResponse: unknown;
    try {
      const protocol = decisionProtocol(run.config.rate_card.provider, run.config.model);
      const providerStarted = performance.now();
      const preparedBody = preparedBodies.get(call.id);
      const requestBody = preparedBody?.body ?? unseal<Record<string, unknown>>(call.body_ciphertext);
      let response: StoredDecisionResponse;
      const stopProviderTiming = startPerformanceStage('provider.model');
      try {
        response = await observeWorkerStep(
          'inference_provider',
          {
            organization_id: org,
            run_id: runId,
            request_id: call.id,
            model: run.config.model,
            provider: run.config.rate_card.provider,
          },
          () =>
            protocol.invoke(
              requestBody,
              authorization.secret,
              controller.signal,
              tracingContentEnabled() ||
                (run.config.stream && run.config.definition.question.kind !== 'provider')
                ? (output) => {
                    rawResponse = output;
                  }
                : undefined,
              run.config.definition.question.kind === 'provider',
              async (event) => {
                if (event.type === 'output.delta' && firstOutputMs === undefined)
                  firstOutputMs = performance.now() - providerStarted;
                const fragment = { ...event, data: { ...event.data, invocation_id: prepared.id } };
                await (output ?? durable?.write)?.(fragment);
              },
              preparedBody?.serialized,
            ),
        );
      } catch (error) {
        if (!(error instanceof DecisionProviderError)) throw error;
        const evidence = error.evidence;
        response = {
          value: null,
          refused: false,
          usage: evidence.usage,
          requestId: evidence.requestId,
          httpStatus: evidence.httpStatus,
          modelRevision: evidence.modelRevision,
          providerResponse: evidence.response,
          completedAt: evidence.completedAt ?? undefined,
          completedAtMonotonicMs: evidence.completedAtMonotonicMs ?? undefined,
          failure_code: error.code,
          transport_complete: evidence.complete,
          ...(evidence.complete ? {} : { incomplete: 'provider_error' }),
        };
      } finally {
        stopProviderTiming();
      }
      const providerMs = performance.now() - providerStarted;
      if (
        run.config.stream &&
        !response.incomplete &&
        !response.failure_code &&
        rawResponse !== undefined &&
        run.config.definition.question.kind !== 'provider'
      )
        response.providerResponse = rawResponse;
      failureStage = 'response_persistence';
      // Intermediate evidence and model settlement share one publication.
      const persistenceStarted = performance.now();
      const ciphertext = seal(response);
      const completedAt =
        response.completedAt && (response.transport_complete ?? !response.incomplete)
          ? new Date(response.completedAt)
          : null;
      const settlement = await transaction(org, async (tx) => {
        // Cancellation and purge share Run-first ordering even without SSE.
        const { run: latest, settlement: lockedSettlement } = await currentInferenceState(
          tx,
          run,
          prepared.id,
        );
        assert(
          latest.lease_generation === run.lease_generation,
          409,
          'inference_owner_changed',
          'The invocation owner changed.',
        );
        if (latest.result.content_expired) return;
        const saved = await tx.query(
          // A purged or already-preserved response cannot be overwritten by a late owner.
          `UPDATE decision_invocations SET state='responded',response_ciphertext=$2,responded_at=now(),timings_ms=$3,provider_completed_at=$4
           WHERE id=$1 AND body_ciphertext<>'' AND state IN ('dispatch_started','uncertain') RETURNING id`,
          [
            prepared.id,
            ciphertext,
            JSON.stringify({ provider: providerMs, first_output: firstOutputMs }),
            completedAt,
          ],
        );
        if (!saved.rowCount) return;
        // Intermediate evidence is required for continuation. Compose it with
        // the shared accounting owner rather than opening another transaction.
        const billing = await settleModelRequestInTransaction(
          tx,
          capability(run),
          prepared.id,
          run.config.rate_card,
          response.usage,
          false,
          run.config.provider_cost_rate_card,
          lockedSettlement,
        );
        // Publish the final replay batch atomically with its response evidence.
        await durable?.flush(tx);
        return billing;
      });
      if (settlement) settled.set(prepared.id, settlement);
      const persistenceMs = performance.now() - persistenceStarted;
      // Optional timing enrichment must not add a transaction between ready
      // model steps. Without a retained host callback, omit this diagnostic.
      const recordPersistenceTiming = async () => {
        await transaction(org, (tx) =>
          tx.query('UPDATE decision_invocations SET timings_ms=timings_ms||$2::jsonb WHERE id=$1', [
            prepared.id,
            JSON.stringify({ response_persistence: persistenceMs }),
          ]),
        ).catch(() => {}); // Never turn a durable provider response into an uncertain call.
      };
      if (background) background(recordPersistenceTiming);
    } catch (error) {
      if (
        tracingContentEnabled() &&
        rawResponse !== undefined &&
        failureStage === 'provider_request' &&
        authorization.traceContext
      )
        recordTrace({
          context: authorization.traceContext,
          id: `response:${call.id}`,
          name: 'decision.response',
          type: 'event',
          startedAt,
          endedAt: new Date(),
          output: rawResponse,
          metadata: { invocation_id: call.id, step: call.step, diagnostic: 'normalization_failed' },
          level: 'ERROR',
        });
      console.error(
        JSON.stringify({
          event: 'inference.execution_failed',
          run_id: runId,
          invocation_id: prepared.id,
          organization_id: org,
          workspace_id: run.workspace_id,
          provider: run.config.rate_card.provider,
          model: run.config.model,
          stage: failureStage,
          elapsed_ms: Math.round(performance.now() - attemptStarted),
          aborted: controller.signal.aborted,
          error: providerErrorDetails(error, authorization.secret),
        }),
      );
      await transaction(org, (tx) =>
        tx.query(
          "UPDATE decision_invocations SET state='uncertain' WHERE id=$1 AND state='dispatch_started'",
          [prepared.id],
        ),
      );
    } finally {
      preparedBodies.delete(prepared.id);
      clearTimeout(timeout);
      await stopCancellationChecks();
    }
    return { done: false, delaySeconds: 0 };
  } catch (error) {
    // Only a pre-dispatch failure reaches here. If dispatch committed, recovery
    // must inspect its durable identity rather than declare it free or retry it.
    return transaction(org, async (tx) => {
      const latest = await currentInferenceRun(tx, run);
      if (latest.lease_generation !== run.lease_generation) return { done: false, delaySeconds: 1 };
      if (terminal(latest.status)) return { done: true, delaySeconds: 0 };
      call = await invocation(tx, runId);
      if (call && call.state !== 'prepared') throw error;
      // Keep this check, zero-usage settlement and terminal publication under
      // one Run lock: another owner must not dispatch a just-released request.
      if (call)
        await settleModelRequestInTransaction(
          tx,
          capability(run),
          call.id,
          run.config.rate_card,
          emptyUsage(),
          true,
          run.config.provider_cost_rate_card,
        );
      const code = error instanceof AppError ? error.code : 'inference_preparation_failed';
      const receipt = await inferencePublicationReceipt(tx, latest, run.lease_generation, {
        ...baseReceipt(),
        outcome: code === 'stale_input' ? 'stale_input' : 'failed',
      });
      await finishInferenceInTransaction(tx, org, runId, receipt, code, undefined, latest);
      return { done: true, delaySeconds: 0 };
    });
  }
}
