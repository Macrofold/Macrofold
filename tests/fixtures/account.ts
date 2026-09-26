import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { createKey } from '../../packages/core/src/keys';
export async function fixtureAccount(label: string) {
  const email = `${id()}@example.test`,
    password = 'local-fixture-password-2026';
  const user = (await auth.api.signUpEmail({ body: { email, password, name: label } })).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  const p: Principal = {
    id: user.id,
    userId: user.id,
    email,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    scopes: customerScopes,
    operator: false,
    workspaceIds: [],
  };
  const key = await transaction(org, (tx) => createKey(tx, p, { name: 'Fixture', scopes: customerScopes }));
  const signed = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { p, key: key.secret, cookie };
}

/** Fixtures that arrange synthetic active states without a worker must retire them.
 * Scheduling is global: a leftover active or claimable Run consumes capacity or the
 * fair turn for every later test file that shares this disposable database. */
export async function retireFixtureRuns(organizationId: string) {
  await transaction(organizationId, async (tx) => {
    await tx.query(
      "UPDATE runs SET status='cancelled',completed_at=now() WHERE organization_id=$1 AND status NOT IN ('succeeded','failed','cancelled','timed_out')",
      [organizationId],
    );
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE organization_id=$1 AND kind='run'", [
      organizationId,
    ]);
  });
}
