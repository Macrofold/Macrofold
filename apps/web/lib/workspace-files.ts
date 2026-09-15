'use client';

import { useQueries, type QueryClient } from '@tanstack/react-query';
import { dataKey, request, type DataQuery } from './dashboard-data';
import { useState } from 'react';
import { type Schema } from './client';

export function parentDirectory(path: string) {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash < 0 ? '' : path.slice(0, lastSlash);
}

export function ancestorDirectories(path: string) {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** Each expanded folder owns bounded cursor pages; opening the explorer never
 * downloads the complete workspace. Existing dashboard signals refresh these URLs. */
export function useDirectoryListings(workspaceId: string, directories: ReadonlySet<string>) {
  const [cursors, setCursors] = useState<Record<string, string[]>>({});
  const requests = [...directories].flatMap((path) =>
    ['', ...(cursors[path] ?? [])].map((cursor) => ({
      path,
      query: {
        operation: 'listFiles',
        params: {
          path: { workspace_id: workspaceId },
          query: { path, recursive: false, limit: 100, ...(cursor ? { cursor } : {}) },
        },
      } satisfies DataQuery<'listFiles'>,
    })),
  );
  const queries = useQueries({
    queries: requests.map(({ query }) => ({
      queryKey: dataKey(query),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(query.operation, { params: query.params, signal }),
      retry: 1,
    })),
  });
  const results = new Map<
    string,
    {
      entries: Schema['FileEntry'][];
      loading: boolean;
      error: Error | null;
      nextCursor: string | null;
    }
  >();
  requests.forEach((request, index) => {
    const query = queries[index];
    const previous = results.get(request.path);
    const entries = [...(previous?.entries ?? []), ...(query.data?.entries ?? [])];
    results.set(request.path, {
      entries: [...new Map(entries.map((entry) => [entry.path, entry])).values()],
      loading: Boolean(previous?.loading || query.isPending),
      error: previous?.error ?? query.error,
      nextCursor: query.data?.next_cursor ?? null,
    });
  });
  return {
    results,
    loadMore(path: string) {
      const cursor = results.get(path)?.nextCursor;
      if (cursor)
        setCursors((previous) => ({
          ...previous,
          [path]: [...new Set([...(previous[path] ?? []), cursor])],
        }));
    },
    retry(path: string) {
      requests.forEach((request, index) => {
        if (request.path === path) void queries[index].refetch();
      });
    },
  };
}

/** Seed only confirmed changes. Refetches remain scoped and never make a successful
 * file action wait for unrelated billing, run, or account requests. */
export async function publishFileMutation(
  client: QueryClient,
  workspaceId: string,
  operation: Schema['Operation'],
) {
  const result = operation.result;
  if (operation.status !== 'succeeded' || !result?.revision || !result.path)
    throw new Error('Unable to confirm the saved revision. Reload the file before retrying.');
  const revision = result.revision;
  const path = result.path;
  const prefix = `/v1/workspaces/${workspaceId}`;
  const listingQuery = (key: readonly unknown[]) =>
    typeof key[0] === 'string' && key[0].startsWith(`${prefix}/files?`);
  await client.cancelQueries({ predicate: (query) => listingQuery(query.queryKey) });
  client.setQueryData<Schema['Workspace']>(
    [prefix],
    (previous) =>
      previous && {
        ...previous,
        revision,
        ...(result.checkpoint_id ? { latest_checkpoint_id: result.checkpoint_id } : {}),
      },
  );
  for (const query of client
    .getQueryCache()
    .findAll({ predicate: (value) => listingQuery(value.queryKey) })) {
    const url = new URL(String(query.queryKey[0]), 'http://workspace.invalid');
    if (url.searchParams.get('recursive') !== 'false') continue;
    const directory = url.searchParams.get('path') ?? '';
    const entry = result.entry;
    const additions: Schema['FileEntry'][] = [];
    if (entry) {
      if (parentDirectory(entry.path) === directory) additions.push(entry);
      for (const path of ancestorDirectories(entry.path)) {
        if (parentDirectory(path) === directory) additions.push({ path, type: 'directory', revision });
      }
    }
    client.setQueryData<Schema['FileListing']>(query.queryKey, (previous) => {
      if (!previous) return previous;
      const entries = previous.entries.filter(
        (item) => item.path !== result.previous_path && (item.path !== result.path || Boolean(entry)),
      );
      // New entries go on the first page only; pagination remains explicit.
      if (!url.searchParams.has('cursor')) entries.push(...additions);
      return {
        ...previous,
        revision,
        entries: [...new Map(entries.map((item) => [item.path, item])).values()],
      };
    });
  }
  void client.invalidateQueries({
    predicate: (query) => {
      const path = query.queryKey[0];
      return typeof path === 'string' && path.startsWith(prefix) && !listingQuery(query.queryKey);
    },
  });
  // Keep seeded listings immediately usable while the server reconciles them.
  void client.invalidateQueries({ predicate: (query) => listingQuery(query.queryKey) });
  return { ...result, revision, path };
}
