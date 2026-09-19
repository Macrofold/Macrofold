'use client';
import Link from 'next/link';
import { useData } from '../lib/dashboard-data';
import { money } from '../lib/client';
import { Loading, ErrorState } from './ui';
import { CopyButton } from './copy-button';

export function TaskLineage({ taskId }: { taskId: string }) {
  const query = useData({ operation: 'getDecisionTask', params: { path: { task_id: taskId } } });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const task = query.data!;
  return (
    <section className="panel compact-panel" aria-label="Task lineage">
      <h2>Ongoing task</h2>
      <p>{task.objective}</p>
      <dl>
        <dt>Next step</dt>
        <dd>{task.next_step}</dd>
        <dt>Committed</dt>
        <dd>{money(task.committed_micro_usd)}</dd>
        <dt>Allocated to active work</dt>
        <dd>{money(task.outstanding_micro_usd)}</dd>
        <dt>Total ceiling</dt>
        <dd>{money(task.max_cost_micro_usd)}</dd>
      </dl>
      <ol>
        {task.runs.map((run) => (
          <li key={run.run_id}>
            <Link href={`/runs/${run.run_id}`}>
              {run.step === 'decide' ? 'Decision' : 'Investigation'} · {run.status}
            </Link>
          </li>
        ))}
      </ol>
      {task.outcomes.map((outcome) => (
        <p key={outcome.id}>Application outcome: {outcome.receipt.outcome}</p>
      ))}
      <p>
        Run completion validates a proposal. Your application records whether it was accepted or rejected.
      </p>
      <CopyButton text={taskId} label="Copy task ID" variant="plain" />
    </section>
  );
}
