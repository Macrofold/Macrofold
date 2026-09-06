'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AuthActionFrame } from './auth-actions';
import { Button } from './ui';
import { api } from '../lib/client';
export function OAuthConsent({
  clientName,
  query,
  scopes = [],
  resources = [],
  email,
  error: initialError,
}: {
  clientName?: string;
  query?: string;
  scopes?: string[];
  resources?: string[];
  email?: string;
  error?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError || '');
  async function decide(accept: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('/auth/oauth2/consent', 'POST', {
        accept,
        oauth_query: query,
      });
      // The authorization server validates the registered callback, including CLI loopback URLs.
      location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <AuthActionFrame
      title={initialError ? 'Connection unavailable.' : `Connect ${clientName}?`}
      description={
        initialError
          ? 'No access has been granted.'
          : `Signed in as ${email}. Review what this application can access.`
      }
    >
      {!initialError && (
        <>
          <div className="permission-list">
            {scopes.map((scope) => (
              <span key={scope}>
                <ShieldCheck size={14} />
                {scope.replaceAll(':', ' · ').replaceAll('_', ' ')}
              </span>
            ))}
          </div>
          {resources.length > 0 && <p className="muted break-anywhere">Resource: {resources.join(', ')}</p>}
          <p>
            Access applies to organizations you belong to, within your role. Revoke this application at any
            time from Account & security.
          </p>
          <div className="button-row">
            <Button variant="secondary" busy={busy} onClick={() => decide(false)}>
              Decline
            </Button>
            <Button busy={busy} onClick={() => decide(true)}>
              Allow access
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </AuthActionFrame>
  );
}
