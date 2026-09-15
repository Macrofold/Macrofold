import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { HarnessContext, NativeResult } from './types';

/** Two embedded runtimes share this private JSONL protocol; it is not a public API. */
export async function runNativeBridge(
  name: string,
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
  { configuration: c, signal, emit, ask }: HarnessContext,
): Promise<NativeResult> {
  signal.throwIfAborted();
  const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  let stopInput!: () => void;
  const interrupted = new Promise<Record<string, unknown>>((resolve) => {
    stopInput = () => resolve({});
  });
  const abort = () => {
    stopInput();
    child.kill('SIGTERM');
  };
  signal.addEventListener('abort', abort, { once: true });
  let result: NativeResult | undefined;
  let pending = Promise.resolve();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    pending = pending.then(async () => {
      const message = JSON.parse(line);
      if (message.type === 'event') await emit(message.event);
      if (message.type === 'result') result = message.result;
      if (message.type === 'input') {
        const answer = await Promise.race([ask(message.id, message.question, message.details), interrupted]);
        if (!signal.aborted && child.exitCode === null && !child.stdin.destroyed)
          child.stdin.write(JSON.stringify({ id: message.id, answer }) + '\n');
      }
    });
    void pending.catch(abort);
  });
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        stopInput();
        resolve(code);
      });
    });
    if (signal.aborted) abort();
    else child.stdin.write(JSON.stringify(c) + '\n');
    const code = await exited;
    await pending;
    if (signal.aborted)
      return { output: result?.output || '', resumeId: result?.resumeId, outcome: 'cancelled' };
    if (code !== 0 || !result) throw new Error(`${name} native process failed`);
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    lines.close();
    child.stdin.destroy();
    child.kill('SIGTERM');
  }
}
