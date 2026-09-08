import assert from 'node:assert/strict';
import { Macrofold, ApiError, RunFailedError, WaitTimeoutError } from '../../sdk/typescript/dist/index.js';

const client = new Macrofold({
  baseURL: process.env.MACROFOLD_FIXTURE_ORIGIN!,
  apiKey: process.env.MACROFOLD_FIXTURE_KEY!,
});
assert.equal(new URL(client.baseURL).hostname, '127.0.0.1');
const filesWorkspace = process.env.MACROFOLD_FIXTURE_FILES_WORKSPACE;
assert(filesWorkspace, 'Run pnpm test:sdks to create the isolated file fixture.');
assert.deepEqual(
  await client.workspaces.readFile(filesWorkspace, { path: 'notes/日本語 + #?.bin' }),
  new Uint8Array([0, 255, 10, 128]),
);
assert.deepEqual(await client.workspaces.readFile(filesWorkspace, { path: 'empty.txt' }), new Uint8Array());
await assert.rejects(
  client.workspaces.readFile(filesWorkspace, { path: 'missing.txt' }),
  (error: unknown) => error instanceof ApiError && error.status === 404,
);
const project = await client.projects.create({ name: 'TypeScript application fixture' });
const agent = await client.agents.create({
  name: 'TypeScript preset',
  harness: 'codex',
  model: 'fixture-model',
  billing_mode: 'managed',
});
const run = await client.runs.create({
  project_id: project.id,
  agent_id: agent.id,
  prompt: 'Verify TypeScript persisted execution.',
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
assert.ok((await client.workspaces.listCheckpoints(run.workspace_id)).data.length);
const note = await client.workspaces.readFile(run.workspace_id, { path: `notes/run-${run.run_id}.md` });
assert.match(new TextDecoder().decode(note), /Verify TypeScript persisted execution/);
const replay = [];
for await (const event of client.runs.stream(run.run_id, { after: events.at(-2)!.sequence }))
  replay.push(event.sequence);
assert.deepEqual(replay, [events.at(-1)!.sequence]);
assert.equal((await client.runs.cancel(run.run_id)).status, 'succeeded');
// A long simulated response keeps earlier workspace work ahead of the queued follow-up.
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
