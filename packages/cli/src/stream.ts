import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Client, Schema } from '../../../sdk/typescript/src/client';
import { release } from './settings';
import { CliError, prompt, terminalText } from './output';

export const outcomeExit = (result: Schema['RunResult']) =>
  result.execution_outcome === 'success'
    ? 0
    : result.execution_outcome === 'timed_out'
      ? 8
      : result.execution_outcome === 'cancelled'
        ? 130
        : result.final
          ? 1
          : 4;
export function waitingLine(run: Schema['Run']) {
  const reason = {
    global_capacity: 'global capacity occupied',
    account_concurrency: 'account concurrency limit',
    earlier_workspace_work: 'earlier workspace work',
    scheduler_turn: 'awaiting a fair scheduling turn',
    cancellation_requested: 'cancellation requested',
    deadline_expired: 'deadline expired; finalizing',
    workspace_unavailable: 'workspace unavailable',
  }[run.waiting_reason || 'scheduler_turn'];
  return `Queued ${Math.floor(run.wait_seconds || 0)}s · ${reason} · expires ${run.queue_expires_at} · $${(Number(run.reserved_micro_usd || 0) / 1000000).toFixed(2)} held · cancel: agent run cancel ${run.id}`;
}
export const eventLine = (event: Schema['Event']) => {
  if (event.type === 'output.delta') return String(event.data.text || '');
  if (event.type === 'reasoning.summary') return `Reasoning summary: ${String(event.data.text || '')}`;
  if (event.type.startsWith('tool.'))
    return `${event.type === 'tool.started' ? '↳' : '✓'} ${String(event.data.name || event.data.tool || 'Tool')} ${String(event.data.summary || '')}`;
  if (event.type === 'input.requested')
    return `Input requested: ${String(event.data.question || event.data.prompt || 'See input details')}`;
  return event.type.startsWith('run.')
    ? event.type.replace('run.', '') + (event.data.code ? ` · ${String(event.data.code)}` : '')
    : '';
};
async function cursorFile(client: Client, runId: string) {
  const directory = path.join(release.configDirectory, 'cursors');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CliError('Unsafe stream cursor directory.');
  const name = createHash('sha256').update(`${client.baseURL}:${runId}`).digest('hex');
  return path.join(directory, name + '.json');
}
export async function readCursor(client: Client, runId: string) {
  try {
    const file = await cursorFile(client, runId);
    if ((await lstat(file)).isSymbolicLink()) throw new CliError('Unsafe stream cursor file.');
    const data = JSON.parse(await readFile(file, 'utf8'));
    return /^\d+$/.test(data.sequence) ? String(data.sequence) : '0';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '0';
    throw error;
  }
}
async function saveCursor(client: Client, event: Schema['Event']) {
  const file = await cursorFile(client, event.run_id),
    temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ sequence: event.sequence }), { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}
export async function followRun(
  client: Client,
  runId: string,
  options: {
    after?: string;
    signal?: AbortSignal;
    onEvent?: (event: Schema['Event']) => void | Promise<void>;
    onWaiting?: (run: Schema['Run']) => void;
    interactiveInput?: boolean;
  } = {},
) {
  let closed = false,
    polling = false;
  const observe = async () => {
    if (closed || polling || !options.onWaiting || options.signal?.aborted) return;
    polling = true;
    try {
      const run = await client.request('getRun', { params: { path: { run_id: runId } } });
      if (!closed && !options.signal?.aborted && run.status === 'queued') options.onWaiting(run);
    } catch {
      /* The resumable event stream owns transport error reporting. */
    } finally {
      polling = false;
    }
  };
  const timer = options.onWaiting
    ? setInterval(() => {
        void observe();
      }, 5000)
    : undefined;
  void observe();
  try {
    for await (const event of client.stream(runId, {
      after: options.after ?? (await readCursor(client, runId)),
      signal: options.signal,
    })) {
      await options.onEvent?.(event);
      await saveCursor(client, event);
      if (event.type === 'input.requested') {
        if (!options.interactiveInput)
          throw new CliError(
            `Run ${runId} is waiting for input. Use agent run input ${runId} --request ${String(event.data.input_request_id)} --answer-file FILE.`,
            4,
          );
        const answer = await prompt(
          `${terminalText(event.data.question || event.data.prompt || 'Agent input')} `,
        );
        await client.request('submitRunInput', {
          params: { path: { run_id: runId } },
          body: { input_request_id: String(event.data.input_request_id), answer: { text: answer } },
        });
      }
    }
    return client.request('getRunResult', { params: { path: { run_id: runId } } });
  } finally {
    closed = true;
    clearInterval(timer);
  }
}
export async function streamCommand(
  client: Client,
  runId: string,
  options: { json?: boolean; jsonl?: boolean; plain?: boolean; after?: string },
) {
  const controller = new AbortController();
  let interrupts = 0,
    cancelled = false;
  const interrupt = () => {
    if (++interrupts > 1) {
      process.stderr.write(
        `Detached from ${runId}; cancellation ${cancelled ? 'acknowledged' : 'not confirmed'}.\n`,
      );
      controller.abort(new CliError('Interrupted.', 130));
      return;
    }
    process.stderr.write(`Cancelling ${runId}; waiting for persistence…\n`);
    void client.request('cancelRun', { params: { path: { run_id: runId } } }).then(
      () => {
        cancelled = true;
      },
      () => {
        process.stderr.write('Cancellation could not be confirmed; Ctrl-C again to detach.\n');
      },
    );
  };
  process.on('SIGINT', interrupt);
  try {
    if (!options.json && !options.jsonl)
      process.stderr.write(`Run ${runId} · reconnect with agent run attach ${runId}\n`);
    const result = await followRun(client, runId, {
      after: options.after,
      signal: controller.signal,
      interactiveInput: !options.json && !options.jsonl && Boolean(process.stdin.isTTY),
      onWaiting:
        !options.json && !options.jsonl
          ? (run) => process.stderr.write(terminalText(waitingLine(run)) + '\n')
          : undefined,
      onEvent: (event) => {
        if (options.jsonl) process.stdout.write(JSON.stringify(event) + '\n');
        else if (!options.json) {
          const text = eventLine(event);
          if (text) {
            if (event.type === 'output.delta') {
              if (process.stdout.isTTY) process.stdout.write(terminalText(text));
            } else process.stderr.write(terminalText(text) + '\n');
          }
        }
      },
    });
    if (!options.json && !options.jsonl) {
      if (!process.stdout.isTTY) process.stdout.write(terminalText(result.output_text || '') + '\n');
      else process.stdout.write('\n');
    }
    return result;
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}
