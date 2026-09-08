import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nextOccurrence, slackMessage, verifySlackSignature } from '../../packages/core/src/trigger-policy';
import { SlackClient } from '../../packages/providers/src/slack';

describe('trigger schedule and Slack boundaries', () => {
  it('uses five-field cron, explicit timezone and the next occurrence after now', () => {
    expect(
      nextOccurrence('0 9 * * 1-5', 'America/New_York', new Date('2026-09-04T14:00:00Z')).toISOString(),
    ).toBe('2026-09-07T13:00:00.000Z');
    expect(
      nextOccurrence('0 9 * * *', 'America/New_York', new Date('2026-11-01T05:00:00Z')).toISOString(),
    ).toBe('2026-11-01T14:00:00.000Z');
    expect(nextOccurrence('* * * * *', 'UTC', new Date('2026-09-01T00:00:00Z')).toISOString()).toBe(
      '2026-09-01T00:01:00.000Z',
    );
  });
  it.each([
    ['* * * * * *', 'UTC'],
    ['not cron', 'UTC'],
    ['0 9 * * *', 'not/a-zone'],
    ['0 0 31 2 *', 'UTC'],
  ])('rejects invalid schedule %s %s', (cron, timezone) => {
    expect(() => nextOccurrence(cron, timezone)).toThrow();
  });
  it('verifies exact Slack bytes, rejects tampering, missing headers and old/future replay', () => {
    const timestamp = '1788796800',
      now = Number(timestamp) * 1000,
      secret = 'fixture-only-signing-secret',
      raw = Buffer.from('{"text":"hello"}');
    const signature =
      'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex');
    const headers = new Headers({ 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature });
    expect(() => verifySlackSignature(raw, headers, secret, now)).not.toThrow();
    for (const time of [now - 301000, now + 301000])
      expect(() => verifySlackSignature(raw, headers, secret, time)).toThrow();
    expect(() => verifySlackSignature(Buffer.from('changed'), headers, secret, now)).toThrow();
    expect(() => verifySlackSignature(raw, new Headers(), secret, now)).toThrow();
    expect(() => verifySlackSignature(raw, headers, 'other', now)).toThrow();
  });
  it('accepts human messages and mentions, preserving the thread while excluding bot and edit loops', () => {
    const event = { type: 'message', user: 'U123', channel: 'C123', text: 'Hello', ts: '1234.5678' };
    expect(slackMessage(event, 'UBOT')).toEqual({
      channel: 'C123',
      text: 'Hello',
      ts: '1234.5678',
      thread: '1234.5678',
    });
    expect(slackMessage({ ...event, type: 'app_mention', thread_ts: '1234.0000' }, 'UBOT')?.thread).toBe(
      '1234.0000',
    );
    for (const patch of [
      { bot_id: 'B123' },
      { user: 'UBOT' },
      { subtype: 'message_changed' },
      { hidden: true },
      { text: '' },
      { thread_ts: 'bad' },
      { channel: 'https://example.test' },
      { ts: 1234 },
      { type: 'reaction_added' },
      { user: undefined },
    ]) {
      expect(slackMessage({ ...event, ...patch }, 'UBOT')).toBeUndefined();
    }
    expect(slackMessage(null, 'UBOT')).toBeUndefined();
  });
});

describe('Slack HTTP adapter', () => {
  it('authenticates a bot and follows opaque channel pagination without returning channels it cannot read', async () => {
    const calls: string[] = [];
    const slack = new SlackClient(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      expect(url.origin).toBe('https://slack.com');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-bot');
      if (url.pathname.endsWith('auth.test'))
        return Response.json({ ok: true, team_id: 'T1', user_id: 'U1', bot_id: 'B1' });
      expect(url.searchParams.get('cursor')).toBe('opaque+/=');
      return Response.json({
        ok: true,
        channels: [
          { id: 'C1', name: 'agents', is_member: true },
          { id: 'C2', name: 'other', is_member: false },
        ],
        response_metadata: { next_cursor: 'next' },
      });
    });
    expect(await slack.identity('fixture-bot')).toEqual({ team_id: 'T1', bot_user_id: 'U1' });
    expect(await slack.channels('fixture-bot', 'opaque+/=')).toEqual({
      data: [{ id: 'C1', name: 'agents' }],
      next_cursor: 'next',
    });
    expect(calls).toHaveLength(2);
  });
  it('uses plain-text threaded replies without an implicit POST retry', async () => {
    let count = 0;
    const slack = new SlackClient(async (_url, init) => {
      count++;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        channel: 'C1',
        text: '&lt;!channel&gt; hello',
        thread_ts: '123.45',
        client_msg_id: 'delivery',
        unfurl_links: false,
        blocks: [{ type: 'section', text: { type: 'plain_text', text: '<!channel> hello' } }],
      });
      throw new Error('network outage');
    });
    await expect(
      slack.reply('fixture-bot', 'C1', '123.45', '<!channel> hello', 'delivery'),
    ).rejects.toMatchObject({ code: 'unreachable', uncertain: true });
    expect(count).toBe(1);
  });
  it.each([
    [() => Response.json({ ok: false, error: 'missing_scope' }), 'missing_scope', false],
    [() => new Response('', { status: 503 }), 'http_error', true],
    [() => new Response('invalid'), 'invalid_response', true],
    [() => Response.json({ wrong: true }), 'invalid_response', true],
    [() => Response.json({ ok: true }), 'invalid_response', true],
  ] as const)(
    'classifies reply failures without exposing vendor payloads',
    async (response, code, uncertain) => {
      const slack = new SlackClient(async () => response());
      await expect(slack.reply('fixture-bot', 'C1', '123.45', 'test', 'delivery')).rejects.toMatchObject({
        code,
        uncertain,
      });
    },
  );
  it('honors Slack rate-limit rejection and bounds malformed retry values', async () => {
    const slack = new SlackClient(
      async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    );
    await expect(slack.reply('fixture-bot', 'C1', '1.2', 'test', 'delivery')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 120,
      uncertain: false,
    });
  });
});
