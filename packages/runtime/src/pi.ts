import { z } from 'zod';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { permissionFileTools, fileToolName, fileToolDescription, fileToolSchema } from './permission-files';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { piBrokerTools } from './pi-tools';

export class PiAdapter implements HarnessAdapter {
  async run({ configuration: c, signal, emit }: HarnessContext): Promise<NativeResult> {
    const guarded = permissionAdapters.pi.translate(c.permissions || []).mode === 'guarded';
    const files = permissionFileTools(c.workspace, c.permissions || []);
    signal.throwIfAborted();
    const agentDir = path.join(c.stateHome, '.pi/agent');
    const sessions = path.join(agentDir, 'sessions');
    if (c.resumeId && path.basename(c.resumeId) !== c.resumeId) throw new Error('Invalid Pi session');
    // Pi opens a new session for a missing file. A requested continuation must fail instead.
    if (c.resumeId) await access(path.join(sessions, c.resumeId));
    const sessionManager = c.resumeId
      ? SessionManager.open(path.join(sessions, c.resumeId), sessions, c.workspace)
      : SessionManager.create(c.workspace, sessions);
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      signal,
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
          contextWindow: 128000,
          maxTokens: 8192,
          compat: { supportsStore: false, maxTokensField: 'max_completion_tokens' },
        },
      ],
    });
    await modelRuntime.setRuntimeApiKey('platform', c.token, { signal });
    const model = modelRuntime.getModel('platform', c.model);
    if (!model) throw new Error('Pi gateway model unavailable');
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({
      cwd: c.workspace,
      agentDir,
      settingsManager,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      appendSystemPromptOverride: () => (c.instructions ? [c.instructions] : []),
    });
    await resourceLoader.reload();
    const broker = await piBrokerTools(c, signal);
    let output = '',
      failed = false;
    let pending = Promise.resolve();
    try {
      const { session } = await createAgentSession({
        cwd: c.workspace,
        agentDir,
        modelRuntime,
        model,
        thinkingLevel: 'off',
        sessionManager,
        settingsManager,
        resourceLoader,
        ...(guarded
          ? { noTools: 'builtin' as const, tools: [...broker.tools.map((tool) => tool.name), fileToolName] }
          : {}),
        customTools: [
          ...broker.tools,
          ...(guarded
            ? [
                {
                  name: fileToolName,
                  label: 'Worktree files',
                  description: fileToolDescription,
                  parameters: z.toJSONSchema(
                    fileToolSchema,
                  ) as import('@earendil-works/pi-coding-agent').ToolDefinition['parameters'],
                  execute: async (_id: string, args: unknown) => ({
                    content: [{ type: 'text' as const, text: await files(args) }],
                    details: {},
                  }),
                },
              ]
            : []),
        ],
      });
      const abort = () => {
        void session.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        const resumeId = path.basename(sessionManager.getSessionFile()!);
        await emit({ type: 'runtime.started', data: { harness: 'pi', native_session_id: resumeId } });
        const unsubscribe = session.subscribe((event) => {
          pending = pending.then(async () => {
            if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
              const text = event.assistantMessageEvent.delta;
              output += text;
              await emit({ type: 'output.delta', data: { text } });
            }
            if (event.type === 'message_end' && event.message.role === 'assistant')
              failed ||= event.message.stopReason === 'error' || event.message.stopReason === 'aborted';
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
          await session.prompt(c.prompt);
          await pending;
          return {
            output,
            resumeId,
            outcome: signal.aborted ? 'cancelled' : failed ? 'failure' : 'success',
            ...(failed ? { failureCode: 'harness_error' } : {}),
          };
        } finally {
          unsubscribe();
        }
      } finally {
        signal.removeEventListener('abort', abort);
        session.dispose();
      }
    } finally {
      await broker.close();
    }
  }
}
