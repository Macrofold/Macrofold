'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/dashboard-data';
import type { Schema } from '../lib/client';
import { Button, Field } from './ui';

export const hostingConnectionLabels = {
  runpod: 'RunPod account',
  hugging_face: 'Hugging Face account',
  external_model: 'External endpoint',
} as const;
export type HostingConnectionKind = keyof typeof hostingConnectionLabels;

/** Shared by deployment setup and Connections; these credentials never use app OAuth. */
export function ModelHostingConnectionForm({
  kind,
  onCreated,
  onCancel,
  onBusyChange,
}: {
  kind: HostingConnectionKind;
  onCreated: (connection: Schema['Connection']) => void;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(''),
    [secret, setSecret] = useState(''),
    [url, setUrl] = useState(''),
    [anonymous, setAnonymous] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const external = kind === 'external_model';
  const valid = !!name.trim() && (anonymous || !!secret) && (!external || !!url);
  async function save() {
    if (busy || !valid) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const connection = await request('createConnection', {
        body: {
          name: name.trim(),
          kind,
          provider: kind === 'hugging_face' ? 'hf' : kind === 'runpod' ? 'runpod' : 'external',
          auth_method: external ? (anonymous ? 'none' : 'bearer') : 'api_key',
          ...(external ? { url } : {}),
          ...(!anonymous ? { secret } : {}),
        },
      });
      setSecret('');
      // Refresh shared selectors before closing; a saved credential must be selectable immediately.
      await client.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/v1/connections'),
      });
      onCreated(connection);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The connection could not be confirmed. Refresh your connections before trying again.',
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div
      role="group"
      aria-label={`${hostingConnectionLabels[kind]} credentials`}
      onKeyDown={(event) => {
        // This also sits inside the deployment form: Enter saves the credential, not the deployment.
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <Field label="Connection name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          maxLength={120}
          disabled={busy}
        />
      </Field>
      {external && (
        <>
          <Field
            label="Endpoint base URL"
            hint="Use the exact reachable API base URL, usually ending in /v1. Cloud hosting cannot reach a laptop through localhost."
          >
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={anonymous}
              disabled={busy}
              onChange={(event) => {
                setAnonymous(event.target.checked);
                setSecret('');
              }}
            />{' '}
            Endpoint requires no authentication
          </label>
        </>
      )}
      {!anonymous && (
        <Field
          label={external ? 'Endpoint bearer token' : 'Account API token'}
          hint="Encrypted on the server. Never returned after creation."
        >
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
        </Field>
      )}
      <p className="form-hint">Adding a connection does not start compute or generate tokens.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel connection setup
          </Button>
        )}
        <Button type="button" busy={busy} disabled={!valid} onClick={() => void save()}>
          Save connection
        </Button>
      </div>
    </div>
  );
}
