'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, type Schema } from './client';
import { dataKey, request } from './dashboard-data';

/** Every consumer of eligibility uses the same cache invalidation boundary. */
export function accessQuery(key: readonly unknown[]) {
  const path = String(key[0]);
  return ['/v1/connections', '/v1/connection-access', '/v1/projects', '/v1/agents', '/v1/sessions'].some(
    (prefix) => path.startsWith(prefix),
  );
}
export function useConnectionAccess(connectionId: string) {
  const client = useQueryClient();
  const params = { path: { connection_id: connectionId } };
  const key = dataKey({ operation: 'getConnectionAccess', params });
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request('getConnectionAccess', { params, signal }),
    // An older in-flight GET cannot roll back a confirmed mutation revision.
    structuralSharing: (old, next) => {
      const previous = old as Schema['ConnectionAccess'] | undefined;
      const incoming = next as Schema['ConnectionAccess'];
      return previous && BigInt(previous.version) > BigInt(incoming.version) ? previous : incoming;
    },
  });
  const [base, setBase] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function beginDraft() {
    setBase((value) => value ?? query.data?.version);
  }
  async function mutate(action: (version: string) => Promise<{ version: string }>) {
    const version = base ?? query.data?.version;
    if (!version || busy) return false;
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      const result = await action(`"${version}"`);
      client.setQueryData<Schema['ConnectionAccess']>(key, (current) => current && { ...current, ...result });
      setBase(undefined);
      await client.invalidateQueries({ predicate: (entry) => accessQuery(entry.queryKey) });
      return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 412) {
        const latest = await query.refetch();
        setBase(latest.data?.version);
        setError(
          'Access changed in another view. Your draft is preserved. Review the current settings below, then save again to apply your draft.',
        );
      } else setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    ...query,
    busy,
    errorMessage: error,
    beginDraft,
    cancelDraft: () => {
      setBase(undefined);
      setError('');
    },
    patch: (body: Schema['ConnectionAccessPatch']) =>
      mutate((version) =>
        request('updateConnectionAccess', { params: { ...params, header: { 'If-Match': version } }, body }),
      ),
    saveRule: (body: Schema['ConnectionAccessRuleInput'], ruleId?: string) =>
      mutate((version) =>
        ruleId
          ? request('updateConnectionAccessRule', {
              params: { path: { ...params.path, rule_id: ruleId }, header: { 'If-Match': version } },
              body,
            })
          : request('createConnectionAccessRule', {
              params: { ...params, header: { 'If-Match': version } },
              body,
            }),
      ),
    deleteRule: (ruleId: string) =>
      mutate((version) =>
        request('deleteConnectionAccessRule', {
          params: { path: { ...params.path, rule_id: ruleId }, header: { 'If-Match': version } },
        }),
      ),
  };
}
