import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { permissionFileTools, fileToolName, permissionFileDefinition } from './permission-files';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { piBrokerTools } from './pi-tools';
import { isOutputLimitReason, modelOutputLimitExceeded } from '../../contracts/model-completion';

type PiSDK = typeof import('@earendil-works/pi-coding-agent');
type PiAI = typeof import('@earendil-works/pi-ai');
class PiAdapter implements HarnessAdapter {
  constructor(
    private readonly sdk: PiSDK,
    private readonly ai: PiAI,
  ) {}
  private resident?: {
    session: Awaited<ReturnType<PiSDK['createAgentSession']>>['session'];
    resumeId: string;
    broker: Awaited<ReturnType<typeof piBrokerTools>>;
    lifetime: AbortController;
  };
  async close() {
    const resident = this.resident;
    this.resident = undefined;
    if (resident) {
      resident.lifetime.abort();
      resident.session.dispose();
      await resident.broker.close();
    }
  }
  async run({ configuration: c, signal, emit }: HarnessContext): Promise<NativeResult> {
    signal.throwIfAborted();
    const reused = Boolean(this.resident);
    if (!this.resident) {
      const lifetime = new AbortController();
      const guarded = permissionAdapters.pi.translate(c.permissions || []).mode === 'guarded';
      const files = permissionFileTools(c.workspace, c.permissions || []);
      const definition = permissionFileDefinition(c.permissions || []);

      const agentDir = path.join(c.stateHome, '.pi/agent');
      const sessions = path.join(agentDir, 'sessions');
      if (c.resumeId && path.basename(c.resumeId) !== c.resumeId) throw new Error('Invalid Pi session');
      // Pi opens a new session for a missing file. A requested continuation must fail instead.
      if (c.resumeId) await access(path.join(sessions, c.resumeId));
      const sessionManager = c.resumeId
        ? this.sdk.SessionManager.open(path.join(sessions, c.resumeId), sessions, c.workspace)
        : this.sdk.SessionManager.create(c.workspace, sessions);
      const modelRuntime = await this.sdk.ModelRuntime.create({
        credentials: new this.ai.InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        signal: lifetime.signal,
      });
      modelRuntime.registerProvider('platform', {
        api: 'openai-completions',
        baseUrl: `${c.gatewayURL}/v1`,
        models: [
          {
            id: c.model,
            name: c.model,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: Math.min(
              c.modelLimits.contextTokens,
              c.modelLimits.inputTokens ?? c.modelLimits.contextTokens,
            ),
            maxTokens: c.modelLimits.maxOutputTokens,
            compat: { supportsStore: false, maxTokensField: 'max_completion_tokens' },
          },
        ],
      });
      await modelRuntime.setRuntimeApiKey('platform', c.token, { signal: lifetime.signal });
      const model = modelRuntime.getModel('platform', c.model);
      if (!model) throw new Error('Pi gateway model unavailable');
      const settingsManager = this.sdk.SettingsManager.inMemory({ retry: { enabled: false } });
      const resourceLoader = new this.sdk.DefaultResourceLoader({
        cwd: c.workspace,
        agentDir,
        settingsManager,
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
        appendSystemPromptOverride: () => (c.instructions ? [c.instructions] : []),
      });
      await resourceLoader.reload();
      const broker = await piBrokerTools(c, lifetime.signal);
      const { session } = await this.sdk
        .createAgentSession({
          cwd: c.workspace,
          agentDir,
          modelRuntime,
          model,
          thinkingLevel: 'off',
          sessionManager,
          settingsManager,
          resourceLoader,
          ...(guarded
            ? {
                noTools: 'builtin' as const,
                tools: [...broker.tools.map((tool) => tool.name), ...(definition ? [fileToolName] : [])],
              }
            : {}),
          customTools: [
            ...broker.tools,
            ...(guarded && definition
              ? [
                  {
                    name: fileToolName,
                    label: 'Worktree files',
                    description: definition.description,
                    parameters: z.toJSONSchema(
                      definition.schema,
                    ) as import('@earendil-works/pi-coding-agent').ToolDefinition['parameters'],
                    execute: async (_id: string, args: unknown) => ({
                      content: [{ type: 'text' as const, text: await files(args) }],
                      details: {},
                    }),
                  },
                ]
              : []),
          ],
        })
        .catch(async (error) => {
          lifetime.abort();
          await broker.close();
          throw error;
        });
      this.resident = {
        session,
        resumeId: path.basename(sessionManager.getSessionFile()!),
        broker,
        lifetime,
      };
    }
    const { session, resumeId } = this.resident;
    let output = '',
      failed = false,
      successful = false;
    let outputLimited = false;
    let finalStopReason: string | undefined;
    let pending = Promise.resolve();
    let messageId = randomUUID();
    const reasoningBlocks = new Set<string>();
    try {
      const abort = () => {
        void session.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        await emit({ type: 'runtime.started', data: { harness: 'pi', native_session_id: resumeId, reused } });
        const unsubscribe = session.subscribe((event) => {
          pending = pending.then(async () => {
            if (event.type === 'message_start') messageId = randomUUID();
            if (event.type === 'message_update') {
              const part = event.assistantMessageEvent;
              if (
                part.type === 'thinking_start' ||
                part.type === 'thinking_delta' ||
                part.type === 'thinking_end'
              ) {
                const block = part.partial.content[part.contentIndex];
                if (block?.type === 'thinking' && !block.redacted) {
                  const data = { reasoning_id: `${messageId}:${part.contentIndex}`, format: 'text' };
                  reasoningBlocks.add(data.reasoning_id);
                  // Pi can emit thinking_end before rejecting a truncated stream.
                  // Only the assistant message outcome establishes completion.
                  if (part.type === 'thinking_start') await emit({ type: 'reasoning.started', data });
                  else if (part.type === 'thinking_delta')
                    await emit({ type: 'reasoning.delta', data: { ...data, text: part.delta } });
                }
              }
            }
            if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
              const text = event.assistantMessageEvent.delta;
              output += text;
              await emit({ type: 'output.delta', data: { text } });
            }
            if (event.type === 'message_end' && event.message.role === 'assistant') {
              finalStopReason = event.message.stopReason;
              outputLimited ||= isOutputLimitReason(event.message.stopReason);
              const interrupted = outputLimited || ['error', 'aborted'].includes(event.message.stopReason);
              failed ||= interrupted;
              for (const id of reasoningBlocks)
                await emit({
                  type: 'reasoning.completed',
                  data: { reasoning_id: id, status: interrupted ? 'interrupted' : 'completed' },
                });
              reasoningBlocks.clear();
            }
            if (event.type === 'tool_execution_start')
              await emit({
                type: 'tool.started',
                data: {
                  tool_call_id: event.toolCallId,
                  name: event.toolName,
                  arguments: event.args,
                },
              });
            if (event.type === 'tool_execution_end')
              await emit({
                type: 'tool.completed',
                data: {
                  tool_call_id: event.toolCallId,
                  name: event.toolName,
                  result: event.result,
                  is_error: event.isError,
                },
              });
          });
          // Event subscribers are synchronous; keep errors observed until the drain below.
          void pending.catch(abort);
        });
        try {
          try {
            await session.prompt(c.prompt);
          } catch (error) {
            await pending;
            if (!outputLimited) throw error;
          }
          await pending;
          // These are valid intermediate boundaries, not a completed prompt.
          // Inspect only the final one so ordinary tool cycles still work.
          failed ||= ['pending', 'deferred', 'toolUse'].includes(finalStopReason || '');
          successful = !signal.aborted && !failed;
          return {
            output,
            resumeId,
            outcome: outputLimited
              ? 'failure'
              : signal.aborted
                ? 'cancelled'
                : failed
                  ? 'failure'
                  : 'success',
            ...(failed ? { failureCode: outputLimited ? modelOutputLimitExceeded : 'harness_error' } : {}),
          };
        } finally {
          unsubscribe();
        }
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } finally {
      if (!c.warm || !successful) await this.close();
    }
  }
}

export async function createAdapter(): Promise<HarnessAdapter> {
  const [sdk, ai] = await Promise.all([
    import('@earendil-works/pi-coding-agent'),
    import('@earendil-works/pi-ai'),
  ]);
  return new PiAdapter(sdk, ai);
}
