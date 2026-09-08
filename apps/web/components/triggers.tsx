'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Copy,
  History,
  KeyRound,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, relative, useApi, usePages, type Page, type Schema } from '../lib/client';
import { copyText } from '../lib/clipboard';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeading,
  SectionHeading,
  Select,
} from './ui';
import './triggers.css';

type Trigger = Schema['Trigger'];
const icons = { slack: MessageSquare, webhook: Webhook, schedule: CalendarClock };
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Please try again.';
export function TriggersView({ scheduled = false }: { scheduled?: boolean }) {
  const path = `/v1/triggers?limit=100${scheduled ? '&kind=schedule' : ''}`;
  const triggers = usePages<Trigger>(path, 15000);
  const [edit, setEdit] = useState<Trigger | 'new'>(),
    [selected, setSelected] = useState<Trigger>(),
    [remove, setRemove] = useState<Trigger>(),
    [slack, setSlack] = useState(false),
    [secret, setSecret] = useState<{ url: string; value: string }>(),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const refresh = () =>
    cache.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/triggers') });
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rows =
    triggers.data?.data.filter((t) => (scheduled ? t.kind === 'schedule' : t.kind !== 'schedule')) || [];
  return (
    <div className="page">
      <PageHeading
        eyebrow={scheduled ? 'ON YOUR SCHEDULE' : 'FROM EVENT TO EXECUTION'}
        title={scheduled ? 'Scheduled tasks' : 'Triggers'}
        description={
          scheduled
            ? 'Save a prompt. Choose a cadence. Your agents keep working, even when you’re offline.'
            : 'Turn Slack messages and incoming webhooks into work in your persistent projects.'
        }
        action={
          <div className="row-actions">
            {!scheduled && (
              <Button variant="secondary" onClick={() => setSlack(true)}>
                <MessageSquare size={16} />
                Slack connections
              </Button>
            )}
            <Button onClick={() => setEdit('new')}>
              <Plus size={16} />
              {scheduled ? 'New task' : 'Create trigger'}
            </Button>
          </div>
        }
      />
      <div className="info-note trigger-explainer">
        <CalendarClock size={23} />
        <div>
          <strong>Same agents. Same files. A new starting point.</strong>
          <p>
            Choose a project and agent preset. Every run keeps its usual budget, permissions, history and
            cancellation controls.{' '}
            <Link href={scheduled ? '/docs/triggers/scheduled-tasks' : '/docs/triggers'}>Setup guide →</Link>
          </p>
        </div>
      </div>
      {triggers.isPending ? (
        <Loading />
      ) : triggers.error ? (
        <ErrorState error={triggers.error} retry={() => void triggers.refetch()} />
      ) : !rows.length ? (
        <Empty
          icon={scheduled ? <CalendarClock /> : <Webhook />}
          title={scheduled ? 'Make room for recurring work' : 'Give your agents a signal'}
          description={
            scheduled
              ? 'A daily briefing, weekly report, or recurring maintenance task starts with a saved prompt.'
              : 'Connect a Slack channel or give another service a secure webhook endpoint.'
          }
          action={
            <Button variant="secondary" onClick={() => setEdit('new')}>
              {scheduled ? 'Create scheduled task' : 'Create trigger'}
            </Button>
          }
        />
      ) : (
        <div className="trigger-grid">
          {rows.map((t) => {
            const Icon = icons[t.kind];
            return (
              <article className="trigger-card" key={t.id}>
                <div className="trigger-card-top">
                  <span className={`trigger-symbol ${t.kind}`}>
                    <Icon size={21} />
                  </span>
                  <Badge status={t.enabled ? 'active' : 'paused'} />
                </div>
                <h2>{t.name}</h2>
                <p className="trigger-prompt">{t.prompt}</p>
                <div className="trigger-details">
                  {t.kind === 'schedule' ? (
                    <>
                      <code>{t.cron}</code>
                      <span>{t.timezone}</span>
                      <span>
                        Next:{' '}
                        {t.enabled && t.next_fire_at
                          ? new Date(t.next_fire_at).toLocaleString(undefined, { timeZone: t.timezone })
                          : 'Paused'}
                      </span>
                    </>
                  ) : (
                    <span>
                      {t.kind === 'slack' ? `Slack · ${t.channel_id}` : 'Authenticated incoming webhook'}
                    </span>
                  )}
                  <span>Up to {t.max_runs_per_day} deliveries / 24 hours</span>
                  {t.last_error_code && (
                    <span role="status">Last occurrence: {t.last_error_code.replaceAll('_', ' ')}</span>
                  )}
                  <Link href={`/projects/${t.project_id}`}>Open project →</Link>
                </div>
                <div className="row-actions trigger-actions">
                  <Button variant="ghost" onClick={() => setSelected(t)}>
                    <History size={15} />
                    History
                  </Button>
                  {t.kind === 'schedule' && (
                    <Button
                      variant="ghost"
                      busy={busy}
                      disabled={!t.enabled}
                      onClick={() =>
                        perform(() => api(`/v1/triggers/${t.id}/run`, 'POST', {}), 'Task queued')
                      }
                    >
                      <Play size={15} />
                      Run now
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    busy={busy}
                    onClick={() =>
                      perform(
                        () => api(`/v1/triggers/${t.id}`, 'PATCH', { enabled: !t.enabled }),
                        t.enabled ? 'Trigger paused' : 'Trigger resumed',
                      )
                    }
                  >
                    {t.enabled ? <Pause size={15} /> : <Play size={15} />}
                    {t.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Edit ${t.name}`}
                    onClick={() => setEdit(t)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setRemove(t)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
                {t.webhook_url && (
                  <div className="trigger-endpoint">
                    <code>{t.webhook_url}</code>
                    <Button
                      variant="ghost"
                      aria-label={`Copy ${t.name} webhook URL`}
                      onClick={() => copyText(t.webhook_url!)}
                    >
                      <Copy size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      busy={busy}
                      aria-label={`Rotate ${t.name} secret`}
                      onClick={() =>
                        perform(async () => {
                          const result = await api<Schema['TriggerSecret']>(
                            `/v1/triggers/${t.id}/rotate-secret`,
                            'POST',
                            {},
                          );
                          setSecret({ url: t.webhook_url!, value: result.webhook_secret });
                        }, 'Previous webhook secret invalidated')
                      }
                    >
                      <KeyRound size={14} />
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {triggers.hasNextPage && (
        <Button
          variant="secondary"
          busy={triggers.isFetchingNextPage}
          onClick={() => triggers.fetchNextPage()}
        >
          Load more
        </Button>
      )}
      {edit && (
        <TriggerForm
          scheduled={scheduled}
          initial={edit === 'new' ? undefined : edit}
          close={() => setEdit(undefined)}
          saved={(result) => {
            setEdit(undefined);
            void refresh();
            if (result.webhook_secret && result.webhook_url)
              setSecret({ url: result.webhook_url, value: result.webhook_secret });
          }}
        />
      )}
      <Modal
        open={!!secret}
        onOpenChange={(open) => {
          if (!open) setSecret(undefined);
        }}
        title="Your webhook is ready"
        description="Copy the secret now. It is shown once. Store it in the sending service’s secret settings."
      >
        {secret && (
          <div className="form-grid">
            <Field label="Webhook URL">
              <input readOnly value={secret.url} />
            </Field>
            <Field label="Authorization header">
              <input readOnly value={`Bearer ${secret.value}`} />
            </Field>
            <Button onClick={() => copyText(secret.value)}>
              <Copy size={15} />
              Copy secret
            </Button>
            <p className="muted">
              Send JSON and a unique Idempotency-Key header. Reuse that key when retrying the same event.
            </p>
            <Link href="/docs/triggers/webhooks">Webhook setup guide →</Link>
          </div>
        )}
      </Modal>
      <Modal
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(undefined);
        }}
        title="Delete trigger?"
        description="This stops future deliveries. Accepted runs and their results remain available."
      >
        <Button
          variant="danger"
          busy={busy}
          onClick={() =>
            perform(async () => {
              await api(`/v1/triggers/${remove!.id}`, 'DELETE');
              setRemove(undefined);
            }, 'Trigger deleted')
          }
        >
          Delete trigger
        </Button>
      </Modal>
      {selected && <DeliveryHistory trigger={selected} close={() => setSelected(undefined)} />}
      {slack && <SlackConnections close={() => setSlack(false)} />}
    </div>
  );
}

function TriggerForm({
  scheduled,
  initial,
  close,
  saved,
}: {
  scheduled: boolean;
  initial?: Trigger;
  close: () => void;
  saved: (t: Schema['NewTrigger']) => void;
}) {
  const [kind, setKind] = useState<Trigger['kind']>(initial?.kind || (scheduled ? 'schedule' : 'webhook'));
  const [name, setName] = useState(initial?.name || ''),
    [prompt, setPrompt] = useState(initial?.prompt || ''),
    [project, setProject] = useState(initial?.project_id || ''),
    [agent, setAgent] = useState(initial?.agent_id || ''),
    [connection, setConnection] = useState(initial?.slack_connection_id || ''),
    [channel, setChannel] = useState(initial?.channel_id || ''),
    [cron, setCron] = useState(initial?.cron || '0 9 * * *'),
    [timezone, setTimezone] = useState(
      initial?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    ),
    [limit, setLimit] = useState(initial?.max_runs_per_day || 100),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const projects = usePages<Schema['Project']>('/v1/projects?archived=false&limit=100'),
    agents = usePages<Schema['Agent']>('/v1/agents?limit=100');
  const connections = useApi<Page<Schema['SlackConnection']>>(
    kind === 'slack' ? '/v1/slack-connections' : undefined,
  );
  const channels = usePages<Schema['SlackChannel']>(
    kind === 'slack' && connection ? `/v1/slack-connections/${connection}/channels` : undefined,
  );
  const availableChannels = channels.data?.data || [];
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={initial ? 'Edit task configuration' : scheduled ? 'New scheduled task' : 'Create trigger'}
      description="The preset supplies the harness, model, tools and billing. The project supplies persistent files."
      wide
    >
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const input: Schema['TriggerCreate'] = {
            name,
            kind,
            project_id: project,
            agent_id: agent,
            prompt,
            max_runs_per_day: limit,
            enabled: initial?.enabled ?? true,
            ...(kind === 'schedule' ? { cron, timezone } : {}),
            ...(kind === 'slack' ? { slack_connection_id: connection, channel_id: channel } : {}),
          };
          try {
            if (initial) {
              const { kind: _kind, enabled: _enabled, ...patch } = input;
              saved(await api(`/v1/triggers/${initial.id}`, 'PATCH', patch));
            } else saved(await api('/v1/triggers', 'POST', input));
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder={scheduled ? 'Morning briefing' : 'Research inbox'}
          />
        </Field>
        {!scheduled && (
          <Field label="Integration">
            <Select
              value={kind}
              disabled={!!initial}
              onValueChange={(v) => setKind(v as Trigger['kind'])}
              options={[
                { value: 'webhook', label: 'Incoming webhook' },
                { value: 'slack', label: 'Slack' },
              ]}
            />
          </Field>
        )}
        <div className="form-row">
          <Field label="Project">
            <Select
              required
              value={project}
              disabled={!!initial}
              onValueChange={setProject}
              placeholder={projects.isPending ? 'Loading projects…' : 'Choose project'}
              options={(projects.data?.data || []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Field label="Agent preset">
            <Select
              required
              value={agent}
              onValueChange={setAgent}
              placeholder={agents.isPending ? 'Loading presets…' : 'Choose preset'}
              options={(agents.data?.data || []).map((a) => ({ value: a.id, label: a.name }))}
            />
          </Field>
        </div>
        {projects.hasNextPage && (
          <Button type="button" variant="ghost" onClick={() => projects.fetchNextPage()}>
            More projects
          </Button>
        )}
        {agents.hasNextPage && (
          <Button type="button" variant="ghost" onClick={() => agents.fetchNextPage()}>
            More presets
          </Button>
        )}
        {!projects.isPending && !projects.data?.data.length && (
          <Link href="/projects">Create a project first →</Link>
        )}
        {!agents.isPending && !agents.data?.data.length && (
          <Link href="/agents">Create an agent preset first →</Link>
        )}
        {(projects.error || agents.error) && <ErrorState error={(projects.error || agents.error)!} />}
        <Field
          label="Prompt"
          hint={
            scheduled
              ? 'These instructions run at every scheduled occurrence.'
              : 'Saved instructions precede the incoming Slack message or webhook payload.'
          }
        >
          <textarea
            required
            rows={4}
            maxLength={20000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what the agent should do…"
          />
        </Field>
        {kind === 'schedule' && (
          <>
            <Field label="Cadence">
              <Select
                value={
                  ['0 * * * *', '0 9 * * *', '0 9 * * 1-5', '0 9 * * 1'].includes(cron) ? cron : 'custom'
                }
                onValueChange={(v) => setCron(v === 'custom' ? '*/30 * * * *' : v)}
                options={[
                  { value: '0 * * * *', label: 'Every hour' },
                  { value: '0 9 * * *', label: 'Daily at 9:00' },
                  { value: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
                  { value: '0 9 * * 1', label: 'Mondays at 9:00' },
                  { value: 'custom', label: 'Custom cron' },
                ]}
              />
            </Field>
            <div className="form-row">
              <Field label="Cron expression" hint="minute · hour · day · month · weekday">
                <input required value={cron} onChange={(e) => setCron(e.target.value)} maxLength={120} />
              </Field>
              <Field label="Timezone" hint="IANA name, such as America/New_York or UTC">
                <input
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  maxLength={100}
                />
              </Field>
            </div>
            <p className="muted">
              Missed occurrences coalesce into one run. An unfinished occurrence skips the next scheduled
              start.
            </p>
          </>
        )}
        {kind === 'slack' && (
          <>
            <Field label="Slack connection">
              <Select
                required
                value={connection}
                onValueChange={(v) => {
                  setConnection(v);
                  setChannel('');
                }}
                options={(connections.data?.data || []).map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose connected bot"
              />
            </Field>
            {connections.error ? (
              <ErrorState error={connections.error} />
            ) : (
              !connections.isPending &&
              !connections.data?.data.length && (
                <p className="muted">
                  Connect a Slack bot from Triggers → Slack connections first.{' '}
                  <Link href="/docs/triggers/slack">Setup guide →</Link>
                </p>
              )
            )}
            <Field label="Slack channel">
              <Select
                value={channel}
                onValueChange={setChannel}
                options={[
                  ...availableChannels.map((c) => ({ value: c.id, label: `#${c.name}` })),
                  ...(channel && !availableChannels.some((c) => c.id === channel)
                    ? [{ value: channel, label: channel }]
                    : []),
                ]}
                placeholder={channels.isFetching ? 'Loading channels…' : 'Choose a channel the bot joined'}
              />
            </Field>
            {channels.hasNextPage && (
              <Button type="button" variant="ghost" onClick={() => channels.fetchNextPage()}>
                More channels
              </Button>
            )}
            {channels.error && <ErrorState error={channels.error} retry={() => void channels.refetch()} />}
            <details>
              <summary>Enter a channel ID manually</summary>
              <Field
                label="Channel ID"
                hint="Copy the channel ID from Slack channel details. Invite the bot before sending messages."
              >
                <input
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  placeholder="C0123456789"
                />
              </Field>
            </details>
            <p className="muted">
              Every new human message starts a run. Replies go into its Slack thread. Bot messages and edits
              are ignored.
            </p>
          </>
        )}
        <Field
          label="Maximum deliveries per 24 hours"
          hint="A rolling intake limit, in addition to your preset budget and account spending limits."
        >
          <input
            type="number"
            required
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </Field>
        {initial && (
          <p className="muted">
            Saving configuration stops deliveries that have not yet become runs. Accepted runs keep their
            original configuration.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={!project || !agent || (kind === 'slack' && (!connection || !channel))}
          >
            {initial ? 'Save changes' : scheduled ? 'Create scheduled task' : 'Create trigger'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeliveryHistory({ trigger, close }: { trigger: Trigger; close: () => void }) {
  const history = usePages<Schema['TriggerDelivery']>(
    `/v1/triggers/${trigger.id}/deliveries?limit=50`,
    10000,
  );
  const [retry, setRetry] = useState<Schema['TriggerDelivery']>(),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={`${trigger.name} · History`}
      description="Delivery acceptance and Slack reply status are separate from agent execution. Open a run for outputs and tool history."
      wide
    >
      {history.isPending ? (
        <Loading />
      ) : history.error ? (
        <ErrorState error={history.error} />
      ) : !history.data?.data.length ? (
        <p className="muted">No deliveries yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Delivery</th>
                <th>Details</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {history.data.data.map((d) => (
                <tr key={d.id}>
                  <td>{relative(d.received_at)}</td>
                  <td>
                    <Badge status={d.status} />
                    {d.reply_state !== 'none' && (
                      <small className="trigger-reply-state">Reply: {d.reply_state}</small>
                    )}
                  </td>
                  <td>
                    {d.error_code?.replaceAll('_', ' ') ||
                      (d.status === 'pending' ? 'Waiting for admission' : '—')}
                    {d.status === 'pending' && (
                      <small className="trigger-reply-state">
                        Deadline: {new Date(d.expires_at).toLocaleString()}
                      </small>
                    )}
                    {['failed', 'uncertain'].includes(d.reply_state) && (
                      <Button variant="ghost" onClick={() => setRetry(d)}>
                        Retry reply
                      </Button>
                    )}
                  </td>
                  <td>{d.run_id ? <Link href={`/runs/${d.run_id}`}>View run →</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.hasNextPage && (
        <Button variant="secondary" onClick={() => history.fetchNextPage()}>
          Load older deliveries
        </Button>
      )}
      {retry && (
        <div className="info-note">
          <div>
            <strong>Check the Slack thread first</strong>
            <p>
              An uncertain reply may already exist. Retrying sends another reply; it never reruns the agent.
            </p>
            <Button
              variant="secondary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/v1/triggers/${trigger.id}/deliveries/${retry.id}/retry-reply`, 'POST', {});
                  setRetry(undefined);
                  await history.refetch();
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry this reply
            </Button>
            <Button variant="ghost" onClick={() => setRetry(undefined)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SlackConnections({ close }: { close: () => void }) {
  const connections = useApi<Page<Schema['SlackConnection']>>('/v1/slack-connections');
  const [name, setName] = useState(''),
    [botToken, setBotToken] = useState(''),
    [signingSecret, setSigningSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [remove, setRemove] = useState<Schema['SlackConnection']>();
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title="Slack connections"
      description="Connect your own Slack app. Tokens stay encrypted on the server; your signing secret verifies incoming events."
      wide
    >
      <Link href="/docs/triggers/slack" target="_blank">
        Create and configure a Slack bot →
      </Link>
      {connections.error && <ErrorState error={connections.error} />}
      <div className="trigger-slack-list">
        {connections.data?.data.map((c) => (
          <div key={c.id} className="trigger-slack-connection">
            <strong>{c.name}</strong>
            <span className="muted">Workspace {c.team_id}</span>
            <Field label={`${c.name} Events request URL`}>
              <input readOnly value={c.events_url} />
            </Field>
            <div className="row-actions">
              <Button variant="ghost" onClick={() => copyText(c.events_url)}>
                <Copy size={15} />
                Copy request URL
              </Button>
              <Button variant="ghost" onClick={() => setRemove(c)}>
                <Trash2 size={15} />
                Disconnect
              </Button>
            </div>
          </div>
        ))}
      </div>
      {remove && (
        <div className="info-note">
          <div>
            <strong>Disconnect {remove.name}?</strong>
            <p>Its triggers will pause and credentials will be removed.</p>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/v1/slack-connections/${remove.id}`, 'DELETE');
                  setRemove(undefined);
                  await connections.refetch();
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect bot
            </Button>
            <Button variant="ghost" onClick={() => setRemove(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <SectionHeading title="Connect a bot" />
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/v1/slack-connections', 'POST', {
              name,
              bot_token: botToken,
              signing_secret: signingSecret,
            });
            setBotToken('');
            setSigningSecret('');
            setName('');
            await connections.refetch();
            toast.success('Bot connected. Copy its request URL into Slack Event Subscriptions.');
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Connection name">
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team assistant"
          />
        </Field>
        <Field label="Bot user OAuth token">
          <input
            required
            type="password"
            autoComplete="off"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="xoxb-…"
          />
        </Field>
        <Field label="Slack signing secret">
          <input
            required
            type="password"
            autoComplete="off"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy}>
          Connect Slack bot
        </Button>
      </form>
    </Modal>
  );
}
