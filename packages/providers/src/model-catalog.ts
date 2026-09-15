import { z } from 'zod';
import { boundedJSON } from '../../core/src/body';
import { discoveredModelsSchema, type DiscoveredModel } from '../../core/src/model-policy';
import type { ModelCatalogSource } from '../../core/src/model-catalog';

const pageSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().optional(),
        display_name: z.string().optional(),
        context_length: z.number().int().positive().nullish(),
        top_provider: z.object({
          context_length: z.number().int().positive().nullish(),
          max_completion_tokens: z.number().int().positive().nullish(),
        }).nullish(),
        pricing: z.record(z.string(), z.unknown()).optional(),
        supported_parameters: z.array(z.string()).optional(),
        architecture: z
          .object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) })
          .optional(),
      }),
    )
    .max(10000),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});

/** Fixed metadata endpoints only: no inference, customer keys, retries, or redirects. */
export function providerModelCatalog(transport: typeof fetch = fetch): ModelCatalogSource {
  return async (provider) => {
    const key = process.env[`${provider.toUpperCase()}_API_KEY`];
    if (provider !== 'openrouter' && !key) return undefined;
    const base =
      provider === 'openai'
        ? 'https://api.openai.com/v1/models'
        : provider === 'anthropic'
          ? 'https://api.anthropic.com/v1/models?limit=1000'
          : 'https://openrouter.ai/api/v1/models';
    const headers: Record<string, string> =
      provider === 'anthropic'
        ? { 'x-api-key': key || '', 'anthropic-version': '2023-06-01' }
        : provider === 'openai'
          ? { Authorization: `Bearer ${key}` }
          : {};
    const signal = AbortSignal.timeout(15000);
    const entries: DiscoveredModel[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const url = new URL(base);
      if (cursor) url.searchParams.set('after_id', cursor);
      const response = await transport(url, { headers, signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Model discovery failed.');
      }
      const page = pageSchema.parse(await boundedJSON(response, 8 * 1024 * 1024));
      entries.push(
        ...page.data.map((entry) => ({
          id: entry.id,
          name: entry.display_name || entry.name || entry.id,
          ...(provider === 'openrouter'
            ? {
                pricing: entry.pricing,
                context_tokens: entry.context_length && entry.top_provider?.context_length
                  ? Math.min(entry.context_length, entry.top_provider.context_length)
                  : entry.context_length || undefined,
                output_tokens: entry.top_provider?.max_completion_tokens || undefined,
                tools: entry.supported_parameters?.includes('tools') || false,
                text:
                  entry.architecture?.input_modalities.includes('text') === true &&
                  entry.architecture.output_modalities.length === 1 &&
                  entry.architecture.output_modalities[0] === 'text',
              }
            : {}),
        })),
      );
      if (entries.length > 10000 || Buffer.byteLength(JSON.stringify(entries)) > 8 * 1024 * 1024)
        throw new Error('Model discovery exceeds its limit.');
      cursor = page.has_more ? page.last_id || undefined : undefined;
      if (page.has_more && (provider !== 'anthropic' || !cursor || seen.has(cursor) || seen.size >= 9))
        throw new Error('Model discovery pagination did not finish.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return discoveredModelsSchema.parse(entries);
  };
}
