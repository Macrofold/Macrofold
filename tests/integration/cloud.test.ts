import { writeFixtureFile } from '../fixtures/file-mutation';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorktree, type FileRecord } from '../../packages/core/src/files';
import { admitRun, getNativeRun as getRun } from '../../packages/core/src/runs';
import { credit, reserve } from '../../packages/core/src/ledger';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { FaultMachine } from '../fixtures/cloud-machine';
import { readContent, saveContent } from '../../packages/providers/src/storage';

async function scenario(attachments?: string[]) {
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
    workspaceIds: [],
    operator: false,
  };
  const ws = await transaction(org, async (tx) => {
    await credit(tx, org, 10_000_000n, `fixture:${id()}`);
    const workspace = await resources.create(tx, 'workspaces', org, { name: 'Cloud fixture' });
    const created = await createWorktree(tx, p, workspace.id, { name: 'main', branch: 'main' });
    const worktreeId = (created.result as { worktree_id: string }).worktree_id;
    const ws = await resources.get(tx, 'worktrees', worktreeId);
    return ws;
  });
  const worktreeId = ws.id;
  await writeFixtureFile(p, worktreeId, 'initial.txt', Buffer.from('Original checkpoint'), ws.revision);
  return transaction(org, async (tx) => {
    const run = await admitRun(tx, p, {
      worktree_id: worktreeId,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      attachments,
      limits: { timeout_seconds: 900, max_cost_micro_usd: '2000000' },
    });
    // Local admission intentionally holds no real money. This test funds a ledger reservation explicitly.
    await reserve(tx, org, 2_000_000n);
    await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [run.run_id]);
    return { org, p, runId: run.run_id, worktreeId };
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
  it('advances ready phases immediately, batches restoration, and preserves progress after a lost upload acknowledgement', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const extra: FileRecord[] = [];
    for (let i = 0; i < 40; i++) {
      const saved = await saveContent(s.org, Buffer.from(`small file ${i}`));
      extra.push({
        ...saved,
        path: `file-${i}.txt`,
        type: 'file',
        mode: 0o644,
        git_ignored: false,
        modified_at: new Date().toISOString(),
      });
    }
    await transaction(s.org, async (tx) => {
      const ws = await resources.get(tx, 'worktrees', s.worktreeId);
      await tx.query("UPDATE worktrees SET data=jsonb_set(data,'{files}',$2::jsonb) WHERE id=$1", [
        s.worktreeId,
        JSON.stringify([...(ws.files || []), ...extra]),
      ]);
    });
    for (let i = 0; i < 10; i++) {
      expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
      if ((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase === 'hydrate')
        break;
    }
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase).toBe('hydrate');
    const write = provider.stage.bind(provider);
    const stage = vi.spyOn(provider, 'stage').mockImplementationOnce(async (binding, files) => {
      await write(binding, files.slice(0, 1));
      throw new Error('Lost batch acknowledgement');
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toEqual({ done: false, delaySeconds: 2 });
    const processed = await transaction(s.org, (tx) =>
      tx.query("SELECT id FROM execution_objects WHERE run_id=$1 AND kind LIKE 'input_%' AND processed", [
        s.runId,
      ]),
    );
    expect(processed.rowCount).toBe(0);
    expect(provider.starts).toBe(0);
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    expect(stage.mock.calls[0][1]).toHaveLength(32);
    expect(stage.mock.calls[1][1]).toEqual(stage.mock.calls[0][1]);
    for (let i = 0; i < 40; i++) {
      const result = await advanceCloudRun(s.org, s.runId, provider);
      expect(result.delaySeconds).toBe(0);
      if (result.done) break;
    }
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('succeeded');
    expect(run.result.persistence_status).toBe('verified');
    expect(provider.starts).toBe(1);
    expect(stage).toHaveBeenCalledTimes(3); // one uncertain upload, then two successful batches
    for (const file of extra)
      expect(provider.stageFiles.get(`/platform-control/restore/chunks/${file.sha256}`)).toEqual(
        await readContent(file.key, file.sha256),
      );
    expect(run.execution_binding?.phaseTimings?.hydrate).toMatchObject({
      attempts: 4,
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      activeMs: expect.any(Number),
    });
    expect(run.execution_binding?.phaseTimings?.hydrate?.activeMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps actual restore and execution waits without delaying ready work in the SQL poller', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    vi.spyOn(provider, 'restored').mockResolvedValueOnce('pending');
    const first = await dispatchCloudPoller(provider, 1, s.org);
    expect(first).toMatchObject({ advanced: 1, failed: 0, ready: true });
    // No forced available_at update: the next phase must already be due.
    expect(await dispatchCloudPoller(provider, 1, s.org)).toMatchObject({
      advanced: 1,
      failed: 0,
      ready: true,
    });
    for (let i = 0; i < 10; i++) {
      const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
      if (run.execution_binding?.phase === 'restore_wait') break;
      expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    }
    expect(await advanceCloudRun(s.org, s.runId, provider)).toEqual({ done: false, delaySeconds: 3 });
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    provider.pendingPolls = 1;
    const waiting = await dispatchCloudPoller(provider, 1, s.org);
    expect(waiting).toMatchObject({ advanced: 1, ready: false });
    const next = await pool.query(
      'SELECT available_at>now() AS delayed FROM dispatch_jobs WHERE resource_id=$1',
      [s.runId],
    );
    expect(next.rows[0].delayed).toBe(true);
    for (let i = 0; i < 30; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
  });
  it('carries attachment hashes into the native configuration and publishes verified deliverables once', async () => {
    const s = await scenario(['initial.txt']),
      provider = new FaultMachine();
    const prepare = vi.spyOn(provider, 'prepare');
    const snapshot = provider.snapshotPage.bind(provider);
    vi.spyOn(provider, 'snapshotPage').mockImplementation(async (binding, offset) => {
      const page = await snapshot(binding, offset);
      return {
        ...page,
        entries: page.entries.map((entry) =>
          entry.path === 'durable.txt' ? { ...entry, path: 'outputs/report.txt' } : entry,
        ),
      };
    });
    for (let i = 0; i < 80; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect(prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ path: 'initial.txt', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        ],
      }),
    );
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('succeeded');
    expect(run.result.artifact_ids).toHaveLength(1);
    const artifact = await transaction(s.org, (tx) =>
      resources.get(tx, 'artifacts', run.result.artifact_ids![0], s.p),
    );
    expect(artifact.name).toBe('outputs/report.txt');
    expect(await readContent(artifact.key, artifact.sha256)).toEqual(provider.bytes);
    await advanceCloudRun(s.org, s.runId, provider);
    expect((await transaction(s.org, (tx) => tx.query('SELECT id FROM artifacts'))).rowCount).toBe(1);
  });
  it('waits for an owned execution phase lease and resumes after expiry without double launching', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceCloudRun(s.org, s.runId, provider);
    await transaction(s.org, async (tx) => {
      const run = await getRun(tx, s.runId);
      await tx.query('UPDATE runs SET execution_binding=$2 WHERE id=$1', [
        s.runId,
        { ...run.execution_binding, lock: 'other-worker', lockExpires: Date.now() + 60000 },
      ]);
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toEqual({ done: false, delaySeconds: 5 });
    expect(provider.starts).toBe(0);
    await transaction(s.org, (tx) =>
      tx.query(
        "UPDATE runs SET execution_binding=jsonb_set(execution_binding,'{lockExpires}','0') WHERE id=$1",
        [s.runId],
      ),
    );
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
    expect(provider.starts).toBe(1);
  });
  it('drops native authentication entries before reading or persisting their chunks', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const originalPage = provider.snapshotPage.bind(provider);
    vi.spyOn(provider, 'snapshotPage').mockImplementation(async (binding, offset) => {
      const page = await originalPage(binding, offset);
      const credential = {
        ...page.entries[0],
        namespace: 'home' as const,
        path: '.claude/.credentials.json',
        sha256: 'a'.repeat(64),
        chunks: [{ hash: 'a'.repeat(64), size: 11 }],
      };
      return { ...page, entries: [...page.entries, credential], total: page.total + 1 };
    });
    const chunk = vi.spyOn(provider, 'chunk');
    for (let i = 0; i < 80; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const saved = await transaction(s.org, async (tx) => {
      const run = await getRun(tx, s.runId);
      return { run, session: await resources.get(tx, 'sessions', run.session_id) };
    });
    expect(saved.run.status).toBe('succeeded');
    expect(JSON.stringify(saved.session.state_files)).not.toContain('.credentials');
    expect(chunk).not.toHaveBeenCalledWith(expect.anything(), 'a'.repeat(64));
    expect(provider.starts).toBe(1);
  });
  it('fails a recovered gated subscription job without launching or losing its reservation', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await transaction(s.org, (tx) =>
      tx.query("UPDATE runs SET config=jsonb_set(config,'{billing_mode}','\"subscription\"') WHERE id=$1", [
        s.runId,
      ]),
    );
    await advanceCloudRun(s.org, s.runId, provider);
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      balance: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org])).rows[0],
    }));
    expect(saved.run).toMatchObject({
      status: 'failed',
      result: { failure_code: 'claude_subscription_unavailable' },
    });
    expect(saved.balance.reserved_micro_usd).toBe('0');
    expect(provider.starts).toBe(0);
    await advanceCloudRun(s.org, s.runId, provider);
    expect(provider.starts).toBe(0);
  });
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
  it('recovers a lost launch acknowledgement without repeating the native prompt; persists worktree, Git, and session state', async () => {
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
      ws: await resources.get(tx, 'worktrees', s.worktreeId),
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
  it('continues a session on a prepared Host by restoring only the namespaces that Host lacks', async () => {
    const s = await scenario();
    let done = false;
    for (let i = 0; i < 60 && !done; i++) done = (await advanceCloudRun(s.org, s.runId, new FaultMachine())).done;
    expect(done).toBe(true);
    const followUp = await transaction(s.org, async (tx) => {
      const first = await getRun(tx, s.runId);
      const next = await admitRun(tx, s.p, { session_id: first.session_id, prompt: 'Continue on a warm Host' });
      await reserve(tx, s.org, 2_000_000n);
      await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [next.run_id]);
      return next.run_id;
    });
    // The Host already holds a clean materialization of this Worktree; only native home state is missing.
    const host = new FaultMachine();
    host.prepared = { reused: false, restoreNamespaces: ['home'] };
    done = false;
    for (let i = 0; i < 60 && !done; i++) done = (await advanceCloudRun(s.org, followUp, host)).done;
    expect(done).toBe(true);
    const pages = await transaction(s.org, (tx) =>
      tx.query<{ data: { entries: { namespace: string; path: string }[] } }>(
        "SELECT data FROM execution_objects WHERE run_id=$1 AND kind='input_page'",
        [followUp],
      ),
    );
    const staged = pages.rows.flatMap((row) => row.data.entries).map((e) => `${e.namespace}/${e.path}`);
    expect(staged).toEqual(['home/.codex/state.json']);
    const restored = JSON.parse(host.stageFiles.get('/platform-control/restore/page-0.json')!.toString());
    expect(restored.map((e: { namespace: string }) => e.namespace)).toEqual(['home']);
    const run = await transaction(s.org, (tx) => getRun(tx, followUp));
    expect(run).toMatchObject({ status: 'succeeded', session_id: (await transaction(s.org, (tx) => getRun(tx, s.runId))).session_id });
    expect(run.result.persistence_status).toBe('verified');
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
      ws: await resources.get(tx, 'worktrees', s.worktreeId),
    }));
    expect(run.status).toBe('failed');
    expect(run.result.persistence_status).toBe('failed');
    expect(run.result.checkpoint_id).toBeUndefined();
    expect(ws.status).toBe('degraded');
    expect(provider.closes.every(Boolean)).toBe(true);
    expect(provider.starts).toBe(1);
  });
});
