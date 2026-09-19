// Isolated Linux acceptance: real pinned Codex, loopback model, no external network.
import { nativeModelFixture } from './native-model.mjs';
import { nativeBroker } from './native-broker.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness = process.argv[2] || 'codex';
const warm = process.argv.includes('--warm');
const toolMode = process.argv.includes('tools');
const sessionId = randomUUID();
let expectedToken;
let blockRequests = false,
  blockedRequest = false;
const secret = 'synthetic-control-secret-for-offline-tests';
const child = spawn('node', ['/opt/platform/sandbox-control.mjs'], {
  env: { PATH: process.env.PATH, SANDBOX_CONTROL_SECRET: secret },
  stdio: 'inherit',
});
const fixture = nativeModelFixture({ toolMode });
const broker = nativeBroker(() => expectedToken);
const model = createServer((req, res) => {
  assert.equal(
    req.headers.authorization || `Bearer ${req.headers['x-api-key']}`,
    `Bearer ${expectedToken}`,
    'each turn uses its own upstream capability',
  );
  if (blockRequests && req.url !== '/mcp') {
    blockedRequest = true;
    return;
  }
  return req.url === '/mcp' ? broker.handle(req, res) : fixture.handler(req, res);
}).listen(8787, '127.0.0.1');
let boot;
async function request(value, expected = 200) {
  const response = await fetch('http://127.0.0.1:10000/control', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ boot_id: boot, request: value }),
  });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body.value;
}
async function until(fn, label) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  boot = (
    await until(async () => {
      try {
        return await request({ action: 'health' });
      } catch {
        return null;
      }
    }, 'control startup')
  ).boot_id;
  assert.equal((await fetch('http://127.0.0.1:10000/control', { method: 'POST', body: '{}' })).status, 401);
  const execute = async (
    run,
    entries = [],
    chunks = [],
    resumeId,
    checkpointId = resumeId ? 'checkpoint-first' : null,
    expectReuse = Boolean(warm && resumeId),
  ) => {
    const configuration = {
      runId: run,
      harness,
      provider: harness === 'claude-code' ? 'anthropic' : 'openai',
      model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
      ...(warm ? { warm: { sessionId, checkpointId, toolFingerprint: 'no-connectors' } } : {}),
      prompt: resumeId
        ? 'Confirm the prior task is complete.'
        : 'Create native.txt with a short note, then finish.',
      workspace: '/workspace',
      stateHome: '/agent-home',
      gatewayURL: 'http://127.0.0.1:8787',
      toolURL: 'http://127.0.0.1:8787/mcp',
      token: `fixture-turn-${run}`,
      deadline: new Date(Date.now() + 60000).toISOString(),
      toolGrants: toolMode,
      resumeId,
    };
    expectedToken = configuration.token;
    const prepared = await request({ action: 'prepare', run_id: run, configuration });
    assert.equal(prepared.reused, expectReuse);
    await request({ action: 'prepare', run_id: run, configuration });
    for (const chunk of chunks) await request({ action: 'stage', run_id: run, files: [chunk] });
    await request({
      action: 'stage',
      run_id: run,
      files: [{ path: 'page-0.json', content: Buffer.from(JSON.stringify(entries)).toString('base64') }],
    });
    await request({ action: 'restore', run_id: run });
    await until(async () => {
      const status = await request({ action: 'restored', run_id: run });
      assert.notEqual(status, 'failure');
      return status === 'success';
    }, 'restore');
    await request({ action: 'launch', run_id: run });
    await request({ action: 'launch', run_id: run });
    if (blockRequests) {
      await until(() => blockedRequest, 'in-flight warm model request');
      await request({ action: 'cancel', run_id: run });
    }
    const result = await until(
      async () => (await request({ action: 'probe', run_id: run, offset: 0 })).result,
      'native run',
    );
    assert.equal(
      result.outcome,
      blockRequests ? 'cancelled' : 'success',
      JSON.stringify({ result, probe: await request({ action: 'probe', run_id: run, offset: 0 }) }),
    );
    assert.equal(result.persistence, 'captured');
    const probe = await request({ action: 'probe', run_id: run, offset: 0 });
    if (warm)
      assert(
        probe.events.some((e) => e.type === 'runtime.started' && e.data.reused === expectReuse),
        'adapter reports actual native reuse',
      );
    return result;
  };
  const first = randomUUID();
  const result = await execute(first);
  const entries = [];
  let total = 1;
  while (entries.length < total) {
    const page = await request({ action: 'snapshot', run_id: first, offset: entries.length });
    entries.push(...page.entries);
    total = page.total;
  }
  const chunks = [];
  for (const hash of new Set(entries.flatMap((e) => e.chunks.map((c) => c.hash)))) {
    const chunk = await request({ action: 'chunk', run_id: first, hash });
    chunks.push({ path: `chunks/${hash}`, content: chunk.content });
  }
  assert(entries.some((e) => e.namespace === 'workspace' && e.path === 'native.txt'));
  await until(async () => {
    try {
      await request({ action: 'release', run_id: first, checkpoint_id: 'checkpoint-first' });
      return true;
    } catch {
      return false;
    }
  }, 'quiescent release');
  await request({ action: 'release', run_id: first, checkpoint_id: 'checkpoint-first' });
  await request({ action: 'launch', run_id: first }, 409);
  const count = fixture.observed.length;
  const second = randomUUID();
  const resumed = await execute(second, entries, chunks, result.resumeId);
  assert.equal(resumed.resumeId, result.resumeId);
  assert(
    fixture.observed.slice(count).some((r) => r.hasPriorPrompt),
    'native conversation restored',
  );
  assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
  assert.equal((await request({ action: 'health' })).boot_id, boot, 'both runs used the same server');
  await request({ action: 'cancel', run_id: first }, 409);
  await until(async () => {
    try {
      await request({ action: 'release', run_id: second });
      return true;
    } catch {
      return false;
    }
  }, 'second release');
  if (toolMode) assert(broker.calls > 0, 'native connector tools reach the authenticated relay');
  if (warm) {
    // An externally published checkpoint invalidates both in-memory context and disk.
    const third = randomUUID();
    await execute(third, entries, chunks, result.resumeId, 'externally-published', false);
    await until(async () => {
      try {
        await request({ action: 'release', run_id: third, checkpoint_id: 'externally-published' });
        return true;
      } catch {
        return false;
      }
    }, 'third release');
    blockRequests = true;
    await execute(randomUUID(), [], [], result.resumeId, 'externally-published', true);
    // Cancellation must remove the retained runtime, not leave a suspended writer.
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const status = await readFile(`/proc/${pid}/status`, 'utf8');
        assert(
          !/^Uid:\s+10001\s/m.test(status) || /^State:\s+Z/m.test(status),
          'cancelled native processes are gone',
        );
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
      }
    }
  }
  console.log(
    `PASS: ${harness}, two turns, warm=${warm}, native session and current credentials, checkpoint invalidation, cancellation, duplicate launch and old-run fencing.`,
  );
} finally {
  child.kill('SIGTERM');
  model.closeAllConnections();
  model.close();
}
