import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';

export class ClaudeAdapter implements HarnessAdapter {
  async run({ configuration: c, signal, emit, ask }: HarnessContext): Promise<NativeResult> {
    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    let output = '',
      resumeId = c.resumeId;
    let outcome: NativeResult['outcome'] = 'failure';
    const conversation = query({
      prompt: c.prompt,
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
        disallowedTools: ['WebSearch', 'WebFetch'],
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: c.stateHome,
          CLAUDE_CONFIG_DIR: `${c.stateHome}/.claude`,
          ANTHROPIC_BASE_URL: c.gatewayURL,
          ANTHROPIC_API_KEY: c.token,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        ...(c.instructions
          ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: c.instructions } }
          : {}),
        mcpServers: c.toolGrants
          ? { platform: { type: 'http', url: c.toolURL, headers: { Authorization: `Bearer ${c.token}` } } }
          : {},
        canUseTool: async (name, input) => {
          if (name === 'AskUserQuestion') {
            const answer = await ask(randomUUID(), 'Your agent has a question.', input);
            return { behavior: 'allow', updatedInput: { ...input, answers: answer.answers || answer } };
          }
          return { behavior: 'allow', updatedInput: input };
        },
      },
    });
    try {
      for await (const message of conversation) {
        const raw = message as unknown as Record<string, unknown>;
        if (typeof raw.session_id === 'string') resumeId = raw.session_id;
        if (message.type === 'system' && message.subtype === 'init')
          await emit({
            type: 'runtime.started',
            data: { harness: 'claude-code', native_session_id: resumeId },
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
        }
      }
    } finally {
      conversation.close();
    }
    return { output, resumeId, outcome, ...(outcome === 'failure' ? { failureCode: 'harness_error' } : {}) };
  }
}
