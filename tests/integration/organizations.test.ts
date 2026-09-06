import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { changeMember, inviteMember } from '../../packages/core/src/organizations';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('serializes owner changes and denies invitation escalation and cross-tenant access', async () => {
  const a = await fixtureAccount('First owner'),
    b = await fixtureAccount('Second owner');
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [a.p.organizationId, b.p.userId]);
  const bOrg = { ...b.p, organizationId: a.p.organizationId };
  const changes = await Promise.allSettled([
    transaction(a.p.organizationId, (tx) => changeMember(tx, a.p, a.p.userId!, 'member')),
    transaction(a.p.organizationId, (tx) => changeMember(tx, bOrg, b.p.userId!, 'member')),
  ]);
  expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(changes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(
    (
      await pool.query("SELECT count(*) FROM memberships WHERE organization_id=$1 AND role='owner'", [
        a.p.organizationId,
      ])
    ).rows[0].count,
  ).toBe('1');
  const owner = (
    await pool.query("SELECT user_id FROM memberships WHERE organization_id=$1 AND role='owner'", [
      a.p.organizationId,
    ])
  ).rows[0].user_id;
  const p = owner === a.p.userId ? a.p : bOrg;
  const invite = await transaction(a.p.organizationId, (tx) =>
    inviteMember(tx, p, 'bound@example.test', 'member'),
  );
  expect(invite.invite_url).toContain('/join?token=');
  expect(
    (
      await transaction(b.p.organizationId, (tx) =>
        tx.query('SELECT id FROM organization_invitations WHERE id=$1', [invite.id]),
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    transaction(a.p.organizationId, (tx) =>
      inviteMember(tx, { ...p, role: 'admin' }, 'admin@example.test', 'admin'),
    ),
  ).rejects.toMatchObject({ code: 'owner_required' });
});
