import { nativeModelFixture } from './native-model.mjs';
// Run only inside `docker run --network none`; every model response is a local deterministic fixture.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness = process.argv[2] || 'codex';
const questionMode = process.argv[3] === 'questions';
let answered = 0;
const fixture = nativeModelFixture({ questionMode });
const observed = fixture.observed;
const server = http.createServer(fixture.handler);
server.listen(8787, '127.0.0.1');
await mkdir('/platform-control', { recursive: true });
const configuration = {
  runId: crypto.randomUUID(),
  harness,
  provider: harness === 'claude-code' ? 'anthropic' : 'openai',
  model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
  prompt: 'Create native.txt with a short note, then finish.',
  workspace: '/workspace',
  stateHome: '/agent-home',
  gatewayURL: 'http://127.0.0.1:8787',
  toolURL: 'http://127.0.0.1:8787/mcp',
  token: 'fixture-local-only',
  deadline: new Date(Date.now() + 60000).toISOString(),
  toolGrants: false,
};
await writeFile('/platform-control/config.json', JSON.stringify(configuration));
const child = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
let checking = false;
const answering = setInterval(async () => {
  if (!questionMode || checking) return;
  checking = true;
  try {
    const input = JSON.parse(await readFile('/platform-control/input.json', 'utf8'));
    if (!answered) {
      await writeFile(
        '/platform-control/answer.json',
        JSON.stringify({ id: input.id, answer: { text: 'Continue with the saved note' } }),
      );
      answered++;
    }
  } catch {
  } finally {
    checking = false;
  }
}, 100);
await new Promise((resolve) => child.on('exit', resolve));
clearInterval(answering);
if (questionMode) {
  assert.equal(answered, 1, 'Interactive question must reach the supervisor');
  assert(
    observed.some((o) => o.hasAnswer),
    'Answer must return to the native model conversation',
  );
}
const result = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
console.log(JSON.stringify({ harness, calls: fixture.calls, observed, result }));
assert.equal(result.outcome, 'success');
assert.equal(result.persistence, 'captured');
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
const index = JSON.parse(await readFile('/platform-control/snapshot/index.json', 'utf8'));
assert(index.entries.some((e) => e.namespace === 'workspace' && e.path === 'native.txt'));
assert(index.entries.some((e) => e.namespace === 'home'));
assert(!index.entries.some((e) => e.path === '.runtime-config.json'));
console.log('Native harness, tool execution and checkpoint verified without external network.');
const previousCount = observed.length;
await cp('/platform-control', '/completed-control', { recursive: true });
await rm('/platform-control', { recursive: true, force: true });
await writeFile('/completed-control/snapshot/page-0.json', JSON.stringify(index.entries));
await rm('/workspace', { recursive: true, force: true });
await rm('/agent-home', { recursive: true, force: true });
const { restoreSnapshot } = await import('/opt/platform/restore.mjs');
await restoreSnapshot('/completed-control/snapshot', { workspace: '/workspace', home: '/agent-home' }, 10001);
await mkdir('/platform-control');
await writeFile(
  '/platform-control/config.json',
  JSON.stringify({
    ...configuration,
    runId: crypto.randomUUID(),
    prompt: 'Confirm the prior task is complete.',
    resumeId: result.resumeId,
    deadline: new Date(Date.now() + 60000).toISOString(),
  }),
);
const continuation = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
await new Promise((resolve) => continuation.on('exit', resolve));
server.close();
const resumed = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
console.log(JSON.stringify({ harness, continuation: resumed, requests: observed.slice(previousCount) }));
assert.equal(resumed.outcome, 'success');
assert.equal(resumed.resumeId, result.resumeId);
assert(
  observed.slice(previousCount).some((o) => o.hasPriorPrompt),
  'Continuation must restore native conversation context',
);
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
console.log('Portable filesystem restore and native session continuation verified.');
