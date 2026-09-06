import { pool, transaction } from '../../db';
import { growthMetrics } from './growth';
import { report, usageReport } from './reports';
/** Store one closed UTC day's report. A try-lock avoids duplicate expensive aggregate work;
 * a failed write rolls back and is retried by the next maintenance sweep. No provider calls. */
export async function snapshotReports(at = new Date()) {
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const from = new Date(to.getTime() - 86400000),
    day = from.toISOString().slice(0, 10);
  if ((await pool.query('SELECT 1 FROM report_snapshots WHERE day=$1', [day])).rowCount)
    return { reports_created: 0 };
  return transaction(null, async (tx) => {
    if (
      !(await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended('daily-reports',0)) AS acquired"))
        .rows[0].acquired
    )
      return { reports_created: 0 };
    if ((await tx.query('SELECT 1 FROM report_snapshots WHERE day=$1', [day])).rowCount)
      return { reports_created: 0 };
    await tx.query("SET LOCAL statement_timeout='30s'");
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const usage = await usageReport(tx, query, true);
    const growth = await growthMetrics(tx, from.toISOString(), to.toISOString());
    const saved = report(query, [...growth, ...usage.metrics], usage.missing_sources, {
      observation: 'Closed UTC day, recorded once. Late-arriving data remains available in live reports.',
      activation: 'First succeeded non-simulator run.',
      growth_exclusions: 'Accounts marked analytics_excluded. Usage totals include all recorded traffic.',
    });
    await tx.query('INSERT INTO report_snapshots(day,report) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      day,
      JSON.stringify(saved),
    ]);
    await tx.query("DELETE FROM report_snapshots WHERE day<$1::date-interval '2 years'", [day]);
    return { reports_created: 1 };
  });
}
