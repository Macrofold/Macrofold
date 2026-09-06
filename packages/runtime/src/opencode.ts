import { createOpencode } from '@opencode-ai/sdk';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
export class OpenCodeAdapter implements HarnessAdapter {
  async run({ configuration: c, signal, emit, ask }: HarnessContext): Promise<NativeResult> {
    const npm = c.provider === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
    // The configuration is supplied by the supervisor; platform tools remain behind its broker.
    const { client, server } = await createOpencode({
      hostname: '127.0.0.1',
      port: 4096,
      config: {
        model: `platform/${c.model}`,
        small_model: `platform/${c.model}`,
        autoupdate: false,
        share: 'disabled',
        enabled_providers: ['platform'],
        provider: {
          platform: {
            npm,
            name: 'Platform',
            options: {
              baseURL: `${c.gatewayURL}/v1`,
              apiKey: c.token,
            },
            models: { [c.model]: { name: c.model, limit: { context: 128000, output: 8192 } } },
          },
        },
        permission: { edit: 'allow', bash: 'allow', webfetch: 'deny' },
        mcp: c.toolGrants
          ? {
              platform: {
                type: 'remote',
                url: c.toolURL,
                headers: { Authorization: `Bearer ${c.token}` },
                enabled: true,
              },
            }
          : {},
      },
    });
    let sessionId = c.resumeId,
      output = '';
    let done = false;
    const controller = new AbortController();
    const questions = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
    try {
      if (!sessionId) {
        const session = await client.session.create({ body: { title: c.prompt.slice(0, 80) } });
        if (!session.data) throw new Error('OpenCode could not create a session');
        sessionId = session.data.id;
      }
      await emit({ type: 'runtime.started', data: { harness: 'opencode', native_session_id: sessionId } });
      const subscription = await client.event.subscribe({ signal: controller.signal });
      const consume = (async () => {
        for await (const event of subscription.stream) {
          if (done) break;
          const raw = event as unknown as { type: string; properties: Record<string, unknown> };
          if (raw.type === 'question.asked' && raw.properties.sessionID === sessionId) {
            const request = raw.properties as {
              id: string;
              sessionID: string;
              questions: { question: string }[];
            };
            const answer = await ask(request.id, request.questions.map((q) => q.question).join('\n'), {
              questions: request.questions,
            });
            const values = Array.isArray(answer.answers)
              ? answer.answers.map((v) => (Array.isArray(v) ? v.map(String) : [String(v)]))
              : request.questions.map(() => [String(answer.text || answer.answer || '')]);
            const replied = await questions.question.reply({ requestID: request.id, answers: values });
            if (replied.error) throw new Error('Question reply failed');
          }
          if (
            raw.type === 'message.part.delta' &&
            raw.properties.sessionID === sessionId &&
            raw.properties.field === 'text'
          ) {
            const text = String(raw.properties.delta || '');
            output += text;
            await emit({ type: 'output.delta', data: { text } });
          }
          if (raw.type === 'message.part.updated') {
            const part = raw.properties.part as {
              type: string;
              sessionID: string;
              text?: string;
              callID?: string;
              tool?: string;
              state?: Record<string, unknown>;
            };
            if (part.sessionID !== sessionId) continue;
            if (part.type === 'text' && raw.properties.delta) {
              const text = String(raw.properties.delta);
              output += text;
              await emit({ type: 'output.delta', data: { text } });
            }
            if (part.type === 'tool' && part.state) {
              const status = String(part.state.status);
              if (status === 'running' || status === 'completed' || status === 'error')
                await emit({
                  type: status === 'running' ? 'tool.started' : 'tool.completed',
                  data: {
                    tool_call_id: part.callID,
                    name: part.tool,
                    ...(status === 'running'
                      ? { arguments: part.state.input }
                      : { result: part.state.output || part.state.error }),
                  },
                });
            }
          }
        }
        if (!done && !controller.signal.aborted)
          throw new Error('OpenCode event stream closed during the turn');
      })().catch((error) => {
        if (!done && !controller.signal.aborted) throw error;
      });
      const abort = () => {
        void client.session.abort({ path: { id: sessionId! } });
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const response = await Promise.race([
          client.session.prompt({
            path: { id: sessionId },
            body: {
              model: { providerID: 'platform', modelID: c.model },
              ...(c.instructions ? { system: c.instructions } : {}),
              parts: [{ type: 'text', text: c.prompt }],
            },
          }),
          consume.then(() => {
            throw new Error('OpenCode event stream ended before the turn completed');
          }),
        ]);
        if (response.error) throw new Error('OpenCode turn failed');
        const full = response.data?.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p.type === 'text' ? p.text : ''))
          .join('\n');
        if (full) output = full;
        done = true;
        controller.abort();
        await consume;
        return { output, resumeId: sessionId, outcome: signal.aborted ? 'cancelled' : 'success' };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } finally {
      done = true;
      controller.abort();
      server.close();
    }
  }
}
