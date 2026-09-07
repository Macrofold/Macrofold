import { it, expect, vi } from 'vitest';
import { CodexAdapter } from '../../packages/runtime/src/codex';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonRpcProcess } from '../../packages/runtime/src/jsonrpc';

it('reads the final RPC response when stdout outlives its original process', async () => {
  const source = `
    const { spawn } = require('node:child_process');
    process.stdin.once('data', bytes => {
      const request = JSON.parse(bytes.toString());
      const reply = JSON.stringify({ id: request.id, result: { complete: true } }) + '\\n';
      const writer = spawn(process.execPath, ['-e',
        'setTimeout(() => process.stdout.write(' + JSON.stringify(reply) + '), 80)'
      ], { stdio: ['ignore', process.stdout, 'ignore'] });
      writer.unref();
      process.exit(0);
    });
  `;
  const rpc = new JsonRpcProcess(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    env: { NODE_ENV: 'test', PATH: process.env.PATH },
  });
  try {
    await expect(rpc.request('final-result', {}, 3000)).resolves.toEqual({ complete: true });
  } finally {
    rpc.close();
  }
});

it('drains asynchronous final notifications before reporting a native closure', async () => {
  const rpc = new JsonRpcProcess(
    process.execPath,
    ['-e', `process.stdout.write(JSON.stringify({method: 'turn/completed'}) + '\\n')`],
    { cwd: process.cwd(), env: { NODE_ENV: 'test', PATH: process.env.PATH } },
  );
  const received: string[] = [];
  rpc.onMessage = async (message) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    received.push(message.method!);
  };
  const closed = new Promise<void>((resolve) => {
    rpc.onExit = () => resolve();
  });
  try {
    await closed;
    expect(received).toEqual(['turn/completed']);
    await expect(rpc.request('after-close', {}, 3000)).rejects.toThrow('closed');
  } finally {
    rpc.close();
  }
});

it('reports native initialization failure without an unhandled completion rejection', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-startup-'));
  vi.stubEnv('CODEX_BINARY', path.join(directory, 'missing-native-binary'));
  try {
    await expect(
      new CodexAdapter().run({
        configuration: {
          runId: 'fixture',
          harness: 'codex',
          model: 'fixture',
          provider: 'fixture',
          prompt: 'fixture',
          workspace: directory,
          stateHome: directory,
          gatewayURL: 'http://127.0.0.1:1',
          toolURL: '',
          token: 'fixture',
          deadline: new Date(Date.now() + 1000).toISOString(),
          toolGrants: false,
        },
        signal: new AbortController().signal,
        emit: async () => {},
        ask: async () => ({}),
      }),
    ).rejects.toThrow(/ENOENT/);
    // Let the subprocess close callback settle; Vitest rejects unhandled promises.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
