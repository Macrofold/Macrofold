import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace, writeFile, type FileRecord } from '../../packages/core/src/files';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { credit, reserve } from '../../packages/core/src/ledger';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { FaultMachine } from '../fixtures/cloud-machine';
import { readContent } from '../../packages/providers/src/storage';

async function scenario() {
  const user = (
    await auth.api.signUpEmail({
      body: {
        email: `cloud-${id()}@example.test`,
        password: 'cloud-test-password-123',
        name: 'Cloud fixture',
      },
    })
  ).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  const p: Principal = {
    id: user.id,
    userId: user.id,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    scopes: customerScopes,
    projectIds: [],
    operator: false,
  };
  return transaction(org, async (tx) => {
    await credit(tx, org, 10_000_000n, `fixture:${id()}`);
    const project = await resources.create(tx, 'projects', org, { name: 'Cloud fixture' });
    const created = await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' });
    const workspaceId = (created.result as { workspace_id: string }).workspace_id;
    const ws = await resources.get(tx, 'workspaces', workspaceId);
    await writeFile(tx, p, workspaceId, 'initial.txt', Buffer.from('Original checkpoint'), ws.revision);
    const run = await admitRun(tx, p, {
      workspace_id: workspaceId,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      limits: { timeout_seconds: 900, max_cost_micro_usd: '2000000' },
    });
    // Local admission intentionally holds no real money. This test funds a ledger reservation explicitly.
    await reserve(tx, org, 2_000_000n);
    await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [run.run_id]);
    return { org, p, runId: run.run_id, workspaceId };
  });
}
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('durable cloud lifecycle with fault injection', () => {
  it('settles with the admitted compute rate after operator pricing changes', async () => {
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '8000');
    const s = await scenario(),
      provider = new FaultMachine();
    for (let i = 0; i < 60; i++) {
      await advanceCloudRun(s.org, s.runId, provider);
      if ((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase === 'publish')
        break;
    }
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase).toBe('publish');
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    await transaction(s.org, (tx) =>
      tx.query('UPDATE runs SET started_at=$2 WHERE id=$1', [s.runId, new Date(now - 60000)]),
    );
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '8000000');
    for (let i = 0; i < 5; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      account: (
        await tx.query('SELECT reserved_micro_usd,balance_micro_usd FROM organizations WHERE id=$1', [s.org])
      ).rows[0],
      charges: (
        await tx.query("SELECT amount_micro_usd FROM ledger WHERE reference=$1 AND account='consumption'", [
          `run:${s.runId}`,
        ])
      ).rows,
    }));
    expect(saved.run.status).toBe('succeeded');
    expect(saved.run.cost_micro_usd).toBe('8000');
    expect(saved.account).toEqual({ reserved_micro_usd: '0', balance_micro_usd: '9992000' });
    expect(saved.charges).toEqual([{ amount_micro_usd: '8000' }]);
    expect(provider.starts).toBe(1);
  });
  it('recovers a lost launch acknowledgement without repeating the native prompt; persists workspace, Git, and session state', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostLaunch = true;
    let done = false;
    for (let i = 0; i < 60 && !done; i++) done = (await advanceCloudRun(s.org, s.runId, provider)).done;
    expect(done).toBe(true);
    expect(provider.attempts).toBe(2);
    expect(provider.starts).toBe(1);
    expect(provider.closes).toEqual([false]);
    expect(provider.stageFiles.has('/platform-control/restore/page-0.json')).toBe(true);
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      ws: await resources.get(tx, 'workspaces', s.workspaceId),
    }));
    expect(saved.run.status).toBe('succeeded');
    expect(saved.run.result.persistence_status).toBe('verified');
    const file = (saved.ws.files as FileRecord[])[0];
    expect((await readContent(file.key, file.sha256)).toString()).toBe(provider.bytes.toString());
    expect((saved.ws.git_files as FileRecord[])[0].path).toBe('.git/HEAD');
    const session = await transaction(s.org, (tx) => resources.get(tx, 'sessions', saved.run.session_id));
    expect(session.native_session_id).toBe('native-session');
    expect((session.state_files as FileRecord[])[0].path).toBe('.codex/state.json');
    const journal = await transaction(s.org, (tx) =>
      tx.query('SELECT sum(amount_micro_usd) AS balance FROM ledger WHERE reference=$1', [`run:${s.runId}`]),
    );
    expect(journal.rows[0].balance).toBe('0');
  });
  it('runs the same durable lifecycle through competing standalone pollers', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostLaunch = true;
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await pool.query("UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND resource_id=$1", [
        s.runId,
      ]);
      const results = await Promise.all([
        dispatchCloudPoller(provider, 1, s.org),
        dispatchCloudPoller(provider, 1, s.org),
      ]);
      expect(results.reduce((n, r) => n + r.advanced, 0)).toBeLessThanOrEqual(1);
      const row = await transaction(s.org, (tx) => getRun(tx, s.runId));
      done = (row.execution_binding as any)?.phase === 'done';
    }
    expect(done).toBe(true);
    expect(provider.starts).toBe(1);
    expect(provider.attempts).toBe(2);
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
  });
  it('publishes modified files even when the native agent fails', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.outcome = 'failure';
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('failed');
    expect(run.result.persistence_status).toBe('verified');
    expect(run.result.checkpoint_id).toBeTruthy();
    expect(provider.closes).toEqual([false]);
  });
  it('retains an unavailable VM for recovery and blocks further writers instead of publishing stale files as a new checkpoint', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostVM = true;
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const { run, ws } = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      ws: await resources.get(tx, 'workspaces', s.workspaceId),
    }));
    expect(run.status).toBe('failed');
    expect(run.result.persistence_status).toBe('failed');
    expect(run.result.checkpoint_id).toBeUndefined();
    expect(ws.status).toBe('degraded');
    expect(provider.closes.every(Boolean)).toBe(true);
    expect(provider.starts).toBe(1);
  });
});
