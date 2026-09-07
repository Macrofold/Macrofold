import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isLocal } from '../../packages/core/src/config';
import { boundedJSON } from '../../packages/core/src/body';

export type Platform = 'openai' | 'anthropic' | 'openrouter' | 'composio' | 'resend' | 'r2';
type Attempt = { platform: Platform; operation: string; ceilingMicroUsd: number; at: string };
const directory = fileURLToPath(new URL('../../.data/live-checks/', import.meta.url));
const journal = path.join(directory, 'budget.json');
// Adapter checks may enable a production branch in memory after booting locally.
const localProfileAtStart = isLocal() && !config.allowPaid && config.execution === 'simulator';
const initialSecrets = Object.entries(process.env)
  .filter(([key, value]) => value && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key))
  .map(([, value]) => value!);

export function assertBudget(attempts: Attempt[], platform: Platform, ceilingMicroUsd: number) {
  if (
    !Number.isSafeInteger(ceilingMicroUsd) ||
    ceilingMicroUsd < 0 ||
    attempts.some((a) => !Number.isSafeInteger(a.ceilingMicroUsd) || a.ceilingMicroUsd < 0)
  )
    throw new Error('Invalid live request ceiling');
  const previous = attempts.filter((a) => a.platform === platform);
  if (
    previous.length >= 40 ||
    previous.reduce((n, a) => n + a.ceilingMicroUsd, 0) + ceilingMicroUsd > 1_000_000
  )
    throw new Error(`${platform} live acceptance budget exhausted; do not reset without authorization.`);
}

/** Opt-in only. Reserve before sending; uncertain/failed attempts still consume the ceiling. */
export function charge(platform: Platform, operation: string, ceilingMicroUsd: number) {
  if (process.env.LIVE_API_TESTS !== '1' || !localProfileAtStart)
    throw new Error('Live checks require LIVE_API_TESTS=1 and an isolated local profile.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'budget.lock');
  const fd = openSync(lock, 'wx', 0o600);
  try {
    let attempts: Attempt[] = [];
    try {
      attempts = JSON.parse(readFileSync(journal, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    assertBudget(attempts, platform, ceilingMicroUsd);
    attempts.push({ platform, operation, ceilingMicroUsd, at: new Date().toISOString() });
    writeFileSync(journal, JSON.stringify(attempts, null, 2) + '\n', { mode: 0o600 });
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

export function safeError(error: unknown) {
  const e = error as {
    name?: string;
    code?: string;
    status?: number;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  let message = String(e?.message || 'Request failed');
  for (const value of initialSecrets) message = message.replaceAll(value, '[redacted]');
  for (const [key, value] of Object.entries(process.env))
    if (value && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key))
      message = message.replaceAll(value, '[redacted]');
  return {
    name: e?.name,
    code: e?.code,
    status: e?.status ?? e?.$metadata?.httpStatusCode,
    message: message.replace(/https?:\/\/[^\s"']+/g, '[url]').slice(0, 400),
  };
}

export function report(platform: Platform, operation: string, details: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = { platform, operation, at: new Date().toISOString(), ...details };
  writeFileSync(
    path.join(directory, `${platform}-${operation}.json`),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
}

export async function check(
  platform: Platform,
  operation: string,
  run: () => Promise<Record<string, unknown>>,
) {
  try {
    report(platform, operation, { passed: true, ...(await run()) });
  } catch (error) {
    report(platform, operation, { passed: false, error: safeError(error) });
    process.exitCode = 1;
  }
}

export async function jsonRequest(platform: Platform, operation: string, url: string, init?: RequestInit) {
  charge(platform, operation, 0);
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const body = (await boundedJSON(response, 8 * 1024 * 1024)) as {
    error?: { message?: string };
    message?: string;
    [key: string]: any;
  };
  if (!response.ok)
    throw Object.assign(new Error(body?.error?.message || body?.message || 'Provider rejected request'), {
      status: response.status,
    });
  return body;
}
