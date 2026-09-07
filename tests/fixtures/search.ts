import type { SearchProviderId } from '../../packages/contracts/search';

// Hand-authored public API examples; never obtained using customer credentials.
export const searchFixtures: {
  provider: SearchProviderId;
  url: string;
  header: string;
  credential: string;
  body?: Record<string, unknown>;
  response: (rows: Record<string, unknown>[]) => unknown;
  row: Record<string, unknown>;
}[] = [
  {
    provider: 'brave',
    url: 'https://api.search.brave.com/res/v1/web/search?q=docs+%26+typescript&count=2&safesearch=moderate',
    header: 'X-Subscription-Token',
    credential: 'fixture-search-key',
    response: (rows) => ({ web: { results: rows } }),
    row: { title: 'Source', url: 'https://example.com', description: 'First\nSecond' },
  },
  {
    provider: 'exa',
    url: 'https://api.exa.ai/search',
    header: 'x-api-key',
    credential: 'fixture-search-key',
    body: { query: 'docs & typescript', type: 'auto', numResults: 2, contents: { highlights: true } },
    response: (rows) => ({ results: rows, requestId: 'fixture-request' }),
    row: { title: 'Source', url: 'https://example.com', highlights: ['First', 'Second'] },
  },
  {
    provider: 'tavily',
    url: 'https://api.tavily.com/search',
    header: 'Authorization',
    credential: 'Bearer fixture-search-key',
    body: {
      query: 'docs & typescript',
      max_results: 2,
      search_depth: 'basic',
      topic: 'general',
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    },
    response: (rows) => ({ results: rows, query: 'docs & typescript', usage: { credits: 1 } }),
    row: { title: 'Source', url: 'https://example.com', content: 'First\nSecond', score: 0.9 },
  },
  {
    provider: 'parallel',
    url: 'https://api.parallel.ai/v1/search',
    header: 'x-api-key',
    credential: 'fixture-search-key',
    body: { search_queries: ['docs & typescript'], mode: 'basic', max_chars_total: 8000 },
    response: (rows) => ({ results: rows, search_id: 'fixture-search', session_id: 'fixture-session' }),
    row: { title: 'Source', url: 'https://example.com', excerpts: ['First', 'Second'] },
  },
  {
    provider: 'firecrawl',
    url: 'https://api.firecrawl.dev/v2/search',
    header: 'Authorization',
    credential: 'Bearer fixture-search-key',
    body: { query: 'docs & typescript', limit: 2, sources: ['web'], timeout: 15000 },
    response: (rows) => ({ success: true, data: { web: rows }, creditsUsed: 2 }),
    row: { title: 'Source', url: 'https://example.com', description: 'First\nSecond' },
  },
];
