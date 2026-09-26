import { createOpencodeClient as createSessionClient } from '@opencode-ai/sdk/client';
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { openCodePermissionSettings } from './permission-settings';
export class OpenCodeAdapter implements HarnessAdapter {
  private server?: Awaited<ReturnType<typeof createOpencodeServer>>;
  private sessionId?: string;
  close() {
    this.server?.close();
    this.server = undefined;
    this.sessionId = undefined;
  }
  async run({
    configuration: c,
    signal,
    emit,
    ask,
    fileTools,
    setStage,
  }: HarnessContext): Promise<NativeResult> {
    const guarded = permissionAdapters.opencode.translate(c.permissions || []).mode === 'guarded';
    if (guarded && !fileTools) throw new Error('Checked file service unavailable.');
    const npm = c.provider === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
    // The configuration is supplied by the supervisor; platform tools remain behind its broker.
    const reused = Boolean(this.server);
    setStage?.('server_start');
    const server =
      this.server ||
      (await createOpencodeServer({
        hostname: '127.0.0.1',
        // The OS assigns an unused port for each resident harness on this Host.
        port: 0,
        // A cold one-shot worker shares its run signal. Resident servers outlive it;
        // the root supervisor still bounds startup and terminates cancelled workers.
        signal: c.warm ? undefined : signal,
        // Cold server startup can exceed the SDK's five-second default. It still
        // shares the run's deadline and cancellation signal; no prompt has started.
        timeout: Math.max(1, Math.min(30_000, Date.parse(c.deadline) - Date.now())),
        config: {
          model: `platform/${c.model}`,
          small_model: `platform/${c.model}`,
          // OpenCode treats an empty string as 'use the provider persona'. A blank
          // nonempty prompt suppresses that fallback without adding instructions.
          agent: { macrofold: { mode: 'primary', prompt: ' ' } },
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
          ...(guarded
            ? { permission: openCodePermissionSettings(c.toolGrants), lsp: false, formatter: false }
            : { permission: { question: 'allow' as const, edit: 'allow' as const, bash: 'allow' as const, webfetch: 'deny' as const } }),
          mcp: {
            ...(c.toolGrants
              ? {
                  platform: {
                    type: 'remote',
                    url: c.toolURL,
                    headers: { Authorization: `Bearer ${c.token}` },
                    enabled: true,
                  },
                }
              : {}),
            ...(fileTools
              ? {
                  worktree: {
                    type: 'remote' as const,
                    url: fileTools.url,
                    headers: { Authorization: `Bearer ${fileTools.token}` },
                    enabled: true,
                  },
                }
              : {}),
          },
        },
      }));
    this.server = server;
    let successful = false;
    const client = createSessionClient({ baseUrl: server.url });
    let sessionId = this.sessionId || c.resumeId,
      output = '';
    let done = false;
    const controller = new AbortController();
    const questions = createOpencodeClient({ baseUrl: server.url });
    try {
      if (!sessionId) {
        setStage?.('session_create');
        const session = await client.session.create({ body: { title: c.prompt.slice(0, 80) } });
        if (!session.data) throw new Error('OpenCode could not create a session');
        sessionId = session.data.id;
      }
      this.sessionId = sessionId;
      await emit({
        type: 'runtime.started',
        data: { harness: 'opencode', native_session_id: sessionId, reused },
      });
      setStage?.('event_subscribe');
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
        // The server may already have exited; cancellation must not create an
        // unhandled rejection that hides the original failure.
        void client.session.abort({ path: { id: sessionId! } }).catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        setStage?.('turn_execute');
        const response = await Promise.race([
          client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: c.harnessPromptMode === 'extend' ? 'build' : 'macrofold',
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
        successful = !signal.aborted;
        return { output, resumeId: sessionId, outcome: signal.aborted ? 'cancelled' : 'success' };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } finally {
      done = true;
      controller.abort();
      if (!c.warm || !successful) this.close();
    }
  }
}
