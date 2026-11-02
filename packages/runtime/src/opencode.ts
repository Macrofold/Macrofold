import { fileAccess, questionsAllowed } from '../../contracts/permissions';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { openCodePermissionSettings } from './permission-settings';
import { modelRequestError } from './failure-diagnostic';
import { isOutputLimitReason, modelOutputLimitExceeded } from '../../contracts/model-completion';

function turnError(error: unknown) {
  const data =
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'APIError' &&
    'data' in error &&
    error.data;
  return (
    modelRequestError(
      data && typeof data === 'object' && 'statusCode' in data ? data.statusCode : undefined,
    ) ?? new Error('OpenCode turn failed')
  );
}
type OpenCodeSDK = {
  createSessionClient: (typeof import('@opencode-ai/sdk/client'))['createOpencodeClient'];
  createOpencodeServer: (typeof import('@opencode-ai/sdk/v2/server'))['createOpencodeServer'];
  createOpencodeClient: (typeof import('@opencode-ai/sdk/v2/client'))['createOpencodeClient'];
};
class OpenCodeAdapter implements HarnessAdapter {
  constructor(private readonly sdk: OpenCodeSDK) {}
  private server?: Awaited<ReturnType<OpenCodeSDK['createOpencodeServer']>>;
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
    const { createSessionClient, createOpencodeServer, createOpencodeClient } = this.sdk;
    const guarded = permissionAdapters.opencode.translate(c.permissions || []).mode === 'guarded';
    const allowQuestions = questionsAllowed(c.permissions || []);
    if (guarded && fileAccess(c.permissions || []).read && !fileTools)
      throw new Error('Checked file service unavailable.');
    const npm = c.provider === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
    // The configuration is supplied by the supervisor; platform tools remain behind its broker.
    const reused = Boolean(this.server);
    setStage?.('server_start');
    // The pinned upstream otherwise applies its own 32,000 default in addition
    // to model.limit.output. This worker is isolated and its environment scrubbed.
    process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = String(c.modelLimits.maxOutputTokens);
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
              models: {
                [c.model]: {
                  name: c.model,
                  limit: {
                    context: c.modelLimits.contextTokens,
                    input: c.modelLimits.inputTokens,
                    output: c.modelLimits.maxOutputTokens,
                  },
                },
              },
            },
          },
          ...(guarded
            ? {
                permission: openCodePermissionSettings(c.toolGrants, allowQuestions),
                lsp: false,
                formatter: false,
              }
            : {
                permission: {
                  question: allowQuestions ? ('allow' as const) : ('deny' as const),
                  edit: 'allow' as const,
                  bash: 'allow' as const,
                  webfetch: 'deny' as const,
                },
              }),
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
    let outputLimited = false;
    const client = createSessionClient({ baseUrl: server.url });
    let sessionId = this.sessionId || c.resumeId,
      output = '';
    let submitted = false;
    let promptId: string | undefined;
    let assistantId: string | undefined;
    const parts = new Map<string, { type: string; length: number }>();
    let done = false;
    const controller = new AbortController();
    const transportSignal = AbortSignal.any([controller.signal, signal]);
    let consume: Promise<void> | undefined;
    const questions = createOpencodeClient({ baseUrl: server.url });
    try {
      if (!sessionId) {
        setStage?.('session_create');
        const session = await client.session.create({
          signal: transportSignal,
          body: { title: c.prompt.slice(0, 80) },
        });
        if (!session.data) throw new Error('OpenCode could not create a session');
        sessionId = session.data.id;
      }
      this.sessionId = sessionId;
      await emit({
        type: 'runtime.started',
        data: { harness: 'opencode', native_session_id: sessionId, reused },
      });
      setStage?.('event_subscribe');
      let connected!: () => void;
      const subscribed = new Promise<void>((resolve) => {
        connected = resolve;
      });
      const subscription = await client.event.subscribe({
        signal: transportSignal,
        sseMaxRetryAttempts: 1,
      });
      consume = (async () => {
        for await (const event of subscription.stream) {
          if (done) break;
          const raw = event as unknown as { type: string; properties: Record<string, unknown> };
          if (raw.type === 'server.connected') connected();
          if (!submitted) continue;
          if (raw.type === 'session.error' && raw.properties.sessionID === sessionId)
            throw turnError(raw.properties.error);
          if (raw.type === 'message.updated') {
            const info = raw.properties.info as {
              id: string;
              sessionID: string;
              role: string;
              parentID?: string;
              error?: unknown;
              finish?: string;
            };
            if (info.sessionID === sessionId) {
              if (info.role === 'user') promptId = info.id;
              if (info.role === 'assistant' && promptId && info.parentID === promptId) {
                assistantId = info.id;
                outputLimited ||= isOutputLimitReason(info.finish);
                if (info.error) throw turnError(info.error);
              }
            }
          }
          // Ignore unrelated/stale idle notifications until our prompt is observed.
          // The boundary drains reasoning/tool events; the final message is read below.
          if (raw.type === 'session.idle' && raw.properties.sessionID === sessionId && promptId) return;
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
            const id = String(raw.properties.partID || '');
            const part = parts.get(id);
            if (part?.type === 'reasoning') {
              part.length += text.length;
              await emit({ type: 'reasoning.delta', data: { reasoning_id: id, format: 'text', text } });
            } else if (part?.type === 'text') {
              output += text;
              await emit({ type: 'output.delta', data: { text } });
            }
          }
          if (raw.type === 'message.part.updated') {
            const part = raw.properties.part as {
              id: string;
              type: string;
              time?: { end?: number };
              sessionID: string;
              text?: string;
              callID?: string;
              tool?: string;
              state?: Record<string, unknown>;
            };
            if (part.sessionID !== sessionId) continue;
            const previous = parts.get(part.id);
            if (!previous) parts.set(part.id, { type: part.type, length: 0 });
            if (part.type === 'reasoning') {
              if (!previous)
                await emit({ type: 'reasoning.started', data: { reasoning_id: part.id, format: 'text' } });
              // Snapshots repeat streamed text; publish only an unseen suffix.
              const saved = parts.get(part.id)!;
              const text =
                typeof raw.properties.delta === 'string'
                  ? raw.properties.delta
                  : (part.text || '').slice(saved.length);
              saved.length += text.length;
              if (text)
                await emit({
                  type: 'reasoning.delta',
                  data: { reasoning_id: part.id, format: 'text', text },
                });
              if (part.time?.end !== undefined)
                await emit({
                  type: 'reasoning.completed',
                  data: { reasoning_id: part.id, status: 'completed' },
                });
            }
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
        void client.session
          .abort({ path: { id: sessionId! }, signal: AbortSignal.timeout(5000) })
          .catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        // SDK subscriptions connect lazily; do not submit before the feed is live.
        await Promise.race([
          subscribed,
          consume.then(() => {
            throw new Error('OpenCode event stream ended before subscription');
          }),
        ]);
        setStage?.('turn_execute');
        submitted = true;
        await Promise.all([
          client.session
            .promptAsync({
              signal: transportSignal,
              path: { id: sessionId },
              body: {
                agent: c.harnessPromptMode === 'extend' ? 'build' : 'macrofold',
                model: { providerID: 'platform', modelID: c.model },
                ...(c.instructions ? { system: c.instructions } : {}),
                parts: [{ type: 'text', text: c.prompt }],
              },
            })
            .then((response) => {
              if (response.error) throw turnError(response.error);
              return response;
            }),
          consume,
        ]);
        transportSignal.throwIfAborted();
        if (!assistantId) throw new Error('OpenCode final message unavailable');
        const response = await client.session.message({
          signal: transportSignal,
          path: { id: sessionId, messageID: assistantId },
        });
        if (response.error || !response.data || response.data.info.role !== 'assistant')
          throw new Error('OpenCode final message unavailable');
        outputLimited ||= isOutputLimitReason(response.data.info.finish);
        const full = response.data?.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p.type === 'text' ? p.text : ''))
          .join('\n');
        if (full) output = full;
        if (response.data.info.error) throw turnError(response.data.info.error);
        const unfinished = ['tool-calls', 'tool_calls', 'content-filter', 'content_filter', 'error'].includes(
          response.data.info.finish || '',
        );
        const outcome: NativeResult['outcome'] = outputLimited
          ? 'failure'
          : signal.aborted
            ? 'cancelled'
            : unfinished
              ? 'failure'
              : 'success';
        successful = outcome === 'success';
        return {
          output,
          resumeId: sessionId,
          outcome,
          ...(outcome === 'failure'
            ? { failureCode: outputLimited ? modelOutputLimitExceeded : 'harness_error' }
            : {}),
        };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } catch (error) {
      if (outputLimited)
        return { output, resumeId: sessionId, outcome: 'failure', failureCode: modelOutputLimitExceeded };
      throw error;
    } finally {
      done = true;
      controller.abort();
      // Do not let queued emissions outlive the worker's reasoning closure.
      await consume?.catch(() => {});
      if (!c.warm || !successful) this.close();
    }
  }
}

export async function createAdapter(): Promise<HarnessAdapter> {
  const [session, server, client] = await Promise.all([
    import('@opencode-ai/sdk/client'),
    import('@opencode-ai/sdk/v2/server'),
    import('@opencode-ai/sdk/v2/client'),
  ]);
  return new OpenCodeAdapter({
    createSessionClient: session.createOpencodeClient,
    createOpencodeServer: server.createOpencodeServer,
    createOpencodeClient: client.createOpencodeClient,
  });
}
