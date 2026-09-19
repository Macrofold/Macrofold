'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Client,
  requestPath,
  requestMethod,
  type RequestMethod,
  type Operation,
  type RequestOptions,
  type Result,
} from 'macrofold';
import { api } from './client';

type ReadOperation = { [K in Operation]: RequestMethod<K> extends 'GET' ? K : never }[Operation];
type JsonRead = Exclude<ReadOperation, 'readFile' | 'streamRun'>;
type ListOperation = {
  [K in JsonRead]: Result<K> extends { next_cursor: string | null } ? K : never;
}[JsonRead];
type Item<K extends ListOperation> =
  Result<K> extends { data: (infer T)[] } ? T : Result<K> extends { entries: (infer T)[] } ? T : never;
export type DataQuery<K extends JsonRead> = { operation: K; params?: RequestOptions<K>['params'] };

/** Public operations infer inputs and outputs from OpenAPI. The dashboard transport
 * retains its recovery key after an uncertain mutation; queries share one cache. */
export function request<K extends Exclude<Operation, 'readFile' | 'streamRun'>>(
  operation: K,
  options: RequestOptions<K> = {},
): Promise<Result<K>> {
  const headers = {
    ...(operation === 'writeFile' ? { 'Content-Type': 'application/octet-stream' } : {}),
    ...options.headers,
    ...options.params?.header,
    ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
  } as Record<string, string>;
  return api<Result<K>>(
    requestPath(operation, options.params),
    requestMethod(operation),
    options.body,
    headers,
    options.signal,
  );
}

/** URL keys are generated, not hand-built. This also keeps the existing SSE
 * invalidation and organization-switch cache clearing on the same cache entries. */
export function dataKey<K extends JsonRead>(query: DataQuery<K>) {
  return [requestPath(query.operation, query.params)] as const;
}
export function useData<K extends JsonRead>(query: DataQuery<K> | undefined, interval?: number | false) {
  return useQuery({
    queryKey: query ? dataKey(query) : ['disabled'],
    queryFn: ({ signal }) => request(query!.operation, { params: query!.params, signal }),
    enabled: Boolean(query),
    refetchInterval: interval,
    retry: 1,
  });
}
export function useDataPages<K extends ListOperation>(
  query: DataQuery<K> | undefined,
  interval?: number | false,
) {
  const result = useInfiniteQuery({
    queryKey: query ? [...dataKey(query), 'pages'] : ['disabled', 'pages'],
    initialPageParam: '',
    queryFn: async ({ pageParam, signal }) => {
      const options = {
        params: {
          ...query!.params,
          query: { ...query!.params?.query, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        signal,
      } as RequestOptions<K>;
      // Every ListOperation has this cursor envelope, with one of the two public
      // collection fields. Keep the structural narrowing at this shared boundary.
      const response = await request(query!.operation, options);
      const page = response as unknown as {
        data?: Item<K>[];
        entries?: Item<K>[];
        next_cursor: string | null;
      };
      return { data: page.data ?? page.entries ?? [], next_cursor: page.next_cursor, response };
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: Boolean(query),
    refetchInterval: interval,
    retry: 1,
  });
  return {
    ...result,
    page: result.data?.pages[0]?.response,
    data: result.data
      ? {
          data: result.data.pages.flatMap((page) => page.data),
          next_cursor: result.data.pages.at(-1)!.next_cursor,
        }
      : undefined,
  };
}

/** Content and ETag are read together; a buffer never borrows a newer tree revision. */
export async function readDocument(worktreeId: string, path: string, signal: AbortSignal) {
  const client = new Client({
    baseURL: window.location.origin,
    sessionAuth: true,
    clientType: 'dashboard',
    retries: 0,
  });
  const response = await client.raw('readFile', {
    params: { path: { worktree_id: worktreeId }, query: { path } },
    signal,
  });
  return { text: await response.text(), revision: (response.headers.get('etag') ?? '').replaceAll('"', '') };
}
