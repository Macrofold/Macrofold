'use client';
import { TaskLineage } from './task-lineage';
import { InferenceResult } from './inference-result';
import { RunArtifacts } from './run-artifacts';
import { harnessLabel } from '../../../packages/contracts/harnesses';
import { CopyButton } from './copy-button';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Activity,
  Square,
  MessageSquare,
  ChevronDown,
  Terminal,
  Check,
  ArrowUpRight,
} from 'lucide-react';
import { MarkdownOutput } from './markdown-output';
import { WaitingText } from './waiting-text';
import { toast } from 'sonner';
import { api, useApi, usePages, money, relative, type Schema } from '../lib/client';
import { More, Button, PageHeading, Badge, Loading, ErrorState, Field } from './ui';
import { RunTable } from './dashboard-shared';
import { QueueStatus } from './queue-status';
import { RunComposer } from './run-composer';
import { dashboardRunEvents } from '../lib/run-events';
const isFinal = (status: string) => ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status);
export function RunsView({ onRun }: { onRun: () => void }) {
  const [filter, setFilter] = useState('all');
  const query = usePages<Schema['Run']>(`/v1/runs?limit=100${filter === 'all' ? '' : `&status=${filter}`}`);
  return (
    <div className="page">
      <PageHeading
        eyebrow="FULL VISIBILITY"
        title="Runs"
        description="Follow active work and explore the complete history of your agents."
        action={
          <Button onClick={onRun}>
            <Plus size={17} />
            New run
          </Button>
        }
      />
      <div className="view-toolbar">
        <div className="segmented">
          {['all', 'running', 'queued', 'succeeded', 'failed'].map((v) => (
            <button className={filter === v ? 'selected' : ''} key={v} onClick={() => setFilter(v)}>
              {v === 'all' ? 'All runs' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted">Updates automatically</span>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <RunTable runs={query.data?.data || []} />
      )}
      <More query={query} label="Older runs" />
    </div>
  );
}
export function RunDetail({ runId }: { runId: string }) {
  const [connected, setConnected] = useState(false);
  const query = useApi<Schema['Run']>(`/v1/runs/${runId}`, connected ? false : 15000);
  const result = useApi<Schema['RunResult']>(`/v1/runs/${runId}/result`, connected ? false : 15000);
  const [events, setEvents] = useState<Schema['Event'][]>([]),
    [streamError, setStreamError] = useState(''),
    [compose, setCompose] = useState(false),
    [tab, setTab] = useState('output'),
    [answer, setAnswer] = useState('');
  const client = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    setEvents([]);
    setConnected(false);
    setStreamError('');
    async function follow() {
      try {
        for await (const event of dashboardRunEvents(location.origin, runId, {
          signal: controller.signal,
          connected: (value) => {
            if (!controller.signal.aborted) setConnected(value);
          },
        })) {
          if (controller.signal.aborted) return;
          setEvents((old) => [...old, event]);
          if (
            ['run.started', 'run.running', 'run.persisting', 'input.requested', 'input.received'].includes(
              event.type,
            )
          )
            void client.invalidateQueries({ queryKey: [`/v1/runs/${runId}`] });
          if (['run.succeeded', 'run.failed', 'run.cancelled', 'run.timed_out'].includes(event.type))
            void client.invalidateQueries();
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setStreamError(error instanceof Error ? error.message : 'The live stream is unavailable.');
      } finally {
        if (!controller.signal.aborted) setConnected(false);
      }
    }
    void follow();
    return () => controller.abort();
  }, [runId, client]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const run = query.data!;
  const timeoutSeconds = run.limits?.timeout_seconds ?? 900;
  const live = !isFinal(run.status);
  const output = result.data?.content_expired
    ? ''
    : result.data?.output_text ||
      events
        .filter((e) => e.type === 'output.delta')
        .map((e) => String(e.data.text || ''))
        .join('');
  const waiting = [...events].reverse().find((e) => e.type === 'input.requested');
  const visibleEvents = result.data?.content_expired
    ? events.filter((e) => e.type.startsWith('run.'))
    : events;
  const tools = visibleEvents.filter((e) => e.type.startsWith('tool.'));
  const summaries = visibleEvents.filter((e) => e.type === 'reasoning.summary');
  return (
    <div className="page run-detail">
      <Link href="/runs" className="back-link">
        <ArrowLeft size={14} />
        All runs
      </Link>
      <PageHeading
        eyebrow={`RUN ${run.id.slice(-8).toUpperCase()}`}
        title={
          run.status === 'queued'
            ? 'Your task is queued.'
            : live
              ? run.kind === 'inference'
                ? 'Decision in progress.'
                : 'Your agent is on it.'
              : run.status === 'succeeded'
                ? 'Work, completed.'
                : 'Run stopped.'
        }
        description={`${run.harness ? harnessLabel(run.harness) : run.kind === 'inference' ? 'Inference' : 'Bounded agent'} · ${run.model === 'fixture-model' ? 'Local simulation' : run.model} · ${relative(run.created_at)}`}
        action={
          <div className="button-row">
            {live ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await api(`/v1/runs/${runId}/cancel`, 'POST', {});
                    await client.invalidateQueries();
                    toast.success('Cancellation requested');
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Square size={14} />
                Cancel run
              </Button>
            ) : run.session_id ? (
              <Button onClick={() => setCompose(true)}>
                <MessageSquare size={16} />
                Continue conversation
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="run-summary-bar">
        <Badge status={run.status} />
        <span>
          <ClockIcon />{' '}
          {run.status === 'queued'
            ? `${Math.floor(run.wait_seconds || 0)}s waiting`
            : run.started_at && run.completed_at
              ? `${Math.round((Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000)}s`
              : 'In progress'}
        </span>
        <span>{money(run.cost_micro_usd)} spent</span>
        <span className="run-stream-state">
          <span className={connected ? 'tiny-dot' : 'tiny-dot neutral'} />
          {connected
            ? 'Live stream connected'
            : live
              ? streamError
                ? 'Stream paused'
                : 'Reconnecting…'
              : 'History saved'}
        </span>
      </div>
      <QueueStatus run={run} />
      {run.failure_code && (
        <div className="form-error" role="status">
          {run.failure_code === 'queue_expired'
            ? 'The queue deadline expired before execution could start. Reserved funds were released; this history is saved.'
            : run.failure_code === 'execution_limit_changed'
              ? 'The account execution cap changed before this job started. Reserved funds were released. Submit a new run within the current limit.'
              : `Run ended: ${run.failure_code.replaceAll('_', ' ')}.`}
        </div>
      )}
      {run.model === 'fixture-model' && (
        <div className="simulation-banner">
          <Terminal size={16} />
          <span>This is a simulation. It tests the complete workflow without calling a paid model.</span>
        </div>
      )}
      {streamError && (
        <p className="form-error" role="alert">
          {streamError} Status updates continue; refresh this page to reconnect the event history.
        </p>
      )}
      <div className="run-layout">
        <section className="run-content">
          <div className="tabs" role="tablist" aria-label="Run output">
            <button
              role="tab"
              aria-selected={tab === 'output'}
              className={tab === 'output' ? 'selected' : ''}
              onClick={() => setTab('output')}
            >
              Output
            </button>
            <button
              role="tab"
              aria-selected={tab === 'tools'}
              className={tab === 'tools' ? 'selected' : ''}
              onClick={() => setTab('tools')}
            >
              Tool calls{' '}
              <span>
                {
                  tools.filter(
                    (t) => t.type === (run.kind === 'bounded_agent' ? 'tool.completed' : 'tool.started'),
                  ).length
                }
              </span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'events'}
              className={tab === 'events' ? 'selected' : ''}
              onClick={() => setTab('events')}
            >
              Events <span>{events.length}</span>
            </button>
          </div>
          {tab === 'output' ? (
            <div className="output-area">
              {!live && run.kind === 'native_agent' && !result.data?.content_expired && (
                <RunArtifacts runId={runId} />
              )}
              {summaries.map((e) => (
                <details className="reasoning-summary" key={e.id}>
                  <summary>Reasoning summary</summary>
                  <p>{String(e.data.text || '')}</p>
                </details>
              ))}
              {result.data?.inference ? (
                <InferenceResult receipt={result.data.inference} />
              ) : output ? (
                <MarkdownOutput text={output} streaming={live} />
              ) : (
                <div className="run-waiting">
                  <Activity size={24} />
                  <h3>
                    <WaitingText active={live && !result.data?.content_expired}>
                      {result.data?.content_expired
                        ? 'Detailed history has expired'
                        : run.status === 'queued'
                          ? 'Queued · waiting to start'
                          : 'Waiting for the first update'}
                    </WaitingText>
                  </h3>
                  <p>
                    {result.data?.content_expired
                      ? 'Prompts, outputs and tool details were removed under the retention policy. Usage and completion records remain.'
                      : 'Your run is saved. You can leave this page and come back later.'}
                  </p>
                </div>
              )}
              {result.data?.final && (
                <div className="output-footer">
                  <span>
                    <Check size={15} />
                    {result.data.persistence_status === 'verified'
                      ? 'Worktree checkpoint verified'
                      : 'Run history saved'}
                  </span>
                  <CopyButton
                    variant="ghost"
                    text={result.data?.inference ? JSON.stringify(result.data.inference, null, 2) : output}
                    label="Copy output"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="event-list">
              {(tab === 'tools' ? tools : visibleEvents).map((event) => (
                <details className="event-row" key={event.id}>
                  <summary>
                    <span className={`event-mark ${event.type.includes('failed') ? 'error' : ''}`}>
                      {event.type.startsWith('tool.') ? <Terminal size={14} /> : <Activity size={14} />}
                    </span>
                    <strong>{event.type}</strong>
                    <span className="event-time">{new Date(event.occurred_at).toLocaleTimeString()}</span>
                    <ChevronDown size={13} />
                  </summary>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </details>
              ))}
            </div>
          )}
          {run.status === 'waiting_for_input' && waiting && (
            <form
              className="input-request"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/v1/runs/${runId}/input`, 'POST', {
                    input_request_id: waiting.data.input_request_id,
                    answer: { text: answer },
                  });
                  setAnswer('');
                  toast.success('Answer submitted');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Field label={String(waiting.data.question || 'Your agent needs input')}>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} required rows={3} />
              </Field>
              <Button type="submit">Send answer</Button>
            </form>
          )}
        </section>
        <aside className="run-aside">
          {run.task_id && <TaskLineage taskId={run.task_id} />}
          <div className="panel compact-panel">
            <h3>Run details</h3>
            <dl>
              <dt>{run.status === 'queued' ? 'Time waiting' : 'Wait before start'}</dt>
              <dd>{Math.round(run.wait_seconds || 0)}s</dd>
              <dt>Scheduling</dt>
              <dd>{run.scheduling_class || 'background'}</dd>
              <dt>Queue deadline</dt>
              <dd>{run.queue_expires_at ? new Date(run.queue_expires_at).toLocaleString() : '—'}</dd>
              <dt>Execution</dt>
              <dd>{run.harness || run.kind.replaceAll('_', ' ')}</dd>
              <dt>Model</dt>
              <dd>{run.model}</dd>
              <dt>Persistence</dt>
              <dd>
                <Badge status={run.persistence_status || 'pending'} />
              </dd>
              {run.kind === 'native_agent' && (
                <>
                  <dt>Git sync</dt>
                  <dd>{run.sync_status || 'disabled'}</dd>
                </>
              )}
              <dt>Budget</dt>
              <dd>{money(run.limits?.max_cost_micro_usd)}</dd>
              <dt>Timeout</dt>
              <dd>
                {timeoutSeconds % 60 === 0 ? `${timeoutSeconds / 60} minutes` : `${timeoutSeconds} seconds`}
              </dd>
            </dl>
            <CopyButton variant="plain" className="text-link" text={runId} label="Copy run ID" />
          </div>
          {run.worktree_id && (
            <div className="panel compact-panel">
              <h3>Worktree</h3>
              <p>
                {run.persistence_status === 'verified'
                  ? 'Changes are saved to this run’s persistent worktree.'
                  : 'Browse the latest verified files. Run changes are available after persistence succeeds.'}
              </p>
              <WorktreeLink worktreeId={run.worktree_id} />
            </div>
          )}
          <div className="run-api-tip">
            <Terminal size={18} />
            <strong>Pick it up in your terminal</strong>
            <code className="break-anywhere">macrofold run attach {run.id}</code>
          </div>
        </aside>
      </div>
      {run.session_id && <RunComposer open={compose} onOpenChange={setCompose} sessionId={run.session_id} />}
    </div>
  );
}
function ClockIcon() {
  return <span aria-hidden="true">◷</span>;
}
function WorktreeLink({ worktreeId }: { worktreeId: string }) {
  const worktree = useApi<Schema['Worktree']>(`/v1/worktrees/${worktreeId}`);
  return worktree.data ? (
    <Link className="text-link" href={`/workspaces/${worktree.data.workspace_id}/worktrees/${worktreeId}`}>
      {worktree.data.name ?? 'Untitled worktree'}
      <ArrowUpRight size={14} />
    </Link>
  ) : null;
}
