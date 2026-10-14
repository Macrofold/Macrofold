import pg from 'pg';

// Server defaults are installed per runtime role/database by migrate.ts, so
// transaction poolers need no unsupported startup parameters. The client allows
// the server five seconds to return its timeout instead of losing the outcome.
export const statementTimeoutMs = 60_000;
export const idleTransactionTimeoutMs = 120_000;
export const queryTimeoutMs = statementTimeoutMs + 5_000;

/** Apply only to the named runtime login/database, never the migration role. */
export async function configureDatabaseTimeouts(
  client: Pick<pg.Client, 'query'>,
  role: string,
  database: string,
) {
  const target = `ALTER ROLE ${pg.escapeIdentifier(role)} IN DATABASE ${pg.escapeIdentifier(database)}`;
  await client.query(`${target} SET statement_timeout='${statementTimeoutMs}'`);
  await client.query(`${target} SET idle_in_transaction_session_timeout='${idleTransactionTimeoutMs}'`);
}
