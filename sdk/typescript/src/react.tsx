'use client';
import { useState } from 'react';
import type { Schema } from './client.js';

/** Presentation only. Your authenticated backend owns customer identity and all SDK calls. */
export function ConnectionPermissions({
  capabilities,
  value,
  onChange,
  disabled = false,
}: {
  capabilities: Schema['ConnectionCapability'][];
  value: string[];
  onChange(value: string[]): void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="macrofold-permissions" disabled={disabled}>
      <legend>What can this agent do?</legend>
      <label>
        <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
        No access
      </label>
      {capabilities.map((capability) => (
        <div key={capability.id}>
          <label>
            <input
              type="checkbox"
              checked={value.includes(capability.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, capability.id]
                    : value.filter((id) => id !== capability.id),
                )
              }
            />
            {capability.label}
          </label>
          {capability.description && <p>{capability.description}</p>}
          <details>
            <summary>View permissions</summary>
            <ul>
              {capability.tools.map((tool) => (
                <li key={tool}>
                  <code>{tool}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </fieldset>
  );
}

/** Embed in your app. Callbacks go to your server; never pass a Macrofold API key here.
 * Refresh `value` after saving or disconnecting. Mount with key={connection.id}. */
export function CustomerConnectionCard({
  value,
  onAuthorize,
  onSave,
  onDisconnect,
}: {
  value: Schema['CustomerAgentConnection'];
  onAuthorize(): Promise<void>;
  onSave(capabilityIds: string[], version: string): Promise<void>;
  onDisconnect(): Promise<void>;
}) {
  const [draft, setDraft] = useState({
    selected: value.selected_capabilities,
    version: value.access_version,
  });
  // A draft is tied to the version the customer saw, so refreshes cannot silently overwrite revocation.
  const selected = draft.selected;
  function setSelected(selected: string[]) {
    setDraft({ ...draft, selected });
  }
  const stale = draft.version !== value.access_version;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this connection. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="macrofold-connection" aria-label={value.connection.name} aria-busy={busy}>
      <h3>{value.connection.name}</h3>
      <p>{value.connection.status === 'healthy' ? 'Connected' : 'Connection needed'}</p>
      <ConnectionPermissions
        capabilities={value.capabilities}
        value={selected}
        onChange={setSelected}
        disabled={busy}
      />
      {error && <p role="alert">{error}</p>}
      {stale && (
        <p role="status">
          Permissions changed.{' '}
          <button
            type="button"
            onClick={() => setDraft({ selected: value.selected_capabilities, version: value.access_version })}
          >
            Load current permissions
          </button>
        </p>
      )}
      <div className="macrofold-connection-actions">
        <button type="button" disabled={busy} onClick={() => void perform(onAuthorize)}>
          {value.connection.status === 'healthy' ? 'Reconnect' : 'Connect account'}
        </button>
        <button
          type="button"
          disabled={busy || stale || (value.connection.status !== 'healthy' && selected.length > 0)}
          onClick={() => void perform(() => onSave(selected, draft.version))}
        >
          Save permissions
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirm(true)}>
          Disconnect
        </button>
      </div>
      {confirm && (
        <div role="group" aria-label="Confirm disconnect">
          <p>Disconnect this account and remove the agent’s access?</p>
          <button type="button" disabled={busy} onClick={() => void perform(onDisconnect)}>
            Disconnect account
          </button>
          <button type="button" onClick={() => setConfirm(false)}>
            Keep connection
          </button>
        </div>
      )}
    </section>
  );
}
