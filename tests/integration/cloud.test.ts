import { afterAll, describe, expect, it } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool, transaction } from '../../packages/db';
import { id, sha256 } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace, writeFile, type FileRecord } from '../../packages/core/src/files';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { credit, reserve } from '../../packages/core/src/ledger';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import type { MachineProvider, MachineBinding, RuntimeProbe } from '../../packages/core/src/ports';
import type { SnapshotEntry } from '../../packages/runtime/src/manifest';
import { readContent } from '../../packages/providers/src/storage';

class FaultMachine implements MachineProvider {
  starts = 0;
  attempts = 0;
  closes: boolean[] = [];
  launched = false;
  lostLaunch = false;
  lostVM = false;
  outcome: 'success' | 'failure' = 'success';
  stageFiles = new Map<string, Buffer>();
  bytes = Buffer.from('Changed by the native fixture.');
  async provision(name: string): Promise<MachineBinding> {
    return { name, sessionId: 'original-vm', createdAt: new Date().toISOString() };
  }
  async prepare() {}
  async stage(_binding: MachineBinding, files: { path: string; content: Buffer }[]) {
    for (const f of files) this.stageFiles.set(f.path, f.content);
  }
  async restore() {
    return 'restore-command';
  }
  async restored() {
    return 'success' as const;
  }
  async launch() {
    this.attempts++;
    if (!this.launched) {
      this.launched = true;
      this.starts++;
      if (this.lostLaunch) throw new Error('Lost response after native dispatch');
    }
    return 'original-command';
  }
  async probe(_binding: MachineBinding, offset: number): Promise<RuntimeProbe> {
    if (this.lostVM) throw new Error('Original VM unavailable');
    return {
      events: offset
        ? []
        : [
            { sequence: 1, type: 'output.delta', data: { text: 'Completed.' } },
            { sequence: 2, type: 'tool.completed', data: { tool_call_id: 'fixture-tool', result: 'saved' } },
          ],
      nextOffset: offset || 100,
      status: { state: 'finished' },
      input: null,
      result: {
        output: 'Completed.',
        resumeId: 'native-session',
        outcome: this.outcome,
        persistence: 'captured',
        completedAt: new Date().toISOString(),
      },
    };
  }
  async answer() {}
  async cancel() {}
  async snapshotPage(_binding: MachineBinding, offset: number) {
    const hash = sha256(this.bytes);
    const entries: SnapshotEntry[] = [
      {
        namespace: 'workspace',
        path: 'durable.txt',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o644,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
      {
        namespace: 'workspace',
        path: '.git/HEAD',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o644,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
      {
        namespace: 'home',
        path: '.codex/state.json',
        type: 'file',
        size: this.bytes.length,
        sha256: hash,
        mode: 0o600,
        modifiedAt: new Date().toISOString(),
        chunks: [{ hash, size: this.bytes.length }],
      },
    ];
    return { entries: entries.slice(offset), total: entries.length, totalBytes: this.bytes.length * 3 };
  }
  async chunk() {
    return this.bytes;
  }
  async close(_binding: MachineBinding, preserve: boolean) {
    this.closes.push(preserve);
    return preserve ? { snapshotId: 'recovery-snapshot' } : {};
  }
}
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
describe('durable cloud lifecycle with fault injection', () => {
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
