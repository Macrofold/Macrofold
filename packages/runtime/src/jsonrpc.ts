import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
export type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};
/** Small stdio protocol transport. Shell interpretation and inherited credentials are excluded. */
export class JsonRpcProcess {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private dispatch: Promise<void> = Promise.resolve();
  private closed = false;
  onMessage: (message: RpcMessage) => Promise<void> = async () => {};
  onExit: (error: Error) => void = () => {};
  constructor(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
    this.child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    // Native stderr may contain request context. The host receives a sanitized error code.
    this.child.stderr.resume();
    this.child.stdin.on('error', (error) => this.fail(error));
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (line.length > 16 * 1024 * 1024) {
        this.close();
        return;
      }
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(Number(message.id));
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(Number(message.id));
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
        return;
      }
      this.dispatch = this.dispatch.then(() => this.onMessage(message)).catch((error) => this.onExit(error));
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code) => {
      // The last response/notification can arrive after `exit`. Process every
      // complete stdout frame before reporting an unexpected protocol closure.
      if (!this.closed) {
        this.closed = true;
        void this.dispatch.then(() => this.fail(new Error(`Native process exited (${code})`)));
      }
    });
  }
  request<T>(method: string, params: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Native process closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native protocol request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ id, method, params });
    });
  }
  send(message: RpcMessage) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private fail(error: Error) {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.onExit(error);
  }
  async drain() {
    await this.dispatch;
  }
  close() {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Native process closed'));
    }
    this.pending.clear();
    this.child.kill('SIGTERM');
  }
}
