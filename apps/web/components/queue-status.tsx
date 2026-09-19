'use client';
import { Clock3, LockKeyhole } from 'lucide-react';
import { money, type Schema } from '../lib/client';
import './scheduling.css';
import { WaitingText } from './waiting-text';

export const waitingReasons: Record<string, string> = {
  lightweight_capacity: 'Waiting for lightweight execution capacity',
  reserved_lightweight_capacity: 'Remaining slots are reserved for lightweight work',
  global_capacity: 'All execution slots are occupied',
  account_concurrency: 'Your account is at its concurrency limit',
  earlier_worktree_work: 'Earlier work is using this worktree',
  scheduler_turn: 'Waiting for your account’s next scheduling turn',
  cancellation_requested: 'Cancellation is being processed',
  deadline_expired: 'Queue deadline reached · finalizing expiry',
  worktree_unavailable: 'This worktree is currently unavailable',
};
export function QueueStatus({ run }: { run: Schema['Run'] }) {
  if (run.status !== 'queued') return null;
  return (
    <section className="queue-status" aria-label="Queue status" role="status">
      <div className="queue-status-title">
        <Clock3 size={20} />
        <div>
          <strong>
            <WaitingText>{waitingReasons[run.waiting_reason || 'scheduler_turn']}</WaitingText>
          </strong>
          <p>
            Saved safely ·{' '}
            {run.scheduling_class === 'interactive' ? 'Interactive priority' : 'Background work'}
          </p>
        </div>
      </div>
      <dl>
        <div>
          <dt>Waited</dt>
          <dd>
            {Math.floor((run.wait_seconds || 0) / 60)}m {Math.floor((run.wait_seconds || 0) % 60)}s
          </dd>
        </div>
        <div>
          <dt>Start deadline</dt>
          <dd>{run.queue_expires_at ? new Date(run.queue_expires_at).toLocaleString() : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>
            <LockKeyhole size={12} /> Budget held
          </dt>
          <dd>{money(run.reserved_micro_usd)}</dd>
        </div>
      </dl>
      <p>
        Reserved funds are unavailable to other jobs. Cancel this run to release them. If the deadline
        expires, the run fails and keeps its history. The execution timer begins when a slot is claimed.
      </p>
    </section>
  );
}
