// Real harness binaries, no external networking or paid model calls.
import { nativeModelFixture } from './native-model.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness = process.argv[2];
for (const mode of ['none', 'read-only']) {
  let requests = 0;
  let sawReadOnlyTool = false;
  const fixture = nativeModelFixture({
    textOnly: true,
    describeTool: mode === 'read-only' ? 'worktree_files' : undefined,
    validateRequest(body) {
      requests++;
      const instructions = JSON.stringify([
        body.system,
        body.instructions,
        ...[...(body.messages || []), ...(Array.isArray(body.input) ? body.input : [])].filter(
          (m) => m.role === 'system' || m.role === 'developer',
        ),
      ]);
      const tools = JSON.stringify(body.tools || []);
      assert(!instructions.includes('Save user-facing deliverables'), 'no unconditional output instructions');
      assert(
        !instructions.includes('If outputs/ is writable'),
        'non-writable runs have no output-saving guidance',
      );
      if (mode === 'none') {
        assert(!instructions.includes('Your persistent worktree'), 'no Macrofold filesystem instructions');
        assert(!tools.includes('worktree_files'), 'no checked file tool is advertised');
      } else {
        // Native title/metadata calls may use their own system prompt.
        if (tools.includes('worktree_files'))
          assert(instructions.includes('read-only worktree'), 'read-only guidance reaches model');
      }
      const definitions = (body.tools || []).flatMap((t) => t.tools || [t]).map((t) => t.function || t);
      const names = definitions.map((t) => t.name);
      if (mode === 'read-only') {
        // Hermes exposes non-core schemas through its native discovery bridge.
        const described = (body.messages || []).find(m => m.role === 'tool' && m.tool_call_id === 'fixture_describe');
        const files = definitions.find((t) => t.name?.includes('worktree_files')) ||
          (described ? JSON.parse(described.content).tools.worktree_files : undefined);
        if (files) {
          sawReadOnlyTool = true;
          assert(instructions.includes('read-only worktree'), 'read-only guidance reaches model');
          const schema = files.parameters || files.input_schema;
          assert.deepEqual(schema.properties.action.enum, ['list', 'read']);
        }
      }
      assert(
        !names.some((name) =>
          /^(bash|terminal|exec_command|shell|read|write|edit|glob|grep|agent|task|skill|str_replace_editor)$/i.test(
            name,
          ),
        ),
        'no native filesystem bypass tools',
      );
    },
  });
  const server = createServer(fixture.handler);
  await new Promise((resolve) => server.listen(8787, '127.0.0.1', resolve));
  await mkdir('/platform-control', { recursive: true });
  const configuration = {
    runId: crypto.randomUUID(),
    harness,
    provider: harness === 'claude-code' ? 'anthropic' : 'openai',
    model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
    prompt: 'Reply briefly.',
    workspace: '/workspace',
    stateHome: '/agent-home',
    gatewayURL: 'http://127.0.0.1:8787',
    toolURL: 'http://127.0.0.1:8787/mcp',
    token: 'fixture',
    deadline: new Date(Date.now() + 120000).toISOString(),
    toolGrants: false,
    permissions: [
      {
        version: 1,
        shell: 'deny',
        files: { read: mode === 'none' ? { include: [] } : {}, write: { include: [] } },
      },
    ],
  };
  await writeFile('/platform-control/config.json', JSON.stringify(configuration));
  const child = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
  await new Promise((resolve) => child.on('exit', resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const result = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
  assert.equal(result.outcome, 'success', JSON.stringify(result));
  assert.equal(result.persistence, 'captured');
  assert(requests > 0, 'harness contacted the model fixture');
  if (mode === 'read-only')
    assert(sawReadOnlyTool, `read/list tool remains available: ${JSON.stringify(fixture.observed)}`);
  const snapshot = JSON.parse(await readFile('/platform-control/snapshot/index.json', 'utf8'));
  assert(
    snapshot.entries.some((e) => e.namespace === 'home'),
    'session history persists without agent file access',
  );
  assert(!snapshot.entries.some((e) => e.namespace === 'workspace'), 'no unsolicited workspace files');
  console.log(JSON.stringify({ harness, mode, requests, outcome: result.outcome }));
  for (const directory of ['/platform-control', '/workspace', '/agent-home'])
    await rm(directory, { recursive: true, force: true });
}
