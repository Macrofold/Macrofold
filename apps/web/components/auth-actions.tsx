'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { KeyRound, ShieldCheck, Terminal, CheckCircle2 } from 'lucide-react';
import { Button, Field, Logo } from './ui';
import { api } from '../lib/client';
export function AuthActionFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-action-page">
      <Link href="/" aria-label="Home">
        <Logo />
      </Link>
      <div className="auth-action-card">
        <div className="auth-action-icon">
          <ShieldCheck size={24} />
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
      </div>
      <Link href="/">Back to dashboard</Link>
    </main>
  );
}
export function DeviceAuthorization({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode),
    [verified, setVerified] = useState<{
      client_id: string;
      scope: string;
      resource?: string | string[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const verify = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        client_id: string;
        scope: string;
        resource?: string | string[];
        status: string;
      }>(`/auth/device?user_code=${encodeURIComponent(value)}`);
      if (!result.client_id) throw new Error('Sign in as the account that owns this authorization request.');
      if (result.status !== 'pending') throw new Error(`This request is already ${result.status}.`);
      setVerified(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (initialCode) void verify(initialCode);
  }, [initialCode]);
  return (
    <AuthActionFrame
      title={done ? 'You’re all set.' : 'Connect your terminal.'}
      description={
        done
          ? 'Return to your terminal to continue.'
          : 'Check that this code matches the one displayed in your terminal.'
      }
    >
      {done ? (
        <div className="success-note">
          <CheckCircle2 size={20} />
          {done}
        </div>
      ) : verified ? (
        <>
          <div className="device-code">{code}</div>
          <div className="authorization-client">
            <Terminal size={18} />
            <strong>{verified.client_id}</strong>
          </div>
          <div className="permission-list">
            {verified.scope.split(' ').map((scope) => (
              <span key={scope}>
                <ShieldCheck size={14} />
                {scope.replaceAll(':', ' · ').replaceAll('_', ' ')}
              </span>
            ))}
          </div>
          <p className="muted">
            Access is limited to your account’s permissions. You can revoke this authorization later.
          </p>
          <div className="button-row">
            <Button
              variant="secondary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/auth/device/deny', 'POST', { userCode: code });
                  setDone('Connection declined.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Decline
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/auth/device/approve', 'POST', { userCode: code });
                  setDone('Your terminal is connected.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Authorize terminal
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <Field label="Verification code">
            <input
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
            />
          </Field>
          <Button type="submit" busy={busy}>
            Review connection
          </Button>
        </form>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
    </AuthActionFrame>
  );
}
export function ResetPassword({ token, error: initialError }: { token: string; error?: string }) {
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [error, setError] = useState(initialError || ''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <AuthActionFrame
      title={done ? 'Password updated.' : 'Set a new password.'}
      description="Use at least 12 characters and choose a password you don’t use elsewhere."
    >
      {done ? (
        <Link className="button button-primary" href="/login">
          Sign in
        </Link>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== confirm) {
              setError('The passwords do not match.');
              return;
            }
            setBusy(true);
            setError('');
            try {
              await api('/auth/reset-password', 'POST', { token, newPassword: password });
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" busy={busy} disabled={!token}>
            <KeyRound size={16} />
            Save password
          </Button>
        </form>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
    </AuthActionFrame>
  );
}
export function VerifyEmail() {
  const [email, setEmail] = useState(''),
    [sent, setSent] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <AuthActionFrame
      title="Check your inbox."
      description="Verify your email address to start using your workspace."
    >
      {sent ? (
        <div className="success-note">If this account needs verification, a new link is on its way.</div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/auth/send-verification-email', 'POST', { email, callbackURL: '/' });
              setSent(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email address">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" busy={busy}>
            Resend verification email
          </Button>
        </form>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
    </AuthActionFrame>
  );
}
