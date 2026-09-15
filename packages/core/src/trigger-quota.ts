import type { Tx } from '../../db';
import { assert } from './errors';

/** Definition capacity is independent of intake, waiting receipts and execution concurrency. */
export async function triggerQuota(tx: Pick<Tx, 'query'>, organizationId: string) {
  const { rows } = await tx.query<{ limit: number; used: number }>(
    `SELECT coalesce(o.trigger_definition_limit,p.definition_limit) AS "limit",
       (SELECT count(*)::integer FROM triggers WHERE deleted_at IS NULL) AS used
     FROM organizations o CROSS JOIN trigger_policy p WHERE o.id=$1`,
    [organizationId],
  );
  assert(rows[0], 503, 'trigger_policy_unavailable', 'Trigger capacity is unavailable. Retry shortly.');
  return { ...rows[0], remaining: Math.max(0, rows[0].limit - rows[0].used) };
}
