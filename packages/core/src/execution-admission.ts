import type { Tx } from '../../db';
import { capacitySetting, fleetLimits } from './capacity';
import { getExecutionPolicy } from './plans';

// Both queued and immediate admission read only current occupancy. Queue heads,
// native placement and terminal history are not inputs to this shared policy.
export const activeExecutionSQL = `SELECT organization_id,count(*)::integer AS n,
 count(*) FILTER(WHERE kind='native_agent')::integer AS native_n,
 count(*) FILTER(WHERE kind<>'native_agent')::integer AS lightweight_n
 FROM reporting.scheduling_runs
 WHERE status IN ('provisioning','running','waiting_for_input','persisting') GROUP BY organization_id`;

/** SQL aliases are owned by schedulingSQL; the direct query below supplies the
 * same facts. Keep account/class eligibility in one predicate. */
export const executionCapacityPredicateSQL = `account_active<account_limit
 AND (kind<>'native_agent' OR native_active<greatest(0,account_limit-lightweight_reserved))
 AND (kind<>'native_agent' OR (SELECT coalesce(sum(native_n),0) FROM active)<native_limit)
 AND (kind='native_agent' OR (SELECT coalesce(sum(lightweight_n),0) FROM active)<lightweight_limit)`;

export type CapacityReason = 'account_concurrency' | 'lightweight_capacity' | 'global_capacity';
export type CapacityDecision = { allowed: true } | { allowed: false; reason: CapacityReason };

/** Caller holds capacity:global through the status mutation. This is an
 * authoritative capacity check, never a queued turn or dispatch permission. */
export async function executionCapacity(
  tx: Tx,
  organizationId: string,
  kind: 'native_agent' | 'inference' | 'bounded_agent',
  currentPolicy?: Awaited<ReturnType<typeof getExecutionPolicy>>,
): Promise<CapacityDecision> {
  // Immediate admission already resolved this policy under its organization
  // guard; reuse it instead of another read while holding the global lock.
  const policy = currentPolicy ?? (await getExecutionPolicy(tx, organizationId));
  const fleet = fleetLimits();
  const reserved = Math.min(
    policy.concurrency_limit,
    capacitySetting('LIGHTWEIGHT_RESERVED_SLOTS_PER_ORG', 0, 100_000, 0),
  );
  const result = await tx.query<{ allowed: boolean; reason: CapacityReason }>(
    `WITH active AS (${activeExecutionSQL}), candidate AS (
      SELECT $2::text AS kind,$3::integer AS account_limit,$4::integer AS lightweight_reserved,
        $5::integer AS lightweight_limit,$6::integer AS native_limit,
        coalesce((SELECT n FROM active WHERE organization_id=$1),0) AS account_active,
        coalesce((SELECT native_n FROM active WHERE organization_id=$1),0) AS native_active
    ) SELECT (${executionCapacityPredicateSQL}) AND (SELECT coalesce(sum(n),0) FROM active)<$7 AS allowed,
      CASE WHEN account_active>=account_limit OR
        (kind='native_agent' AND native_active>=greatest(0,account_limit-lightweight_reserved)) THEN 'account_concurrency'
        WHEN kind<>'native_agent' AND (SELECT coalesce(sum(lightweight_n),0) FROM active)>=lightweight_limit THEN 'lightweight_capacity'
        ELSE 'global_capacity' END AS reason FROM candidate`,
    [organizationId, kind, policy.concurrency_limit, reserved, fleet.inference, fleet.native, fleet.total],
  );
  const row = result.rows[0];
  return row.allowed ? { allowed: true } : { allowed: false, reason: row.reason };
}
