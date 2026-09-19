import { Macrofold, type Schema } from '../../sdk/typescript/src/index';

/** Compiled by pnpm check; never invokes a provider. Negative cases guard autocomplete contracts. */
export async function typedSdkContract(client: Macrofold) {
  const workspace: Schema['Workspace'] = await client.workspaces.create({ name: 'Research' });
  const run: Schema['RunAccepted'] = await client.runs.create({
    workspace_id: workspace.id,
    agent_id: 'preset',
    prompt: 'Test',
  });
  const state: Schema['Run'] = await client.runs.get(run.run_id);
  const text: AsyncGenerator<string> = client.runs.streamText(run.run_id);
  const events: AsyncGenerator<Schema['Event']> = client.runs.events(run.run_id);
  const result: Schema['RunResult'] = await client.runs.wait(run.run_id);
  void [text, events, result];
  await client.runs.cancel(state.id);
  // @ts-expect-error Workspace names are required.
  await client.workspaces.create({});
  // @ts-expect-error Harnesses are a closed contract enum.
  await client.runs.create({ workspace_id: workspace.id, harness: 'unknown', model: 'fixture', prompt: 'Test' });
  // @ts-expect-error A worktree selector is required.
  await client.runs.create({ harness: 'codex', model: 'fixture', prompt: 'Test' });
  // @ts-expect-error File writes need the observed revision.
  await client.worktrees.writeFile('worktree', { path: 'a', content: new Uint8Array() });
  // @ts-expect-error Typed responses do not expose nonexistent fields.
  return workspace.nonexistent;
}
