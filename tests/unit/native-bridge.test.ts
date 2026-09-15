import { expect, it, vi } from 'vitest';
import { runNativeBridge } from '../../packages/runtime/src/native-bridge';
import type { HarnessContext } from '../../packages/runtime/src/types';

function context(): HarnessContext {
  return {
    configuration: {
      runId: 'synthetic',
      harness: 'hermes',
      provider: 'openai',
      model: 'fixture',
      prompt: 'fixture prompt',
      workspace: '/workspace',
      stateHome: '/agent-home',
      gatewayURL: 'http://127.0.0.1:1',
      toolURL: 'http://127.0.0.1:1',
      token: 'fixture-only',
      deadline: new Date(Date.now() + 60000).toISOString(),
      toolGrants: false,
    },
    signal: new AbortController().signal,
    emit: vi.fn(async () => {}),
    ask: vi.fn(async () => ({ text: 'Answer' })),
  };
}
// An actual subprocess exercises framing and lifecycle without loading a model or using the network.
const prelude = `const rl = require('node:readline').createInterface({input:process.stdin});
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');`;
const launch = (source: string, c = context()) =>
  runNativeBridge(
    'Fixture',
    process.execPath,
    ['-e', prelude + source],
    {
      env: { NODE_ENV: 'test' },
    },
    c,
  );

it('serializes configuration, forwards ordered events and answers, and returns the native result', async () => {
  const c = context();
  const result = await launch(
    `rl.once('line', line => {
    const config=JSON.parse(line);
    send({type:'event',event:{type:'output.delta',data:{text:config.prompt}}});
    send({type:'input',id:'question',question:'Continue?',details:{}});
    rl.once('line', answer => {
      send({type:'result',result:{outcome:'success',output:JSON.parse(answer).answer.text,resumeId:'session'}});
      rl.close(); process.stdin.destroy();
    });
  });`,
    c,
  );
  expect(c.emit).toHaveBeenCalledWith({ type: 'output.delta', data: { text: 'fixture prompt' } });
  expect(c.ask).toHaveBeenCalledWith('question', 'Continue?', {});
  expect(result).toEqual({ outcome: 'success', output: 'Answer', resumeId: 'session' });
});
it.each(['process.exit(1)', "process.stdout.write('not-json\\n'); rl.close(); process.stdin.destroy()"])(
  'fails explicitly when the native bridge exits or sends invalid framing',
  async (failure) => {
    await expect(launch(`rl.once('line',()=>{${failure}});`)).rejects.toThrow();
  },
);
it('cancels while an input answer is pending without leaving the adapter waiting forever', async () => {
  const controller = new AbortController();
  const c = context();
  c.signal = controller.signal;
  c.ask = vi.fn(async () => {
    controller.abort();
    return new Promise<Record<string, unknown>>(() => {});
  });
  const result = await launch(
    `rl.once('line',()=>send({type:'input',id:'q',question:'Continue?',details:{}}));`,
    c,
  );
  expect(result.outcome).toBe('cancelled');
  expect(c.ask).toHaveBeenCalledTimes(1);
});
it('does not launch an already cancelled operation', async () => {
  const c = context();
  c.signal = AbortSignal.abort(new Error('Already cancelled'));
  await expect(launch('throw new Error("Must never launch")', c)).rejects.toThrow('Already cancelled');
});
