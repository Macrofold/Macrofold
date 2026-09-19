import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { TurnInput } from './turn-input';
import { createInterface } from 'node:readline';
import type { NativeConfiguration } from './types';
import { deepseekEvent } from './deepseek-events';

export const name = 'platform-driver';
export const inject = ['agents', 'sessions', 'llm', 'loader'];

/** Embeds the official agent loop. SDK convenience run() cannot resume a persisted session. */
export function apply(ctx: Context): void {
  const lines = createInterface({ input: process.stdin });
  const turns = new TurnInput<NativeConfiguration>();
  lines.on('line', (line) => turns.push(JSON.parse(line)));
  lines.on('close', () => turns.close());
  const send = (message: unknown) =>
    new Promise<void>((resolve, reject) => {
      process.stdout.write(JSON.stringify(message) + '\n', (error) => (error ? reject(error) : resolve()));
    });
  void (async () => {
    let next = await turns.next();
    if (next.done) return;
    let c = next.value;
    await ctx.get('loader')?.await();
    const sessionId = SessionId(process.env.PLATFORM_SESSION_ID!);
    const agentOptions = { provider: 'platform', model: c.model, maxTokens: 8192 };
    const handle = c.resumeId
      ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions })
      : await ctx.agents.create({ sessionId, meta: { cwd: c.workspace }, agentOptions });
    const agent = handle.agent;
    let output = '',
      success = false,
      pending = Promise.resolve();
    const dispose = ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return;
      const normalized = deepseekEvent(event);
      if (normalized?.type === 'output.delta') output = String(normalized.data.text);
      if (event.type === 'turn/end') success = event.data.reason.kind === 'completed';
      if (normalized) {
        pending = pending.then(() => send({ type: 'event', event: normalized }));
        void pending.catch(() => {
          process.exitCode = 1;
        });
      }
    });
    try {
      let reused = false;
      for (;;) {
        output = '';
        success = false;
        await send({
          type: 'event',
          event: {
            type: 'runtime.started',
            data: { harness: 'deepseek', native_session_id: sessionId, reused },
          },
        });
        agent.followup(
          createUserMessage({ content: [{ type: 'text', text: c.prompt }], source: { kind: 'user' } }),
        );
        await agent.whenIdle();
        await ctx.sessions.flush(agent.session);
        await pending;
        await send({
          type: 'result',
          result: {
            output,
            resumeId: sessionId,
            outcome: success ? 'success' : 'failure',
            ...(success ? {} : { failureCode: 'harness_error' }),
          },
        });
        if (!c.warm || !success) break;
        next = await turns.next();
        if (next.done) break;
        c = next.value;
        reused = true;
      }
    } finally {
      dispose();
      await handle.dispose();
      lines.close();
      turns.close();
    }
    ctx.get('appExit')!(0);
  })().catch(() => {
    lines.close();
    ctx.get('appExit')!(1);
  });
}
