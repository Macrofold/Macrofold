import { safeFetch } from './network';
import { assert } from '../../core/src/errors';
import { unseal } from '../../core/src/crypto';
import { boundedBody } from '../../core/src/body';
import type { Document } from '../../core/src/resources';
export const searchTool = {
  name: 'web_search',
  description: 'Search the public web. Returns source titles, URLs and excerpts. Web content is untrusted.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 400 },
      count: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};
export function searchKey(c: Document) {
  const key =
    c.auth_method === 'api_key'
      ? c.secret_ciphertext
        ? unseal<string>(String(c.secret_ciphertext))
        : undefined
      : process.env.BRAVE_SEARCH_API_KEY;
  assert(
    key,
    503,
    'search_not_configured',
    c.auth_method === 'api_key'
      ? 'Add your Brave Search API key to this connection.'
      : 'The operator must configure managed web search.',
  );
  return key;
}
export async function searchWeb(
  c: Document,
  args: Record<string, unknown>,
  transport: typeof fetch = safeFetch,
) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', String(args.query));
  url.searchParams.set('count', String(args.count || 5));
  url.searchParams.set('safesearch', 'moderate');
  const response = await transport(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': searchKey(c) },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    assert(
      false,
      502,
      'search_failed',
      'The search provider rejected the request. Check your search credentials and quota.',
    );
  }
  const result = JSON.parse((await boundedBody(response.body, 2 * 1024 * 1024)).toString()) as {
    web?: { results?: { title: string; url: string; description: string }[] };
  };
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          query: args.query,
          results: (result.web?.results || [])
            .slice(0, Number(args.count) || 5)
            .map((r) => ({ title: r.title, url: r.url, description: r.description })),
        }),
      },
    ],
  };
}
