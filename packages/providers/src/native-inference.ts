import { z } from 'zod';
import type { DecisionRequest } from '../../core/src/decision';
import { assert } from '../../core/src/errors';
import { requireClientTools } from './model-protocols';
import { openRouterPriceCeiling } from './openrouter-pricing';

/** Preserve provider payloads; only execution identity and metered liability are platform-owned. */
export function nativeInferenceBody(request: DecisionRequest, provider: 'anthropic' | 'typesafe' | 'openrouter', decisions = false) {
  assert(request.input && typeof request.input === 'object' && !Array.isArray(request.input),
    400, 'invalid_request', 'Provider input must be a request object.');
  const body = structuredClone(z.record(z.string(), z.unknown()).parse(request.input));
  assert(body.model === undefined || body.model === request.model,
    400, 'model_not_authorized', 'The request model must match model_binding.');
  assert(!body.stream && !body.background,
    400, 'unsupported_transport', 'Inference currently returns a completed response; streaming and provider-background delivery are not supported.');
  body.model = request.model;
  if (!decisions) {
    assert(body.service_tier == null || body.service_tier === 'default',
      400, 'unsupported_billing', 'Non-default service tiers require corresponding billing rates.');
    assert(body.speed == null || body.speed === 'standard',
      400, 'unsupported_billing', 'Accelerated service requires corresponding billing rates.');
    assert(body.modalities === undefined || (Array.isArray(body.modalities) && body.modalities.every(value => value === 'text')),
      400, 'unsupported_billing', 'Generated audio and images require corresponding billing rates.');
    requireClientTools(body, provider, 'v1/chat/completions');
    const copies = body.n ?? 1;
    assert(typeof copies === 'number' && Number.isSafeInteger(copies) && copies > 0,
      400, 'invalid_request', 'n must be a positive integer.');
    const allowance = Math.floor(request.maxOutputTokens / copies);
    assert(allowance > 0, 400, 'output_limit_exceeded', 'Increase the aggregate output-token limit for the requested number of completions.');
    const requested = body.max_completion_tokens ?? body.max_tokens ?? allowance;
    for (const tokens of [requested, body.max_tokens, body.max_completion_tokens].filter(value => value !== undefined))
      assert(typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens > 0 && tokens <= allowance,
        400, 'output_limit_exceeded', 'Requested completion tokens exceed the aggregate output-token limit.');
    if (provider === 'anthropic' || body.max_completion_tokens === undefined) body.max_tokens = requested;
    else body.max_completion_tokens = requested;
  }
  if (provider === 'openrouter') {
    assert(body.models == null || (Array.isArray(body.models) && body.models.length === 0),
      400, 'model_not_authorized', 'Fallback models require separately authorized billing rates.');
    assert(body.provider == null || (typeof body.provider === 'object' && !Array.isArray(body.provider)),
      400, 'invalid_request', 'Provider preferences must be an object.');
    body.provider = {
      ...body.provider as Record<string, unknown> | undefined,
      ...request.modelParameters?.provider,
      allow_fallbacks: false,
      max_price: openRouterPriceCeiling(request.rates),
    };
  }
  if (request.modelParameters?.reasoning) body.reasoning = request.modelParameters.reasoning;
  return body;
}
