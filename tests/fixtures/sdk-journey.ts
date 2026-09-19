import assert from 'node:assert/strict';
import { Macrofold, ApiError, RunFailedError, WaitTimeoutError } from '../../sdk/typescript/dist/index.js';

const client = new Macrofold({
  baseURL: process.env.MACROFOLD_FIXTURE_ORIGIN!,
  apiKey: process.env.MACROFOLD_FIXTURE_KEY!,
});
assert.equal(new URL(client.baseURL).hostname, '127.0.0.1');
const filesWorktree = process.env.MACROFOLD_FIXTURE_FILES_WORKTREE;
assert(filesWorktree, 'Run pnpm test:sdks to create the isolated file fixture.');
assert.deepEqual(
  await client.worktrees.readFile(filesWorktree, { path: 'notes/日本語 + #?.bin' }),
  new Uint8Array([0, 255, 10, 128]),
);
assert.deepEqual(await client.worktrees.readFile(filesWorktree, { path: 'empty.txt' }), new Uint8Array());
await assert.rejects(
  client.worktrees.readFile(filesWorktree, { path: 'missing.txt' }),
  (error: unknown) => error instanceof ApiError && error.status === 404,
);
const customerId = 'customer / 日本語',
  customerAgentId = process.env.MACROFOLD_FIXTURE_CUSTOMER_AGENT!,
  customerRunId = process.env.MACROFOLD_FIXTURE_CUSTOMER_RUN!;
assert.equal(
  (await client.customerAgents.get(customerId, customerAgentId)).integration_path,
  'customer-agents',
);
const customerEvents = [];
for await (const event of client.customerAgents.streamRun(customerId, customerAgentId, customerRunId))
  customerEvents.push(event);
assert.equal(customerEvents.at(-1)?.type, 'run.succeeded');
assert.match(
  new TextDecoder().decode(
    await client.customerAgents.readFile(customerId, customerAgentId, {
      path: `notes/run-${customerRunId}.md`,
    }),
  ),
  /optional customer-agent path/,
);
await assert.rejects(
  client.customerAgents.getRun('wrong customer', customerAgentId, customerRunId),
  (e: unknown) => e instanceof ApiError && e.status === 404,
);
const workspace = await client.workspaces.create({ name: 'TypeScript application fixture' });
assert(workspace.default_worktree_id);
const worktreeId = workspace.default_worktree_id;
const folder = await client.worktrees.createFolder(worktreeId, {
  path: 'examples',
  ifMatch: (await client.worktrees.get(worktreeId)).revision,
});
assert.equal(folder.result?.entry?.type, 'directory');
assert(folder.result?.revision);
const renamed = await client.worktrees.renameFile(worktreeId, {
  path: 'examples/.gitkeep',
  new_path: 'examples/renamed.txt',
  ifMatch: folder.result.revision,
});
assert.equal(renamed.result?.previous_path, 'examples/.gitkeep');
assert.deepEqual(
  (await client.worktrees.listFiles(worktreeId, { recursive: false })).entries.map((entry) => entry.type),
  ['directory'],
);
assert.deepEqual(
  await client.worktrees.readFile(worktreeId, { path: 'examples/renamed.txt' }),
  new Uint8Array(),
);
const agent = await client.agents.create({
  name: 'TypeScript preset',
  harness: 'codex',
  model: 'fixture-model',
  billing_mode: 'managed',
});
const connection = await client.connections.create({
  name: 'SDK tools',
  kind: 'search',
  provider: 'brave',
  auth_method: 'none',
});
const initialAccess = await client.connections.getAccess(connection.id);
assert.equal(initialAccess.organization_wide, false);
const approved = await client.connections.updateAccess(connection.id, {
  tools: ['web_search'],
  ifMatch: `"${initialAccess.version}"`,
});
const permission = await client.connections.createAccessRule(connection.id, {
  scope: 'workspace_agent',
  workspace_id: workspace.id,
  agent_id: agent.id,
  ifMatch: `"${approved.version}"`,
});
assert.equal(permission.version, '3');
assert.equal(
  (await client.workspaces.get(workspace.id, { include_connections: true, agent_id: agent.id })).connections
    ?.data[0].id,
  connection.id,
);
assert.equal(
  (await client.connections.resolveAccess({ workspace_id: workspace.id, agent_id: agent.id })).data[0].tools[0],
  'web_search',
);
await client.agents.update(agent.id, { connection_grants: [] });
assert.deepEqual((await client.agents.get(agent.id)).connection_grants, []);
await client.agents.update(agent.id, { connection_grants: null });
assert.equal((await client.agents.get(agent.id)).connection_grants, undefined);
await client.worktrees.writeFile(worktreeId, {
  path: 'brief.md',
  content: new TextEncoder().encode('SDK document fixture'),
  ifMatch: (await client.worktrees.get(worktreeId)).revision,
});
const run = await client.runs.create({
  workspace_id: workspace.id,
  agent_id: agent.id,
  prompt: 'Verify TypeScript persisted execution.',
  attachments: ['brief.md'],
});
const events = [];
let text = '';
for await (const part of client.runs.streamText(run.run_id)) text += part;
for await (const event of client.runs.events(run.run_id)) events.push(event);
assert.equal(events.at(-1)?.type, 'run.succeeded');
assert.equal((await client.runs.get(run.run_id)).status, 'succeeded');
const result = await client.runs.wait(run.run_id);
assert.equal(result.final, true);
assert.match(result.output_text!, /Simulation completed/);
assert.equal(text, result.output_text);
assert.equal(result.persistence_status, 'verified');
const artifacts = await client.runs.listArtifacts(run.run_id);
assert.equal(artifacts.data.length, 1);
const download = await client.artifacts.download(artifacts.data[0].id);
// A signed download is self-authorizing; never forward the customer's API key.
const downloaded = await fetch(download.url);
assert(downloaded.ok);
assert.match(await downloaded.text(), /Simulation completed/);
assert.ok((await client.worktrees.listCheckpoints(run.worktree_id)).data.length);
const note = await client.worktrees.readFile(run.worktree_id, { path: `notes/run-${run.run_id}.md` });
assert.match(new TextDecoder().decode(note), /Verify TypeScript persisted execution/);
const replay = [];
for await (const event of client.runs.stream(run.run_id, { after: events.at(-2)!.sequence }))
  replay.push(event.sequence);
assert.deepEqual(replay, [events.at(-1)!.sequence]);
assert.equal((await client.runs.cancel(run.run_id)).status, 'succeeded');
// A long simulated response keeps earlier worktree work ahead of the queued follow-up.
const blocker = await client.runs.create({
  session_id: run.session_id,
  prompt: 'Fixture work. '.repeat(100),
});
const queued = await client.runs.create({
  session_id: run.session_id,
  prompt: 'Cancel this queued follow-up.',
  queue_if_busy: true,
});
assert.equal(queued.status, 'queued');
await assert.rejects(client.runs.wait(blocker.run_id, { timeoutMs: 0 }), WaitTimeoutError);
assert.notEqual((await client.runs.get(blocker.run_id)).status, 'cancelled');
await client.runs.cancel(queued.run_id);
await assert.rejects(client.runs.wait(queued.run_id), RunFailedError);
const cancellation = [];
for await (const event of client.runs.stream(queued.run_id)) cancellation.push(event);
assert.equal(cancellation.at(-1)?.type, 'run.cancelled');
await client.runs.cancel(blocker.run_id);
for await (const _event of client.runs.stream(blocker.run_id)) {
  /* Wait for cleanup before removing the fixture. */
}
console.log(
  'TypeScript resource journey: execution, replay, persistent files, checkpoints, queued cancellation, cleanup.',
);
