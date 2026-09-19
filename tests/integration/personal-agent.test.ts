import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Macrofold } from '../../sdk/typescript/src/index';
import { fixtureAccount } from '../fixtures/account';
import { handleApi } from '../../packages/core/src/http';
import { executeRun } from '../../packages/core/src/engine';
import { authPool, pool } from '../../packages/db';
import { AgentStore, type AgentRecord } from '../../examples/personal-agent/store';
import { PersonalAgents } from '../../examples/personal-agent/service';
import { exampleServer, demoAuth } from '../../examples/personal-agent/server';

let account: Awaited<ReturnType<typeof fixtureAccount>>,
  client: Macrofold,
  store: AgentStore,
  service: PersonalAgents,
  dir: string;
const configuration = {
  harness: 'codex' as const,
  model: 'fixture-model',
  billing_mode: 'managed' as const,
  budgetMicroUsd: '2000000',
};
let loseWorkspaceResponse = false;
beforeAll(async () => {
  account = await fixtureAccount('Personal agent reference');
  client = new Macrofold({
    apiKey: account.key,
    baseURL: 'http://localhost:3210',
    retries: 0,
    fetch: async (input, init) => {
      const response = await handleApi(new Request(input, init));
      if (
        loseWorkspaceResponse &&
        init?.method === 'POST' &&
        new URL(String(input)).pathname === '/v1/workspaces' &&
        response.ok
      ) {
        loseWorkspaceResponse = false;
        throw new Error('Synthetic lost response after commit');
      }
      return response;
    },
  });
  dir = await mkdtemp(path.join(tmpdir(), 'personal-agent-'));
  store = new AgentStore(path.join(dir, 'app.sqlite'));
  service = new PersonalAgents(store, client, configuration);
});
afterAll(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
  await pool.end();
  await authPool.end();
});
const act = (customer: string, agent: AgentRecord, action: unknown) =>
  service.act(customer, agent.id, randomUUID(), action);

it('recovers setup across a process restart without duplicating workspaces, and isolates Alice and Bob', async () => {
  const id = randomUUID(),
    request = randomUUID();
  loseWorkspaceResponse = true;
  await expect(service.act('alice', id, request, { action: 'setup', name: 'Milo' })).rejects.toThrow(
    'could not confirm',
  );
  expect(service.list('alice')[0]).toMatchObject({ status: 'setting_up' });
  store.close();
  store = new AgentStore(path.join(dir, 'app.sqlite'));
  service = new PersonalAgents(store, client, configuration);
  const alice = await service.act('alice', id, request, { action: 'setup', name: 'Milo' });
  expect(alice.status).toBe('active');
  expect((await client.workspaces.list()).data).toHaveLength(1);
  expect(await service.act('alice', id, request, { action: 'setup', name: 'Milo' })).toEqual(alice);
  expect(await service.readMemory('alice', id, 'profile.md')).toMatchObject({
    content: expect.stringContaining('# Profile'),
  });
  const bob = await service.act('bob', randomUUID(), randomUUID(), { action: 'setup', name: 'Basil' });
  expect(bob.worktreeId).not.toBe(alice.worktreeId);
  expect(service.list('bob').map((item) => item.id)).toEqual([bob.id]);
  await expect(service.readMemory('bob', id, 'profile.md')).rejects.toMatchObject({ status: 404 });
  await expect(
    service.act('bob', id, randomUUID(), { action: 'delete', confirmation: 'Milo' }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(service.readMemory('alice', id, '../private')).rejects.toMatchObject({ status: 400 });
});

it('preserves corrected memory across separate real simulator runs, handles stale edits and forgetting', async () => {
  let alice = service.list('alice')[0];
  const profile = await service.readMemory('alice', alice.id, 'profile.md');
  await act('alice', alice, {
    action: 'write',
    path: 'profile.md',
    content: '# Profile\nPrefers quiet hotels. Source: customer, 2026-09-11.\n',
    revision: profile.revision,
  });
  await expect(
    act('alice', alice, {
      action: 'write',
      path: 'profile.md',
      content: 'stale overwrite',
      revision: profile.revision,
    }),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  alice = await act('alice', alice, { action: 'chat', prompt: 'Plan a weekend using my profile.' });
  const first = alice.runs.at(-1)!;
  await executeRun(account.p.organizationId, first);
  expect(await client.runs.getResult(first)).toMatchObject({ final: true, persistence_status: 'verified' });
  alice = await act('alice', alice, {
    action: 'chat',
    prompt: 'Start another conversation using the same profile.',
  });
  expect(alice.conversations).toHaveLength(2);
  await executeRun(account.p.organizationId, alice.runs.at(-1)!);
  expect((await service.readMemory('alice', alice.id, 'profile.md')).content).toContain('quiet hotels');
  const bob = service.list('bob')[0];
  await expect(
    act('bob', bob, {
      action: 'chat',
      prompt: 'Foreign conversation',
      conversationId: alice.conversations[0],
    }),
  ).rejects.toMatchObject({ status: 404 });
  const updated = await service.readMemory('alice', alice.id, 'profile.md');
  await act('alice', alice, { action: 'forget', path: 'profile.md', revision: updated.revision });
  await expect(service.readMemory('alice', alice.id, 'profile.md')).rejects.toMatchObject({ status: 404 });
  expect((await service.readMemory('bob', bob.id, 'profile.md')).content).toContain('# Profile');
});

it('scopes connected accounts, creates one schedule on retry, pauses and deletes without cross-customer cleanup', async () => {
  let alice = service.list('alice')[0];
  const bob = service.list('bob')[0];
  alice = await act('alice', alice, { action: 'connect', secret: 'fixture-only-never-live' });
  const allowed = await client.connections.resolveAccess({
    workspace_id: alice.workspaceId!,
    agent_id: alice.presetId!,
  });
  expect(allowed.data).toMatchObject([{ connection_id: alice.connectionId, tools: ['web_search'] }]);
  expect(
    (await client.connections.resolveAccess({ workspace_id: bob.workspaceId!, agent_id: bob.presetId! })).data,
  ).toEqual([]);
  const request = randomUUID();
  alice = await service.act('alice', alice.id, request, { action: 'schedule', timezone: 'America/New_York' });
  expect(
    await service.act('alice', alice.id, request, { action: 'schedule', timezone: 'America/New_York' }),
  ).toEqual(alice);
  expect((await client.triggers.list()).data).toHaveLength(1);
  expect((await service.activity('alice', alice.id)).schedule).toMatchObject({
    cron: '0 9 * * 1',
    enabled: true,
    timezone: 'America/New_York',
  });
  alice = await act('alice', alice, { action: 'pause' });
  expect((await client.triggers.get(alice.triggerId!)).enabled).toBe(false);
  await expect(
    act('alice', alice, { action: 'chat', prompt: 'No new work while paused' }),
  ).rejects.toMatchObject({ status: 409 });
  alice = await act('alice', alice, { action: 'resume' });
  expect((await client.triggers.get(alice.triggerId!)).enabled).toBe(true);
  await expect(act('alice', alice, { action: 'delete', confirmation: 'wrong' })).rejects.toMatchObject({
    status: 400,
  });
  alice = await act('alice', alice, { action: 'delete', confirmation: 'Milo' });
  expect(alice.status).toBe('deleted');
  expect((await client.workspaces.get(bob.workspaceId!)).name).toContain('Basil');
  await expect(client.connections.get(alice.connectionId!)).rejects.toMatchObject({ status: 404 });
});

it('protects the HTTP UI against cross-origin actions, arbitrary customers and oversized bodies', async () => {
  const server = exampleServer(service, demoAuth, true).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const session = await fetch(origin + '/api/session').then((r) => r.json());
    const target = `/api/agents/${randomUUID()}`;
    const body = JSON.stringify({ action: 'setup', name: 'No CSRF', requestId: randomUUID() });
    expect(
      (
        await fetch(origin + target, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + '/api/demo/customer', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin, 'x-csrf-token': session.csrf },
          body: JSON.stringify({ id: 'admin' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(origin + target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin, 'x-csrf-token': session.csrf },
          body: ' '.repeat(128 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    const bob = service.list('bob')[0];
    expect((await fetch(origin + `/api/agents/${bob.id}/memory?path=profile.md`)).status).toBe(404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
