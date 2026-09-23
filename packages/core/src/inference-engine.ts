import { inferenceInputBound } from './decision';
import { boundedRequest, evidenceSteps, applyBoundedResponse } from './bounded-decisions';
import { transaction, type Tx } from '../../db';
import { id, seal, unseal } from './crypto';
import { assert, AppError } from './errors';
import { emit } from './events';
import { getRun, terminal, type InferenceRunRow } from './runs';
import { initialReceipt } from './inference-receipt';
import { claimRun, principalFor } from './engine';
import { authorizeContext } from './context-artifacts';
import { actorAuthorized } from './actor-authorization';
import { modelCredential } from './model-credentials';
import { decisionProtocol } from '../../providers/src/decision-protocols';
import { costForUsage, settleModelRequest } from './model-gateway';
import { emptyUsage } from './model-protocol';
import { digest, schemaValidator } from './explicit-context';
import { settle } from './ledger';
import type { DecisionResponse, InferenceReceipt } from './decision';
import { runTraceContext } from './run-tracing';
import { recordTrace, tracingEnabled } from './tracing';
import { providerErrorDetails } from './provider-diagnostics';
import { observeWorkerStep } from './worker-diagnostics';

type Invocation = {
  id: string;
  run_id: string;
  step: number;
  context_digest: string;
  context_expires_at: Date | null;
  dependency_tokens: Record<string, string>;
  dispatch_started_at: Date | null;
  responded_at: Date | null;
  state: 'prepared' | 'dispatch_started' | 'responded' | 'uncertain';
  body_ciphertext: string;
  provider_request_digest: string;
  response_ciphertext: string | null;
  timings_ms: Record<string, number>;
};
type Advance = { done: boolean; delaySeconds: number; queued?: boolean };
async function invocation(tx: Tx, runId: string) {
  return (
    await tx.query<Invocation>(
      'SELECT * FROM decision_invocations WHERE run_id=$1 AND handled_at IS NULL ORDER BY step DESC LIMIT 1',
      [runId],
    )
  ).rows[0];
}
async function finish(org: string, runId: string, receipt: InferenceReceipt, failureCode?: string) {
  return transaction(org, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
    const run = await getRun(tx, runId);
    // Late evidence is retained by the invocation owner. It cannot change a
    // terminal status or replay the ledger settlement.
    if (terminal(run.status)) return;
    const status = run.cancel_requested
      ? 'cancelled'
      : run.deadline && run.deadline.getTime() <= Date.now()
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
    await tx.query('UPDATE runs SET status=$2,completed_at=now(),result=$3 WHERE id=$1', [
      runId,
      status,
      JSON.stringify({
        inference: receipt,
        execution_outcome: status === 'succeeded' ? 'success' : status === 'failed' ? 'failure' : status,
        persistence_status: 'not_required',
        ...(failureCode ? { failure_code: failureCode } : {}),
      }),
    ]);
    await settle(tx, org, runId, BigInt(run.reservation_micro_usd), BigInt(run.cost_micro_usd));
    await tx.query(
      "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
      [runId],
    );
    await emit(tx, org, runId, `run.${status}`, { status, outcome: receipt.outcome });
  });
}
function capability(run: InferenceRunRow) {
  return {
    purpose: 'runtime' as const,
    organization: run.organization_id,
    run: run.id,
    lease: run.lease_generation,
    expires: Date.now(),
  };
}
function checkedReceipt(
  run: InferenceRunRow,
  call: Invocation,
  response: DecisionResponse,
): InferenceReceipt {
  const validationStarted = performance.now();
  const receipt = initialReceipt(run.config, call.id);
  const question = run.config.definition.question;
  const valid =
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
      queue_wait: run.started_at ? run.started_at.getTime() - run.created_at.getTime() : 0,
      ...call.timings_ms,
      validation: performance.now() - validationStarted,
    },
    context_digest: call.context_digest,
    dependency_tokens: call.dependency_tokens,
    provider_request_digest: call.provider_request_digest,
    provider_outcome: 'responded',
    provider_request_id: response.requestId,
    model_revision: response.modelRevision,
    model_revision_status: response.modelRevision ? 'reported' : 'unavailable',
    usage_request_id: call.id,
    outcome: stale
      ? 'stale_input'
      : response.refused
        ? 'refused'
        : unknown
          ? 'unknown'
          : valid
            ? 'value'
            : 'invalid_output',
    reason_code: stale
      ? 'context_expired'
      : response.refused
        ? 'provider_refused'
        : unknown
          ? 'declared_unknown'
          : !valid
            ? 'output_schema_mismatch'
            : undefined,
    provider_evidence: response.evidence,
    ...(valid && !stale && !response.refused && !unknown ? { value: response.value } : {}),
    validation: { ...receipt.validation, status: response.refused ? 'not_run' : valid ? 'passed' : 'failed' },
  };
}

/** One request, persisted intent and response, no automatic provider replay.
 * A competing worker waits until the accepted deadline before classifying a
 * lost dispatch as uncertain. No connection/transaction is held during HTTP. */
export async function advanceInference(org: string, runId: string, background?: (task: () => Promise<void>) => void): Promise<Advance> {
  let run = await transaction(org, (tx) => getRun(tx, runId));
  assert(
    run.kind !== 'native_agent',
    409,
    'unsupported_run_kind',
    'This executor supports single-request inference.',
  );
  if (terminal(run.status)) return { done: true, delaySeconds: 0 };
  if (run.status === 'queued') {
    const claimed = await claimRun(org, runId);
    if (!claimed) {
      const current = await transaction(org, (tx) => getRun(tx, runId));
      return { done: terminal(current.status), queued: current.status === 'queued', delaySeconds: 1 };
    }
    assert(
      claimed.kind !== 'native_agent',
      409,
      'run_kind_mismatch',
      'The claimed execution has an incompatible kind.',
    );
    run = claimed;
  }
  const currentRun = run;
  let call = await transaction(org, (tx) => invocation(tx, runId));
  const baseReceipt = () => initialReceipt(currentRun.config, call?.id || runId);
  const stopped = run.cancel_requested || (run.deadline && run.deadline.getTime() <= Date.now());
  if (call?.state === 'responded' && call.response_ciphertext) {
    const response = unseal<DecisionResponse>(call.response_ciphertext);
    const billing = await settleModelRequest(
      capability(run),
      call.id,
      run.config.rate_card,
      response.usage,
      false,
      run.config.provider_cost_rate_card,
    );
    const context = tracingEnabled() ? await transaction(org, (tx) => runTraceContext(tx, run)) : undefined;
    if (context)
      recordTrace({
        context,
        id: call.id,
        name: 'decision.generate',
        type: 'generation',
        startedAt: call.dispatch_started_at || run.created_at,
        endedAt: call.responded_at || new Date(),
        input: unseal<Record<string, unknown>>(call.body_ciphertext),
        output: response,
        model: run.config.model,
        usage: response.usage,
        chargedMicroUsd: billing?.charged_micro_usd,
        metadata: {
          invocation_id: call.id,
          step: call.step,
          provider_request_id: response.requestId,
          model_revision: response.modelRevision,
          transformation_version: run.config.transformation_version,
          context_digest: call.context_digest,
          provider_request_digest: call.provider_request_digest,
          usage_complete: response.usage.complete,
          ...billing,
        },
      });
    try {
      const result = await applyBoundedResponse(run, call, response);
      if (!result) return { done: false, delaySeconds: 0 };
      await finish(org, runId, checkedReceipt(run, call, result));
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'tool_read_failed';
      await finish(
        org,
        runId,
        {
          ...baseReceipt(),
          provider_request_digest: call.provider_request_digest,
          provider_outcome: 'responded',
          usage_request_id: call.id,
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
          input: call.body_ciphertext ? unseal<Record<string, unknown>>(call.body_ciphertext) : undefined,
          output: { outcome: 'uncertain' },
          level: 'ERROR',
          chargedMicroUsd: billing?.charged_micro_usd,
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
    await finish(org, runId, {
      ...baseReceipt(),
      outcome: sent ? 'uncertain' : 'failed',
      provider_outcome: sent ? 'uncertain' : 'not_invoked',
      provider_request_digest: sent ? call.provider_request_digest : null,
      usage_request_id: call?.id || null,
    });
    return { done: true, delaySeconds: 0 };
  }
  if (call?.state === 'dispatch_started') return { done: false, delaySeconds: 1 };
  try {
    if (!call) {
      await transaction(org, async (tx) => {
        await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
        if (await invocation(tx, runId)) return;
        const latest = await getRun(tx, runId);
        assert(
          !latest.cancel_requested && !terminal(latest.status),
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
        const provider = run.config.rate_card.provider;
        const protocol = decisionProtocol(provider, run.config.model);
        const steps = await evidenceSteps(tx, runId);
        const history = (
          await tx.query<{ count: string; output: string }>(
            'SELECT count(*)::text AS count,coalesce(sum(output_token_bound),0)::text AS output FROM decision_invocations WHERE run_id=$1',
            [runId],
          )
        ).rows[0];
        const step = Number(history.count);
        assert(
          step < (run.config.definition.bounded_agent?.max_model_calls || 1),
          409,
          'model_call_limit_exceeded',
          'The model-call limit was reached.',
        );
        // Reserve output tokens conservatively across calls even if a provider
        // cannot meter them. Complete usage releases the unused token allowance.
        const used = (
          await tx.query<{ output: string }>(
            `SELECT coalesce(sum(CASE WHEN u.completeness='complete' THEN u.output_tokens ELSE i.output_token_bound END),0)::text AS output
          FROM decision_invocations i LEFT JOIN model_usage u ON u.request_id=i.id::text WHERE i.run_id=$1`,
            [runId],
          )
        ).rows[0];
        const maxOutputTokens = run.config.limits.max_output_tokens - Number(used.output);
        assert(
          maxOutputTokens > 0,
          409,
          'output_limit_exceeded',
          'The aggregate output-token limit was reached.',
        );
        const dependencyTokens = { ...run.config.context.dependency_tokens };
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
        const expirations = [run.config.context, ...steps.map((step) => step.context)].flatMap((context) =>
          context.expires_at ? [Date.parse(context.expires_at)] : [],
        );
        const expiresAt = expirations.length ? new Date(Math.min(...expirations)) : null;
        assert(
          !expiresAt || expiresAt.getTime() > Date.now(),
          409,
          'stale_input',
          'Read evidence expired before the next model call.',
        );
        const body = protocol.prepare(
          boundedRequest({
            model: run.config.model,
            modelParameters: run.config.model_parameters,
            definition: run.config.definition,
            input: run.config.input,
            context: run.config.context,
            maxOutputTokens,
            rates: {
              inputMicroUsdPerMillion: run.config.rate_card.input_micro_usd_per_million,
              outputMicroUsdPerMillion: run.config.rate_card.output_micro_usd_per_million,
            },
            ...(run.kind === 'bounded_agent' ? { steps } : {}),
          }),
        );
        const inputTokenBound = inferenceInputBound(body, provider, run.config.model, run.config.definition.question.kind === 'provider');
        assert(
          inputTokenBound + maxOutputTokens <= protocol.maxInputTokens,
          413,
          'model_context_exceeded',
          'The accumulated evidence exceeds the model context limit.',
        );
        const bound = costForUsage(run.config.rate_card, {
          ...emptyUsage(),
          input: inputTokenBound,
          cacheWrite: provider === 'anthropic' && run.config.definition.question.kind === 'provider' ? inputTokenBound : 0,
          output: maxOutputTokens,
        });
        assert(
          bound +
            BigInt(
              (await tx.query('SELECT budget_used_micro_usd FROM runs WHERE id=$1', [runId])).rows[0]
                .budget_used_micro_usd,
            ) <=
            BigInt(run.config.limits.max_cost_micro_usd),
          402,
          'run_budget_exhausted',
          'The request exceeds the authorized budget.',
        );
        const invocationId = id();
        await tx.query(
          "INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight',$8)",
          [
            invocationId,
            org,
            runId,
            run.lease_generation,
            run.config.model,
            provider,
            run.config.billing_mode,
            bound.toString(),
          ],
        );
        await tx.query("UPDATE runs SET model_reserved_micro_usd=$2,status='running' WHERE id=$1", [
          runId,
          bound.toString(),
        ]);
        await tx.query(
          "INSERT INTO decision_invocations(id,organization_id,run_id,step,state,provider_request_digest,body_ciphertext,context_digest,output_token_bound,dependency_tokens,context_expires_at) VALUES($1,$2,$3,$6,'prepared',$4,$5,$7,$8,$9,$10)",
          [
            invocationId,
            org,
            runId,
            digest(body),
            seal(body),
            step,
            steps.length ? digest({ context: run.config.context, steps }) : run.config.context_digest,
            maxOutputTokens,
            JSON.stringify(dependencyTokens),
            expiresAt,
          ],
        );
        await emit(tx, org, runId, 'inference.prepared', { invocation_id: invocationId });
      });
      return { done: false, delaySeconds: 0 };
    }
    const prepared = call;
    const authorization = await transaction(org, async (tx) => {
      await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
      const latest = await getRun(tx, runId);
      assert(
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
        ? { secret, deadline: latest.deadline, traceContext: await runTraceContext(tx, run) }
        : undefined;
    });
    if (!authorization) return { done: false, delaySeconds: 1 };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, authorization.deadline.getTime() - Date.now()),
    );
    const cancelled = setInterval(() => {
      void transaction(org, (tx) => getRun(tx, runId))
        .then((latest) => {
          if (latest.cancel_requested || terminal(latest.status)) controller.abort();
        })
        .catch(() => controller.abort());
    }, 500);
    const attemptStarted = performance.now();
    let failureStage = 'provider_request';
    const startedAt = new Date();
    let rawResponse: unknown;
    try {
      const protocol = decisionProtocol(run.config.rate_card.provider, run.config.model);
      const providerStarted = performance.now();
      const requestBody = unseal<Record<string, unknown>>(call.body_ciphertext);
      const response = await observeWorkerStep('inference_provider', {
        organization_id: org, run_id: runId, request_id: call.id,
        model: run.config.model, provider: run.config.rate_card.provider,
      }, () => protocol.invoke(
        requestBody,
        authorization.secret,
        controller.signal,
        (output) => {
          rawResponse = output;
        },
        run.config.definition.question.kind === 'provider',
      ));
      const providerMs = performance.now() - providerStarted;
      failureStage = 'response_persistence';
      // Commit evidence before attempting financial settlement or publication.
      const persistenceStarted = performance.now();
      await transaction(org, (tx) =>
        tx.query(
          // Retention/purge wins over a late provider response. Never restore
          // customer content after the owning run's diagnostics were erased.
          "UPDATE decision_invocations SET state='responded',response_ciphertext=$2,responded_at=now(),timings_ms=$3 WHERE id=$1 AND body_ciphertext<>''",
          [prepared.id, seal(response), JSON.stringify({ provider: providerMs })],
        ),
      );
      const persistenceMs = performance.now() - persistenceStarted;
      // Measurement is non-authoritative. The request host owns it after the
      // response; worker callers retain the existing awaited behavior.
      const recordPersistenceTiming = async () => {
        await transaction(org, (tx) =>
          tx.query('UPDATE decision_invocations SET timings_ms=timings_ms||$2::jsonb WHERE id=$1', [
            prepared.id, JSON.stringify({ response_persistence: persistenceMs }),
          ]),
        ).catch(() => {}); // Never turn a durable provider response into an uncertain call.
      };
      if (background) background(recordPersistenceTiming);
      else await recordPersistenceTiming();
    } catch (error) {
      if (
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
      console.error(JSON.stringify({
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
      }));
      await transaction(org, (tx) =>
        tx.query(
          "UPDATE decision_invocations SET state='uncertain' WHERE id=$1 AND state='dispatch_started'",
          [prepared.id],
        ),
      );
    } finally {
      clearTimeout(timeout);
      clearInterval(cancelled);
    }
    return { done: false, delaySeconds: 0 };
  } catch (error) {
    // Only a pre-dispatch failure reaches here. If dispatch committed, recovery
    // must inspect its durable identity rather than declare it free or retry it.
    call = await transaction(org, (tx) => invocation(tx, runId));
    if (call && call.state !== 'prepared') throw error;
    if (call)
      await settleModelRequest(
        capability(run),
        call.id,
        run.config.rate_card,
        emptyUsage(),
        true,
        run.config.provider_cost_rate_card,
      );
    const code = error instanceof AppError ? error.code : 'inference_preparation_failed';
    await finish(
      org,
      runId,
      { ...baseReceipt(), outcome: code === 'stale_input' ? 'stale_input' : 'failed' },
      code,
    );
    return { done: true, delaySeconds: 0 };
  }
}
