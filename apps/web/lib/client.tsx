'use client';
import { QueryClient, QueryClientProvider, useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import type { components } from '../../../packages/contracts/api';
export type Schema = components['schemas'];
export type Page<T> = { data: T[]; next_cursor: string | null };
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId?: string,
    public status?: number,
    public idempotencyKey?: string,
  ) {
    super(message);
  }
}
// An explicit retry of an unchanged action must recover a possibly committed
// mutation. Keep only opaque hashes and keys, never request bodies or credentials.
const uncertainMutations = new Map<string, string>();
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const payload =
    body === undefined
      ? undefined
      : headers['Content-Type'] === 'application/octet-stream'
        ? (body as string)
        : JSON.stringify(body);
  const mutation = !['GET', 'HEAD'].includes(method);
  const recoverable = mutation && (path.startsWith('/v1/') || path.startsWith('/admin/v1/'));
  const fingerprint = recoverable
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify([method, path, payload, headers])),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('')
    : '';
  const idempotencyKey = mutation
    ? headers['Idempotency-Key'] || uncertainMutations.get(fingerprint) || crypto.randomUUID()
    : undefined;
  function rememberUncertain() {
    if (fingerprint && idempotencyKey) {
      if (uncertainMutations.size >= 100 && !uncertainMutations.has(fingerprint))
        uncertainMutations.delete(uncertainMutations.keys().next().value!);
      uncertainMutations.set(fingerprint, idempotencyKey);
    }
  }
  function uncertain(status?: number): never {
    rememberUncertain();
    throw new ApiError(
      mutation
        ? `We couldn’t confirm whether this action completed. ${recoverable ? 'Retry the unchanged action to recover its result safely.' : 'Refresh this view to check its state before trying again.'} Recovery key: ${idempotencyKey}`
        : 'The connection was interrupted. Please try again.',
      'connection_interrupted',
      undefined,
      status,
      idempotencyKey,
    );
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Client-Type': 'dashboard',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...headers,
      },
      body: payload,
    });
  } catch {
    return uncertain();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status >= 500) rememberUncertain();
    throw new ApiError(
      data.error?.message || data.message || `Request failed (${response.status})`,
      data.error?.code || 'request_failed',
      data.error?.request_id,
      response.status,
      idempotencyKey,
    );
  }
  let result: T;
  try {
    result = (response.status === 204 ? undefined : await response.json()) as T;
  } catch {
    return uncertain(response.status);
  }
  // A different concurrent action can become uncertain while this one succeeds.
  // Only clear the recovery identity that this response actually confirms.
  if (fingerprint && uncertainMutations.get(fingerprint) === idempotencyKey)
    uncertainMutations.delete(fingerprint);
  return result;
}
export function useApi<T>(path: string | undefined, interval?: number | false) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: Boolean(path),
    refetchInterval: interval,
    retry: 1,
  });
}
/** Cursor pages remain explicit: opening a selector never downloads an entire account. */
export function usePages<T>(
  path: string | undefined,
  interval?: number | false,
  field: 'data' | 'entries' = 'data',
) {
  const result = useInfiniteQuery({
    queryKey: [path, 'pages'],
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      const url = new URL(path!, window.location.origin);
      if (pageParam) url.searchParams.set('cursor', pageParam);
      const page = await api<Record<string, unknown> & { next_cursor: string | null }>(
        url.pathname + url.search,
      );
      return { data: page[field] as T[], next_cursor: page.next_cursor };
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: Boolean(path),
    refetchInterval: interval,
    retry: 1,
  });
  return {
    ...result,
    data: result.data
      ? {
          data: result.data.pages.flatMap((page) => page.data),
          next_cursor: result.data.pages.at(-1)!.next_cursor,
        }
      : undefined,
  };
}
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15000, refetchOnWindowFocus: true } } }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
export const money = (micro: string | number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    Number(micro || 0) / 1000000,
  );
export function relative(value: string) {
  const seconds = (Date.now() - Date.parse(value)) / 1000;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
