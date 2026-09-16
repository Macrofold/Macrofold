'use client';
import { useEffect, useState } from 'react';
import { ConnectionPermissions } from 'macrofold/react';
import type { describeCustomerConsent } from '@platform/core/customer-connect';
import { BrandLockup } from './brand-lockup';
import { ProviderLogo, providerName } from './provider-logo';
import { ThemeControl } from './theme';
import { Button } from './ui';
import { WaitingText } from './waiting-text';

type Consent = Awaited<ReturnType<typeof describeCustomerConsent>>;
async function request<T>(body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/integrations/customer-connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message || 'Could not load the connection. Return to your app for a new link.',
    );
  return result;
}
export function CustomerConnect() {
  const [ticket, setTicket] = useState(''),
    [consent, setConsent] = useState<Consent>();
  const [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const value = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    if (!value) {
      setError('Open a connection link from your app to get started.');
      return;
    }
    setTicket(value);
    request<Consent>({ action: 'describe', ticket: value }, controller.signal)
      .then((result) => {
        setConsent(result);
        setSelected(result.selected_capabilities);
        // Retain the fragment until loaded so hydration/remounts are safe; never send it to a server log.
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ authorization_url: string }>({
        action: 'start',
        ticket,
        capability_ids: selected,
      });
      window.location.replace(result.authorization_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect. Return to your app to try again.');
      setBusy(false);
    }
  }
  return (
    <main className="customer-connect-site">
      <header>
        <a className="customer-connect-brand" href="/" aria-label="Macrofold home">
          <BrandLockup name="Macrofold" />
        </a>
        <ThemeControl />
      </header>
      <section className="customer-connect-panel">
        <p className="customer-connect-eyebrow">Account connection</p>
        {consent ? (
          <>
            <ProviderLogo provider={consent.provider} size={48} />
            <h1>
              Connect {providerName(consent.provider)} to {consent.name}
            </h1>
            <p>
              Choose what this agent can do with <strong>{consent.connection_name}</strong>. Then sign in to
              your account.
            </p>
            <ConnectionPermissions
              capabilities={consent.capabilities}
              value={selected}
              onChange={setSelected}
              disabled={busy}
            />
            <p className="customer-connect-note">
              Your account provider may request broader account permissions. The agent is limited to the tools
              you select here. You can change or revoke access in your app.
            </p>
            <p>
              You’ll return to <strong>{consent.return_host}</strong> to confirm your account.
            </p>
            <Button busy={busy} onClick={() => void connect()}>
              Continue to {providerName(consent.provider)}
            </Button>
          </>
        ) : !error ? (
          <p role="status">
            <WaitingText>Loading connection permissions…</WaitingText>
          </p>
        ) : (
          <h1>Connection link needed</h1>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>Customer agents is an optional Macrofold integration path.</footer>
      </section>
    </main>
  );
}
