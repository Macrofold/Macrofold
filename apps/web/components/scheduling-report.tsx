'use client';
import { useApi, type Schema } from '../lib/client';
import { ErrorState, SectionHeading } from './ui';
import './scheduling.css';

export function SchedulingReport() {
  const report = useApi<Schema['Report']>('/admin/v1/infrastructure/capacity', 10000);
  const value = report.data?.scheduling;
  return (
    <section className="scheduling-accounts">
      <SectionHeading
        title="Execution demand"
        description="Live capacity and account waits. Starts are measured over the last 30 days; a free slot is never guaranteed."
      />
      {report.error ? (
        <ErrorState error={report.error} />
      ) : (
        value && (
          <>
            <div className="health-grid">
              <div className="health-item">
                <span>Active / ceiling</span>
                <strong>
                  {value.active_executions} / {value.global_concurrency_limit}
                </strong>
              </div>
              <div className="health-item">
                <span>Eligible queued jobs</span>
                <strong>{value.eligible_queued_jobs}</strong>
              </div>
              <div className="health-item">
                <span>Oldest eligible wait</span>
                <strong>{Math.round(value.oldest_eligible_wait_seconds)}s</strong>
              </div>
              <div className="health-item">
                <span>Start wait · p95</span>
                <strong>
                  {value.p95_start_wait_seconds === null
                    ? 'No starts'
                    : `${Math.round(value.p95_start_wait_seconds)}s`}
                </strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Active</th>
                    <th>Eligible / queued</th>
                    <th>Oldest eligible wait</th>
                    <th>Mean / p95 start wait</th>
                  </tr>
                </thead>
                <tbody>
                  {value.accounts.map((a) => (
                    <tr key={a.organization_id}>
                      <td>
                        <code>{a.organization_id}</code>
                      </td>
                      <td>{a.active_executions}</td>
                      <td>
                        {a.eligible_queued_jobs} / {a.queued_jobs}
                      </td>
                      <td>{Math.round(a.oldest_eligible_wait_seconds)}s</td>
                      <td>
                        {a.mean_start_wait_seconds === null
                          ? 'No starts'
                          : `${Math.round(a.mean_start_wait_seconds)}s / ${Math.round(a.p95_start_wait_seconds || 0)}s`}
                      </td>
                    </tr>
                  ))}
                  {!value.accounts.length && (
                    <tr>
                      <td colSpan={5}>No queued work or recent starts.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="form-hint">
              Up to {value.accounts_limit} active accounts, ordered by oldest eligible wait. Filter the
              capacity API by organization_id to inspect a specific account.
            </p>
          </>
        )
      )}
    </section>
  );
}
