import { transaction } from '../../db';
import { config, isLocal } from './config';
import { assert, errorBody } from './errors';
import { id, unseal } from './crypto';
import { getRun } from './runs';
import { verifyRuntime, type RuntimeCapability } from './runtime-auth';
import { models, type Model } from './catalog';
import * as resources from './resources';
import { emit } from './events';
import { requireRunActor } from './actor-authorization';
import { boundedBody } from './body';

const endpoints = {
  openai: { base: 'https://api.openai.com', paths: ['v1/responses', 'v1/chat/completions'] },
  anthropic: { base: 'https://api.anthropic.com', paths: ['v1/messages', 'v1/messages/count_tokens'] },
  openrouter: { base: 'https://openrouter.ai/api', paths: ['v1/chat/completions'] },
} as const;
type Usage = { input: number; output: number; cached: number; cacheWrite: number; complete: boolean };
const emptyUsage = (): Usage => ({ input: 0, output: 0, cached: 0, cacheWrite: 0, complete: false });
export function usageFromEvent(provider: string, event: Record<string, unknown>, previous: Usage): Usage {
  const next = { ...previous };
  if (provider === 'anthropic') {
    const message = event.message as { usage?: Record<string, number> } | undefined;
    const usage = (event.usage || message?.usage) as Record<string, number> | undefined;
    if (usage) {
      if (usage.input_tokens !== undefined) next.input = usage.input_tokens;
      if (usage.output_tokens !== undefined) next.output = usage.output_tokens;
      if (usage.cache_read_input_tokens !== undefined) next.cached = usage.cache_read_input_tokens;
      if (usage.cache_creation_input_tokens !== undefined)
        next.cacheWrite = usage.cache_creation_input_tokens;
    }
    if (event.type === 'message_stop' || (event.type === 'message' && usage)) next.complete = true;
  } else {
    const response = event.response as { usage?: Record<string, unknown> } | undefined;
    const usage = (event.usage || response?.usage) as Record<string, unknown> | undefined;
    if (usage) {
      next.input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
      next.output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
      next.cached = Number(
        (usage.input_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ||
          (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ||
          0,
      );
      next.complete = true;
    }
  }
  return next;
}
function roundedCost(tokens: number, rate: string) {
  return (BigInt(Math.max(0, Math.ceil(tokens))) * BigInt(rate) + 999999n) / 1000000n;
}
export function costForUsage(model: Model, usage: Usage) {
  // Published retail rates remain stable for the run; cache writes conservatively use 2× input.
  const input =
    model.provider === 'anthropic' ? usage.input + usage.cacheWrite * 2 + usage.cached : usage.input;
  return (
    roundedCost(input, model.input_micro_usd_per_million) +
    roundedCost(usage.output, model.output_micro_usd_per_million)
  );
}
function rejectUnmeteredContent(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const part of value) rejectUnmeteredContent(part);
    return;
  }
  const object = value as Record<string, unknown>;
  if (typeof object.type === 'string')
    assert(
      !/image|audio|video|file|web_search|computer_use/.test(object.type),
      400,
      'unsupported_model_content',
      'This metered route accepts text and client-executed tools. Use the platform tool broker for external services.',
    );
  for (const field of ['image_url', 'input_audio', 'audio', 'file_id', 'file_data'])
    assert(
      !(field in object),
      400,
      'unsupported_model_content',
      'Multimodal model content requires a configured rate-aware route.',
    );
  for (const child of Object.values(object)) rejectUnmeteredContent(child);
}
/** Model-side tools can create separately billed containers, searches or connector actions.
 * Only reviewed client-executed forms belong on this text-token-metered route. Unknown
 * future tool types fail closed rather than bypassing the platform tool broker. */
function requireClientTools(payload: Record<string, unknown>, provider: string, path: string) {
  for (const field of ['mcp_servers', 'plugins', 'web_search_options', 'container']) {
    const value = payload[field];
    assert(
      value == null || (Array.isArray(value) && value.length === 0),
      400,
      'unsupported_model_content',
      'Hosted model tools require a separately metered route. Use the platform tool broker.',
    );
    // SDKs may serialize unused optional collections. Empty values enable no service
    // and can be omitted without forwarding another provider's configuration fields.
    delete payload[field];
  }
  if (payload.tools === undefined) return;
  assert(Array.isArray(payload.tools), 400, 'invalid_request', 'Model tools must be an array.');
  const clientTool = (value: unknown, nested = false): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const tool = value as Record<string, unknown>;
    if (provider === 'anthropic')
      return (
        tool.type === undefined ||
        [
          'custom',
          'bash_20250124',
          'text_editor_20250124',
          'text_editor_20250728',
          'memory_20250818',
        ].includes(String(tool.type))
      );
    if (!path.endsWith('responses')) return tool.type === 'function';
    if (tool.type === 'function' || tool.type === 'custom') return true;
    if (nested) return false;
    if (tool.type === 'namespace')
      return Array.isArray(tool.tools) && tool.tools.every((child) => clientTool(child, true));
    if (tool.type === 'shell')
      return (tool.environment as Record<string, unknown> | undefined)?.type === 'local';
    return tool.type === 'local_shell' || tool.type === 'apply_patch';
  };
  assert(
    payload.tools.every((tool) => clientTool(tool)),
    400,
    'unsupported_model_content',
    'This model route accepts client-executed tools only. Use the platform tool broker for hosted tools.',
  );
}
export function computeMaximum(timeoutSeconds: number) {
  return (BigInt(timeoutSeconds) * BigInt(process.env.COMPUTE_MICRO_USD_PER_MINUTE || '8000') + 59n) / 60n;
}
async function reserveRequest(cap: RuntimeCapability, payload: Record<string, unknown>, path: string) {
  return transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const run = await getRun(tx, cap.run);
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
    const model = run.config.rate_card || models().find((m) => m.id === run.config.model && m.enabled);
    assert(
      model && model.id === payload.model,
      403,
      'model_not_authorized',
      'This model is not authorized for the run.',
    );
    const endpoint = endpoints[model.provider as keyof typeof endpoints];
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
      endpoint && (endpoint.paths as readonly string[]).includes(path),
      403,
      'endpoint_not_authorized',
      'This model endpoint is not authorized.',
    );
    requireClientTools(payload, model.provider, path);
    let secret: string;
    if (run.config.billing_mode === 'byok') {
      const connection = await resources.get(tx, 'connections', run.config.provider_connection_id!);
      assert(
        connection.provider === model.provider &&
          connection.status === 'healthy' &&
          connection.owner_subject_id === run.config.user_id,
        403,
        'credentials_unavailable',
        'The BYOK connection is no longer available.',
      );
      secret = unseal<string>(String(connection.secret_ciphertext));
    } else {
      secret = process.env[`${model.provider.toUpperCase()}_API_KEY`] || '';
      assert(secret, 503, 'provider_not_configured', 'The managed model provider is not configured.');
    }
    const requestId = id();
    if (path.endsWith('count_tokens'))
      return {
        requestId,
        model,
        secret,
        url: `${endpoint.base}/${path}`,
        reserved: 0n,
        metered: false,
        deadline: run.deadline,
      };
    const maxOutput = Math.min(
      8192,
      Math.max(
        1,
        Number(payload.max_output_tokens || payload.max_completion_tokens || payload.max_tokens || 4096),
      ),
    );
    assert(Number.isInteger(maxOutput), 400, 'invalid_request', 'Maximum output tokens must be an integer.');
    if (path.endsWith('responses')) payload.max_output_tokens = maxOutput;
    else if (model.provider === 'anthropic') payload.max_tokens = maxOutput;
    else {
      delete payload.max_tokens;
      payload.max_completion_tokens = maxOutput;
      if (payload.stream) payload.stream_options = { include_usage: true };
    }
    // UTF-8 bytes are a conservative text token bound. Hosted tools, media, background
    // responses, and premium service tiers are rejected/disabled before authorization.
    const inputBound = Buffer.byteLength(JSON.stringify(payload)) + 1024;
    const reserved =
      roundedCost(inputBound * (model.provider === 'anthropic' ? 2 : 1), model.input_micro_usd_per_million) +
      roundedCost(maxOutput, model.output_micro_usd_per_million);
    const budget = (
      await tx.query('SELECT budget_used_micro_usd,model_reserved_micro_usd FROM runs WHERE id=$1', [cap.run])
    ).rows[0];
    const compute = computeMaximum(run.config.limits?.timeout_seconds || 900);
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
      model,
      secret,
      url: `${endpoint.base}/${path}`,
      reserved,
      metered: true,
      deadline: run.deadline,
    };
  });
}
async function settleRequest(
  cap: RuntimeCapability,
  requestId: string,
  model: Model,
  usage: Usage,
  upstreamRejected = false,
) {
  await transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const request = (await tx.query('SELECT * FROM gateway_requests WHERE id=$1 FOR UPDATE', [requestId]))
      .rows[0];
    if (!request || request.status !== 'in_flight') return;
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
        upstreamRejected
          ? 0
          : usage.complete
            ? usage.input + usage.cacheWrite + (model.provider === 'anthropic' ? usage.cached : 0)
            : null,
        upstreamRejected ? 0 : usage.complete ? usage.output : null,
        actual.toString(),
        usage.complete || upstreamRejected ? 'complete' : 'missing',
        JSON.stringify({
          cached_tokens: usage.cached,
          cache_write_tokens: usage.cacheWrite,
          provisional: !usage.complete && !upstreamRejected,
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
    const model = run.config.rate_card || models().find((m) => m.id === request.model);
    assert(model, 503, 'rate_card_unavailable', 'The run rate card is unavailable for reconciliation.');
    await settleRequest(
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
export async function handleModelRequest(request: Request, runId: string, path: string) {
  const requestId = id();
  try {
    assert(
      config.allowPaid && !isLocal(),
      503,
      'paid_execution_disabled',
      'Paid model requests are disabled in this environment.',
    );
    const cap = verifyRuntime(request, runId);
    assert(request.method === 'POST', 405, 'method_not_allowed', 'Only model POST endpoints are supported.');
    const text = (await boundedBody(request.body, 4 * 1024 * 1024)).toString();
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
    rejectUnmeteredContent(payload);
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
    delete payload.background;
    delete payload.service_tier;
    delete payload.store;
    delete payload.speed;
    if (path.endsWith('responses')) {
      payload.background = false;
      payload.store = false;
    }
    const admission = await reserveRequest(cap, payload, path);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(280000, admission.deadline.getTime() - Date.now())),
    );
    let ownsStream = false,
      usage = emptyUsage(),
      rejected = false;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (admission.model.provider === 'anthropic') {
        headers['x-api-key'] = admission.secret;
        headers['anthropic-version'] = '2023-06-01';
        const beta = request.headers.get('anthropic-beta');
        if (beta) headers['anthropic-beta'] = beta;
      } else headers.Authorization = `Bearer ${admission.secret}`;
      const upstream = await fetch(admission.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.any([controller.signal, request.signal]),
        redirect: 'error',
      });
      rejected = !upstream.ok;
      if (!upstream.ok) {
        await upstream.body?.cancel();
        if (admission.metered) await settleRequest(cap, admission.requestId, admission.model, usage, true);
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
        usage = usageFromEvent(admission.model.provider, data, usage);
        if (admission.metered) await settleRequest(cap, admission.requestId, admission.model, usage);
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
                    usage = usageFromEvent(admission.model.provider, JSON.parse(line.slice(5)), usage);
                  } catch {
                    /* SSE keepalives and non-JSON control frames are not usage. */
                  }
                }
              }
              if (!closed) downstream.enqueue(part.value);
            }
            if (admission.metered) await settleRequest(cap, admission.requestId, admission.model, usage);
            if (!closed) {
              closed = true;
              downstream.close();
            }
          } catch (error) {
            controller.abort();
            if (admission.metered)
              await settleRequest(cap, admission.requestId, admission.model, usage).catch(() => {});
            if (!closed) {
              closed = true;
              downstream.error(new Error('Model stream interrupted'));
            }
          } finally {
            clearTimeout(timeout);
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
      clearTimeout(timeout);
      if (admission.metered)
        await settleRequest(cap, admission.requestId, admission.model, usage, rejected).catch(() => {});
      throw error;
    } finally {
      if (!ownsStream) clearTimeout(timeout);
    }
  } catch (error) {
    const result = errorBody(error, requestId);
    return Response.json(result.body, { status: result.status });
  }
}
