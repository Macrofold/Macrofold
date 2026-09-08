import { z } from 'zod';
import { boundedJSON } from '../../core/src/body';

export class SlackError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
    public retryAfter?: number,
  ) {
    super(`Slack request failed (${code}).`);
  }
}
const envelope = z.object({ ok: z.boolean(), error: z.string().optional() });
/** Fixed vendor origin, bounded responses and no automatic POST retry: a timeout may have sent a reply. */
export class SlackClient {
  constructor(private transport: typeof fetch = fetch) {}
  private async call(token: string, method: string, params: Record<string, unknown> = {}, write = false) {
    const url = new URL(`https://slack.com/api/${method}`);
    if (!write) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await this.transport(url, {
        method: write ? 'POST' : 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: write ? JSON.stringify(params) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new SlackError('unreachable', write);
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new SlackError(
        'rate_limited',
        false,
        Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 60)),
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SlackError('http_error', write && response.status >= 500);
    }
    let data: unknown;
    try {
      data = await boundedJSON(response, 1024 * 1024);
    } catch {
      throw new SlackError('invalid_response', write);
    }
    const result = envelope.safeParse(data);
    if (!result.success) throw new SlackError('invalid_response', write);
    if (!result.data.ok) {
      const code = result.data.error;
      // Only stable vendor codes are surfaced; never raw response bodies or credentials.
      throw new SlackError(code && /^[a-z_]{1,60}$/.test(code) ? code : 'rejected');
    }
    return data;
  }
  async identity(token: string) {
    const result = z
      .object({ team_id: z.string().min(1), user_id: z.string().min(1), bot_id: z.string().min(1) })
      .safeParse(await this.call(token, 'auth.test'));
    if (!result.success) throw new SlackError('bot_token_required');
    return { team_id: result.data.team_id, bot_user_id: result.data.user_id };
  }
  async channels(token: string, cursor?: string) {
    const result = z
      .object({
        channels: z.array(z.object({ id: z.string(), name: z.string(), is_member: z.boolean() })),
        response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
      })
      .safeParse(
        await this.call(token, 'conversations.list', {
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        }),
      );
    if (!result.success) throw new SlackError('invalid_response');
    return {
      data: result.data.channels.filter((c) => c.is_member).map(({ id, name }) => ({ id, name })),
      next_cursor: result.data.response_metadata?.next_cursor || null,
    };
  }
  async reply(token: string, channel: string, thread: string, text: string, clientId: string) {
    const result = z.object({ ts: z.string() }).safeParse(
      await this.call(
        token,
        'chat.postMessage',
        {
          channel,
          thread_ts: thread,
          client_msg_id: clientId,
          text: text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
          blocks: [{ type: 'section', text: { type: 'plain_text', text, emoji: false } }],
          unfurl_links: false,
          unfurl_media: false,
          parse: 'none',
        },
        true,
      ),
    );
    if (!result.success) throw new SlackError('invalid_response', true);
    return result.data.ts;
  }
}
