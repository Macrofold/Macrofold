import pg from 'pg';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { config, isLocal } from '../packages/core/src/config';

const { values } = parseArgs({
  options: {
    organization: { type: 'string' },
    limit: { type: 'string' },
    reset: { type: 'boolean' },
  },
});
if (!isLocal() && !process.env.MIGRATION_DATABASE_URL)
  throw new Error('Set MIGRATION_DATABASE_URL for the intended deployment.');
if (values.reset && (!values.organization || values.limit !== undefined))
  throw new Error('Use --organization ID --reset to restore the deployment default.');
const organization = values.organization ? z.uuid().parse(values.organization) : undefined;
const limit =
  values.limit === undefined ? undefined : z.coerce.number().int().min(0).max(1000000).parse(values.limit);
const db = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await db.connect();
try {
  await db.query('BEGIN');
  if (organization) {
    // Same lock as definition creation; lowering never edits an existing trigger.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`triggers:${organization}`]);
    if (limit !== undefined || values.reset) {
      const result = await db.query('UPDATE organizations SET trigger_definition_limit=$2 WHERE id=$1', [
        organization,
        limit ?? null,
      ]);
      if (!result.rowCount) throw new Error('Organization not found.');
    }
    const result = await db.query(
      'SELECT coalesce(o.trigger_definition_limit,p.definition_limit) AS effective_limit,o.trigger_definition_limit AS account_override FROM organizations o CROSS JOIN trigger_policy p WHERE o.id=$1',
      [organization],
    );
    if (!result.rowCount) throw new Error('Organization not found.');
    console.log(JSON.stringify(result.rows[0]));
  } else {
    if (limit !== undefined) await db.query('UPDATE trigger_policy SET definition_limit=$1', [limit]);
    console.log(JSON.stringify((await db.query('SELECT definition_limit FROM trigger_policy')).rows[0]));
  }
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
