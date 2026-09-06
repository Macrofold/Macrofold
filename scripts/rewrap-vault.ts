import { pool, authPool, transaction } from '../packages/db';
import { storage } from '../packages/providers/src/storage';
import { seal, unseal } from '../packages/core/src/crypto';
import { tables } from '../packages/core/src/resources';

// An operator-only maintenance command. It never prints plaintext, keys or encrypted values.
const write = process.argv.includes('--write');
if (write && (!process.argv.includes('--confirm-paused') || !process.env.VAULT_ACTIVE_KEY_ID))
  throw new Error(
    'Writes require VAULT_ACTIVE_KEY_ID and --confirm-paused after pausing API/worker writers. See the launch guide.',
  );
if (!storage.list) throw new Error('Object inventory is not supported by this storage adapter');
let inspected = 0,
  rewrapped = 0;
const current = process.env.VAULT_ACTIVE_KEY_ID ? `v2.${process.env.VAULT_ACTIVE_KEY_ID}.` : 'v1.';
function replace(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === 'string' && /^(v1\.|v2\.)/.test(value)) {
    const decoded = unseal(value);
    inspected++;
    if (!value.startsWith(current)) {
      rewrapped++;
      return { value: write ? seal(decoded) : value, changed: true };
    }
  }
  return { value, changed: false };
}
function document(value: Record<string, unknown>) {
  let changed = false;
  for (const key of Object.keys(value))
    if (key.endsWith('_ciphertext')) {
      const next = replace(value[key]);
      if (next.changed) {
        value[key] = next.value;
        changed = true;
      }
    }
  return { value, changed };
}
try {
  for (const { id: org } of (await pool.query('SELECT id FROM organizations ORDER BY id')).rows) {
    for (const table of [...tables, 'oauth_attempts']) {
      let cursor = '00000000-0000-0000-0000-000000000000';
      while (true) {
        const next = await transaction(org, async (tx) => {
          const batch = (
            await tx.query(`SELECT id,data FROM ${table} WHERE id>$1 ORDER BY id LIMIT 100 FOR UPDATE`, [
              cursor,
            ])
          ).rows;
          for (const row of batch) {
            const result = document(row.data);
            if (write && result.changed)
              await tx.query(`UPDATE ${table} SET data=$2 WHERE id=$1`, [
                row.id,
                JSON.stringify(result.value),
              ]);
          }
          return batch.at(-1)?.id;
        });
        if (!next) break;
        cursor = next;
      }
    }
    for (const [table, column] of [
      ['idempotency', 'response_ciphertext'],
      ['github_user_links', 'token_ciphertext'],
      ['tool_invocations', 'result_ciphertext'],
    ] as const) {
      // A ctid is used only while its row lock remains held, never as a durable identifier.
      await transaction(org, async (tx) => {
        const rows = (
          await tx.query(
            `SELECT ctid::text AS locator,${column} AS value FROM ${table} WHERE ${column} IS NOT NULL FOR UPDATE`,
          )
        ).rows;
        for (const row of rows) {
          const result = replace(row.value);
          if (write && result.changed)
            await tx.query(`UPDATE ${table} SET ${column}=$2 WHERE ctid=$1::tid`, [
              row.locator,
              result.value,
            ]);
        }
      });
    }
    let cursor: string | undefined;
    do {
      const batch = await storage.list(org + '/', cursor, 100);
      for (const object of batch.objects) {
        const value = (await storage.get(object.key)).toString();
        const result = replace(value);
        if (write && result.changed) await storage.put(object.key, Buffer.from(String(result.value)));
      }
      cursor = batch.next_cursor;
    } while (cursor);
  }
  await transaction(null, async (tx) => {
    const rows = (
      await tx.query(
        'SELECT id,"clientSecret" FROM auth."oauthClient" WHERE "clientSecret" IS NOT NULL FOR UPDATE',
      )
    ).rows;
    for (const row of rows) {
      const result = replace(row.clientSecret);
      if (write && result.changed)
        await tx.query('UPDATE auth."oauthClient" SET "clientSecret"=$2 WHERE id=$1', [row.id, result.value]);
    }
  });
  console.log(
    JSON.stringify({
      mode: write ? 'rewrapped' : 'dry-run',
      encrypted_values_inspected: inspected,
      values_requiring_rewrap: rewrapped,
      plaintext_logged: false,
    }),
  );
} finally {
  await pool.end();
  await authPool.end();
}
