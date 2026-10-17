import { modelInputBound } from './model-content';
import { modelTransport } from '../../contracts/model-transport';
import { prepareModelUpload, readModelBody } from './model-request-upload';
import { transaction, type Tx } from '../../db';
import type { components } from '../../contracts/api';
import { runTraceContext } from './run-tracing';
import { recordTrace } from './tracing';
import { ModelOutputCapture } from '../../providers/src/model-output-capture';
import type { TraceObservation } from './trace';
import { realExecutionEnabled } from './config';
import { assert, errorBody } from './errors';
import { id } from './crypto';
import { modelCredential } from './model-credentials';
import { getRun, requireNativeRun } from './runs';
import { verifyRuntime, type RuntimeCapability } from './runtime-auth';
import { computeMaximum, type Model } from './catalog';
import { emit } from './events';
import { requireRunActor } from './actor-authorization';
import { boundedBody } from './body';
import { emptyUsage, type ModelUsage as Usage } from './model-protocol';
import { modelProtocol } from '../../providers/src/model-protocols';
import {
  modelResponseFailed,
  modelResponseMaximumBytes,
  observeModelStream,
} from '../../providers/src/model-stream';

type ModelBillingMode = NonNullable<components['schemas']['RunCreate']['billing_mode']>;
type GatewaySettlementRequest = {
  id: string;
  run_id: string;
  billing_mode: ModelBillingMode;
  status: string;
  reserved_micro_usd: string;
  actual_micro_usd: string | null;
};
export type ModelBillingReceipt = Omit<
  components['schemas']['InferenceBilling'],
  'billing_mode' | 'charged_micro_usd' | 'budget_cost_micro_usd' | 'reserved_micro_usd'
> & {
  billing_mode: ModelBillingMode;
  charged_micro_usd: string;
  budget_cost_micro_usd: string;
  reserved_micro_usd: string;
  upstream_rejected: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number;
  cache_write_tokens: number;
  retail_rate_card: Model;
  provider_cost_rate_card: Model | undefined;
  input_micro_usd_per_million: string;
  output_micro_usd_per_million: string;
};

/** Shared wire projection; unknown counts remain null rather than apparent zero. */
export function inferenceUsage(
  usage: Usage,
  provenUninvoked = false,
): components['schemas']['InferenceUsage'] {
  const tokens = (key: 'input' | 'output' | 'cached' | 'cacheWrite') =>
    provenUninvoked ? '0' : usage.complete || usage.known?.[key] ? String(usage[key]) : null;
  return {
    input_tokens: tokens('input'),
    output_tokens: tokens('output'),
    cached_input_tokens: tokens('cached'),
    cache_write_input_tokens: tokens('cacheWrite'),
    completeness: provenUninvoked || usage.complete ? 'complete' : 'missing',
  };
}

/** This only projects committed settlement; it never estimates charges. */
export function inferenceBilling(
  billing: ModelBillingReceipt | undefined,
  billingMode: 'managed' | 'byok',
  provenUninvoked = false,
): components['schemas']['InferenceBilling'] {
  return {
    billing_mode: billingMode,
    charged_micro_usd: billing?.charged_micro_usd ?? (billingMode === 'byok' || provenUninvoked ? '0' : null),
    budget_cost_micro_usd: billing?.budget_cost_micro_usd ?? (provenUninvoked ? '0' : null),
    reserved_micro_usd: billing?.reserved_micro_usd ?? (provenUninvoked ? '0' : null),
    reported_micro_usd: billing?.reported_micro_usd ?? (provenUninvoked ? '0' : null),
    provisional: billing?.provisional ?? !provenUninvoked,
    bound_breached: billing?.bound_breached ?? false,
    provider_cost_micro_usd: billing?.provider_cost_micro_usd ?? null,
    provider_cost_status: billing?.provider_cost_status ?? 'unavailable',
    provider_reported_cost_usd: billing?.provider_reported_cost_usd ?? null,
    provider_reported_cost_status: billing?.provider_reported_cost_status ?? 'unavailable',
    upstream_inference_cost_usd: billing?.upstream_inference_cost_usd ?? null,
  };
}

/** Commit the spending fence before settlement or returning an upstream failure.
 * Settlement may need recovery; that must never reopen model admission. */
async function recordModelFailure(cap: RuntimeCapability, requestId: string) {
  await transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const stopped = await tx.query(
      `UPDATE runs SET model_error_request_id=$2 WHERE id=$1
       AND kind='native_agent' AND config->'limits'->>'stop_on_model_error'='true'
       AND model_error_request_id IS NULL AND completed_at IS NULL RETURNING id`,
      [cap.run, requestId],
    );
    if (stopped.rowCount)
      await emit(tx, cap.organization, cap.run, 'run.model_error', {
        request_id: requestId,
        failure_code: 'model_request_failed',
      });
  });
}

function roundedCost(tokens: number, rate: string) {
  return (BigInt(Math.max(0, Math.ceil(tokens))) * BigInt(rate) + 999999n) / 1000000n;
}
export function costForUsage(model: Model, usage: Usage) {
  // Published retail rates remain stable for the run; cache writes conservatively use 2× input.
  const input = usage.input + usage.cacheWrite;
  return (
    roundedCost(input, model.input_micro_usd_per_million) +
    roundedCost(usage.output, model.output_micro_usd_per_million)
  );
}
async function reserveRequest(cap: RuntimeCapability, payload: Record<string, unknown>, path: string) {
  return transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const run = await getRun(tx, cap.run);
    requireNativeRun(run);
    await requireRunActor(tx, run);
    assert(
      !run.model_error_request_id,
      409,
      'model_request_failed',
      'An earlier model request failed. This Run does not allow further model requests.',
    );
    assert(
      run.lease_generation === cap.lease &&
        ['running', 'waiting_for_input'].includes(run.status) &&
        !run.cancel_requested,
      409,
      'run_unavailable',
      'The run is no longer authorized to invoke models.',
    );
    assert(
      run.deadline && run.deadline.getTime() > Date.now(),
      408,
      'run_timeout',
      'The run deadline has passed.',
    );
    const model = run.config.rate_card;
    assert(
      model && model.id === payload.model,
      403,
      'model_not_authorized',
      'This model is not authorized for the run.',
    );
    const inputBound = modelInputBound(payload, {
      harness: run.config.harness,
      provider: model.provider,
      model: model.id,
    });
    const protocol = modelProtocol(model.provider);
    const blocked = await tx.query(
      'SELECT 1 FROM provider_circuit_breakers WHERE key=$1 AND resolved_at IS NULL',
      [`model:${model.provider}:${model.id}`],
    );
    assert(
      !blocked.rowCount,
      503,
      'model_paused',
      'This model is paused pending operator review of its metering.',
    );
    assert(
      protocol && protocol.paths.includes(path),
      403,
      'endpoint_not_authorized',
      'This model endpoint is not authorized.',
    );
    const maxOutput = Math.min(
      8192,
      Math.max(
        1,
        Number(payload.max_output_tokens || payload.max_completion_tokens || payload.max_tokens || 4096),
      ),
    );
    assert(Number.isInteger(maxOutput), 400, 'invalid_request', 'Maximum output tokens must be an integer.');
    protocol.prepare(payload, path, {
      maxOutput,
      modelParameters: run.config.model_parameters,
      inputMicroUsdPerMillion: model.input_micro_usd_per_million,
      outputMicroUsdPerMillion: model.output_micro_usd_per_million,
    });
    const secret = await modelCredential(tx, run.config.user_id, {
      provider: model.provider,
      billing_mode: run.config.billing_mode,
      provider_connection_id: run.config.provider_connection_id,
    });
    const requestId = id();
    const traceContext = await runTraceContext(tx, run);
    if (path.endsWith('count_tokens'))
      return {
        requestId,
        traceContext,
        protocol,
        model,
        secret,
        url: `${protocol.base}/${path}`,
        reserved: 0n,
        metered: false,
        deadline: run.deadline,
      };
    // Text bytes plus bounded native-image tokens; hosted tools remain disabled.
    const reserved =
      roundedCost(inputBound * (protocol.cacheWrites ? 2 : 1), model.input_micro_usd_per_million) +
      roundedCost(maxOutput, model.output_micro_usd_per_million);
    const budget = (
      await tx.query('SELECT budget_used_micro_usd,model_reserved_micro_usd FROM runs WHERE id=$1', [cap.run])
    ).rows[0];
    const compute = computeMaximum(
      run.config.limits?.timeout_seconds || 900,
      run.config.compute_rate_micro_usd_per_minute,
    );
    assert(
      BigInt(budget.budget_used_micro_usd) + BigInt(budget.model_reserved_micro_usd) + reserved + compute <=
        BigInt(run.config.limits?.max_cost_micro_usd || '0'),
      402,
      'run_budget_exhausted',
      'The next model request exceeds the remaining run budget.',
    );
    await tx.query(
      'UPDATE runs SET model_reserved_micro_usd=model_reserved_micro_usd+$2::bigint WHERE id=$1',
      [cap.run, reserved.toString()],
    );
    await tx.query(
      "INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight',$8)",
      [
        requestId,
        cap.organization,
        cap.run,
        cap.lease,
        model.id,
        model.provider,
        run.config.billing_mode,
        reserved.toString(),
      ],
    );
    return {
      requestId,
      traceContext,
      protocol,
      model,
      secret,
      url: `${protocol.base}/${path}`,
      reserved,
      metered: true,
      deadline: run.deadline,
    };
  });
}
export async function settleModelRequest(
  cap: RuntimeCapability,
  requestId: string,
  model: Model,
  usage: Usage,
  upstreamRejected = false,
  providerCostModel?: Model,
) {
  return transaction(cap.organization, (tx) =>
    settleModelRequestInTransaction(tx, cap, requestId, model, usage, upstreamRejected, providerCostModel),
  );
}

/** Compose model accounting with Run completion without opening a nested
 * transaction. Native callers keep the wrapper and their own Run lifecycle. */
export async function settleModelRequestInTransaction(
  tx: Tx,
  cap: RuntimeCapability,
  requestId: string,
  model: Model,
  usage: Usage,
  upstreamRejected = false,
  providerCostModel?: Model,
): Promise<ModelBillingReceipt | undefined> {
  await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
  const request = (
    await tx.query<GatewaySettlementRequest>(
      'SELECT * FROM gateway_requests WHERE id=$1 AND run_id=$2 FOR UPDATE',
      [requestId, cap.run],
    )
  ).rows[0];
  if (!request) return undefined;
  if (request.status !== 'in_flight') {
    assert(
      request.actual_micro_usd !== null,
      503,
      'billing_unavailable',
      'The settled model cost is unavailable.',
    );
    const prior = (
      await tx.query<{
        input_tokens: string | null;
        output_tokens: string | null;
        usage_details: Partial<ModelBillingReceipt>;
      }>('SELECT input_tokens,output_tokens,usage_details FROM model_usage WHERE request_id=$1', [requestId])
    ).rows[0];
    const details = prior?.usage_details;
    return {
      charged_micro_usd: request.billing_mode === 'managed' ? request.actual_micro_usd : '0',
      budget_cost_micro_usd: request.actual_micro_usd,
      reserved_micro_usd: request.reserved_micro_usd,
      billing_mode: request.billing_mode,
      reported_micro_usd: details?.reported_micro_usd ?? null,
      provisional: details?.provisional ?? request.status === 'unknown',
      bound_breached: details?.bound_breached ?? false,
      provider_cost_micro_usd: details?.provider_cost_micro_usd ?? null,
      provider_cost_status: details?.provider_cost_status ?? 'unavailable',
      provider_reported_cost_usd: details?.provider_reported_cost_usd ?? null,
      provider_reported_cost_status: details?.provider_reported_cost_status ?? 'unavailable',
      upstream_inference_cost_usd: details?.upstream_inference_cost_usd ?? null,
      upstream_rejected: details?.upstream_rejected ?? false,
      input_tokens: prior?.input_tokens === null || !prior ? null : Number(prior.input_tokens),
      output_tokens: prior?.output_tokens === null || !prior ? null : Number(prior.output_tokens),
      cached_tokens: details?.cached_tokens ?? 0,
      cache_write_tokens: details?.cache_write_tokens ?? 0,
      retail_rate_card: model,
      provider_cost_rate_card: providerCostModel,
      input_micro_usd_per_million: model.input_micro_usd_per_million,
      output_micro_usd_per_million: model.output_micro_usd_per_million,
    };
  }
  // Provider-reported cost is observability, independent of token completeness,
  // reservations and the retail rate estimate used for customer settlement.
  const reportedCost = {
    provider_reported_cost_usd: usage.providerReportedCostUsd ?? null,
    provider_reported_cost_status:
      usage.providerReportedCostUsd === undefined ? ('unavailable' as const) : ('reported' as const),
    upstream_inference_cost_usd: usage.upstreamInferenceCostUsd ?? null,
  };
  if (
    ![usage.input, usage.output, usage.cached, usage.cacheWrite].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    usage = emptyUsage();
  const reported = upstreamRejected
    ? 0n
    : usage.complete
      ? costForUsage(model, usage)
      : BigInt(request.reserved_micro_usd);
  const breached = reported > BigInt(request.reserved_micro_usd);
  // Never transfer an underestimated provider bill onto a customer's authorized ceiling.
  const actual = breached ? BigInt(request.reserved_micro_usd) : reported;
  if (breached) {
    await tx.query(
      `INSERT INTO provider_circuit_breakers(key,reason) VALUES($1,'usage_bound_exceeded') ON CONFLICT(key) DO UPDATE SET last_seen_at=now(),occurrences=provider_circuit_breakers.occurrences+1,resolved_at=NULL`,
      [`model:${model.provider}:${model.id}`],
    );
    await tx.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [cap.run]);
    await emit(tx, cap.organization, cap.run, 'metering.review_required', {
      request_id: requestId,
      charged_micro_usd: actual.toString(),
      reported_micro_usd: reported.toString(),
    });
  }
  await tx.query('UPDATE gateway_requests SET status=$2,actual_micro_usd=$3,completed_at=now() WHERE id=$1', [
    requestId,
    usage.complete || upstreamRejected ? 'complete' : 'unknown',
    actual.toString(),
  ]);
  await tx.query(
    'UPDATE runs SET model_reserved_micro_usd=model_reserved_micro_usd-$2::bigint,budget_used_micro_usd=budget_used_micro_usd+$3::bigint,cost_micro_usd=cost_micro_usd+$4::bigint WHERE id=$1',
    [
      cap.run,
      request.reserved_micro_usd,
      actual.toString(),
      request.billing_mode === 'managed' ? actual.toString() : '0',
    ],
  );
  await tx.query(
    'INSERT INTO model_usage(id,organization_id,run_id,request_id,provider,model,billing_mode,input_tokens,output_tokens,cost_micro_usd,completeness,usage_details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(request_id) DO NOTHING',
    [
      id(),
      cap.organization,
      cap.run,
      requestId,
      model.provider,
      model.id,
      request.billing_mode,
      upstreamRejected ? 0 : usage.complete || usage.known?.input ? usage.input : null,
      upstreamRejected ? 0 : usage.complete || usage.known?.output ? usage.output : null,
      actual.toString(),
      usage.complete || upstreamRejected ? 'complete' : 'missing',
      JSON.stringify({
        ...reportedCost,
        cached_tokens: usage.cached,
        cache_write_tokens: usage.cacheWrite,
        provisional: !usage.complete && !upstreamRejected,
        upstream_rejected: upstreamRejected,
        ...(providerCostModel
          ? {
              provider_cost_micro_usd: upstreamRejected
                ? '0'
                : usage.complete
                  ? costForUsage(providerCostModel, usage).toString()
                  : null,
              provider_cost_status:
                usage.complete || upstreamRejected ? 'estimated_from_usage' : 'unavailable',
            }
          : {}),
        reported_micro_usd: reported.toString(),
        bound_breached: breached,
      }),
    ],
  );
  await emit(tx, cap.organization, cap.run, 'usage.updated', {
    request_id: requestId,
    cost_micro_usd: actual.toString(),
    billing_mode: request.billing_mode,
    complete: usage.complete || upstreamRejected,
  });
  const billing: ModelBillingReceipt = {
    ...reportedCost,
    charged_micro_usd: request.billing_mode === 'managed' ? actual.toString() : '0',
    budget_cost_micro_usd: actual.toString(),
    reserved_micro_usd: String(request.reserved_micro_usd),
    billing_mode: request.billing_mode,
    reported_micro_usd: reported.toString(),
    provisional: !usage.complete && !upstreamRejected,
    bound_breached: breached,
    provider_cost_micro_usd:
      providerCostModel && (usage.complete || upstreamRejected)
        ? upstreamRejected
          ? '0'
          : costForUsage(providerCostModel, usage).toString()
        : null,
    provider_cost_status:
      providerCostModel && (usage.complete || upstreamRejected) ? 'estimated_from_usage' : 'unavailable',
    upstream_rejected: upstreamRejected,
    input_tokens: upstreamRejected ? 0 : usage.complete || usage.known?.input ? usage.input : null,
    output_tokens: upstreamRejected ? 0 : usage.complete || usage.known?.output ? usage.output : null,
    cached_tokens: usage.cached,
    cache_write_tokens: usage.cacheWrite,
    retail_rate_card: model,
    provider_cost_rate_card: providerCostModel,
    input_micro_usd_per_million: model.input_micro_usd_per_million,
    output_micro_usd_per_million: model.output_micro_usd_per_million,
  };
  return billing;
}
export async function settleOrphanModelRequests(org: string, runId: string) {
  const requests = await transaction(
    org,
    async (tx) =>
      (await tx.query("SELECT * FROM gateway_requests WHERE run_id=$1 AND status='in_flight'", [runId])).rows,
  );
  for (const request of requests) {
    const run = await transaction(org, (tx) => getRun(tx, runId));
    const model = run.config.rate_card;
    assert(model, 503, 'rate_card_unavailable', 'The run rate card is unavailable for reconciliation.');
    const cap: RuntimeCapability = {
      purpose: 'runtime',
      organization: org,
      run: runId,
      lease: String(request.lease_generation),
      expires: Date.now(),
    };
    await recordModelFailure(cap, request.id);
    await settleModelRequest(cap, request.id, model, emptyUsage());
  }
}
export async function handleModelRequest(
  request: Request,
  runId: string,
  path: string,
  transport: typeof fetch = fetch,
) {
  const requestId = id();
  try {
    assert(
      realExecutionEnabled(),
      503,
      'paid_execution_disabled',
      'Paid model requests are disabled in this environment.',
    );
    const cap = verifyRuntime(request, runId);
    if (path === modelTransport.uploadPath) return await prepareModelUpload(request, cap);
    assert(request.method === 'POST', 405, 'method_not_allowed', 'Only model POST endpoints are supported.');
    const text = (await readModelBody(request, cap, path)).toString();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text);
    } catch {
      assert(false, 400, 'invalid_json', 'The model request is not valid JSON.');
    }
    assert(
      payload && typeof payload === 'object' && !Array.isArray(payload),
      400,
      'invalid_request',
      'The model request must be an object.',
    );
    assert(
      !payload.previous_response_id && !payload.conversation,
      400,
      'unmetered_context',
      'Send explicit conversation context so its token budget can be authorized.',
    );
    assert(
      payload.n === undefined || payload.n === 1,
      400,
      'unmetered_completions',
      'Only one completion per request is supported.',
    );
    const admission = await reserveRequest(cap, payload, path);
    const startedAt = new Date();
    const capture = admission.traceContext ? new ModelOutputCapture() : undefined;
    let output: unknown;
    let billing: Awaited<ReturnType<typeof settleModelRequest>>;
    let level: TraceObservation['level'] = 'DEFAULT';
    let providerRequestId: string | null = null;
    const failRequest = async () => {
      level = 'ERROR';
      if (admission.metered) await recordModelFailure(cap, admission.requestId);
    };
    const settleRequest = async (upstreamRejected = false) => {
      if (admission.metered)
        billing = await settleModelRequest(
          cap,
          admission.requestId,
          admission.model,
          usage,
          upstreamRejected,
        );
    };
    const finishTrace = () => {
      if (!admission.traceContext) return;
      recordTrace({
        context: admission.traceContext,
        id: admission.requestId,
        name: admission.metered ? 'model.generate' : 'model.count_tokens',
        type: admission.metered ? 'generation' : 'event',
        startedAt,
        endedAt: new Date(),
        model: admission.model.id,
        input: payload,
        output: output ?? capture?.result(),
        usage,
        chargedMicroUsd: billing?.charged_micro_usd,
        firstOutputAt: capture?.firstOutputAt,
        level,
        metadata: {
          request_id: admission.requestId,
          provider_request_id: providerRequestId,
          endpoint: path,
          streaming: Boolean(payload.stream),
          usage_complete: usage.complete,
          ...billing,
        },
      });
    };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(280000, admission.deadline.getTime() - Date.now())),
    );
    let ownsStream = false,
      usage = emptyUsage(),
      rejected = false;
    try {
      const headers = admission.protocol.headers(admission.secret, request.headers);
      const upstream = await transport(admission.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.any([controller.signal, request.signal]),
        redirect: 'error',
      });
      // A declared client rejection has no generation; server/timeout failures
      // can have incurred usage and retain the normal provisional liability.
      rejected = upstream.status >= 400 && upstream.status < 500 && upstream.status !== 408;
      providerRequestId = upstream.headers.get('x-request-id') || upstream.headers.get('request-id');
      if (!upstream.ok) {
        level = 'ERROR';
        output = { error: 'provider_rejected', http_status: upstream.status };
        await failRequest();
        await upstream.body?.cancel().catch(() => {});
        await settleRequest(rejected);
        return Response.json(
          {
            error: {
              type: 'provider_error',
              message:
                'The model provider rejected this request. Check credentials, model access, and provider quota.',
            },
          },
          { status: upstream.status },
        );
      }
      if (!payload.stream) {
        const data = JSON.parse(
          (await boundedBody(upstream.body, modelResponseMaximumBytes)).toString(),
        ) as Record<string, unknown>;
        usage = admission.protocol.usage(data, usage);
        output = data;
        assert(
          !modelResponseFailed(data),
          502,
          'model_provider_error',
          'The provider reported a model failure.',
        );
        if (typeof data.id === 'string') providerRequestId ||= data.id;
        await settleRequest();
        return Response.json(data);
      }
      const reader = upstream.body!.getReader();
      ownsStream = true;
      const decoder = new TextDecoder();
      const observer = observeModelStream(path, (frame) => {
        usage = admission.protocol.usage(frame, usage);
        capture?.add(frame);
        const responseId =
          (frame.response as { id?: unknown } | undefined)?.id ??
          (frame.message as { id?: unknown } | undefined)?.id ??
          frame.id;
        if (typeof responseId === 'string') providerRequestId ||= responseId;
      });
      let total = 0;
      let emptyChunks = 0;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(downstream) {
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              assert(
                !controller.signal.aborted,
                504,
                'model_stream_timeout',
                'Model stream exceeded its deadline.',
              );
              emptyChunks = part.value.byteLength ? 0 : emptyChunks + 1;
              assert(
                emptyChunks < 16,
                502,
                'model_stream_not_progressing',
                'Model stream did not make progress.',
              );
              total += part.value.length;
              assert(
                total <= modelResponseMaximumBytes,
                413,
                'response_too_large',
                'Model output exceeded the stream limit.',
              );
              observer.feed(decoder.decode(part.value, { stream: true }));
              if (!closed) downstream.enqueue(part.value);
            }
            observer.feed(decoder.decode());
            assert(
              !controller.signal.aborted && !request.signal.aborted && !closed,
              502,
              'model_stream_interrupted',
              'The model stream was interrupted.',
            );
            observer.finish();
            await settleRequest();
            if (!closed) {
              closed = true;
              downstream.close();
            }
          } catch (error) {
            level = 'ERROR';
            controller.abort();
            try {
              await failRequest();
              await settleRequest();
            } catch {
              // Keep the in-flight reservation for reconciliation if the
              // durable fence cannot commit. Settlement must not erase it.
            }
            if (!closed) {
              closed = true;
              downstream.error(new Error('Model stream interrupted'));
            }
          } finally {
            clearTimeout(timeout);
            finishTrace();
          }
        },
        cancel() {
          closed = true;
          controller.abort();
          // Aborting can already have errored the upstream reader. The read loop
          // owns settlement; a cleanup rejection must not escape that lifecycle.
          return reader.cancel().catch(() => {});
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Request-Id': admission.requestId,
        },
      });
    } catch (error) {
      level = 'ERROR';
      clearTimeout(timeout);
      await failRequest();
      await settleRequest(rejected).catch(() => {});
      throw error;
    } finally {
      if (!ownsStream) {
        clearTimeout(timeout);
        finishTrace();
      }
    }
  } catch (error) {
    const result = errorBody(error, requestId);
    return Response.json(result.body, { status: result.status });
  }
}
