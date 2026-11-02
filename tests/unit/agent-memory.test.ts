import { afterEach, describe, expect, it, vi } from 'vitest';
const files = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn(), open: vi.fn() }));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  ...files,
}));
import {
  agentMemoryMiB,
  agentMemorySample,
  agentPss,
  agentProcesses,
  largestMemoryProcesses,
} from '../../packages/runtime/src/agent-processes';

afterEach(() => vi.resetAllMocks());
function inventory(values: Record<string, string>) {
  files.readdir.mockResolvedValue(Object.keys(values));
  files.readFile.mockImplementation(async (file: string) => {
    const value = values[file.split('/')[2]];
    if (value === undefined) throw Object.assign(new Error('vanished'), { code: 'ENOENT' });
    return value;
  });
}
const status = (uid: number, rss?: number, name = 'node', state = 'S') =>
  `Name:\t${name}\nState:\t${state} (sleeping)\nUid:\t9\t${uid}\t${uid}\t${uid}\n${rss === undefined ? '' : `VmRSS:\t${rss} kB\n`}`;

describe('allocation memory inventory', () => {
  it('uses effective UID, excludes zombies and labels unavailable RSS without exporting process names', async () => {
    inventory({
      '10': status(10001, 1024, 'MainThread'),
      '11': status(10002, 99999),
      '12': status(10001, 99999, 'node', 'Z'),
      '13': status(10001, undefined, 'private-customer-name'),
    });
    const sample = await agentMemorySample();
    expect(sample).toMatchObject({ rssBytes: 1024 * 1024, processCount: 2, unavailableProcessCount: 1 });
    expect([...sample.processes]).toEqual([
      [10, { rssBytes: 1024 * 1024, kind: 'node' }],
      [13, { rssBytes: null, kind: 'other' }],
    ]);
    expect(JSON.stringify(largestMemoryProcesses(sample))).not.toContain('private');
    expect(await agentMemoryMiB()).toBe(1);
    inventory({ '10': status(10001, 1025) });
    expect(await agentMemoryMiB()).toBe(2);
  });
  it('shares only the inventory currently in flight and rescans for a later quiescence check', async () => {
    inventory({ '10': status(10001, 10) });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    files.readdir.mockImplementationOnce(async () => {
      await gate;
      return ['10'];
    });
    const sample = agentMemorySample(),
      processes = agentProcesses();
    release();
    await Promise.all([sample, processes]);
    expect(files.readdir).toHaveBeenCalledTimes(1);
    await agentProcesses();
    expect(files.readdir).toHaveBeenCalledTimes(2);
  });
  it('keeps only five largest observed processes with deterministic PID ties', async () => {
    inventory(
      Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(20 - index), status(10001, 10)])),
    );
    const sample = await agentMemorySample();
    expect(largestMemoryProcesses(sample).map((process) => process.pid)).toEqual([9, 10, 11, 12, 13]);
  });
  it('ignores a vanished PID but propagates an inventory failure required by the guard', async () => {
    inventory({ '10': status(10001, 5) });
    files.readdir.mockResolvedValue(['10', '11']);
    expect((await agentMemorySample()).processCount).toBe(1);
    files.readdir.mockRejectedValueOnce(new Error('guard inventory failed'));
    await expect(agentMemorySample()).rejects.toThrow('guard inventory failed');
  });
});

describe('optional proportional memory reader', () => {
  function rollup(text: string, uid = 10001) {
    const close = vi.fn(async () => {}),
      read = vi.fn(async (bytes: Buffer) => {
        const content = Buffer.from(text);
        content.copy(bytes);
        return { bytesRead: Math.min(bytes.length, content.length), buffer: bytes };
      });
    files.open.mockResolvedValue({ stat: async () => ({ uid }), read, close });
    return { read, close };
  }
  it('checks descriptor ownership before reading and always closes it', async () => {
    const foreign = rollup('Pss: 123 kB\n', 10002);
    expect(await agentPss(10, 10001)).toEqual({ reason: 'vanished' });
    expect(foreign.read).not.toHaveBeenCalled();
    expect(foreign.close).toHaveBeenCalledOnce();
    const own = rollup('Rss: 512 kB\nPss: 123 kB\n');
    expect(await agentPss(10, 10001)).toEqual({ pssBytes: 123 * 1024 });
    expect(own.read).toHaveBeenCalledOnce();
    expect(own.close).toHaveBeenCalledOnce();
  });
  it('omits oversized, unsupported and inaccessible observations rather than treating them as zero', async () => {
    rollup(`Pss: 123 kB\n${'x'.repeat(16 * 1024)}`);
    expect(await agentPss(10, 10001)).toEqual({ reason: 'read_failed' });
    rollup('Rss: 12 kB\n');
    expect(await agentPss(10, 10001)).toEqual({ reason: 'unsupported' });
    files.open.mockRejectedValueOnce(Object.assign(new Error('private'), { code: 'EACCES' }));
    expect(await agentPss(10, 10001)).toEqual({ reason: 'permissions' });
  });
});
