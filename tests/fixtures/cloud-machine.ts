import { sha256 } from '../../packages/core/src/crypto';
import type { MachineProvider, MachineBinding, RuntimeProbe } from '../../packages/core/src/ports';
import type { SnapshotEntry } from '../../packages/runtime/src/manifest';

export class FaultMachine implements MachineProvider {
  starts = 0;
  pendingPolls = 0;
  snapshotPages = 1;
  attempts = 0;
  closes: boolean[] = [];
  launched = false;
  lostLaunch = false;
  lostVM = false;
  outcome: 'success' | 'failure' | 'cancelled' = 'success';
  cancellations = 0;
  stageFiles = new Map<string, Buffer>();
  bytes = Buffer.from('Changed by the native fixture.');
  async provision(name: string): Promise<MachineBinding> {
    return { name, sessionId: 'original-vm', createdAt: new Date().toISOString() };
  }
  async prepare() {}
  async stage(_binding: MachineBinding, files: { path: string; content: Buffer }[]) {
    for (const f of files) this.stageFiles.set(f.path, f.content);
  }
  async restore() {
    return 'restore-command';
  }
  async restored() {
    return 'success' as const;
  }
  async launch() {
    this.attempts++;
    if (!this.launched) {
      this.launched = true;
      this.starts++;
      if (this.lostLaunch) throw new Error('Lost response after native dispatch');
    }
    return 'original-command';
  }
  async probe(_binding: MachineBinding, offset: number): Promise<RuntimeProbe> {
    if (this.pendingPolls-- > 0)
      return { events: [], nextOffset: offset, status: { state: 'running' }, input: null, result: null };
    if (this.lostVM) throw new Error('Original VM unavailable');
    return {
      events: offset
        ? []
        : [
            { sequence: 1, type: 'output.delta', data: { text: 'Completed.' } },
            { sequence: 2, type: 'tool.completed', data: { tool_call_id: 'fixture-tool', result: 'saved' } },
          ],
      nextOffset: offset || 100,
      status: { state: 'finished' },
      input: null,
      result: {
        output: 'Completed.',
        resumeId: 'native-session',
        outcome: this.outcome,
        persistence: 'captured',
        completedAt: new Date().toISOString(),
      },
    };
  }
  async answer() {}
  async cancel() {
    this.cancellations++;
    this.outcome = 'cancelled';
    this.pendingPolls = 0;
  }
  async snapshotPage(_binding: MachineBinding, offset: number) {
    const hash = sha256(this.bytes);
    const entries: SnapshotEntry[] = [
      {
        namespace: 'workspace',
        path: 'durable.txt',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o644,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
      {
        namespace: 'workspace',
        path: '.git/HEAD',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o644,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
      {
        namespace: 'home',
        path: '.codex/state.json',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o600,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
    ];
    if (this.snapshotPages > 1)
      return {
        entries: offset < this.snapshotPages ? [{ ...entries[0], path: `page-${offset}.txt` }] : [],
        total: this.snapshotPages,
        totalBytes: this.bytes.length * this.snapshotPages,
      };
    return { entries: entries.slice(offset), total: entries.length, totalBytes: this.bytes.length * 3 };
  }
  async chunk() {
    return this.bytes;
  }
  async close(_binding: MachineBinding, preserve: boolean) {
    this.closes.push(preserve);
    return preserve ? { snapshotId: 'recovery-snapshot' } : {};
  }
}
