import { permissionAdapters } from '../../contracts/permission-adapters';
import { questionsAllowed } from '../../contracts/permissions';
import { permissionFileTools, fileToolName, permissionFileDefinition } from './permission-files';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { TurnInput } from './turn-input';
import { randomUUID } from 'node:crypto';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { isOutputLimitReason, modelOutputLimitExceeded } from '../../contracts/model-completion';

type ClaudeSDK = typeof import('@anthropic-ai/claude-agent-sdk');
class ClaudeAdapter implements HarnessAdapter {
  constructor(private readonly sdk: ClaudeSDK) {}
  private conversation?: ReturnType<ClaudeSDK['query']>;
  private input?: TurnInput<SDKUserMessage>;
  private context?: HarnessContext;
  close() {
    this.conversation?.close();
    this.input?.close();
    this.conversation = undefined;
    this.input = undefined;
    this.context = undefined;
  }
  async run(context: HarnessContext): Promise<NativeResult> {
    this.context = context;
    const { configuration: c, images = [], signal, emit } = context;
    const guarded = permissionAdapters['claude-code'].translate(c.permissions || []).mode === 'guarded';
    const allowQuestions = questionsAllowed(c.permissions || []);
    const files = permissionFileTools(c.workspace, c.permissions || []);
    const definition = permissionFileDefinition(c.permissions || []);
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      this.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    let reasoningMessageId: string = randomUUID();
    const reasoningBlocks = new Map<number, string>();
    let output = '',
      resumeId = c.resumeId;
    let outcome: NativeResult['outcome'] = 'failure';
    let outputLimited = false;
    const reused = Boolean(this.conversation);
    const input = this.input || new TurnInput<SDKUserMessage>();
    this.input = input;
    const conversation =
      this.conversation ||
      this.sdk.query({
        prompt: input,
        options: {
          cwd: c.workspace,
          model: c.model,
          resume: c.resumeId,
          abortController: controller,
          includePartialMessages: true,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          settingSources: [],
          strictMcpConfig: true,
          disallowedTools: [
            'WebSearch',
            'WebFetch',
            ...(!allowQuestions ? ['AskUserQuestion'] : []),
            ...(guarded
              ? ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent', 'Task', 'Skill', 'NotebookEdit']
              : []),
          ],
          ...(guarded ? { tools: allowQuestions ? ['AskUserQuestion'] : [] } : {}),
          env: {
            NODE_ENV: 'production',
            PATH: process.env.PATH,
            HOME: c.stateHome,
            CLAUDE_CONFIG_DIR: `${c.stateHome}/.claude`,
            ANTHROPIC_BASE_URL: c.gatewayURL,
            ANTHROPIC_API_KEY: c.token,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(c.modelLimits.maxOutputTokens),
          },
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: c.instructions || '',
          },
          mcpServers: {
            ...(c.toolGrants
              ? {
                  platform: {
                    type: 'http' as const,
                    url: c.toolURL,
                    headers: { Authorization: `Bearer ${c.token}` },
                  },
                }
              : {}),
            ...(guarded && definition
              ? {
                  worktree: this.sdk.createSdkMcpServer({
                    name: 'worktree',
                    tools: [
                      this.sdk.tool(fileToolName, definition.description, definition.shape, async (args) => {
                        try {
                          return { content: [{ type: 'text' as const, text: await files(args) }] };
                        } catch (error) {
                          return {
                            isError: true,
                            content: [{ type: 'text' as const, text: (error as Error).message }],
                          };
                        }
                      }),
                    ],
                  }),
                }
              : {}),
          },
          canUseTool: async (name, input) => {
            if (name === 'AskUserQuestion') {
              if (!questionsAllowed(this.context!.configuration.permissions || []))
                return { behavior: 'deny', message: 'Native questions are denied by policy.' };
              const answer = await this.context!.ask(randomUUID(), 'Your agent has a question.', input);
              return { behavior: 'allow', updatedInput: { ...input, answers: answer.answers || answer } };
            }
            return { behavior: 'allow', updatedInput: input };
          },
        },
      });
    this.conversation = conversation;
    input.push({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: c.prompt },
          ...images.map((image) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
          })),
        ],
      },
    });
    if (reused)
      await emit({
        type: 'runtime.started',
        data: { harness: 'claude-code', native_session_id: resumeId, reused: true },
      });
    try {
      for (;;) {
        const next = await conversation.next();
        if (next.done) break;
        const message = next.value;
        const raw = message as unknown as Record<string, unknown>;
        if (typeof raw.session_id === 'string') resumeId = raw.session_id;
        if (message.type === 'system' && message.subtype === 'init')
          await emit({
            type: 'runtime.started',
            data: { harness: 'claude-code', native_session_id: resumeId, reused: false },
          });
        if (message.type === 'stream_event') {
          const event = message.event as unknown as {
            type: string;
            index?: number;
            message?: { id: string };
            delta?: { type: string; text?: string; thinking?: string; stop_reason?: string };
            content_block?: { type: string; id?: string; name?: string; input?: unknown };
          };
          outputLimited ||= isOutputLimitReason(event.delta?.stop_reason);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            output += event.delta.text || '';
            await emit({ type: 'output.delta', data: { text: event.delta.text || '' } });
          }
          if (event.type === 'message_start') {
            reasoningMessageId = event.message?.id || randomUUID();
            reasoningBlocks.clear();
          }
          if (
            event.type === 'content_block_start' &&
            event.content_block?.type === 'thinking' &&
            event.index !== undefined
          ) {
            const id = `${reasoningMessageId}:${event.index}`;
            reasoningBlocks.set(event.index, id);
            await emit({ type: 'reasoning.started', data: { reasoning_id: id, format: 'text' } });
          }
          if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'thinking_delta' &&
            event.index !== undefined
          ) {
            const id = reasoningBlocks.get(event.index);
            if (id && event.delta.thinking)
              await emit({
                type: 'reasoning.delta',
                data: { reasoning_id: id, format: 'text', text: event.delta.thinking },
              });
          }
          if (event.type === 'content_block_stop' && event.index !== undefined) {
            const id = reasoningBlocks.get(event.index);
            if (id)
              await emit({ type: 'reasoning.completed', data: { reasoning_id: id, status: 'completed' } });
            reasoningBlocks.delete(event.index);
          }
          // Signatures and redacted_thinking remain native protocol state only.
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
            await emit({
              type: 'tool.started',
              data: {
                tool_call_id: event.content_block.id,
                name: event.content_block.name,
                arguments: event.content_block.input || {},
              },
            });
        }
        if (message.type === 'user')
          for (const block of Array.isArray(message.message.content) ? message.message.content : []) {
            if (block.type === 'tool_result')
              await emit({
                type: 'tool.completed',
                data: { tool_call_id: block.tool_use_id, result: block.content, is_error: block.is_error },
              });
          }
        if (message.type === 'result') {
          outputLimited ||= isOutputLimitReason(message.stop_reason);
          const unfinished = ['tool_use', 'pause_turn', 'model_context_window_exceeded'].includes(
            message.stop_reason || '',
          );
          outcome = outputLimited
            ? 'failure'
            : message.subtype === 'success' && !unfinished
              ? 'success'
              : signal.aborted
                ? 'cancelled'
                : 'failure';
          if (message.subtype === 'success' && message.result) output = message.result;
          break;
        }
      }
    } catch (error) {
      if (!outputLimited) throw error;
      outcome = 'failure';
    } finally {
      signal.removeEventListener('abort', abort);
      if (!c.warm || outcome !== 'success') this.close();
    }
    return {
      output,
      resumeId,
      outcome,
      ...(outcome === 'failure'
        ? { failureCode: outputLimited ? modelOutputLimitExceeded : 'harness_error' }
        : {}),
    };
  }
}

export async function createAdapter(): Promise<HarnessAdapter> {
  return new ClaudeAdapter(await import('@anthropic-ai/claude-agent-sdk'));
}
