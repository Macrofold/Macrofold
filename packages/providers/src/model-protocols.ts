import { assert } from '../../core/src/errors';
import type { ModelProtocol, ModelUsage } from '../../core/src/model-protocol';

function usageFromEvent(provider: string, event: Record<string, unknown>, previous: ModelUsage): ModelUsage {
  const next = { ...previous };
  if (provider === 'anthropic') next.input -= previous.cached + previous.cacheWrite;
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
  if (provider === 'anthropic') next.input += next.cached + next.cacheWrite;
  return next;
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
    // Codex discovers local tools through this client-executed Responses tool.
    // Missing/default execution selects the provider-hosted service and remains forbidden.
    if (tool.type === 'tool_search') return tool.execution === 'client';
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

function protocol(
  provider: 'openai' | 'anthropic' | 'openrouter',
  base: string,
  paths: readonly string[],
): ModelProtocol {
  return {
    base,
    paths,
    cacheWrites: provider === 'anthropic',
    prepare(payload, path, bounds) {
      requireClientTools(payload, provider, path);
      delete payload.background;
      delete payload.service_tier;
      delete payload.store;
      delete payload.speed;
      if (path.endsWith('responses')) {
        payload.background = false;
        payload.store = false;
      }
      if (provider === 'openrouter') {
        assert(
          payload.models === undefined || (Array.isArray(payload.models) && payload.models.length === 0),
          403,
          'model_not_authorized',
          'Model fallbacks are outside the run’s accepted configuration.',
        );
        delete payload.models;
        assert(
          payload.provider == null ||
            (typeof payload.provider === 'object' && !Array.isArray(payload.provider)),
          400,
          'invalid_request',
          'Provider preferences must be an object.',
        );
        // OpenRouter can route to differently priced providers. Its wire format uses
        // dollars/million tokens; reservations and settlement stay in integer micro-USD.
        payload.provider = {
          ...(payload.provider as Record<string, unknown> | undefined),
          max_price: {
            prompt: Number(bounds.inputMicroUsdPerMillion) / 1_000_000,
            completion: Number(bounds.outputMicroUsdPerMillion) / 1_000_000,
            request: 0,
          },
        };
      }
      if (path.endsWith('count_tokens')) return;
      if (path.endsWith('responses')) payload.max_output_tokens = bounds.maxOutput;
      else if (provider === 'anthropic') payload.max_tokens = bounds.maxOutput;
      else {
        delete payload.max_tokens;
        payload.max_completion_tokens = bounds.maxOutput;
        if (payload.stream) payload.stream_options = { include_usage: true };
      }
    },
    headers(secret, incoming) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider === 'anthropic') {
        headers['x-api-key'] = secret;
        headers['anthropic-version'] = '2023-06-01';
        const beta = incoming.get('anthropic-beta');
        if (beta) headers['anthropic-beta'] = beta;
      } else headers.Authorization = `Bearer ${secret}`;
      return headers;
    },
    usage: (event, previous) => usageFromEvent(provider, event, previous),
  };
}
const protocols: Readonly<Record<string, ModelProtocol>> = {
  openai: protocol('openai', 'https://api.openai.com', ['v1/responses', 'v1/chat/completions']),
  anthropic: protocol('anthropic', 'https://api.anthropic.com', ['v1/messages', 'v1/messages/count_tokens']),
  openrouter: protocol('openrouter', 'https://openrouter.ai/api', ['v1/chat/completions']),
};
export function modelProtocol(provider: string): ModelProtocol | undefined {
  return protocols[provider];
}
