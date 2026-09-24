import { readFile } from 'node:fs/promises';
import { KeyedCommands } from './host-paths';

export type HostResourceMeters = { kind: 'resource'; cpu_ms: string; memory_mib_ms: string };
export async function cgroupCPUTime(): Promise<bigint> {
  const contents = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8');
  const value = /^usage_usec\s+(\d+)$/m.exec(contents)?.[1];
  if (value === undefined) throw new Error('host_usage_unavailable');
  return BigInt(value);
}
/** Meter epochs are bound to the controller boot identity. Idle speculative caches are not a billable allocation. */
export class HostMeter {
  private readonly lock = new KeyedCommands();
  private readonly assignments = new Map<string, number>();
  private sampledAt: bigint | undefined;
  private cpuAt: bigint | undefined;
  private cpuMicroseconds = 0n;
  private memoryMiBMilliseconds = 0n;
  constructor(private readonly cpu: () => Promise<bigint> = cgroupCPUTime,
    private readonly clock: () => bigint = () => process.hrtime.bigint() / 1000000n) {}
  private async sampleUnlocked(): Promise<HostResourceMeters> {
    const usage = await this.cpu();
    const now = this.clock();
    if (this.cpuAt !== undefined && this.sampledAt !== undefined) {
      if (usage < this.cpuAt || now < this.sampledAt) throw new Error('host_meter_regressed');
      const memory = [...this.assignments.values()].reduce((sum, value) => sum + BigInt(value), 0n);
      if (memory > 0n) this.cpuMicroseconds += usage - this.cpuAt;
      this.memoryMiBMilliseconds += memory * (now - this.sampledAt);
    }
    this.cpuAt = usage;
    this.sampledAt = now;
    return { kind: 'resource', cpu_ms: (this.cpuMicroseconds / 1000n).toString(),
      memory_mib_ms: this.memoryMiBMilliseconds.toString() };
  }
  sample(): Promise<HostResourceMeters> { return this.lock.run('meter', () => this.sampleUnlocked()); }
  claim(id: string, memoryMiB: number): Promise<void> {
    return this.lock.run('meter', async () => {
      if (!Number.isSafeInteger(memoryMiB) || memoryMiB <= 0) throw new Error('invalid_memory_allocation');
      const previous = this.assignments.get(id);
      if (previous !== undefined) {
        if (previous !== memoryMiB) throw new Error('allocation_identity_changed');
        return;
      }
      await this.sampleUnlocked();
      this.assignments.set(id, memoryMiB);
    });
  }
  release(id: string): Promise<void> {
    return this.lock.run('meter', async () => {
      if (!this.assignments.has(id)) return;
      await this.sampleUnlocked();
      this.assignments.delete(id);
    });
  }
}
