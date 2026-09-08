import { createHmac } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { assert } from './errors';
import { sameSecret } from './crypto';

export function nextOccurrence(cron: string, timezone: string, now = new Date()): Date {
  assert(
    cron.trim().split(/\s+/).length === 5,
    400,
    'invalid_schedule',
    'Use a five-field cron expression (minute precision).',
  );
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
    return CronExpressionParser.parse(cron, { currentDate: now, tz: timezone }).next().toDate();
  } catch {
    assert(false, 400, 'invalid_schedule', 'Provide a valid cron expression and IANA timezone.');
  }
}

export function verifySlackSignature(raw: Buffer, headers: Headers, secret: string, now = Date.now()) {
  const timestamp = headers.get('x-slack-request-timestamp') || '';
  const signature = headers.get('x-slack-signature') || '';
  assert(
    /^\d{10}$/.test(timestamp) && Math.abs(now / 1000 - Number(timestamp)) <= 300,
    401,
    'invalid_slack_signature',
    'Slack request verification failed.',
  );
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex');
  assert(
    sameSecret(signature, expected),
    401,
    'invalid_slack_signature',
    'Slack request verification failed.',
  );
}

export type SlackMessage = { channel: string; text: string; ts: string; thread: string };
export function slackMessage(value: unknown, botUserId: string): SlackMessage | undefined {
  if (!value || typeof value !== 'object') return;
  const e = value as Record<string, unknown>;
  if (
    !['message', 'app_mention'].includes(String(e.type)) ||
    e.subtype ||
    e.bot_id ||
    e.hidden ||
    typeof e.user !== 'string' ||
    e.user === botUserId ||
    typeof e.text !== 'string' ||
    !e.text.trim() ||
    typeof e.channel !== 'string' ||
    !/^[CG][A-Z0-9]+$/.test(e.channel) ||
    typeof e.ts !== 'string' ||
    !/^\d+\.\d+$/.test(e.ts)
  )
    return;
  if (e.thread_ts !== undefined && (typeof e.thread_ts !== 'string' || !/^\d+\.\d+$/.test(e.thread_ts)))
    return;
  return { channel: e.channel, text: e.text, ts: e.ts, thread: String(e.thread_ts || e.ts) };
}
