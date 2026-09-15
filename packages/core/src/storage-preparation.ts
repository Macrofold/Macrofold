import { transaction, type Tx } from '../../db';
import { id } from './crypto';
import { assert } from './errors';

/** A bounded GC guard, not a worktree writer lock. Concurrent work may proceed;
 * publication must still reauthorize and compare the source revision. */
export async function storagePreparation<T>(org: string, read: (tx: Tx) => Promise<T>) {
  const lease = id();
  const value = await transaction(org, async (tx) => {
    const value = await read(tx);
    await tx.query("INSERT INTO storage_preparations VALUES($1,$2,now()+interval '5 minutes')", [lease, org]);
    return value;
  });
  return {
    value,
    async assertActive(tx: Tx) {
      const active = await tx.query('SELECT 1 FROM storage_preparations WHERE id=$1 AND expires_at>now()', [
        lease,
      ]);
      assert(active.rowCount, 409, 'preparation_expired', 'File preparation expired. Reload and retry.');
    },
    async dispose() {
      await transaction(org, (tx) => tx.query('DELETE FROM storage_preparations WHERE id=$1', [lease]));
    },
  };
}
