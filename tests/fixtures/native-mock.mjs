import { nativeModelFixture } from './native-model.mjs';
import { nativeBroker } from './native-broker.mjs';
// Run only inside `docker run --network none`; every model response is a local deterministic fixture.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, rm, symlink, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness = process.argv[2] || 'codex';
const questionMode = process.argv[3] === 'questions';
const toolMode = process.argv[3] === 'tools';
const permissionMode = process.argv[3] === 'permissions';
// The guarded matrix includes ten tool turns and a cold native startup.
const duration = permissionMode ? 120_000 : 60_000;
const cancellation = process.argv[3] === 'cancel';
const failureMode = cancellation || process.argv[3] === 'failure';
let answered = 0;
const fixture = nativeModelFixture({
  questionMode,
  toolMode,
  failureMode,
  permissionMode,
  onBlocked: cancellation
    ? async () => {
        await writeFile('/platform-control/cancel', '');
      }
    : undefined,
});
const broker = nativeBroker();
const observed = fixture.observed;
function assertClaudeWorkspaceContext(requests) {
  if (harness !== 'claude-code') return;
  const messages = requests.filter((request) => request.path.split('?')[0].endsWith('/messages'));
  assert(messages.length > 0, 'Claude must send a model request');
  assert(
    messages.every((request) => request.hasWorkspaceContext && request.hasPersistenceGuidance),
    'Claude model requests must identify the persistent workspace and temporary-file boundary',
  );
}
const server = http.createServer((req, res) =>
  req.url === '/mcp' ? broker.handle(req, res) : fixture.handler(req, res),
);
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
  deadline: new Date(Date.now() + duration).toISOString(),
  toolGrants: toolMode || permissionMode,
  ...(permissionMode
    ? {
        permissions: [
          {
            version: 1,
            files: { read: { exclude: ['**/*.env'] }, write: { include: ['native.txt', 'docs/**'] } },
          },
          { version: 1, files: { write: { exclude: ['docs/private/**'] } } },
        ],
      }
    : {}),
};
if (permissionMode) {
  await mkdir('/workspace', { recursive: true });
  for (const name of ['private.env', 'readonly.txt']) {
    await writeFile(`/workspace/${name}`, 'PERMISSION_SECRET_FIXTURE');
    await chmod(`/workspace/${name}`, 0o666);
  }
  await writeFile('/outside.txt', 'PERMISSION_SECRET_FIXTURE');
  await symlink('/', '/workspace/escape');
  await mkdir('/workspace/.codex', { recursive: true });
  await writeFile(
    '/workspace/.codex/config.toml',
    'sandbox_mode = "danger-full-access"\n[features]\nshell_tool = true\n',
  );
  await writeFile('/workspace/opencode.json', JSON.stringify({ permission: 'allow' }));
}
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
assert.equal(result.outcome, cancellation ? 'cancelled' : failureMode ? 'failure' : 'success');
assert.equal(result.persistence, 'captured');
assertClaudeWorkspaceContext(observed);
if (toolMode || permissionMode)
  assert.equal(broker.calls, 1, 'The native agent must invoke the authorized MCP broker exactly once');
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
if (permissionMode) {
  assert(
    observed.some((o) => o.fileSaved),
    'Permitted writes must report success after denials',
  );
  assert(
    observed.some((o) => o.fileRead),
    'Permitted reads must return file content',
  );
  await assert.rejects(readFile('/workspace/forbidden.txt'), { code: 'ENOENT' });
  await assert.rejects(readFile('/workspace/bypass.txt'), { code: 'ENOENT' });
  await assert.rejects(readFile('/workspace/docs/private/blocked.md'), { code: 'ENOENT' });
  assert.equal(await readFile('/workspace/readonly.txt', 'utf8'), 'PERMISSION_SECRET_FIXTURE');
  assert(!observed.some((o) => o.leakedSecret), 'Denied contents must never reach model requests');
  assert(
    observed.some((o) => o.permissionDenied),
    'Denied file access must return to the native conversation',
  );
  for (const request of observed) {
    assert(
      !request.tools?.some((name) =>
        /^(bash|terminal|exec_command|shell|read|write|edit|glob|grep|agent|task|skill|str_replace_editor)$/i.test(
          name,
        ),
      ),
      'Guarded runs must not advertise bypass tools',
    );
  }
}
const index = JSON.parse(await readFile('/platform-control/snapshot/index.json', 'utf8'));
assert(index.entries.some((e) => e.namespace === 'workspace' && e.path === 'native.txt'));
assert(index.entries.some((e) => e.namespace === 'home'));
assert(!index.entries.some((e) => e.path === '.runtime-config.json'));
console.log('Native harness, tool execution and checkpoint verified without external network.');
if (failureMode) {
  assert(fixture.calls < 10, 'Authentication failure must not cause an unbounded retry loop');
  server.closeAllConnections();
  server.close();
  console.log('Interrupted native execution preserved its files and explicit terminal outcome.');
  process.exit(0);
}
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
    ...(harness === 'claude-code' ? { instructions: 'Keep the fixture note unchanged.' } : {}),
    resumeId: result.resumeId,
    deadline: new Date(Date.now() + duration).toISOString(),
  }),
);
const continuation = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
await new Promise((resolve) => continuation.on('exit', resolve));
server.close();
const resumed = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
console.log(JSON.stringify({ harness, continuation: resumed, requests: observed.slice(previousCount) }));
assert.equal(resumed.outcome, 'success');
assert.equal(resumed.resumeId, result.resumeId);
assertClaudeWorkspaceContext(observed.slice(previousCount));
if (harness === 'claude-code')
  assert(
    observed.slice(previousCount).some((request) => request.hasRunInstructions),
    'Custom run instructions must reach the resumed Claude conversation alongside workspace guidance',
  );
assert(
  observed.slice(previousCount).some((o) => o.hasPriorPrompt),
  'Continuation must restore native conversation context',
);
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
if (permissionMode)
  assert(
    observed.slice(previousCount).some((o) => o.fileRead),
    'Restored sessions must reconnect to checked file tools',
  );
console.log('Portable filesystem restore and native session continuation verified.');
