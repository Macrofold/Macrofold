import { modelInputBound } from './model-content';
import { modelTransport } from '../../contracts/model-transport';
import { prepareModelUpload, readModelBody } from './model-request-upload';
import { transaction, afterCommit } from '../../db';
import { runTraceContext } from './run-tracing';
import { recordTrace, tracingEnabled } from './tracing';
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
  return transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const request = (await tx.query('SELECT * FROM gateway_requests WHERE id=$1 FOR UPDATE', [requestId]))
      .rows[0];
    if (!request) return undefined;
    if (request.status !== 'in_flight') {
      const prior = (
        await tx.query<{ usage_details: Record<string, unknown> }>(
          'SELECT usage_details FROM model_usage WHERE request_id=$1',
          [requestId],
        )
      ).rows[0];
      return {
        charged_micro_usd: request.billing_mode === 'managed' ? String(request.actual_micro_usd) : '0',
        budget_cost_micro_usd: String(request.actual_micro_usd),
        reserved_micro_usd: String(request.reserved_micro_usd),
        billing_mode: String(request.billing_mode),
        retail_rate_card: model,
        provider_cost_rate_card: providerCostModel,
        ...(prior?.usage_details || {}),
      };
    }
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
    await tx.query(
      'UPDATE gateway_requests SET status=$2,actual_micro_usd=$3,completed_at=now() WHERE id=$1',
      [requestId, usage.complete || upstreamRejected ? 'complete' : 'unknown', actual.toString()],
    );
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
        upstreamRejected ? 0 : usage.complete ? usage.input : null,
        upstreamRejected ? 0 : usage.complete ? usage.output : null,
        actual.toString(),
        usage.complete || upstreamRejected ? 'complete' : 'missing',
        JSON.stringify({
          cached_tokens: usage.cached,
          cache_write_tokens: usage.cacheWrite,
          provisional: !usage.complete && !upstreamRejected,
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
    const billing = {
      charged_micro_usd: request.billing_mode === 'managed' ? actual.toString() : '0',
      budget_cost_micro_usd: actual.toString(),
      reserved_micro_usd: String(request.reserved_micro_usd),
      billing_mode: String(request.billing_mode),
      reported_micro_usd: reported.toString(),
      provisional: !usage.complete && !upstreamRejected,
      bound_breached: breached,
      provider_cost_micro_usd:
        providerCostModel && usage.complete ? costForUsage(providerCostModel, usage).toString() : null,
      provider_cost_status: providerCostModel && usage.complete ? 'estimated_from_usage' : 'unavailable',
      upstream_rejected: upstreamRejected,
      input_tokens: upstreamRejected ? 0 : usage.complete ? usage.input : null,
      output_tokens: upstreamRejected ? 0 : usage.complete ? usage.output : null,
      cached_tokens: usage.cached,
      cache_write_tokens: usage.cacheWrite,
      retail_rate_card: model,
      provider_cost_rate_card: providerCostModel,
      input_micro_usd_per_million: model.input_micro_usd_per_million,
      output_micro_usd_per_million: model.output_micro_usd_per_million,
    };
    const context = tracingEnabled() ? await runTraceContext(tx, await getRun(tx, cap.run)) : undefined;
    if (context)
      afterCommit(tx, () =>
        recordTrace({
          context,
          id: `billing:${requestId}`,
          name: 'billing.model',
          type: 'event',
          startedAt: new Date(),
          endedAt: new Date(),
          metadata: { request_id: requestId, ...billing },
        }),
      );
    return billing;
  });
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
    await settleModelRequest(
      {
        purpose: 'runtime',
        organization: org,
        run: runId,
        lease: String(request.lease_generation),
        expires: Date.now(),
      },
      request.id,
      model,
      emptyUsage(),
    );
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
      rejected = !upstream.ok;
      providerRequestId = upstream.headers.get('x-request-id') || upstream.headers.get('request-id');
      if (!upstream.ok) {
        level = 'ERROR';
        output = { error: 'provider_rejected', http_status: upstream.status };
        await upstream.body?.cancel();
        await settleRequest(true);
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
        const data = JSON.parse((await boundedBody(upstream.body, 32 * 1024 * 1024)).toString()) as Record<
          string,
          unknown
        >;
        usage = admission.protocol.usage(data, usage);
        output = data;
        if (typeof data.id === 'string') providerRequestId ||= data.id;
        await settleRequest();
        return Response.json(data);
      }
      const reader = upstream.body!.getReader();
      ownsStream = true;
      const decoder = new TextDecoder();
      let buffer = '';
      let total = 0;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(downstream) {
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              total += part.value.length;
              assert(
                total < 32 * 1024 * 1024,
                413,
                'response_too_large',
                'Model output exceeded the stream limit.',
              );
              buffer += decoder.decode(part.value, { stream: true });
              let newline;
              while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line.startsWith('data:') && line.slice(5).trim() !== '[DONE]') {
                  try {
                    const frame = JSON.parse(line.slice(5));
                    usage = admission.protocol.usage(frame, usage);
                    capture?.add(frame);
                    const responseId = frame?.response?.id ?? frame?.message?.id ?? frame?.id;
                    if (typeof responseId === 'string') providerRequestId ||= responseId;
                  } catch {
                    /* SSE keepalives and non-JSON control frames are not usage. */
                  }
                }
              }
              if (!closed) downstream.enqueue(part.value);
            }
            await settleRequest();
            if (!closed) {
              closed = true;
              downstream.close();
            }
          } catch (error) {
            level = 'ERROR';
            controller.abort();
            await settleRequest().catch(() => {});
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
          void reader.cancel();
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
