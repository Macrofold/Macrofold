import { z } from 'zod';
import { safeFetch } from './network';
import { AppError, assert } from '../../core/src/errors';
import { boundedJSON } from '../../core/src/body';
import type { WebSearchProvider, SearchHit } from '../../core/src/search';
import type { SearchProviderId } from '../../contracts/search';

const source = z.object({
  title: z.string().nullish(),
  url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
});
const snippet = source.extend({ description: z.string().nullish() });
const highlights = source.extend({ highlights: z.array(z.string()).nullish() });
const content = source.extend({ content: z.string().nullish() });
const excerpts = source.extend({ excerpts: z.array(z.string()).nullish() });
function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data);
  assert(parsed.success, 502, 'search_invalid_response', 'The search provider returned an invalid response.');
  return parsed.data;
}
function hit(row: z.infer<typeof source>, text: string = ''): SearchHit {
  return { title: row.title || row.url, url: row.url, description: text.slice(0, 4000) };
}
type RequestInput = { query: string; count: number };
type Adapter = {
  request(input: RequestInput, key: string): { url: string | URL; init: RequestInit };
  results(data: unknown): SearchHit[];
};
const post = (url: string, headers: Record<string, string>, body: unknown) => ({
  url,
  init: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  },
});
// Fixed endpoints and explicit options prevent tool input from choosing destinations or paid add-ons.
// Public API references and the reviewed request modes are indexed in the web-search feature doc.
const adapters: Record<SearchProviderId, Adapter> = {
  brave: {
    request({ query, count }, key) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(count));
      url.searchParams.set('safesearch', 'moderate');
      return { url, init: { headers: { 'X-Subscription-Token': key } } };
    },
    results(data) {
      const result = parse(z.object({ web: z.object({ results: z.array(snippet) }).optional() }), data);
      // Brave omits the web section for a valid search with no web results.
      return (result.web?.results || []).map((row) => hit(row, row.description || ''));
    },
  },
  exa: {
    request: ({ query, count }, key) =>
      post(
        'https://api.exa.ai/search',
        { 'x-api-key': key },
        {
          query,
          type: 'auto',
          numResults: count,
          contents: { highlights: true },
        },
      ),
    results: (data) =>
      parse(z.object({ results: z.array(highlights) }), data).results.map((row) =>
        hit(row, row.highlights?.join('\n')),
      ),
  },
  tavily: {
    request: ({ query, count }, key) =>
      post(
        'https://api.tavily.com/search',
        { Authorization: `Bearer ${key}` },
        {
          query,
          max_results: count,
          search_depth: 'basic',
          topic: 'general',
          auto_parameters: false,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        },
      ),
    results: (data) =>
      parse(z.object({ results: z.array(content) }), data).results.map((row) => hit(row, row.content || '')),
  },
  parallel: {
    request: ({ query, count }, key) =>
      post(
        'https://api.parallel.ai/v1/search',
        { 'x-api-key': key },
        {
          search_queries: [query],
          mode: 'basic',
          max_chars_total: count * 4000,
        },
      ),
    // V1 has no max_results parameter. Bound excerpt volume upstream and slice result count below.
    results: (data) =>
      parse(z.object({ results: z.array(excerpts) }), data).results.map((row) =>
        hit(row, row.excerpts?.join('\n')),
      ),
  },
  firecrawl: {
    request: ({ query, count }, key) =>
      post(
        'https://api.firecrawl.dev/v2/search',
        { Authorization: `Bearer ${key}` },
        {
          query,
          limit: count,
          sources: ['web'],
          timeout: 15000,
        },
      ),
    // Omitting scrapeOptions requests search snippets without triggering page scraping.
    results: (data) =>
      parse(
        z.object({ success: z.literal(true), data: z.object({ web: z.array(snippet) }) }),
        data,
      ).data.web.map((row) => hit(row, row.description || '')),
  },
};

export function searchProvider(
  provider: SearchProviderId,
  transport: typeof fetch = safeFetch,
): WebSearchProvider {
  return {
    async search(input, key, signal) {
      const adapter = adapters[provider];
      const request = adapter.request(input, key);
      const timeout = AbortSignal.timeout(provider === 'brave' ? 15000 : 30000);
      const boundedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        boundedSignal.throwIfAborted();
        // No automatic retries: even a timed-out search may have consumed provider credits.
        const response = await transport(request.url, {
          ...request.init,
          headers: { Accept: 'application/json', ...request.init.headers },
          signal: boundedSignal,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(
            502,
            'search_failed',
            'The search provider rejected the request. Check your search credentials and quota.',
          );
        }
        return adapter.results(await boundedJSON(response, 2 * 1024 * 1024)).slice(0, input.count);
      } catch (error) {
        if (boundedSignal.aborted)
          throw new AppError(
            504,
            'search_timeout',
            'Search was interrupted or exceeded its time limit. It may have consumed provider credits.',
          );
        if (error instanceof AppError) throw error;
        throw new AppError(
          502,
          'search_failed',
          'The search provider could not be reached. It may have consumed provider credits.',
        );
      }
    },
  };
}
