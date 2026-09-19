import { permissionAdapters } from '../../contracts/permission-adapters';
import { permissionFileTools, fileToolName, fileToolDescription, fileToolShape } from './permission-files';
import { query, createSdkMcpServer, tool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { TurnInput } from './turn-input';
import { randomUUID } from 'node:crypto';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';

export class ClaudeAdapter implements HarnessAdapter {
  private conversation?: ReturnType<typeof query>;
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
    const files = permissionFileTools(c.workspace, c.permissions || []);
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      this.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    let output = '',
      resumeId = c.resumeId;
    let outcome: NativeResult['outcome'] = 'failure';
    const reused = Boolean(this.conversation);
    const input = this.input || new TurnInput<SDKUserMessage>();
    this.input = input;
    const conversation =
      this.conversation ||
      query({
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
            ...(guarded
              ? ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent', 'Task', 'Skill', 'NotebookEdit']
              : []),
          ],
          ...(guarded ? { tools: ['AskUserQuestion'] } : {}),
          env: {
            NODE_ENV: 'production',
            PATH: process.env.PATH,
            HOME: c.stateHome,
            CLAUDE_CONFIG_DIR: `${c.stateHome}/.claude`,
            ANTHROPIC_BASE_URL: c.gatewayURL,
            ANTHROPIC_API_KEY: c.token,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: [
              `Your persistent worktree is ${c.workspace}. Save requested deliverables there. Files in /tmp or elsewhere outside the workspace are not included in workspace checkpoints. Verify output files in the workspace before reporting completion.`,
              c.instructions,
            ]
              .filter(Boolean)
              .join('\n\n'),
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
            ...(guarded
              ? {
                  worktree: createSdkMcpServer({
                    name: 'worktree',
                    tools: [
                      tool(fileToolName, fileToolDescription, fileToolShape, async (args) => {
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
            delta?: { type: string; text?: string };
            content_block?: { type: string; id?: string; name?: string; input?: unknown };
          };
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            output += event.delta.text || '';
            await emit({ type: 'output.delta', data: { text: event.delta.text || '' } });
          }
          // Private thinking blocks are deliberately not persisted or displayed.
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
          outcome = message.subtype === 'success' ? 'success' : signal.aborted ? 'cancelled' : 'failure';
          if (message.subtype === 'success' && message.result) output = message.result;
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', abort);
      if (!c.warm || outcome !== 'success') this.close();
    }
    return { output, resumeId, outcome, ...(outcome === 'failure' ? { failureCode: 'harness_error' } : {}) };
  }
}
