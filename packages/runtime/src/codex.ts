import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { JsonRpcProcess, type RpcMessage } from './jsonrpc';
import type { HarnessAdapter, HarnessContext, NativeResult, NativeEvent } from './types';

export function codexEvent(message: RpcMessage): NativeEvent | undefined {
  const params = message.params || {};
  const item = params.item as Record<string, unknown> | undefined;
  if (message.method === 'item/agentMessage/delta')
    return { type: 'output.delta', data: { text: params.delta || '' } };
  if (message.method === 'item/reasoning/summaryTextDelta')
    return { type: 'reasoning.summary', data: { text: params.delta || '' } };
  if (item && ['item/started', 'item/completed'].includes(message.method || '')) {
    const type = String(item.type);
    if (['reasoning', 'agentMessage', 'userMessage', 'contextCompaction', 'plan'].includes(type)) return;
    const started = message.method === 'item/started';
    return {
      type: started ? 'tool.started' : 'tool.completed',
      data: {
        tool_call_id: item.id,
        name: type,
        ...(started
          ? {
              arguments: {
                ...(item.command ? { command: item.command } : {}),
                ...(item.arguments ? { arguments: item.arguments } : {}),
                ...(item.tool ? { tool: item.tool } : {}),
                ...(item.server ? { server: item.server } : {}),
              },
            }
          : {
              result: {
                ...(item.aggregatedOutput ? { output: item.aggregatedOutput } : {}),
                ...(item.result ? { result: item.result } : {}),
                ...(item.changes ? { changes: item.changes } : {}),
                status: item.status,
                exit_code: item.exitCode,
              },
            }),
      },
    };
  }
  return undefined;
}
export class CodexAdapter implements HarnessAdapter {
  async run({ configuration: c, signal, emit, ask }: HarnessContext): Promise<NativeResult> {
    await mkdir(`${c.stateHome}/.codex`, { recursive: true, mode: 0o700 });
    const overrides: Record<string, unknown> = {
      model_provider: 'platform',
      model: c.model,
      'model_providers.platform.name': 'Platform',
      'model_providers.platform.base_url': `${c.gatewayURL}/v1`,
      'model_providers.platform.env_key': 'PLATFORM_RUN_TOKEN',
      'model_providers.platform.wire_api': 'responses',
      'model_providers.platform.requires_openai_auth': false,
      approval_policy: 'never',
      sandbox_mode: 'danger-full-access',
      web_search: 'disabled',
      'analytics.enabled': false,
    };
    if (c.toolGrants) {
      overrides['mcp_servers.platform.url'] = c.toolURL;
      overrides['mcp_servers.platform.bearer_token_env_var'] = 'PLATFORM_RUN_TOKEN';
    }
    const rpc = new JsonRpcProcess(
      process.env.CODEX_BINARY || 'codex',
      [
        'app-server',
        '--stdio',
        ...Object.entries(overrides).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]),
      ],
      {
        cwd: c.workspace,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: c.stateHome,
          CODEX_HOME: `${c.stateHome}/.codex`,
          PLATFORM_RUN_TOKEN: c.token,
        },
      },
    );
    let output = '',
      threadId = c.resumeId,
      turnId = '';
    let resolve!: (value: NativeResult) => void, reject!: (error: Error) => void;
    const completed = new Promise<NativeResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    rpc.onExit = reject;
    rpc.onMessage = async (message) => {
      if (message.id !== undefined && message.method) {
        if (message.method === 'item/tool/requestUserInput') {
          const requestId = randomUUID(),
            questions = (message.params?.questions || []) as { id: string; question: string }[];
          const answer = await ask(requestId, questions.map((q) => q.question).join('\n'), { questions });
          rpc.send({
            id: message.id,
            result: {
              answers:
                answer.answers ||
                Object.fromEntries(questions.map((q) => [q.id, { answers: [String(answer.text || '')] }])),
            },
          });
        } else
          rpc.send({
            id: message.id,
            error: { code: -32601, message: 'This runtime does not grant additional approvals.' },
          });
        return;
      }
      const event = codexEvent(message);
      if (event) {
        if (event.type === 'output.delta') output += String(event.data.text);
        await emit(event);
      }
      if (message.method === 'turn/completed') {
        const turn = message.params?.turn as { status: string; error?: unknown };
        resolve({
          output,
          resumeId: threadId,
          outcome: turn.status === 'completed' ? 'success' : signal.aborted ? 'cancelled' : 'failure',
          ...(turn.error ? { failureCode: 'harness_error' } : {}),
        });
      }
    };
    const abort = () => {
      if (threadId && turnId) void rpc.request('turn/interrupt', { threadId, turnId }, 3000).catch(() => {});
      setTimeout(() => {
        rpc.close();
        resolve({ output, resumeId: threadId, outcome: 'cancelled' });
      }, 2000).unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'platform-runtime', title: 'Hosted agent runtime', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      rpc.send({ method: 'initialized', params: {} });
      const options = {
        cwd: c.workspace,
        model: c.model,
        modelProvider: 'platform',
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        ...(c.instructions ? { developerInstructions: c.instructions } : {}),
      };
      const thread = await rpc.request<{ thread: { id: string } }>(
        threadId ? 'thread/resume' : 'thread/start',
        { ...options, ...(threadId ? { threadId } : { ephemeral: false }) },
      );
      threadId = thread.thread.id;
      await emit({ type: 'runtime.started', data: { harness: 'codex', native_session_id: threadId } });
      const turn = await rpc.request<{ turn: { id: string } }>('turn/start', {
        threadId,
        input: [{ type: 'text', text: c.prompt, text_elements: [] }],
        serviceTierForTurn: 'default',
      });
      turnId = turn.turn.id;
      const result = await completed;
      await rpc.drain();
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      rpc.close();
    }
  }
}
