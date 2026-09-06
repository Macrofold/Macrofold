'use client';
import Link from 'next/link';
import { waitingReasons } from './queue-status';
import { Activity, FolderOpen, ArrowUpRight, GitBranch } from 'lucide-react';
import { money, relative, type Schema } from '../lib/client';
import { Empty, Badge } from './ui';
export function Stat({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function ProjectCard({ project, index = 0 }: { project: Schema['Project']; index?: number }) {
  return (
    <Link href={`/projects/${project.id}`} className="project-card">
      <div className="project-card-top">
        <span className={`project-icon color-${index % 4}`}>
          <FolderOpen size={21} />
        </span>
        <ArrowUpRight size={17} className="project-arrow" />
      </div>
      <h3>{project.name}</h3>
      <p>{project.github ? 'Connected to GitHub' : 'Your persistent agent workspace'}</p>
      <div className="project-card-footer">
        <span>
          <GitBranch size={13} />
          {project.github?.target_branch || 'main'}
        </span>
        <span>
          <span className="tiny-dot" />
          {project.archived ? 'Archived' : 'Persistent'}
        </span>
      </div>
    </Link>
  );
}
export function RunTable({ runs }: { runs: Schema['Run'][] }) {
  return !runs.length ? (
    <Empty
      icon={<Activity />}
      title="No runs yet"
      description="Start a run to see your agent’s progress here."
    />
  ) : (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Model</th>
            <th>Cost</th>
            <th>Submitted / wait</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link className="run-name" href={`/runs/${run.id}`}>
                  <span className={`harness-icon ${run.harness}`}>
                    {run.harness === 'codex' ? '⌘' : run.harness === 'claude-code' ? '✳' : '>'}
                  </span>
                  <span>
                    <strong>
                      {run.harness === 'codex'
                        ? 'Codex'
                        : run.harness === 'claude-code'
                          ? 'Claude Code'
                          : 'OpenCode'}{' '}
                      run
                    </strong>
                    <small>{run.id.slice(-8)}</small>
                  </span>
                </Link>
              </td>
              <td>
                <Badge status={run.status} />
                {run.status === 'queued' && (
                  <small className="muted" style={{ display: 'block', maxWidth: 220, marginTop: 6 }}>
                    {waitingReasons[run.waiting_reason || 'scheduler_turn']}
                  </small>
                )}
              </td>
              <td>
                <span className="model-label">
                  {run.model === 'fixture-model' ? 'Simulation' : run.model}
                </span>
              </td>
              <td className="mono">{money(run.cost_micro_usd)}</td>
              <td className="muted">
                {relative(run.created_at)}
                {run.status === 'queued' && (
                  <small style={{ display: 'block' }}>{Math.floor(run.wait_seconds || 0)}s waiting</small>
                )}
              </td>
              <td>
                <Link
                  className="icon-button"
                  href={`/runs/${run.id}`}
                  aria-label={`Open run ${run.id.slice(-8)}`}
                >
                  <ArrowUpRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
