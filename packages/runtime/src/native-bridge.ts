import {
  spawn,
  type SpawnOptionsWithoutStdio,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createInterface } from 'node:readline';
import type { HarnessContext, NativeResult } from './types';

/** Two embedded runtimes share this private JSONL protocol; it is not a public API. */
export class NativeBridge {
  private child?: ChildProcessWithoutNullStreams;
  close() {
    this.child?.stdin.destroy();
    this.child?.kill('SIGTERM');
    this.child = undefined;
  }
  async run(
    name: string,
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
    { configuration: c, signal, emit, ask }: HarnessContext,
  ): Promise<NativeResult> {
    signal.throwIfAborted();
    const child = this.child || spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stderr.resume();
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
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
        if (message.type === 'result') {
          result = message.result;
          finish();
        }
        if (message.type === 'input') {
          const answer = await Promise.race([
            ask(message.id, message.question, message.details),
            interrupted,
          ]);
          if (!signal.aborted && child.exitCode === null && !child.stdin.destroyed)
            child.stdin.write(JSON.stringify({ id: message.id, answer }) + '\n');
        }
      });
      void pending.catch(abort);
    });
    let onError: ((error: Error) => void) | undefined;
    let onClose: ((code: number | null) => void) | undefined;
    try {
      const exited = new Promise<number | null>((resolve, reject) => {
        onError = reject;
        child.once('error', onError);
        onClose = (code) => {
          stopInput();
          resolve(code);
        };
        child.once('close', onClose);
      });
      if (signal.aborted) abort();
      else child.stdin.write(JSON.stringify(c) + '\n');
      const code = c.warm ? await Promise.race([completed.then(() => 0), exited]) : await exited;
      await pending;
      if (signal.aborted)
        return { output: result?.output || '', resumeId: result?.resumeId, outcome: 'cancelled' };
      if (code !== 0 || !result) throw new Error(`${name} native process failed`);
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      if (onError) child.removeListener('error', onError);
      if (onClose) child.removeListener('close', onClose);
      lines.close();
      if (!c.warm || result?.outcome !== 'success' || signal.aborted) this.close();
    }
  }
}
export async function runNativeBridge(
  name: string,
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
  context: HarnessContext,
) {
  const bridge = new NativeBridge();
  try {
    return await bridge.run(name, command, args, options, context);
  } finally {
    bridge.close();
  }
}
