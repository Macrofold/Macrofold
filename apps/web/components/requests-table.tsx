'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { relative, type Schema } from '../lib/client';
export function RequestsTable({ records }: { records: Schema['RequestRecord'][] }) {
  const [search, setSearch] = useState('');
  const filtered = records.filter((record) =>
    `${record.route} ${record.status_code}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="view-toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Filter requests"
            placeholder="Filter loaded rows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">{records.length} loaded requests</span>
      </div>
      <div className="table-wrap">
        <table className="data-table requests-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Status</th>
              <th>Client</th>
              <th>Actor</th>
              <th>Duration</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="empty-inline">
                  {search ? 'No loaded requests match this filter.' : 'No requests recorded in this period.'}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.request_id}>
                <td>
                  <span className={`method ${r.method.toLowerCase()}`}>{r.method}</span>
                  <code>{r.route}</code>
                </td>
                <td>
                  <span
                    className={`http-status ${r.status_code == null ? '' : r.status_code < 400 ? 'good' : 'bad'}`}
                  >
                    {r.status_code || '—'}
                  </span>
                </td>
                <td>{r.client_type}</td>
                <td>{r.principal_type}</td>
                <td className="mono">{r.duration_ms} ms</td>
                <td className="muted">{relative(r.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
