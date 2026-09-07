'use client';
import { copyText } from '../lib/clipboard';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, KeyRound, Laptop, LogOut, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api, useApi, relative } from '../lib/client';
import { Button, PageHeading, SectionHeading, Field, Modal, ErrorState, Loading, Badge } from './ui';
import { AuthActionFrame } from './auth-actions';
import { authReturnPath } from '../lib/auth-return';
type Session = {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
};
type Identity = {
  user: { id: string; name: string; email: string; twoFactorEnabled?: boolean };
  session: Session;
};
export function SecurityView() {
  const identity = useApi<Identity>('/auth/get-session'),
    sessions = useApi<Session[]>('/auth/list-sessions'),
    grants = useApi<{ data: { client_id: string; name: string; scopes: string[]; authorized_at: string }[] }>(
      '/account/grants',
    );
  const client = useQueryClient();
  const [name, setName] = useState<string>(),
    [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [mode, setMode] = useState<'enable' | 'disable' | 'backup' | null>(null),
    [enrollment, setEnrollment] = useState<{ totpURI?: string; backupCodes: string[] }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await client.invalidateQueries();
      toast.success(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (identity.isPending) return <Loading />;
  if (identity.error) return <ErrorState error={identity.error} />;
  const user = identity.data!.user;
  return (
    <div className="page narrow-page">
      <PageHeading
        eyebrow="YOUR ACCOUNT, YOUR CONTROL"
        title="Account & security"
        description="Manage your identity, strengthen sign-in, and review active devices."
      />
      <section className="panel">
        <SectionHeading title="Profile" description={user.email} />
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('/auth/update-user', 'POST', { name: name ?? user.name });
              setName(undefined);
            }, 'Profile updated');
          }}
        >
          <Field label="Display name">
            <input
              required
              value={name ?? user.name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </Field>
          <Button busy={busy}>Save profile</Button>
        </form>
      </section>
      <section className="panel">
        <SectionHeading
          title="Password"
          description="Changing your password signs out your other browser sessions."
        />
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('/auth/change-password', 'POST', {
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
              });
              setCurrentPassword('');
              setNewPassword('');
            }, 'Password updated');
          }}
        >
          <Field label="Current password">
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 12 characters.">
            <input
              required
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Button variant="secondary" busy={busy}>
            <KeyRound size={16} />
            Change password
          </Button>
        </form>
      </section>
      <section className="panel">
        <SectionHeading
          title="Two-factor authentication"
          description="Use an authenticator app to protect your account with a second verification step."
        />
        <div className="row-actions">
          <Badge status={user.twoFactorEnabled ? 'enabled' : 'disabled'} />
          <Button
            variant="secondary"
            onClick={() => {
              setMode(user.twoFactorEnabled ? 'disable' : 'enable');
              setEnrollment(undefined);
              setPassword('');
              setCode('');
              setError('');
            }}
          >
            <ShieldCheck size={16} />
            {user.twoFactorEnabled ? 'Disable two-factor' : 'Set up authenticator'}
          </Button>
          {user.twoFactorEnabled && (
            <Button
              variant="ghost"
              onClick={() => {
                setMode('backup');
                setEnrollment(undefined);
                setPassword('');
                setError('');
              }}
            >
              Regenerate recovery codes
            </Button>
          )}
        </div>
      </section>
      <section className="panel">
        <SectionHeading title="Signed-in devices" description="Revoke any session you no longer use." />
        {sessions.error ? (
          <ErrorState error={sessions.error} />
        ) : (
          <div className="session-list">
            {sessions.data?.map((session) => (
              <div className="session-row" key={session.id}>
                <Laptop size={19} />
                <div>
                  <strong>
                    {session.id === identity.data!.session.id ? 'This device' : 'Browser session'}
                  </strong>
                  <p className="break-anywhere">
                    {session.userAgent || 'Unknown browser'} · {session.ipAddress || 'Unknown address'}
                  </p>
                  <small>Last active {relative(session.updatedAt)}</small>
                </div>
                <Button
                  variant="ghost"
                  busy={busy}
                  aria-label={
                    session.id === identity.data!.session.id
                      ? 'Sign out this device'
                      : 'Revoke browser session'
                  }
                  onClick={() =>
                    act(async () => {
                      await api('/auth/revoke-session', 'POST', { token: session.token });
                      if (session.id === identity.data!.session.id) location.assign('/login');
                    }, 'Session revoked')
                  }
                >
                  <LogOut size={16} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      {error && !mode && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <SectionHeading
          title="Authorized applications"
          description="Applications and terminals with access to your account. Revoking access also invalidates their refresh tokens."
        />
        {grants.error ? (
          <ErrorState error={grants.error} />
        ) : !grants.data ? (
          <Loading />
        ) : grants.data.data.length === 0 ? (
          <p className="muted">No applications have access to your account.</p>
        ) : (
          <div className="session-list">
            {grants.data.data.map((grant) => (
              <div className="session-row" key={grant.client_id}>
                <ShieldCheck size={19} />
                <div>
                  <strong>{grant.name}</strong>
                  <p className="break-anywhere">{grant.scopes.join(' · ')}</p>
                  <small>Authorized {relative(grant.authorized_at)}</small>
                </div>
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    act(
                      () => api('/account/grants?client_id=' + encodeURIComponent(grant.client_id), 'DELETE'),
                      'Application access revoked',
                    )
                  }
                >
                  Revoke {grant.name}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <Modal
        open={!!mode}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null);
            setEnrollment(undefined);
            setPassword('');
            setCode('');
          }
        }}
        title={
          mode === 'disable'
            ? 'Disable two-factor authentication'
            : enrollment
              ? 'Save your recovery codes'
              : mode === 'backup'
                ? 'Replace recovery codes'
                : 'Set up your authenticator'
        }
        description={
          enrollment
            ? 'Store these codes somewhere safe. Each code works once.'
            : mode === 'disable'
              ? 'Your account will use its password alone. Confirm your current password.'
              : 'Confirm your current password to continue.'
        }
      >
        {enrollment ? (
          <div className="form-stack">
            {enrollment.totpURI && (
              <>
                <div className="totp-qr">
                  <QRCodeSVG
                    value={enrollment.totpURI}
                    size={192}
                    marginSize={4}
                    title="Authenticator enrollment QR code"
                  />
                </div>
                <p>Scan this code with your authenticator app, then enter its six-digit code below.</p>
                <details>
                  <summary>Enter a setup key manually</summary>
                  <code className="break-anywhere">
                    {new URL(enrollment.totpURI).searchParams.get('secret')}
                  </code>
                </details>
              </>
            )}
            <pre className="recovery-codes">{enrollment.backupCodes.join('\n')}</pre>
            <Button
              variant="secondary"
              onClick={() => copyText(enrollment.backupCodes.join('\n'), 'Recovery codes copied')}
            >
              <Copy size={15} />
              Copy recovery codes
            </Button>
            {enrollment.totpURI ? (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await api('/auth/two-factor/verify-totp', 'POST', { code });
                    setEnrollment(undefined);
                    setMode(null);
                    setCode('');
                  }, 'Two-factor authentication enabled');
                }}
              >
                <Field label="Authenticator code">
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <Button busy={busy}>Verify and enable</Button>
              </form>
            ) : (
              <Button
                onClick={() => {
                  setEnrollment(undefined);
                  setMode(null);
                }}
              >
                I saved these codes
              </Button>
            )}
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                async () => {
                  if (mode === 'disable') {
                    await api('/auth/two-factor/disable', 'POST', { password });
                    setMode(null);
                  } else {
                    const result = await api<{ totpURI?: string; backupCodes: string[] }>(
                      `/auth/two-factor/${mode === 'backup' ? 'generate-backup-codes' : 'enable'}`,
                      'POST',
                      { password },
                    );
                    setEnrollment(result);
                  }
                  setPassword('');
                },
                mode === 'disable' ? 'Two-factor disabled' : 'Security settings updated',
              );
            }}
          >
            <Field label="Confirm password">
              <input
                autoComplete="current-password"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button busy={busy} variant={mode === 'disable' ? 'danger' : 'primary'}>
              {mode === 'disable' ? 'Disable two-factor' : 'Continue'}
            </Button>
          </form>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
export function VerifySecondFactor() {
  const [code, setCode] = useState(''),
    [backup, setBackup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <AuthActionFrame
      title="One more step."
      description={
        backup
          ? 'Enter one of your saved recovery codes. Each can be used once.'
          : 'Enter the six-digit code from your authenticator app.'
      }
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const oauthQuery = new URLSearchParams(location.search).get('oauth_query');
            const result = await api<{ redirect?: boolean; url?: string }>(
              `/auth/two-factor/${backup ? 'verify-backup-code' : 'verify-totp'}`,
              'POST',
              { code, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) },
            );
            if (result.redirect && result.url) {
              location.assign(result.url);
              return;
            }
            location.assign(
              authReturnPath(new URLSearchParams(location.search).get('returnTo'), location.origin),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={backup ? 'Recovery code' : 'Authenticator code'}>
          <input
            autoFocus
            autoComplete="one-time-code"
            required
            inputMode={backup ? 'text' : 'numeric'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Button busy={busy}>Verify and sign in</Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setBackup(!backup);
            setCode('');
          }}
        >
          {backup ? 'Use authenticator instead' : 'Use a recovery code'}
        </Button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
    </AuthActionFrame>
  );
}
