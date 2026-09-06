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
    projectIds: [],
  };
  const key = await transaction(org, (tx) => createKey(tx, p, { name: 'Fixture', scopes: customerScopes }));
  const signed = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { p, key: key.secret, cookie };
}
