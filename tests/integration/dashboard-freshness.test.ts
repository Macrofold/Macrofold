import { fork } from 'node:child_process';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { dashboardAccess, readDashboardSnapshot } from '../../packages/core/src/dashboard-freshness';
import { handleApi } from '../../packages/core/src/http';
import { executeRun } from '../../packages/core/src/engine';
import { emit, eventsAfter } from '../../packages/core/src/events';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { GET } from '../../apps/web/app/account/events/route';

let a: Awaited<ReturnType<typeof fixtureAccount>>, b: Awaited<ReturnType<typeof fixtureAccount>>;
let access: Awaited<ReturnType<typeof dashboardAccess>>;
const browser = (cookie: string, organization: string) =>
  new Request(`${config.origin}/account/events?organization_id=${organization}`, { headers: { cookie } });
async function post(path: string, data: unknown) {
  const response = await handleApi(
    new Request(config.origin + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${a.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id(),
      },
      body: JSON.stringify(data),
    }),
  );
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return response.json();
}
const snapshot = () => readDashboardSnapshot(a.p.organizationId, [access]);
beforeAll(async () => {
  a = await fixtureAccount('Freshness A');
  b = await fixtureAccount('Freshness B');
  access = await dashboardAccess(browser(a.cookie, a.p.organizationId));
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

describe('committed dashboard revisions', () => {
  it('signals API admission and simulated lifecycle without routing detailed output through the dashboard protocol', async () => {
    const project = await post('/v1/projects', { name: 'Stream fixture', persistence: 'persistent' });
    const before = await snapshot();
    const run = await post('/v1/runs', {
      project_id: project.id,
      harness: 'codex',
      model: 'fixture-model',
      prompt: 'Private prompt is never a signal',
      billing_mode: 'managed',
    });
    const admitted = await snapshot();
    expect(BigInt(admitted.revisions.runs)).toBeGreaterThan(BigInt(before.revisions.runs));
    await transaction(a.p.organizationId, async (tx) => {
      await emit(tx, a.p.organizationId, run.run_id, 'output.delta', { text: 'private streamed output' });
      await tx.query('UPDATE runs SET heartbeat_at=now() WHERE id=$1', [run.run_id]);
    });
    expect((await snapshot()).revisions).toEqual(admitted.revisions);
    expect(
      (await eventsAfter(a.p.organizationId, run.run_id, '0')).some(
        (e) => e.type === 'output.delta' && e.data,
      ),
    ).toBe(true);
    await executeRun(a.p.organizationId, run.run_id);
    const completed = await snapshot();
    expect(BigInt(completed.revisions.runs)).toBeGreaterThan(BigInt(admitted.revisions.runs));
    expect(BigInt(completed.revisions.workspace)).toBeGreaterThan(BigInt(admitted.revisions.workspace));
    expect((await eventsAfter(a.p.organizationId, run.run_id, '0')).at(-1)?.type).toBe('run.succeeded');
    expect(JSON.stringify(completed)).not.toMatch(/Private prompt|private streamed output/);
  });

  it('reads only committed data across processes and detects workspace, checkpoint and Git publication', async () => {
    const project = await post('/v1/projects', { name: 'Cross instance', persistence: 'persistent' });
    const workspace = project.default_workspace_id;
    const child = fork(new URL('../fixtures/dashboard-instance.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    const frames: { event?: string; data?: string }[] = [];
    child.on('message', (frame) => frames.push(frame as (typeof frames)[number]));
    let stderr = '';
    child.stderr?.on('data', (part) => {
      stderr += part;
    });
    try {
      await Promise.race([
        once(child, 'message'),
        exited.then(() => {
          throw new Error('Fixture exited: ' + stderr);
        }),
      ]);
      child.send({ cookie: a.cookie, organization: a.p.organizationId });
      await expect.poll(() => frames.some((f) => f.event === 'ready')).toBe(true);
      const before = await snapshot();
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query("SELECT set_config('app.organization_id',$1,true)", [a.p.organizationId]);
        await resources.update(writer, 'workspaces', workspace, { sync: { status: 'pending' } });
        // The other transaction still sees the last committed resource state.
        expect((await snapshot()).revisions).toEqual(before.revisions);
        await writer.query('ROLLBACK');
      } finally {
        writer.release();
      }
      expect((await snapshot()).revisions).toEqual(before.revisions);
      await transaction(a.p.organizationId, (tx) =>
        resources.update(tx, 'workspaces', workspace, {
          sync: { status: 'conflict', error: 'private diagnostic' },
        }),
      );
      await expect
        .poll(() => frames.filter((f) => f.event === 'change').map((f) => JSON.parse(f.data!)))
        .toEqual(
          expect.arrayContaining([
            { category: 'workspace', organization_id: a.p.organizationId },
            { category: 'git', organization_id: a.p.organizationId },
          ]),
        );
      expect(JSON.stringify(frames)).not.toMatch(/private diagnostic|conflict|revision|cursor/);
      const changed = await snapshot();
      await transaction(a.p.organizationId, (tx) =>
        resources.create(tx, 'checkpoints', a.p.organizationId, {
          workspace_id: workspace,
          project_id: project.id,
          label: 'Published checkpoint',
        }),
      );
      expect(BigInt((await snapshot()).revisions.workspace)).toBeGreaterThan(
        BigInt(changed.revisions.workspace),
      );
      expect(stderr).toBe('');
    } finally {
      if (child.connected) child.send('stop');
      const timeout = setTimeout(() => child.kill('SIGTERM'), 2000);
      await exited;
      clearTimeout(timeout);
    }
  });

  it('enforces tenant isolation and rejects unauthenticated, bearer and mismatched organization streams', async () => {
    const foreign = await dashboardAccess(browser(b.cookie, b.p.organizationId));
    const foreignSnapshot = await readDashboardSnapshot(b.p.organizationId, [foreign]);
    expect(foreignSnapshot.revisions).toEqual({ runs: '0', workspace: '0', git: '0' });
    expect(foreignSnapshot.authorizedSessions).toEqual(new Set([foreign.sessionId + ':owner']));
    await expect(readDashboardSnapshot(b.p.organizationId, [access])).rejects.toMatchObject({ status: 400 });
    expect((await GET(browser('', a.p.organizationId))).status).toBe(401);
    expect(
      (
        await GET(
          new Request(`${config.origin}/account/events?organization_id=${a.p.organizationId}`, {
            headers: { authorization: `Bearer ${a.key}` },
          }),
        )
      ).status,
    ).toBe(401);
    expect((await GET(browser(a.cookie, b.p.organizationId))).status).toBe(409);
    const cross = browser(a.cookie, a.p.organizationId);
    cross.headers.set('Origin', 'https://untrusted.test');
    expect((await GET(cross)).status).toBe(403);
  });

  it.each(['role', 'membership', 'session', 'expiry', 'verification'] as const)(
    'revokes established access on %s changes with real identity rows',
    async (change) => {
      const account = await fixtureAccount('Revocation ' + change);
      const binding = await dashboardAccess(browser(account.cookie, account.p.organizationId));
      const read = (bindings = [binding]) => readDashboardSnapshot(account.p.organizationId, bindings);
      expect((await read()).authorizedSessions.size).toBe(1);
      if (change === 'role')
        await pool.query("UPDATE memberships SET role='viewer' WHERE user_id=$1", [account.p.userId]);
      if (change === 'membership')
        await pool.query('DELETE FROM memberships WHERE user_id=$1', [account.p.userId]);
      if (change === 'session') await pool.query('DELETE FROM auth.session WHERE id=$1', [binding.sessionId]);
      if (change === 'expiry')
        await pool.query('UPDATE auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1', [
          binding.sessionId,
        ]);
      if (change === 'verification')
        await pool.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1', [account.p.userId]);
      expect((await read()).authorizedSessions.size).toBe(0);
      if (change === 'role') {
        const current = await dashboardAccess(browser(account.cookie, account.p.organizationId));
        expect(current.role).toBe('viewer');
        // A replacement stream must not re-authorize an old binding to the same session.
        expect((await read([binding, current])).authorizedSessions).toEqual(
          new Set([binding.sessionId + ':viewer']),
        );
      }
    },
  );
});
