import { afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { pool, authPool } from '../../packages/db';
import { fixtureOperator } from '../fixtures/operator';

// Real PostgreSQL RLS; only Supabase's auth.uid() helper and role names are fixture substitutes.
// This does not claim to validate Supabase Auth's JWT issuer or a hosted workspace.
it('the Supabase SQL recipe restricts reads to the authenticated subject and denies writes', async () => {
  const runtimeRole = String((await pool.query('SELECT current_user')).rows[0].current_user);
  if (!/^[a-zA-Z0-9_]+$/.test(runtimeRole)) throw new Error('Unexpected fixture role');
  const alice = 'a20e277f-2c2b-46ea-8478-a32fc2b550d2',
    bob = 'e21f277f-2c2b-46ea-8478-a32fc2b550d3';
  const sql = (await readFile('examples/integrations/supabase.sql', 'utf8'))
    .replaceAll(/\bauthenticated\b/g, `"${runtimeRole}"`)
    .replaceAll(/\banon\b/g, `"${runtimeRole}"`);
  await fixtureOperator(async (db) => {
    await db.query(
      "CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.jwt.sub',true),'')::uuid $$;",
    );
    await db.query(sql);
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [alice, bob]);
    await db.query(
      "INSERT INTO customer_notes(customer_id,title,body) VALUES($1,'Alice','private-a'),($2,'Bob','private-b')",
      [alice, bob],
    );
  });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('fixture.jwt.sub',$1,true)", [alice]);
    expect((await db.query('SELECT title,body FROM customer_notes')).rows).toEqual([
      { title: 'Alice', body: 'private-a' },
    ]);
    await db.query("SELECT set_config('fixture.jwt.sub',$1,true)", [bob]);
    expect((await db.query('SELECT title FROM customer_notes')).rows).toEqual([{ title: 'Bob' }]);
    await db.query("SELECT set_config('fixture.jwt.sub','',true)");
    expect((await db.query('SELECT title FROM customer_notes')).rows).toEqual([]);
    await expect(
      db.query("INSERT INTO customer_notes(customer_id,title,body) VALUES($1,'bad','bad')", [bob]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
