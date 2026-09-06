/** Provider port: never exposes platform credentials or provider objects to the domain. */
export type ExecutionEvent = { type: string; data: Record<string, unknown> };
export type ExecutionFile = { path: string; bytes: Buffer; mode?: number };
export type ExecutionRequest = {
  runId: string;
  organizationId: string;
  sessionId: string;
  harness: string;
  model: string;
  prompt: string;
  instructions?: string;
  files: ExecutionFile[];
  timeoutSeconds: number;
  resumeState?: string;
  signal: AbortSignal;
};
export type ExecutionResult = {
  output: string;
  files: ExecutionFile[];
  resumeState?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  usageComplete: boolean;
};
export interface ExecutionProvider {
  execute(
    request: ExecutionRequest,
    onEvent: (event: ExecutionEvent) => Promise<void>,
  ): Promise<ExecutionResult>;
}

/** A deliberately labeled fixture, used for free acceptance tests and local development. */
export class Simulator implements ExecutionProvider {
  async execute(
    request: ExecutionRequest,
    onEvent: (event: ExecutionEvent) => Promise<void>,
  ): Promise<ExecutionResult> {
    const pause = async () => {
      if (request.signal.aborted) throw request.signal.reason;
      await new Promise((r) => setTimeout(r, 120));
    };
    await onEvent({ type: 'runtime.started', data: { harness: request.harness, simulated: true } });
    await onEvent({
      type: 'tool.started',
      data: {
        tool_call_id: `${request.runId}:list`,
        name: 'workspace.list',
        arguments: { path: '.' },
        simulated: true,
      },
    });
    await pause();
    await onEvent({
      type: 'tool.completed',
      data: {
        tool_call_id: `${request.runId}:list`,
        result: { paths: request.files.map((f) => f.path) },
        simulated: true,
      },
    });
    const previous = request.resumeState
      ? (JSON.parse(request.resumeState) as { turn: number })
      : { turn: 0 };
    const output = `Simulation completed · turn ${previous.turn + 1}\n\nYour persistent workspace contains ${request.files.length} file${request.files.length === 1 ? '' : 's'}. The request was saved, streamed, and checkpointed without calling a model.\n\nRequest: ${request.prompt}`;
    for (const part of output.match(/.{1,32}(?:\n|$)?/gs) || []) {
      await pause();
      await onEvent({ type: 'output.delta', data: { text: part, simulated: true } });
    }
    const path = `notes/run-${request.runId}.md`;
    const content = Buffer.from(`# Run record\n\n${output}\n`);
    await onEvent({
      type: 'tool.started',
      data: {
        tool_call_id: `${request.runId}:write`,
        name: 'workspace.write',
        arguments: { path },
        simulated: true,
      },
    });
    await pause();
    await onEvent({
      type: 'tool.completed',
      data: {
        tool_call_id: `${request.runId}:write`,
        result: { path, bytes: content.length },
        simulated: true,
      },
    });
    return {
      output,
      files: [...request.files, { path, bytes: content }],
      resumeState: JSON.stringify({ turn: previous.turn + 1 }),
      inputTokens: 0,
      outputTokens: 0,
      usageComplete: true,
    };
  }
}
