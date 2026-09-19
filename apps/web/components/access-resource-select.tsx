'use client';
import { useEffect, useState } from 'react';
import { ApiError } from '../lib/client';
import { useData, useDataPages } from '../lib/dashboard-data';
import { ErrorState, Field, More, Select } from './ui';

/** Search is server-side and all cursor pages remain reachable in every selector. */
export function AccessResourceSelect({
  kind,
  value,
  onChange,
  label,
  optional = true,
  disabled = false,
  emptyLabel,
  activeOnly = false,
  onUnavailable,
}: {
  kind: 'workspace' | 'agent';
  value: string;
  onChange: (id: string) => void;
  label: string;
  optional?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  activeOnly?: boolean;
  onUnavailable?: () => void;
}) {
  const [search, setSearch] = useState('');
  const query = useDataPages(
    kind === 'workspace'
      ? {
          operation: 'listWorkspaces',
          params: { query: { query: search, ...(activeOnly ? { archived: false } : {}) } },
        }
      : { operation: 'listAgents', params: { query: { query: search } } },
  );
  const selected = useData(
    value
      ? kind === 'workspace'
        ? { operation: 'getWorkspace', params: { path: { workspace_id: value } } }
        : { operation: 'getAgent', params: { path: { agent_id: value } } }
      : undefined,
  );
  useEffect(() => {
    if (value && selected.error instanceof ApiError && [400, 403, 404].includes(selected.error.status ?? 0))
      onUnavailable?.();
  }, [value, selected.error, onUnavailable]);
  const options = query.data?.data.map((item) => ({ value: item.id, label: item.name })) || [];
  if (value && !options.some((option) => option.value === value))
    options.unshift({ value, label: selected.data?.name || 'Unavailable selection' });
  return (
    <div>
      <Field label={`Search ${label.toLowerCase()}`}>
        <input
          type="search"
          disabled={disabled}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${kind === 'agent' ? 'presets' : 'workspaces'}…`}
        />
      </Field>
      <Field label={label}>
        <Select
          disabled={disabled}
          value={value}
          onValueChange={onChange}
          required={!optional}
          options={[
            {
              value: '',
              label:
                emptyLabel ?? (optional ? `All ${kind === 'agent' ? 'presets' : 'workspaces'}` : 'Choose…'),
              disabled: !optional,
            },
            ...options,
          ]}
        />
      </Field>
      {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
      <More query={query} label={`More ${kind === 'agent' ? 'presets' : 'workspaces'}`} />
    </div>
  );
}
