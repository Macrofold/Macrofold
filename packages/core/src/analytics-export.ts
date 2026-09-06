import { pool, transaction } from '../../db';
import { isLocal } from './config';
import { sha256 } from './crypto';
import { PostHogSink, type AnalyticsSink, type AnalyticsEvent } from '../../providers/src/posthog';
import contract from '../../../docs/api/openapi.json';
const allowed = new Set([
  'user.registered',
  'organization.created',
  'run.completed',
  ...Object.values(contract.paths).flatMap((path) =>
    Object.values(path)
      .filter((v) => v && typeof v === 'object' && 'operationId' in v)
      .map((v) => String((v as { operationId: string }).operationId)),
  ),
]);
/** Native reporting is independent of analytics export. A daily *attempt* ceiling bounds
 * forwarding during outages; UUIDs stay stable across retries. No raw event.data is forwarded. */
export async function forwardProductEvents(
  sink?: AnalyticsSink,
  options: { since?: string; dailyLimit?: number; organization?: string } = {},
): Promise<Record<string, number>> {
  if (!sink && (isLocal() || process.env.POSTHOG_ENABLED !== 'true')) return { analytics_exported: 0 };
  const since = options.since || process.env.POSTHOG_START_AT;
  if (!since || !Number.isFinite(Date.parse(since)))
    throw new Error('Analytics requires an explicit valid POSTHOG_START_AT.');
  const limit = Math.max(
    0,
    Math.min(
      1000000,
      Math.floor(options.dailyLimit ?? Number(process.env.POSTHOG_DAILY_EVENT_LIMIT || 10000)),
    ),
  );
  if (!Number.isFinite(limit)) throw new Error('POSTHOG_DAILY_EVENT_LIMIT must be a finite number.');
  const rows = await transaction(null, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('analytics-budget',0))");
    const key = 'analytics:' + new Date().toISOString().slice(0, 10),
      budget = (await tx.query('SELECT data FROM platform_meta WHERE key=$1', [key])).rows[0]?.data;
    const count = Math.min(100, limit - Number(budget?.attempts || 0));
    if (count <= 0) return [];
    const claimed = (
      await tx.query(
        `WITH due AS (SELECT e.id FROM product_events e JOIN organizations o ON o.id=e.organization_id WHERE e.exported_at IS NULL AND e.export_attempts<8 AND e.export_due_at<=now() AND e.created_at>=$1 AND ($2::uuid IS NULL OR e.organization_id=$2) AND coalesce(o.settings->>'analytics_excluded','false')<>'true' ORDER BY e.created_at LIMIT $3 FOR UPDATE OF e SKIP LOCKED)
      UPDATE product_events e SET export_attempts=export_attempts+1,export_due_at=now()+interval '2 minutes' FROM due WHERE e.id=due.id RETURNING e.*`,
        [since, options.organization || null, count],
      )
    ).rows;
    await tx.query(
      'INSERT INTO platform_meta(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
      [key, JSON.stringify({ attempts: Number(budget?.attempts || 0) + claimed.length })],
    );
    return claimed;
  });
  const batch: AnalyticsEvent[] = rows
    .filter((row) => allowed.has(row.name))
    .map((row) => ({
      uuid: row.id,
      event: row.name,
      timestamp: row.created_at.toISOString(),
      properties: {
        distinct_id: sha256(
          'analytics:' +
            row.organization_id +
            ':' +
            (row.data.principal_type || 'human') +
            ':' +
            (row.data.principal_id || row.user_id || 'account'),
        ),
        organization_id: row.organization_id,
        principal_type: row.data.principal_type === 'service' ? 'service' : 'human',
        $process_person_profile: false,
        $insert_id: row.id,
        definition_version: '2',
      },
    }));
  if (!rows.length) return { analytics_exported: 0 };
  try {
    if (batch.length) await (sink || new PostHogSink()).send(batch);
    await pool.query('UPDATE product_events SET exported_at=now() WHERE id=ANY($1::uuid[])', [
      rows.map((r) => r.id),
    ]);
    return { analytics_exported: batch.length };
  } catch {
    await pool.query(
      "UPDATE product_events SET export_due_at=now()+(least(3600,30*power(2,export_attempts))::integer*interval '1 second') WHERE id=ANY($1::uuid[])",
      [rows.map((r) => r.id)],
    );
    return { analytics_exported: 0, analytics_retry: rows.length };
  }
}
