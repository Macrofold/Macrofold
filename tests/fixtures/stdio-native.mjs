// Runs inside the runtime image with --network none; no provider or model calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, chown } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('/workspace', { recursive: true });
await mkdir('/platform-control', { recursive: true });
await chown('/workspace', 10001, 10001);
const runId = randomUUID();
// stdio-call validates the complete supervisor configuration; loopback URLs are never contacted here.
await writeFile(
  '/platform-control/config.json',
  JSON.stringify({
    runId,
    harness: 'codex',
    model: 'fixture-model',
    provider: 'openai',
    prompt: '',
    workspace: '/workspace',
    stateHome: '/agent-home',
    gatewayURL: 'http://127.0.0.1:9/',
    toolURL: 'http://127.0.0.1:9/',
    token: 'fixture-token',
    deadline: new Date(Date.now() + 120000).toISOString(),
    toolGrants: false,
  }),
  { mode: 0o600 },
);
async function invoke(invocationId, tool, args) {
  await writeFile(
    `/platform-control/stdio-${invocationId}.json`,
    JSON.stringify({
      runId,
      command: '/opt/platform/node_modules/.bin/mcp-server-filesystem',
      args: ['/workspace'],
      environment: {},
      tool,
      arguments: args,
    }),
    { mode: 0o600 },
  );
  const child = spawn('node', ['/opt/platform/stdio-call.mjs', invocationId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    errors = '';
  child.stdout.on('data', (part) => (output += part));
  child.stderr.on('data', (part) => (errors += part));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, errors, result: output ? JSON.parse(output) : null };
}
const invocation = randomUUID();
const written = await invoke(invocation, 'write_file', {
  path: '/workspace/stdio.txt',
  content: 'Native MCP persisted this file.',
});
assert.equal(written.code, 0, written.errors);
assert.equal(await readFile('/workspace/stdio.txt', 'utf8'), 'Native MCP persisted this file.');
assert.notEqual(
  (await invoke(invocation, 'write_file', { path: '/workspace/stdio.txt', content: 'Must never repeat.' }))
    .code,
  0,
);
assert.equal(await readFile('/workspace/stdio.txt', 'utf8'), 'Native MCP persisted this file.');
const read = await invoke(randomUUID(), 'read_text_file', { path: '/workspace/stdio.txt' });
assert.equal(read.code, 0, read.errors);
assert.ok(read.result.content.some((c) => c.text?.includes('Native MCP persisted')));
const denied = await invoke(randomUUID(), 'read_text_file', { path: '/platform-control/config.json' });
assert.equal(denied.result.isError, true);
console.log(
  'Native stdio MCP: write/read, sandbox boundary and duplicate-dispatch prevention passed with external networking disabled.',
);
