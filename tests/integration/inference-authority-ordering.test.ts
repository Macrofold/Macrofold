import { afterAll, expect, it, vi } from 'vitest';
import { authPool, credentialPool, pool, transaction, lock } from '../../packages/db';
import { changeMember } from '../../packages/core/src/organizations';
import { actorAuthorized } from '../../packages/core/src/actor-authorization';
import { createKey } from '../../packages/core/src/keys';
import { id } from '../../packages/core/src/crypto';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';

const organizations: string[] = [];
afterAll(async () => {
  for (const organization of organizations) await retireFixtureRuns(organization);
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it('orders demotion after admission and cancels newly committed and persisting Runs together', async () => {
  const owner = await fixtureAccount('Authority ordering owner');
  const member = await fixtureAccount('Authority ordering member');
  const organizationId = owner.p.organizationId;
  organizations.push(organizationId);
  await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'member')", [
    organizationId,
    member.p.userId,
  ]);
  const principal = { ...member.p, organizationId, role: 'member' as const };
  const key = await transaction(organizationId, (tx) =>
    createKey(tx, principal, { name: 'Authority fixture', scopes: ['runs:write'] }),
  );
  const config = {
    executor_version: '1',
    definition: {},
    context: {},
    user_id: principal.userId!,
    principal_id: key.id,
    principal_kind: 'api_key' as const,
  };
  const oldRun = id(),
    newRun = id();
  await transaction(organizationId, (tx) =>
    tx.query(
      "INSERT INTO runs(id,organization_id,kind,status,config) VALUES($1,$2,'inference','persisting',$3)",
      [oldRun, organizationId, JSON.stringify(config)],
    ),
  );
  let admissionReady!: (pid: number) => void,
    rejectAdmission!: (error: unknown) => void,
    releaseAdmission!: () => void,
    removalReady!: (pid: number) => void,
    rejectRemoval!: (error: unknown) => void;
  const admitted = new Promise<number>((resolve, reject) => {
    admissionReady = resolve;
    rejectAdmission = reject;
  });
  const gate = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  const removing = new Promise<number>((resolve, reject) => {
    removalReady = resolve;
    rejectRemoval = reject;
  });
  const admission = transaction(organizationId, async (tx) => {
    await lock(tx, `organization:${organizationId}`);
    expect(await actorAuthorized(tx, { organization_id: organizationId, workspace_id: null, config })).toBe(
      true,
    );
    await tx.query(
      "INSERT INTO runs(id,organization_id,kind,status,config) VALUES($1,$2,'inference','running',$3)",
      [newRun, organizationId, JSON.stringify(config)],
    );
    admissionReady((await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await gate;
  });
  void admission.catch(rejectAdmission);
  const admissionPid = await admitted;
  const removal = transaction(organizationId, async (tx) => {
    removalReady((await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await changeMember(tx, owner.p, principal.userId!, 'viewer');
  });
  void removal.catch(rejectRemoval);
  try {
    const removalPid = await removing;
    await vi.waitFor(async () => {
      const locks = (
        await pool.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [removalPid])
      ).rows[0].blockers;
      expect(locks).toContain(admissionPid);
    });
  } finally {
    releaseAdmission();
    await Promise.allSettled([admission, removal]);
  }
  await admission;
  await removal;
  await transaction(organizationId, async (tx) => {
    const rows = (
      await tx.query<{ cancel_requested: boolean }>(
        'SELECT cancel_requested FROM runs WHERE id=ANY($1::uuid[])',
        [[oldRun, newRun]],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((run) => run.cancel_requested)).toBe(true);
    expect(await actorAuthorized(tx, { organization_id: organizationId, workspace_id: null, config })).toBe(
      false,
    );
  });
});
