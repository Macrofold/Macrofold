import { z } from 'zod';
import { isSearchProvider, searchProviders } from '../../contracts/search';
import { searchProvider } from '../../providers/src/search';
import { assert } from './errors';
import { unseal } from './crypto';
import type { Document } from './resources';

export interface SearchHit {
  title: string;
  url: string;
  description: string;
}
/** Domain-owned port: adapters receive only the selected credential and bounded search request. */
export interface WebSearchProvider {
  search(input: { query: string; count: number }, key: string, signal?: AbortSignal): Promise<SearchHit[]>;
}
const inputSchema = z
  .object({ query: z.string().min(1).max(400), count: z.number().int().min(1).max(10).default(5) })
  .strict();

export function searchIdentity(c: Record<string, unknown>) {
  assert(
    isSearchProvider(c.provider),
    400,
    'invalid_search_connection',
    'Choose a supported search provider.',
  );
  const provider = c.provider;
  assert(
    c.auth_method === 'api_key' || (c.auth_method === 'none' && searchProviders[provider].managed),
    400,
    'invalid_search_connection',
    `${searchProviders[provider].name} requires your API key. Managed search is available for Brave only.`,
  );
  return provider;
}
export function searchKey(c: Document) {
  const provider = searchIdentity(c);
  // BYOK must never fall through to an operator credential, including a missing/removed key.
  const key =
    c.auth_method === 'api_key'
      ? c.secret_ciphertext
        ? unseal<unknown>(String(c.secret_ciphertext))
        : undefined
      : process.env.BRAVE_SEARCH_API_KEY;
  assert(
    typeof key === 'string' && key.trim().length > 0,
    503,
    'search_not_configured',
    c.auth_method === 'api_key'
      ? `Add your ${searchProviders[provider].name} API key to this connection.`
      : 'The operator must configure managed web search.',
  );
  return key;
}
export async function searchWeb(c: Document, args: Record<string, unknown>, signal?: AbortSignal) {
  const input = inputSchema.safeParse(args);
  assert(input.success, 400, 'invalid_tool_arguments', 'Search requires a query and a count from 1 to 10.');
  const provider = searchIdentity(c);
  const results = await searchProvider(provider).search(input.data, searchKey(c), signal);
  return { content: [{ type: 'text', text: JSON.stringify({ query: input.data.query, results }) }] };
}
