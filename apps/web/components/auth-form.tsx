'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Terminal, FolderGit2, Radio } from 'lucide-react';
import { Logo, Button, Field } from './ui';
import { api } from '../lib/client';
import { authReturnPath } from '../lib/auth-return';
export function AuthForm({
  name,
  local,
  mode = 'login',
}: {
  name: string;
  local: boolean;
  mode?: 'login' | 'register' | 'forgot';
}) {
  const router = useRouter();
  const [returnPath, setReturnPath] = useState('/');
  useEffect(() => {
    setReturnPath(authReturnPath(new URLSearchParams(location.search).get('returnTo'), location.origin));
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState(false);
  const [email, setEmail] = useState(local && mode === 'login' ? 'demo@example.test' : ''),
    [password, setPassword] = useState(local && mode === 'login' ? 'local-only-demo-2026' : ''),
    [fullName, setFullName] = useState('');
  const title =
    mode === 'register'
      ? 'A home for your agents.'
      : mode === 'forgot'
        ? 'Reset your password.'
        : 'Welcome back.';
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Link href="/" className="brand">
          <Logo />
          <span>{name}</span>
        </Link>
        <div className="auth-message">
          <span className="eyebrow">YOUR WORK, IN MOTION</span>
          <h1>
            Agents that pick up
            <br />
            where you left off.
          </h1>
          <p>One persistent workspace. Every conversation, every file, every step forward.</p>
          <div className="auth-features">
            <span>
              <FolderGit2 />
              Files that stay with you
            </span>
            <span>
              <Radio />
              Live, visible execution
            </span>
            <span>
              <Terminal />
              Dashboard, API, or terminal
            </span>
          </div>
        </div>
        <span className="auth-footer">Your infrastructure for getting things done.</span>
      </div>
      <div className="auth-form-side">
        <div className="auth-form">
          <div className="eyebrow">GET STARTED</div>
          <h2>{title}</h2>
          <p>
            {mode === 'register'
              ? 'Create your account to start building with cloud agents.'
              : mode === 'forgot'
                ? 'We’ll email you a secure reset link.'
                : 'Sign in to your persistent agent workspace.'}
          </p>
          {sent ? (
            <div className="success-note">
              Check your inbox.{' '}
              {local
                ? 'Local emails are available in Mailpit at localhost:58025.'
                : 'Follow the email link to continue.'}
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  if (mode === 'forgot') {
                    await api('/auth/request-password-reset', 'POST', {
                      email,
                      redirectTo: `${location.origin}/reset-password`,
                    });
                    setSent(true);
                  } else {
                    const result = await api<{
                      redirect?: boolean;
                      url?: string;
                      twoFactorRedirect?: boolean;
                    }>(`/auth/${mode === 'register' ? 'sign-up' : 'sign-in'}/email`, 'POST', {
                      email,
                      password,
                      ...(new URLSearchParams(location.search).has('sig')
                        ? { oauth_query: location.search.slice(1) }
                        : {}),
                      ...(mode === 'register' ? { name: fullName, callbackURL: returnPath } : {}),
                    });
                    if (mode === 'register') setSent(true);
                    else {
                      if (result.twoFactorRedirect) {
                        router.push(
                          '/two-factor?returnTo=' +
                            encodeURIComponent(returnPath) +
                            (new URLSearchParams(location.search).has('sig')
                              ? '&oauth_query=' + encodeURIComponent(location.search.slice(1))
                              : ''),
                        );
                        return;
                      }
                      if (result.redirect && result.url) {
                        location.assign(result.url);
                        return;
                      }
                      router.push(returnPath);
                      router.refresh();
                    }
                  }
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === 'register' && (
                <Field label="Full name">
                  <input
                    autoComplete="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Email address">
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </Field>
              {mode !== 'forgot' && (
                <Field
                  label="Password"
                  hint={mode === 'register' ? 'Use at least 12 characters.' : undefined}
                >
                  <input
                    type="password"
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <Button busy={busy} type="submit">
                {mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
          <p className="auth-switch">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <Link href={'/register?returnTo=' + encodeURIComponent(returnPath)}>Create an account</Link>{' '}
                <Link className="forgot-link" href="/forgot-password">
                  Forgot password?
                </Link>
              </>
            ) : (
              <Link href={'/login?returnTo=' + encodeURIComponent(returnPath)}>Back to sign in</Link>
            )}
          </p>
          {local && (
            <div className="local-note">
              <strong>Local development</strong>
              <p>
                The demo uses a simulator. No model or sandbox charges. Demo credentials are prefilled after
                running the seed command.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
