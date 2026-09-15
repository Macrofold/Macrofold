'use client';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Schema } from '../lib/client';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { ErrorState, Field, Loading, More, Select } from './ui';

type Grant = Schema['Grant'];
export type RunAccessChoice = { selection?: Grant[]; overrides: Grant[] };
function replaceTools(grants: Grant[], id: string, tools: string[]) {
  return [
    ...grants.filter((grant) => grant.connection_id !== id),
    ...(tools.length ? [{ connection_id: id, tools }] : []),
  ];
}
function ToolOptions({
  connection,
  selected,
  onChange,
  disabled = false,
}: {
  connection: Schema['ContextualConnection'];
  selected: string[];
  onChange: (tools: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <details className="run-tool-connection">
      <summary>
        {connection.name} <span className="muted">· {selected.length} selected</span>
      </summary>
      <div className="tool-selection">
        {!connection.approved_tools?.length && <p>No tools approved yet.</p>}
        {connection.approved_tools?.map((tool) => (
          <label key={tool}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(tool)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...selected, tool] : selected.filter((name) => name !== tool),
                )
              }
            />
            <span>{tool}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
/** Selection is a preference, never a permission grant. Omission retains inheritance. */
export function ConnectionSelection({
  value,
  onChange,
  label = 'Tool selection',
  disabled = false,
}: {
  value?: Grant[];
  onChange: (value: Grant[] | undefined) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [emptyMode, setEmptyMode] = useState('none');
  const mode = value === undefined ? 'inherit' : value.length ? 'select' : emptyMode;
  const connections = useDataPages(mode === 'select' ? { operation: 'listConnections' } : undefined);
  return (
    <fieldset className="run-tools" disabled={disabled}>
      <legend>{label}</legend>
      <Field label="Selection mode">
        <Select
          value={mode}
          disabled={disabled}
          onValueChange={(next) => {
            setEmptyMode(next === 'select' ? 'select' : 'none');
            onChange(next === 'inherit' ? undefined : []);
          }}
          options={[
            { value: 'inherit', label: 'Inherit available tools' },
            { value: 'select', label: 'Select specific tools' },
            { value: 'none', label: 'No tools' },
          ]}
        />
      </Field>
      <p className="form-hint">
        Selections can only use tools allowed by current access rules and run permissions.
      </p>
      {mode === 'select' &&
        (connections.isPending ? (
          <Loading />
        ) : connections.error ? (
          <ErrorState error={connections.error} />
        ) : (
          <>
            {connections.data?.data
              .filter((connection) => connection.approved_tools !== undefined)
              .map((connection) => (
                <ToolOptions
                  key={connection.id}
                  connection={connection}
                  selected={value?.find((grant) => grant.connection_id === connection.id)?.tools || []}
                  onChange={(tools) => onChange(replaceTools(value || [], connection.id, tools))}
                />
              ))}
            <More query={connections} label="More tool connections" />
          </>
        ))}
    </fieldset>
  );
}
export function RunAccess({
  context,
  value,
  onChange,
  onPendingChange,
}: {
  context: Schema['ConnectionAccessResolve'];
  value: RunAccessChoice;
  onChange: (value: RunAccessChoice) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const identity = useData({ operation: 'getIdentity' });
  const canOverride =
    identity.data?.effective_scopes.includes('connections:write') &&
    identity.data.effective_scopes.includes('runs:write');
  const connections = useDataPages(
    exceptionsOpen && canOverride ? { operation: 'listConnections' } : undefined,
  );
  const body = {
    ...context,
    ...(value.selection !== undefined ? { connection_grants: value.selection } : {}),
    ...(value.overrides.length ? { connection_access_overrides: value.overrides } : {}),
  };
  const preview = useConnectionAccess(body);
  async function selectException(connectionId: string, tools: string[]) {
    if (selecting) return;
    const signal = lifetime.current?.signal;
    setSelecting(true);
    onPendingChange(true);
    setSelectionError('');
    try {
      // An exception must be part of the submitted selection, including when a
      // preset saves "no tools". Preserve all inherited pages, not just the UI page.
      let selection = value.selection;
      if (selection === undefined) {
        selection = [];
        let cursor: string | undefined;
        do {
          const page = await request('resolveConnectionAccess', {
            body,
            params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } },
            signal,
          });
          selection.push(
            ...page.data
              .filter((item) => item.tools.length)
              .map((item) => ({ connection_id: item.connection_id, tools: item.tools })),
          );
          if (selection.length > 100)
            throw new Error('Select specific connections before adding a one-run exception.');
          cursor = page.next_cursor || undefined;
        } while (cursor);
      }
      if (signal?.aborted) return;
      const selected = selection.find((grant) => grant.connection_id === connectionId)?.tools || [];
      onChange({
        selection: replaceTools(selection, connectionId, [...new Set([...selected, ...tools])]),
        overrides: replaceTools(value.overrides, connectionId, tools),
      });
    } catch (error) {
      if (!signal?.aborted) setSelectionError((error as Error).message);
    } finally {
      setSelecting(false);
      onPendingChange(false);
    }
  }
  return (
    <>
      <ConnectionSelection
        value={value.selection}
        onChange={(selection) => onChange({ ...value, selection })}
        label="Tools for this run"
        disabled={selecting}
      />
      {canOverride && (
        <details className="run-tools" onToggle={(event) => setExceptionsOpen(event.currentTarget.open)}>
          <summary>Allow for this run only</summary>
          <p className="form-hint">
            Allow approved tools from your own connections for this run. This does not change saved
            permissions or future runs.
          </p>
          {selectionError && <p role="alert">{selectionError}</p>}
          {exceptionsOpen &&
            (connections.isPending ? (
              <Loading />
            ) : connections.error ? (
              <ErrorState error={connections.error} />
            ) : (
              <>
                {connections.data?.data
                  .filter(
                    (connection) =>
                      connection.owner_subject_id === identity.data?.user_id &&
                      connection.approved_tools !== undefined,
                  )
                  .map((connection) => (
                    <ToolOptions
                      key={connection.id}
                      connection={connection}
                      disabled={selecting}
                      selected={
                        value.overrides.find((grant) => grant.connection_id === connection.id)?.tools || []
                      }
                      onChange={(tools) => void selectException(connection.id, tools)}
                    />
                  ))}
                <More query={connections} label="More owned connections" />
              </>
            ))}
        </details>
      )}
      <section aria-label="Connection access preview">
        <h3>Access preview</h3>
        <p className="form-hint">Checked again when the run starts and before every tool call.</p>
        {preview.isPending ? (
          <Loading label="Checking access…" />
        ) : preview.error ? (
          <ErrorState error={preview.error} retry={() => void preview.refetch()} />
        ) : (
          <>
            {!preview.data?.pages.some((page) => page.data.length) && (
              <p>No eligible tools in this context.</p>
            )}
            {preview.data?.pages
              .flatMap((page) => page.data)
              .map((item) => (
                <div className="run-tool-connection" key={item.connection_id}>
                  <strong>{item.name}</strong>
                  <p>
                    {item.tools.length} tools · {item.source.replaceAll('_', ' ')}
                  </p>
                  {item.rejection_codes.length > 0 && (
                    <p className="form-hint">
                      {item.rejection_codes.map((code) => code.replaceAll('_', ' ')).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            <More query={preview} label="More access results" />
          </>
        )}
      </section>
    </>
  );
}

/** Shared read-only preview; authority is always checked again at admission. */
export function useConnectionAccess(body: Schema['ConnectionAccessResolve'] | undefined) {
  return useInfiniteQuery({
    queryKey: ['/v1/connection-access/resolve', body],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      request('resolveConnectionAccess', {
        body: body!,
        params: { query: { ...(pageParam ? { cursor: pageParam } : {}) } },
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled: Boolean(body),
    retry: 1,
  });
}
