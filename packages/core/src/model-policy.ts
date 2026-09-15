import { createHash } from 'node:crypto';
import { z } from 'zod';

export const modelProviders = ['openai', 'anthropic', 'openrouter'] as const;
export type ModelProvider = (typeof modelProviders)[number];
export type Model = {
  id: string;
  name: string;
  provider: string;
  harnesses: string[];
  input_micro_usd_per_million: string;
  output_micro_usd_per_million: string;
  enabled: boolean;
  simulated?: boolean;
};

// These are retail rules, not account entitlements. Review native compatibility and
// all billable dimensions before extending this list. No environment JSON is needed.
// Sources and the cache policy are documented in features/execution/models.md.
export const modelPolicy: Model[] = [
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    provider: 'openai',
    harnesses: ['codex', 'opencode', 'hermes', 'deepseek', 'pi'],
    input_micro_usd_per_million: '750000',
    output_micro_usd_per_million: '4500000',
    enabled: true,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    harnesses: ['claude-code', 'opencode'],
    input_micro_usd_per_million: '3000000',
    output_micro_usd_per_million: '15000000',
    enabled: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    harnesses: ['claude-code', 'opencode'],
    input_micro_usd_per_million: '1000000',
    output_micro_usd_per_million: '5000000',
    enabled: true,
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 mini via OpenRouter',
    provider: 'openrouter',
    harnesses: ['opencode', 'hermes', 'deepseek', 'pi'],
    input_micro_usd_per_million: '750000',
    output_micro_usd_per_million: '4500000',
    enabled: true,
  },
];

export const discoveredModelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  // Only OpenRouter publishes prices in discovery. Other providers use reviewed retail rules.
  pricing: z.record(z.string(), z.unknown()).optional(),
  tools: z.boolean().optional(),
  text: z.boolean().optional(),
  context_tokens: z.number().int().positive().optional(),
  output_tokens: z.number().int().positive().optional(),
});
export const discoveredModelsSchema = z
  .array(discoveredModelSchema)
  .max(10000)
  .refine(
    (models) => new Set(models.map((model) => model.id)).size === models.length,
    'Duplicate model identifiers',
  );
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;

/** USD/token to micro-USD/million tokens. Never round a fractional price downward. */
export function tokenPrice(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value || !/^\d{1,6}(?:\.\d{1,18})?$/.test(value)) return;
  const [whole, fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * 1_000_000_000_000n;
  const rate = (numerator + denominator - 1n) / denominator;
  if (rate > 999_999_999_999_999n) return;
  return rate.toString();
}

export function applyModelPolicy(provider: ModelProvider, discovered?: DiscoveredModel[]): Model[] {
  const reviewed = modelPolicy.filter((model) => model.provider === provider);
  // OpenRouter is one supported chat/tools protocol, not an adapter per model.
  // Discovery may add routes only where capabilities and every charge fit that protocol.
  // Routing aliases choose a different model at runtime and cannot freeze a model rate card.
  // Direct providers still need reviewed prices because discovery has no rate card.
  const rules = provider === 'openrouter' && discovered
    ? discovered.filter((entry) => !entry.id.startsWith('openrouter/')).map((entry): Model => reviewed.find((rule) => rule.id === entry.id) || {
        id: entry.id,
        name: entry.name,
        provider,
        harnesses: ['opencode', 'hermes', 'deepseek', 'pi'],
        input_micro_usd_per_million: '0',
        output_micro_usd_per_million: '0',
        enabled: true,
      })
    : reviewed;
  return rules
    .map((rule) => {
      const result = { ...rule, harnesses: [...rule.harnesses] };
      if (!discovered) return { ...result, enabled: result.enabled && provider !== 'openrouter' };
      const available = discovered.find((entry) => entry.id === rule.id);
      result.enabled = rule.enabled && !!available;
      if (available && provider === 'openrouter') {
        const input = tokenPrice(available.pricing?.prompt);
        const output = tokenPrice(available.pricing?.completion);
        // Reject unaccounted fees or pricing structures rather than treating them as zero.
        const safePrices =
          available.pricing &&
          Object.entries(available.pricing).every(([key, value]) => {
            if (key === 'prompt' || key === 'completion') return true;
            // Hosted search tools, plugins and web_search_options are rejected by the gateway.
            if (key === 'web_search') return tokenPrice(value) !== undefined;
            if (key === 'input_cache_read') {
              const cached = tokenPrice(value);
              return cached !== undefined && input !== undefined && BigInt(cached) <= BigInt(input);
            }
            return tokenPrice(value) === '0';
          });
        // These are the common limits configured by the chat/tools runtimes. Models
        // below that floor need per-model runtime limits before they can be admitted.
        const fitsRuntime = (available.context_tokens || 0) >= 128000 && (available.output_tokens || 0) >= 8192;
        result.enabled &&= !!(available.tools && available.text && fitsRuntime && input && output && safePrices);
        if (result.enabled && input !== undefined && output !== undefined) {
          result.input_micro_usd_per_million = input;
          result.output_micro_usd_per_million = output;
        }
      }
      return result;
    });
}

export function rateCardVersion(model: Model) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        model.provider,
        model.id,
        model.input_micro_usd_per_million,
        model.output_micro_usd_per_million,
        'cache-read=input;anthropic-cache-write=2x-input',
      ]),
    )
    .digest('hex')
    .slice(0, 20);
}
