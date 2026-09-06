'use client';
import { Download, ArrowUpRight } from 'lucide-react';
import { usePages, type Schema } from '../lib/client';
import { More, SectionHeading, Button, ErrorState } from './ui';
export function GrowthDetails({ report }: { report?: Schema['Report'] }) {
  const snapshots = usePages<Schema['ReportSnapshot']>('/admin/v1/reports/snapshots');
  if (!report) return null;
  const values = new Map(
    report.metrics.filter((m) => !m.dimensions).map((m) => [m.name, Number(m.value || 0)]),
  );
  const daily = report.metrics.filter((m) => m.name === 'accounts_new' && m.dimensions?.day);
  const peak = Math.max(1, ...daily.map((m) => Number(m.value)));
  const weeks = [
    ...new Set(report.metrics.flatMap((m) => (m.dimensions?.cohort_week ? [m.dimensions.cohort_week] : []))),
  ];
  const cohort = (week: string, name: string) =>
    Number(
      report.metrics.find((m) => m.name === 'cohort_' + name && m.dimensions?.cohort_week === week)?.value ||
        0,
    );
  const rate = (n: number, d: number) =>
    d ? `${Math.round((n / d) * 100)}% · ${n}/${d}` : 'Still observing';
  function download(day: string, value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `operating-report-${day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <SectionHeading
        title="From signup to useful work"
        description="Activation is the first successful real agent run. Simulation is excluded."
      />
      <div className="growth-funnel">
        {[
          ['Verified people', 'users_verified'],
          ['Organizations', 'accounts_total'],
          ['Activated organizations', 'accounts_activated'],
        ].map(([label, key]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{values.get(key) || 0}</strong>
            <ArrowUpRight size={18} />
          </div>
        ))}
      </div>
      <SectionHeading
        title="New organizations"
        description="Acquisition by UTC date. Dates with no signups are omitted."
      />
      <div
        className="acquisition-chart"
        role="img"
        aria-label={
          daily.length
            ? daily.map((m) => `${m.dimensions!.day}: ${m.value} organizations`).join('; ')
            : 'No organizations created in this period'
        }
      >
        {daily.length ? (
          daily.map((m) => (
            <div
              className="acquisition-day"
              key={m.dimensions!.day}
              title={`${m.dimensions!.day}: ${m.value}`}
            >
              <span>{String(m.value)}</span>
              <div style={{ height: `${Math.max(4, (Number(m.value) / peak) * 100)}px` }} />
              <small>{m.dimensions!.day.slice(5)}</small>
            </div>
          ))
        ) : (
          <p className="muted">Your acquisition history will appear here.</p>
        )}
      </div>
      <SectionHeading
        title="Account cohorts"
        description="Activation: days 0–7. Return usage: a successful run in days 7–14. Percentages only include accounts old enough to observe."
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Signup week (UTC)</th>
              <th>Accounts</th>
              <th>Activated in 7 days</th>
              <th>Returned in week 1</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w}>
                <td>{w}</td>
                <td>{cohort(w, 'size')}</td>
                <td>{rate(cohort(w, 'activated_7d'), cohort(w, 'eligible_7d'))}</td>
                <td>{rate(cohort(w, 'retained_week_1'), cohort(w, 'eligible_14d'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionHeading
        title="Daily operating reports"
        description="Stored observations for comparison and agent reporting. Live totals may include late records."
      />
      {snapshots.error ? (
        <ErrorState error={snapshots.error} />
      ) : (
        <div className="report-downloads">
          {snapshots.data?.data.map((s) => (
            <div key={s.day}>
              <div>
                <strong>{s.day}</strong>
                <small>Observed {new Date(s.observed_at).toLocaleString()}</small>
              </div>
              <Button variant="ghost" onClick={() => download(s.day, s.report)}>
                <Download size={15} />
                Download JSON
              </Button>
            </div>
          ))}
          {snapshots.data && !snapshots.data.data.length && (
            <p className="muted">The maintenance worker creates one report each UTC day.</p>
          )}
        </div>
      )}
      <More query={snapshots} label="Older reports" />
    </>
  );
}
