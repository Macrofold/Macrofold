import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { fixtureHttpApi } from '../fixtures/http-api';
import { authPool, pool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { credit } from '../../packages/core/src/ledger';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorktree } from '../../packages/core/src/files';
import {
  createSandbox,
  changeSandbox,
  getSandbox,
  advanceSandbox,
  presentSandbox,
  sandboxName,
  sandboxCost,
  releaseSandbox,
} from '../../packages/core/src/sandboxes';
import { billingUsage } from '../../packages/core/src/billing-usage';
import { reconcileFinance } from '../../packages/core/src/maintenance';
import { admitRun, getNativeRun } from '../../packages/core/src/runs';
import { claimRun } from '../../packages/core/src/engine';
import { SandboxMachines } from '../../packages/core/src/sandbox-machines';
import type { SandboxProvider } from '../../packages/contracts/sandbox-control';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let other: Awaited<ReturnType<typeof fixtureAccount>>;
let api: Awaited<ReturnType<typeof fixtureHttpApi>>;
let worktree: string;
const original = { ...config };
const provider: SandboxProvider = {
  create: vi.fn(async (name) => ({ name, sessionId: 'test-machine', createdAt: new Date().toISOString() })),
  isRunning: vi.fn(async () => true),
  control: vi.fn(async () => ({})),
  pause: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
};
const tx = <T>(f: (tx: import('../../packages/db').Tx) => Promise<T>) =>
  transaction(account.p.organizationId, f);
beforeAll(async () => {
  api = await fixtureHttpApi();
  account = await fixtureAccount('Sandboxes');
  other = await fixtureAccount('Other sandboxes');
  await tx(async (t) => {
    await credit(t, account.p.organizationId, 100000000n, `test:${id()}`);
    const workspace = await resources.create(t, 'workspaces', account.p.organizationId, {
      name: 'Reusable compute',
    });
    const op = await createWorktree(t, account.p, workspace.id, { name: 'main', branch: 'main' });
    worktree = op.result.worktree_id;
    await t.query("UPDATE organizations SET plan='scale' WHERE id=$1", [account.p.organizationId]);
  });
});
afterEach(() => {
  Object.assign(config, original);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
afterAll(async () => {
  await api.close();
  await pool.end();
  await authPool.end();
});
function enabled() {
  Object.assign(config, { mode: 'local', execution: 'docker', orchestration: 'poller', allowPaid: true });
  vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '60');
}
async function create(warm = 60) {
  enabled();
  return tx((t) =>
    createSandbox(t, account.p, {
      worktree_id: worktree,
      keep_warm_seconds: warm,
      max_cost_micro_usd: '100000',
    }),
  );
}
describe('durable sandbox lifecycle', () => {
  it.each([
    { mode: 'local', longRunning: false, expected: 'docker' },
    { mode: 'local', longRunning: true, expected: 'docker' },
    { mode: 'production', longRunning: false, expected: 'vercel' },
    { mode: 'production', longRunning: true, expected: 'render' },
  ])('selects $expected in $mode with long_running=$longRunning', async ({ mode, longRunning, expected }) => {
    enabled();
    config.mode = mode;
    config.execution = mode === 'local' ? 'docker' : 'vercel';
    vi.stubEnv('RENDER_SANDBOX_ENABLED', mode === 'local' ? '' : 'true');
    vi.stubEnv('RENDER_COMPUTE_MICRO_USD_PER_MINUTE', mode === 'local' ? '' : '60');
    const created = await tx((t) =>
      createSandbox(t, account.p, {
        worktree_id: worktree,
        long_running: longRunning,
        max_cost_micro_usd: '100000',
      }),
    );
    expect((await tx((t) => getSandbox(t, created.id))).provider).toBe(expected);
    await tx((t) => changeSandbox(t, account.p, created.id, 'destroy'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
  });
  it('still requires Render enablement for hosted long-running workers', async () => {
    enabled();
    config.mode = 'production';
    config.execution = 'vercel';
    vi.stubEnv('RENDER_SANDBOX_ENABLED', '');
    await expect(
      tx((t) =>
        createSandbox(t, account.p, {
          worktree_id: worktree,
          long_running: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'render_unavailable' });
  });
  it('keeps a local long-running worker past a day without cloud credentials or a provider expiry', async () => {
    enabled();
    vi.stubEnv('RENDER_SANDBOX_ENABLED', '');
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '0');
    const created = await tx((t) =>
      createSandbox(t, account.p, {
        worktree_id: worktree,
        long_running: true,
      }),
    );
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect(provider.create).toHaveBeenCalledWith(expect.any(String), expect.any(String), null);
    await tx((t) =>
      t.query("UPDATE sandboxes SET started_at=now()-interval '2 days' WHERE id=$1", [created.id]),
    );
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect(await tx((t) => getSandbox(t, created.id))).toMatchObject({
      provider: 'docker',
      status: 'ready',
      expires_at: null,
      idle_expires_at: null,
    });
    expect(provider.pause).not.toHaveBeenCalled();
    await tx((t) => changeSandbox(t, account.p, created.id, 'pause'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('paused');
    await tx((t) => changeSandbox(t, account.p, created.id, 'resume'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect(await tx((t) => getSandbox(t, created.id))).toMatchObject({
      provider: 'docker',
      status: 'ready',
      generation: 2,
      expires_at: null,
    });
    await tx((t) => changeSandbox(t, account.p, created.id, 'destroy'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('destroyed');
  });
  it('authorizes, creates, pauses, resumes with a new generation and destroys without altering saved files', async () => {
    const created = await create();
    expect(created.status).toBe('creating');
    const before = await tx((t) => resources.get(t, 'worktrees', worktree));
    await expect(
      transaction(other.p.organizationId, (t) => getSandbox(t, created.id, other.p)),
    ).rejects.toMatchObject({ status: 404 });
    await advanceSandbox(account.p.organizationId, created.id, provider);
    const ready = await tx((t) => getSandbox(t, created.id));
    expect(ready.status).toBe('ready');
    expect(ready.expires_at).not.toBeNull();
    expect(ready.idle_expires_at).not.toBeNull();
    expect(presentSandbox(ready)).not.toHaveProperty('secret_ciphertext');
    await tx((t) => changeSandbox(t, account.p, created.id, 'pause'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    const paused = await tx((t) => getSandbox(t, created.id));
    expect(paused.status).toBe('paused');
    expect(paused.reserved_micro_usd).toBe('0');
    await tx((t) => changeSandbox(t, account.p, created.id, 'resume'));
    const resumed = await tx((t) => getSandbox(t, created.id));
    expect(sandboxName(resumed)).not.toBe(sandboxName(ready));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) => changeSandbox(t, account.p, created.id, 'destroy'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) => changeSandbox(t, account.p, created.id, 'destroy'));
    await expect(tx((t) => changeSandbox(t, account.p, created.id, 'resume'))).rejects.toMatchObject({
      code: 'sandbox_destroyed',
    });
    expect((await tx((t) => resources.get(t, 'worktrees', worktree))).revision).toBe(before.revision);
    expect((await tx((t) => reconcileFinance(t, account.p.organizationId))).issues).toEqual([]);
  });
  it('expires idle compute, caps its charge, and serializes duplicate maintenance', async () => {
    const created = await create(1);
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) =>
      t.query(
        "UPDATE sandboxes SET started_at=now()-interval '10 days',idle_expires_at=now()-interval '1 second' WHERE id=$1",
        [created.id],
      ),
    );
    expect(sandboxCost(await tx((t) => getSandbox(t, created.id)))).toBe(100000n);
    await Promise.all([
      advanceSandbox(account.p.organizationId, created.id, provider),
      advanceSandbox(account.p.organizationId, created.id, provider),
    ]);
    expect(provider.pause).toHaveBeenCalledTimes(1);
    const row = await tx((t) => getSandbox(t, created.id));
    expect(row.status).toBe('paused');
    expect(row.cost_micro_usd).toBe('100000');
    expect((await tx((t) => reconcileFinance(t, account.p.organizationId))).issues).toEqual([]);
  });
  it('keeps failures retryable without pretending compute was destroyed or releasing its reservation', async () => {
    const created = await create();
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) => changeSandbox(t, account.p, created.id, 'destroy'));
    const failed = {
      ...provider,
      destroy: vi.fn(async () => {
        throw new Error('network');
      }),
    };
    await advanceSandbox(account.p.organizationId, created.id, failed);
    const row = await tx((t) => getSandbox(t, created.id));
    expect(row.status).toBe('destroying');
    expect(row.reserved_micro_usd).toBe('100000');
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('destroyed');
  });
  it('borrows the same machine for separate native runs, blocks lifecycle changes while owned, and keeps no run token in the public response', async () => {
    const created = await create();
    await advanceSandbox(account.p.organizationId, created.id, provider);
    // Native admission uses the fixture catalog in simulation; compute is provided only by the fake port.
    config.execution = 'simulator';
    config.allowPaid = false;
    const accepted = await tx((t) =>
      admitRun(t, account.p, {
        worktree_id: worktree,
        sandbox_id: created.id,
        prompt: 'test',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      }),
    );
    expect(accepted.sandbox_id).toBe(created.id);
    const run = await tx((t) => getNativeRun(t, accepted.run_id));
    expect(run.config.compute_rate_micro_usd_per_minute).toBe('0');
    const machine = new SandboxMachines(run, created.id, provider);
    const binding = await machine.provision();
    await expect(tx((t) => changeSandbox(t, account.p, created.id, 'destroy'))).rejects.toMatchObject({
      code: 'sandbox_busy',
    });
    await machine.close(binding, false);
    await machine.close(binding, false);
    expect(provider.control).toHaveBeenCalledTimes(1);
    const row = await tx((t) => getSandbox(t, created.id));
    expect(row.status).toBe('ready');
    expect(row.active_run_id).toBeNull();
    expect(row.idle_expires_at).not.toBeNull();
    await tx((t) => t.query("UPDATE runs SET status='succeeded' WHERE id=$1", [run.id]));
  });
  it('replaces confirmed expired compute before prepare, but never mistakes a lookup failure for absence', async () => {
    const created = await create();
    await advanceSandbox(account.p.organizationId, created.id, provider);
    config.execution = 'simulator';
    config.allowPaid = false;
    const accepted = await tx((t) =>
      admitRun(t, account.p, {
        worktree_id: worktree,
        sandbox_id: created.id,
        prompt: 'test',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      }),
    );
    const run = await tx((t) => getNativeRun(t, accepted.run_id));
    const failed = {
      ...provider,
      isRunning: vi.fn(async () => {
        throw new Error('lookup unavailable');
      }),
    };
    await expect(new SandboxMachines(run, created.id, failed).provision()).rejects.toThrow(
      'lookup unavailable',
    );
    expect(provider.destroy).not.toHaveBeenCalled();
    const stopped = { ...provider, isRunning: vi.fn(async () => false) };
    const binding = await new SandboxMachines(run, created.id, stopped).provision();
    expect(binding.name).toContain('-2');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    await releaseSandbox(account.p.organizationId, created.id, run.id, 0, false);
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) => t.query("UPDATE runs SET status='succeeded' WHERE id=$1", [run.id]));
  });
  it('keeps long-running servers ready until explicit stop or a run override, and excludes active ones from idle maintenance', async () => {
    enabled();
    vi.stubEnv('RENDER_SANDBOX_ENABLED', '');
    const created = await tx((t) =>
      createSandbox(t, account.p, {
        worktree_id: worktree,
        long_running: true,
        max_cost_micro_usd: '100000',
      }),
    );
    await advanceSandbox(account.p.organizationId, created.id, provider);
    expect(created.keep_warm_seconds).toBeNull();
    expect((await tx((t) => getSandbox(t, created.id))).idle_expires_at).toBeNull();
    config.execution = 'simulator';
    config.allowPaid = false;
    const accepted = await tx((t) =>
      admitRun(t, account.p, {
        worktree_id: worktree,
        sandbox_id: created.id,
        prompt: 'test',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      }),
    );
    const run = await tx((t) => getNativeRun(t, accepted.run_id));
    const machine = new SandboxMachines(run, created.id, provider);
    const binding = await machine.provision();
    expect(
      (await pool.query('SELECT id FROM reporting.sandbox_schedule WHERE id=$1', [created.id])).rowCount,
    ).toBe(0);
    await machine.close(binding, false);
    expect((await tx((t) => getSandbox(t, created.id))).idle_expires_at).toBeNull();
    await machine.provision();
    await releaseSandbox(account.p.organizationId, created.id, run.id, null, false);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('pausing');
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) => t.query("UPDATE runs SET status='succeeded' WHERE id=$1", [run.id]));
  });
  it('reports server compute separately from run usage and reconciles every allocation', async () => {
    const created = await create();
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx((t) =>
      t.query("UPDATE sandboxes SET started_at=now()-interval '1 minute' WHERE id=$1", [created.id]),
    );
    await tx((t) => changeSandbox(t, account.p, created.id, 'pause'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    const query = new URLSearchParams({
      from: '2020-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
      worktree_id: worktree,
      limit: '100',
    });
    const usage = await tx((t) => billingUsage(t, account.p.organizationId, query));
    expect(usage.data.find((e) => e.sandbox_id === created.id)).toMatchObject({
      kind: 'compute',
      run_id: null,
      worktree_id: worktree,
      provider: 'docker',
    });
    query.set('session_id', id());
    expect((await tx((t) => billingUsage(t, account.p.organizationId, query))).data).toEqual([]);
    expect((await tx((t) => reconcileFinance(t, account.p.organizationId))).issues).toEqual([]);
  });
  it('resumes a server that paused after a message was admitted but before it was claimed', async () => {
    const created = await create();
    await advanceSandbox(account.p.organizationId, created.id, provider);
    config.execution = 'simulator';
    config.allowPaid = false;
    const accepted = await tx((t) =>
      admitRun(t, account.p, {
        worktree_id: worktree,
        sandbox_id: created.id,
        prompt: 'test',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      }),
    );
    await tx((t) => changeSandbox(t, account.p, created.id, 'pause'));
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await claimRun(account.p.organizationId, accepted.run_id);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('creating');
    await releaseSandbox(account.p.organizationId, created.id, accepted.run_id, 0, true);
    await advanceSandbox(account.p.organizationId, created.id, provider);
    await tx(async (t) => {
      await t.query("UPDATE runs SET status='succeeded' WHERE id=$1", [accepted.run_id]);
      await resources.update(t, 'worktrees', worktree, { status: 'idle' });
    });
  });
  it('bounds pending provisioning and releases its allocation only after confirmed cleanup', async () => {
    const created = await create();
    const pending = { ...provider, create: vi.fn(async () => null) };
    await advanceSandbox(account.p.organizationId, created.id, pending);
    expect((await tx((t) => getSandbox(t, created.id))).status).toBe('creating');
    await tx((t) =>
      t.query("UPDATE sandboxes SET provisioning_at=now()-interval '11 minutes' WHERE id=$1", [created.id]),
    );
    await advanceSandbox(account.p.organizationId, created.id, pending);
    const stopped = await tx((t) => getSandbox(t, created.id));
    expect(stopped.status).toBe('paused');
    expect(stopped.reserved_micro_usd).toBe('0');
    expect(pending.create).toHaveBeenCalledTimes(1);
    expect(provider.pause).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate display names before reserving additional funds', async () => {
    enabled();
    const name = `named-${id()}`;
    await tx((t) => createSandbox(t, account.p, { worktree_id: worktree, name }));
    const before = (
      await tx((t) =>
        t.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [account.p.organizationId]),
      )
    ).rows[0];
    await expect(
      tx((t) => createSandbox(t, account.p, { worktree_id: worktree, name: name.toUpperCase() })),
    ).rejects.toMatchObject({ code: 'sandbox_name_exists' });
    const after = (
      await tx((t) =>
        t.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [account.p.organizationId]),
      )
    ).rows[0];
    expect(after).toEqual(before);
  });
  it('exposes lifecycle through the authenticated REST contract', async () => {
    enabled();
    const response = await fetch(`${api.origin}/v1/sandboxes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({ worktree_id: worktree, max_cost_micro_usd: '10000' }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(202);
    const read = await fetch(`${api.origin}/v1/sandboxes/${body.id}`, {
      headers: { authorization: `Bearer ${account.key}` },
    });
    expect(read.status).toBe(200);
    const foreign = await fetch(`${api.origin}/v1/sandboxes/${body.id}`, {
      headers: { authorization: `Bearer ${other.key}` },
    });
    expect(foreign.status).toBe(404);
    const listed = await fetch(`${api.origin}/v1/sandboxes?worktree_id=${worktree}`, {
      headers: { authorization: `Bearer ${account.key}` },
    });
    expect(listed.status).toBe(200);
  });
});
