import { planFor } from './plans';
import { pool, transaction, type Tx } from '../../db';
import { storage, type ObjectStore } from '../../providers/src/storage';
import { unseal, id } from './crypto';
import { assert } from './errors';
import { debit, expireCredits } from './ledger';
import { purgeProjects, expireDetailedHistory } from './deletion';

const DAY = 86400000,
  GRACE = 14 * DAY;
export function storageAllowance(plan: string) {
  return BigInt(planFor(plan).storage_gib) * 1024n ** 3n;
}
export async function storageReport(tx: Tx, org: string) {
  const account = (await tx.query('SELECT plan,settings FROM organizations WHERE id=$1', [org])).rows[0];
  const observed = (await tx.query('SELECT * FROM storage_state WHERE organization_id=$1', [org])).rows[0];
  return {
    physical_bytes: observed?.physical_bytes || '0',
    object_count: observed?.object_count || '0',
    allowance_bytes: String(storageAllowance(account.plan)),
    observed_at: observed?.observed_at?.toISOString() || null,
    overage_enabled: !!account.settings.storage_overage_enabled,
    monthly_budget_micro_usd: account.settings.storage_monthly_budget_micro_usd || '0',
    over_quota: !!account.settings.storage_over_quota,
    retention: { all_hours: 24, daily_days: 30, weekly_weeks: 12, unreferenced_grace_days: 14 },
    rate_micro_usd_per_gib_month: '100000',
  };
}
export async function requireStorageCapacity(tx: Tx, org: string) {
  const value = (await tx.query('SELECT settings FROM organizations WHERE id=$1', [org])).rows[0];
  assert(
    !value.settings.storage_over_quota,
    409,
    'storage_quota_exceeded',
    'Storage is over the included allowance or your overage budget. Remove old data or enable a larger storage budget in Billing. Existing files and recovery remain available.',
  );
}
/** Retention never removes a current/base checkpoint, a pin, or a run checkpoint within its
 * detailed-history window. Soft-expired checkpoint metadata remains an auditable tombstone. */
async function pruneHistory(tx: Tx, plan: string, at: Date) {
  const historyDays = planFor(plan).history_days;
  await tx.query(
    `WITH ranked AS (
    SELECT id,created_at,data,row_number() OVER(PARTITION BY data->>'workspace_id',date_trunc('day',created_at AT TIME ZONE 'UTC') ORDER BY created_at DESC,id DESC) AS daily,
    row_number() OVER(PARTITION BY data->>'workspace_id',date_trunc('week',created_at AT TIME ZONE 'UTC') ORDER BY created_at DESC,id DESC) AS weekly
    FROM checkpoints WHERE coalesce(data->>'deleted','false')<>'true'
  ) UPDATE checkpoints c SET data=c.data||jsonb_build_object('deleted',true,'retention_expired_at',$1::timestamptz,'files','[]'::jsonb,'git_files','[]'::jsonb),revision=c.revision+1,updated_at=$1
    FROM ranked r WHERE c.id=r.id AND r.created_at<$1::timestamptz-interval '24 hours'
    AND coalesce(r.data->>'pinned','false')<>'true'
    AND NOT (r.created_at>=$1::timestamptz-interval '30 days' AND r.daily=1)
    AND NOT (r.created_at>=$1::timestamptz-interval '84 days' AND r.weekly=1)
    AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.data->>'latest_checkpoint_id'=c.id::text OR w.data->>'base_checkpoint_id'=c.id::text)
    AND NOT EXISTS(SELECT 1 FROM runs x WHERE x.completed_at>=$2 AND (x.result->>'checkpoint_id'=c.id::text OR x.result->>'last_verified_checkpoint_id'=c.id::text))`,
    [at, new Date(at.getTime() - historyDays * DAY)],
  );
  await tx.query(
    `DELETE FROM execution_objects e USING runs r WHERE e.run_id=r.id AND r.completed_at<$1 AND r.status IN ('succeeded','failed','cancelled','timed_out') AND coalesce(r.execution_binding->>'phase','done')='done'`,
    [new Date(at.getTime() - GRACE)],
  );
}
async function roots(tx: Tx, org: string) {
  const values = (
    await tx.query(
      `WITH documents AS (
    SELECT data FROM workspaces WHERE coalesce(data->>'deleted','false')<>'true'
    UNION ALL SELECT data FROM checkpoints WHERE coalesce(data->>'deleted','false')<>'true'
    UNION ALL SELECT s.data FROM sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE coalesce(w.data->>'deleted','false')<>'true' AND coalesce(s.data->>'deleted','false')<>'true'
    UNION ALL SELECT data FROM artifacts WHERE coalesce(data->>'deleted','false')<>'true'
    UNION ALL SELECT data FROM transfers WHERE (data->>'expires_at')::timestamptz>now()
    UNION ALL SELECT data FROM execution_objects
  ) SELECT DISTINCT value #>> '{}' AS key FROM documents, jsonb_path_query(data,'$.**.key') value
    UNION SELECT $1||'/content/'||name FROM execution_objects WHERE kind IN ('input_chunk','output_chunk')`,
      [org],
    )
  ).rows;
  const keys = new Set<string>();
  for (const row of values)
    if (typeof row.key === 'string' && row.key.startsWith(org + '/')) keys.add(row.key);
  return keys;
}
async function meter(tx: Tx, org: string, bytes: bigint, objects: bigint, at: Date) {
  await expireCredits(tx, org, at);
  const row = (
    await tx.query(
      'SELECT plan,settings,balance_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1 FOR NO KEY UPDATE',
      [org],
    )
  ).rows[0];
  const state = (await tx.query('SELECT * FROM storage_state WHERE organization_id=$1 FOR UPDATE', [org]))
    .rows[0];
  const excess = bytes > storageAllowance(row.plan) ? bytes - storageAllowance(row.plan) : 0n;
  const enabled = row.settings.storage_overage_enabled === true;
  const budget = BigInt(row.settings.storage_monthly_budget_micro_usd || '0');
  // A fixed 30-day GiB-month is disclosed. Integer remainder avoids losing sub-micro-USD
  // fractions. Use the last complete observation over elapsed time; incomplete scans never bill.
  const prior = BigInt(state.physical_bytes),
    allowance = storageAllowance(row.plan);
  const priorExcess = prior > allowance ? prior - allowance : 0n;
  // Beyond two hours without a complete observation, the platform absorbs the unobserved
  // interval instead of billing a guess after an outage.
  const duration = BigInt(Math.max(0, Math.min(2 * 3600000, at.getTime() - state.billing_at.getTime())));
  const divisor = 1024n ** 3n * 30n * 86400000n;
  const numerator = enabled ? priorExcess * duration * 100000n + BigInt(state.billing_remainder) : 0n;
  let charge = numerator / divisor;
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const spent = BigInt(
    (
      await tx.query(
        'SELECT coalesce(sum(charged_micro_usd),0)::text AS value FROM storage_usage WHERE observed_at>=$1',
        [month],
      )
    ).rows[0].value,
  );
  const remaining = budget > spent ? budget - spent : 0n;
  const available = BigInt(row.balance_micro_usd) - BigInt(row.reserved_micro_usd);
  const limit = available < remaining ? (available > 0n ? available : 0n) : remaining;
  const capped = charge > limit;
  if (capped) charge = limit;
  if (charge) await debit(tx, org, charge, `storage:${at.toISOString()}`, 'storage_consumption');
  const over =
    excess > 0n && (!enabled || !budget || spent + charge >= budget || available <= charge || capped);
  await tx.query(
    'INSERT INTO storage_usage(id,organization_id,observed_at,physical_bytes,object_count,charged_micro_usd) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [id(), org, at, String(bytes), String(objects), String(charge)],
  );
  await tx.query(
    'UPDATE storage_state SET physical_bytes=$2,object_count=$3,observed_at=$4,billing_at=$4,billing_remainder=$5 WHERE organization_id=$1',
    [org, String(bytes), String(objects), at, String(capped ? 0n : numerator % divisor)],
  );
  await tx.query(
    "UPDATE organizations SET settings=settings||jsonb_build_object('storage_over_quota',$2::boolean) WHERE id=$1",
    [org, over],
  );
}
export async function maintainStorage(org: string, store: ObjectStore = storage, at = new Date()) {
  assert(store.list, 503, 'inventory_unavailable', 'The configured object store cannot list inventory.');
  return transaction(
    org,
    async (tx) => {
      const account = (await tx.query('SELECT plan FROM organizations WHERE id=$1', [org])).rows[0];
      await tx.query(
        'INSERT INTO storage_state(organization_id,scan_started_at,billing_at) VALUES($1,$2,$2) ON CONFLICT DO NOTHING',
        [org, at],
      );
      const state = (await tx.query('SELECT * FROM storage_state WHERE organization_id=$1 FOR UPDATE', [org]))
        .rows[0];
      const page = await store.list!(org + '/', state.cursor || undefined, 1000);
      for (const object of page.objects) {
        assert(
          object.key.startsWith(org + '/'),
          500,
          'inventory_prefix',
          'Storage inventory returned an unexpected key.',
        );
      }
      await tx.query(
        `INSERT INTO storage_objects(organization_id,key,size_bytes,modified_at,seen_at,children)
      SELECT $1,key,size_bytes,modified_at,$3,children FROM jsonb_to_recordset($2) AS object(key text,size_bytes bigint,modified_at timestamptz,children jsonb)
      ON CONFLICT(organization_id,key) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,seen_at=excluded.seen_at`,
        [
          org,
          JSON.stringify(
            page.objects.map((o) => ({
              key: o.key,
              size_bytes: o.size,
              modified_at: o.modified_at,
              children: o.key.startsWith(org + '/manifest/') ? null : [],
            })),
          ),
          at,
        ],
      );
      await tx.query('UPDATE storage_state SET cursor=$2 WHERE organization_id=$1', [
        org,
        page.next_cursor || null,
      ]);
      if (page.next_cursor) return { scan: 'in_progress', deleted: 0 };
      await tx.query('DELETE FROM storage_objects WHERE seen_at<$1', [state.scan_started_at]);
      await tx.query('UPDATE storage_state SET scanned_at=$2,scan_started_at=$2 WHERE organization_id=$1', [
        org,
        at,
      ]);
      const active = (
        await tx.query(
          "SELECT 1 FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting') LIMIT 1",
        )
      ).rowCount;
      let deleted = 0,
        graphPending = false;
      if (!active) {
        await purgeProjects(tx, at);
        await expireDetailedHistory(tx, account.plan, at);
        await pruneHistory(tx, account.plan, at);
        const reachable = await roots(tx, org);
        const unknown = (
          await tx.query(
            'SELECT key FROM storage_objects WHERE key=ANY($1::text[]) AND children IS NULL LIMIT 51',
            [[...reachable]],
          )
        ).rows;
        for (const item of unknown.slice(0, 50)) {
          const manifest = unseal<{ version: number; chunks: { key: string }[] }>(
            (await store.get(item.key)).toString(),
          );
          assert(
            manifest.version === 2 &&
              Array.isArray(manifest.chunks) &&
              manifest.chunks.every((c) => c.key.startsWith(org + '/content/')),
            500,
            'invalid_manifest',
            'Invalid stored chunk manifest.',
          );
          await tx.query('UPDATE storage_objects SET children=$2 WHERE key=$1', [
            item.key,
            JSON.stringify(manifest.chunks.map((c) => c.key)),
          ]);
        }
        const childRows = (
          await tx.query(
            'SELECT jsonb_array_elements_text(children) AS key FROM storage_objects WHERE key=ANY($1::text[])',
            [[...reachable]],
          )
        ).rows;
        for (const row of childRows) reachable.add(row.key);
        const missing = (
          await tx.query(
            'SELECT key FROM unnest($1::text[]) AS key WHERE NOT EXISTS(SELECT 1 FROM storage_objects s WHERE s.key=key.key) LIMIT 1',
            [[...reachable]],
          )
        ).rowCount;
        graphPending = !!missing || unknown.length > 50;
        if (!missing && unknown.length <= 50) {
          await tx.query('UPDATE storage_objects SET unreferenced_since=NULL WHERE key=ANY($1::text[])', [
            [...reachable],
          ]);
          await tx.query(
            'UPDATE storage_objects SET unreferenced_since=$1 WHERE NOT(key=ANY($2::text[])) AND unreferenced_since IS NULL',
            [at, [...reachable]],
          );
          const expired = (
            await tx.query(
              'SELECT key FROM storage_objects WHERE unreferenced_since<$1 AND modified_at<$1 ORDER BY unreferenced_since LIMIT 100',
              [new Date(at.getTime() - GRACE)],
            )
          ).rows;
          for (const item of expired) {
            await store.delete(item.key);
            await tx.query('DELETE FROM storage_objects WHERE key=$1', [item.key]);
            deleted++;
          }
        }
      }
      const totals = (
        await tx.query(
          'SELECT coalesce(sum(size_bytes),0)::text AS bytes,count(*)::text AS count FROM storage_objects',
        )
      ).rows[0];
      await meter(tx, org, BigInt(totals.bytes), BigInt(totals.count), at);
      await tx.query(
        'UPDATE storage_state SET gc_deleted_objects=gc_deleted_objects+$2,checked_at=$3,health_code=$4 WHERE organization_id=$1',
        [org, deleted, at, graphPending ? 'reference_graph_incomplete' : null],
      );
      return {
        scan: 'complete',
        deleted,
        active: !!active,
        graph_pending: graphPending,
        physical_bytes: totals.bytes,
      };
    },
    { exclusiveStorage: true },
  );
}
export async function dispatchStorageMaintenance() {
  const jobs =
    await pool.query(`WITH candidate AS (SELECT id FROM organizations WHERE storage_due_at<=now() ORDER BY storage_due_at LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED)
    UPDATE organizations o SET storage_due_at=now()+interval '1 hour' FROM candidate c WHERE o.id=c.id RETURNING o.id`);
  for (const row of jobs.rows) {
    try {
      const result = await maintainStorage(row.id);
      if (result.scan === 'in_progress' || result.graph_pending)
        await pool.query("UPDATE organizations SET storage_due_at=now()+interval '1 minute' WHERE id=$1", [
          row.id,
        ]);
    } catch {
      await transaction(row.id, (tx) =>
        tx.query(
          "INSERT INTO storage_state(organization_id,checked_at,health_code) VALUES($1,now(),'storage_maintenance_failed') ON CONFLICT(organization_id) DO UPDATE SET checked_at=now(),health_code='storage_maintenance_failed'",
          [row.id],
        ),
      ).catch(() => {});
      await pool.query("UPDATE organizations SET storage_due_at=now()+interval '5 minutes' WHERE id=$1", [
        row.id,
      ]);
    }
  }
  return { storage_accounts_checked: jobs.rowCount || 0 };
}
