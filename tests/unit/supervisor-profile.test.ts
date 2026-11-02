import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
const io = vi.hoisted(() => ({
  readFile: vi.fn(),
  appendFile: vi.fn(async (_file: string, _data: string) => {}),
  mkdir: vi.fn(async () => {}),
  chmod: vi.fn(async () => {}),
  chown: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  lstat: vi.fn(),
  unlink: vi.fn(async () => {}),
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  ...io,
}));
vi.mock('../../packages/runtime/src/manifest', () => ({
  atomicJSON: vi.fn(async () => {}),
  captureSnapshot: vi.fn(),
}));
vi.mock('../../packages/runtime/src/agent-processes', () => ({
  agentProcesses: vi.fn(async () => new Map()),
  agentMemorySample: vi.fn(),
  largestMemoryProcesses: vi.fn(),
  agentPss: vi.fn(),
  freezeAgent: vi.fn(),
  stopAgent: vi.fn(async () => {}),
  signalAgents: vi.fn(async () => {
    throw new Error('resume_failed');
  }),
}));
import { supervise, type LiveHarness } from '../../packages/runtime/src/supervisor';
import { signalAgents, stopAgent } from '../../packages/runtime/src/agent-processes';
import { atomicJSON } from '../../packages/runtime/src/manifest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
function fixture() {
  const assignmentId = randomUUID(),
    sessionId = randomUUID(),
    worktreeId = randomUUID();
  const configuration: NativeConfiguration = {
    runId: randomUUID(),
    harness: 'opencode',
    model: 'fixture',
    provider: 'openai',
    modelLimits: { contextTokens: 128000, maxOutputTokens: 8192 },
    prompt: 'synthetic',
    token: 'synthetic',
    deadline: new Date(Date.now() + 60000).toISOString(),
    toolGrants: false,
    workspace: `/host-data/worktrees/${worktreeId}`,
    stateHome: `/host-data/continuations/${sessionId}`,
    gatewayURL: 'http://127.0.0.1',
    toolURL: 'http://127.0.0.1',
    hostRun: { assignmentId, handleId: randomUUID(), worktreeId, sessionId, uid: 20000, memoryMiB: 1024 },
    warm: { sessionId, checkpointId: null, toolFingerprint: 'synthetic' },
    performance: {
      capture_id: randomUUID(),
      origin_instance_id: randomUUID(),
      sample_rate: 1,
      expires_at_ms: Date.now() + 60000,
    },
  };
  io.readFile.mockResolvedValue(JSON.stringify(configuration));
  // A process object with owned streams, without starting an OS process.
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  const stdio: ChildProcessWithoutNullStreams['stdio'] = [stdin, stdout, stderr, undefined, undefined];
  const child: ChildProcessWithoutNullStreams = Object.assign(new ChildProcess(), {
    stdin,
    stdout,
    stderr,
    stdio,
    kill: vi.fn(() => true),
  });
  const resident: LiveHarness = { uid: 20000, child, processes: new Set([22]) };
  return { child, stdout, resident, directory: `/platform-control/assignments/${assignmentId}/config.json` };
}
it('releases optional profile slots and owned listeners after a resumed startup fails', async () => {
  vi.stubGlobal('process', { ...process, platform: 'linux', getuid: () => 0 });
  for (let index = 0; index < 10; index++) {
    const { child, resident, directory } = fixture();
    await expect(supervise(directory, '/fixture/worker', resident)).rejects.toThrow('resume_failed');
    expect(resident.child).toBeUndefined();
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  }
  const profiles = io.appendFile.mock.calls.filter((call) =>
    String(call[1]).includes('runtime.memory_profile'),
  );
  expect(profiles).toHaveLength(10); // All eight optional slots remained reusable.
  expect(stopAgent).toHaveBeenCalledTimes(20);
});

it('drains a pending child line before returning a resumed startup failure', async () => {
  vi.stubGlobal('process', { ...process, platform: 'linux', getuid: () => 0 });
  const { child, stdout, resident, directory } = fixture();
  let release = () => {},
    inputWritten = false,
    returned = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(atomicJSON).mockImplementation(async (file) => {
    if (file.endsWith('/input.json')) {
      await pending;
      inputWritten = true;
    }
  });
  vi.mocked(signalAgents).mockImplementationOnce(async () => {
    stdout.write(
      `${JSON.stringify({ type: 'input', id: 'pending', question: 'synthetic', details: {} })}\n`,
    );
    await Promise.resolve();
    throw new Error('resume_failed');
  });
  const execution = supervise(directory, '/fixture/worker', resident).finally(() => {
    returned = true;
  });
  const rejection = expect(execution).rejects.toThrow('resume_failed');
  try {
    await vi.waitFor(() => expect(stopAgent).toHaveBeenCalled());
    expect(returned).toBe(false);
    release();
    await rejection;
    expect(inputWritten).toBe(true);
  } finally {
    release();
    await rejection;
    child.stdout.destroy();
    child.stderr.destroy();
  }
});
