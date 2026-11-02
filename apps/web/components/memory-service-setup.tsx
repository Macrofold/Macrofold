'use client';
import { useState } from 'react';
import Link from 'next/link';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { Button, ErrorState, Field, Loading, More, Select } from './ui';

export type MemoryServiceSetupValue = {
  connection_id: string;
  namespace: string;
  required: boolean;
  external_cost_acknowledged: boolean;
  namespace_is_dedicated: boolean;
};

export function MemoryServiceSetup({
  provider,
  value,
  onChange,
}: {
  provider: 'hindsight' | 'claude-mem';
  value: MemoryServiceSetupValue;
  onChange: (value: MemoryServiceSetupValue) => void;
}) {
  const identity = useData({ operation: 'getIdentity' });
  const connections = useDataPages({ operation: 'listConnections', params: { query: { limit: 100 } } });
  const [create, setCreate] = useState(false),
    [baseURL, setBaseURL] = useState(''),
    [key, setKey] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error>();
  const update = (next: Partial<MemoryServiceSetupValue>) => onChange({ ...value, ...next });
  const owned =
    connections.data?.data.filter(
      (item) =>
        item.kind === 'memory_service' &&
        item.provider === provider &&
        item.owner_subject_id === identity.data?.user_id,
    ) || [];
  return (
    <>
      <Field
        label="Memory service connection"
        hint="Your service API key stays encrypted in Connections. Macrofold does not host or bill this service."
      >
        <Select
          value={value.connection_id || '__none'}
          onValueChange={(connection_id) =>
            update({ connection_id: connection_id === '__none' ? '' : connection_id })
          }
          options={[
            { value: '__none', label: 'Choose your connection' },
            ...owned.map((item) => ({ value: item.id, label: `${item.name} · ${item.status}` })),
          ]}
        />
      </Field>
      {connections.isPending && <Loading label="Loading service connections…" />}
      {connections.error && <ErrorState error={connections.error} retry={() => void connections.refetch()} />}
      <More query={connections} label="Load more connections" />
      {identity.error && <ErrorState error={identity.error} retry={() => void identity.refetch()} />}
      {!create ? (
        <Button type="button" variant="ghost" onClick={() => setCreate(true)}>
          Add service connection
        </Button>
      ) : (
        <>
          <Field
            label="Service API base URL"
            hint="Use the server base URL, without /mcp, /v1 or a bank path."
          >
            <input
              type="url"
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
              placeholder="https://memory.example.com"
            />
          </Field>
          <Field label="Service bearer key">
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>
          {error && <ErrorState error={error} />}
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            disabled={!baseURL || !key}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const connection = await request('createConnection', {
                    body: {
                      name: `${provider === 'hindsight' ? 'Hindsight' : 'Claude-mem'} memory service`,
                      kind: 'memory_service',
                      provider,
                      auth_method: 'bearer',
                      url: baseURL,
                      secret: key,
                    },
                  });
                  setKey('');
                  await connections.refetch();
                  update({ connection_id: connection.id });
                  setCreate(false);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure : new Error('Could not save the service connection.'),
                  );
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Save connection
          </Button>
        </>
      )}
      <Field
        label={provider === 'hindsight' ? 'Dedicated memory bank' : 'Dedicated Claude-mem project ID'}
        hint={
          provider === 'hindsight'
            ? 'Macrofold initializes this bank during setup. Choose a new name after retiring an old collection.'
            : 'Ask the hosted server operator for an existing dedicated PostgreSQL project and its ID. Do not use another agent or customer’s project.'
        }
      >
        <input
          value={value.namespace}
          onChange={(event) => update({ namespace: event.target.value })}
          placeholder={provider === 'hindsight' ? 'mf-personal-agent' : 'Dedicated server project ID'}
          pattern="[A-Za-z0-9_-]+"
          maxLength={128}
        />
      </Field>
      <label>
        <input
          type="checkbox"
          checked={value.namespace_is_dedicated}
          onChange={(event) => update({ namespace_is_dedicated: event.target.checked })}
        />
        This collection is dedicated to this worktree; I authorize Macrofold to capture this recipe’s Run
        narratives and metadata, retrieve memories and manage it.
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.external_cost_acknowledged}
          onChange={(event) => update({ external_cost_acknowledged: event.target.checked })}
        />
        I understand this service can charge separately for generation, embeddings, reads and storage.
        Macrofold Run budgets do not cap those external charges.
      </label>
      <details>
        <summary>Advanced availability</summary>
        <label>
          <input
            type="checkbox"
            checked={value.required}
            onChange={(event) => update({ required: event.target.checked })}
          />
          Require memory before starting the agent.
        </label>
        <p>
          Optional memory can be unavailable without blocking the Run. Required memory fails before native
          execution when retrieval cannot be confirmed.
        </p>
      </details>
      <p className="form-hint">
        {provider === 'claude-mem'
          ? 'Captures terminal engineering narratives, including failed/cancelled attempts, and bounded committed tool-outcome metadata with known verified provenance. Raw arguments/results, reasoning and tool-effect claims are excluded.'
          : 'Captures successful final user/assistant conversation notes only.'}{' '}
        No history import, global harness plugin or provider compute resource is installed.{' '}
        <Link href="/docs/customer-agents/agent-library">Setup and lifecycle guide</Link>.
      </p>
    </>
  );
}
