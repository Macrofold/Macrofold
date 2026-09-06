'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pause, Play, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, relative, usePages, type Schema } from '../lib/client';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  More,
  PageHeading,
  SectionHeading,
} from './ui';
const events = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'git_sync.updated',
  'connection.expired',
] as const;
export function WebhooksView() {
  const endpoints = usePages<Schema['Webhook']>('/v1/webhook-endpoints');
  const deliveries = usePages<Schema['Delivery']>('/v1/webhook-deliveries?limit=100', 10000);
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [selected, setSelected] = useState<string[]>(['run.completed', 'run.failed']),
    [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [remove, setRemove] = useState<Schema['Webhook']>();
  const client = useQueryClient();
  const perform = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await client.invalidateQueries();
      toast.success(message);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Request failed.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="KEEP YOUR SYSTEMS IN STEP"
        title="Webhooks"
        description="Deliver completion and connection events to your application, with signatures and automatic retries."
        action={
          <Button
            onClick={() => {
              setOpen(true);
              setSecret('');
              setError('');
            }}
          >
            <Plus size={16} />
            Add endpoint
          </Button>
        }
      />
      <div className="info-note key-note">
        <Webhook size={22} />
        <div>
          <strong>Receive an event. Fetch the details securely.</strong>
          <p>
            Payloads contain resource IDs. Use your API key to retrieve results. Local simulation records
            events but does not contact external endpoints.
          </p>
        </div>
      </div>
      {endpoints.isPending ? (
        <Loading />
      ) : endpoints.error ? (
        <ErrorState error={endpoints.error} />
      ) : !endpoints.data?.data.length ? (
        <Empty
          icon={<Webhook />}
          title="Connect your first endpoint"
          description="Start a downstream job when your agent finishes working."
          action={
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Add endpoint
            </Button>
          }
        />
      ) : (
        <div className="connections-grid">
          {endpoints.data.data.map((endpoint) => (
            <div className="connection-card" key={endpoint.id}>
              <div className="connection-card-top">
                <Webhook size={21} />
                <Badge status={endpoint.enabled ? 'healthy' : 'paused'} />
              </div>
              <h3 className="break-anywhere">{endpoint.url}</h3>
              <p>{endpoint.events.join(' · ')}</p>
              <div className="row-actions">
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    perform(
                      () =>
                        api(`/v1/webhook-endpoints/${endpoint.id}`, 'PATCH', { enabled: !endpoint.enabled }),
                      endpoint.enabled ? 'Endpoint paused' : 'Endpoint enabled',
                    )
                  }
                >
                  {endpoint.enabled ? <Pause size={15} /> : <Play size={15} />}{' '}
                  {endpoint.enabled ? 'Pause' : 'Enable'}
                </Button>
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    perform(async () => {
                      const result = await api<Schema['NewWebhook']>(
                        `/v1/webhook-endpoints/${endpoint.id}/rotate-secret`,
                        'POST',
                        {},
                      );
                      setSecret(result.signing_secret);
                      setOpen(true);
                    }, 'Secret rotated; previous secret overlaps for 24 hours')
                  }
                >
                  <KeyRound size={15} />
                  Rotate secret
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Delete ${endpoint.url}`}
                  onClick={() => setRemove(endpoint)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <More query={endpoints} label="More endpoints" />
      <SectionHeading
        title="Recent deliveries"
        description="Stable event IDs make duplicates safe to detect. Replays retain the original event and create a new delivery."
      />
      {deliveries.error ? (
        <ErrorState error={deliveries.error} />
      ) : !deliveries.data?.data.length ? (
        <Empty
          icon={<Webhook />}
          title="Your delivery history will appear here"
          description="Create a subscribed endpoint, then complete a run."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>HTTP</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <code>{d.event_id.slice(0, 12)}…</code>
                  </td>
                  <td>
                    <Badge status={d.status} />
                  </td>
                  <td>{d.attempts}</td>
                  <td>{d.last_status_code || '—'}</td>
                  <td>{relative(d.created_at)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      busy={busy}
                      onClick={() =>
                        perform(
                          () => api(`/v1/webhook-deliveries/${d.id}/replay`, 'POST', {}),
                          'Replay queued',
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      Replay
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <More query={deliveries} label="Older deliveries" />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={secret ? 'Save your signing secret' : 'Add webhook endpoint'}
        description={
          secret
            ? 'Copy this secret now. Store it in your receiver’s environment, and verify every incoming event.'
            : 'Your destination must use public HTTPS. Choose the events you need.'
        }
      >
        {secret ? (
          <div className="form-stack">
            <pre className="secret-value break-anywhere">{secret}</pre>
            <Button
              onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success('Secret copied'))}
            >
              <Copy size={15} />
              Copy secret
            </Button>
            <p className="muted">
              Verify HMAC-SHA256 of the timestamp, a period, and the exact raw body. Accept any matching v1
              signature within five minutes. Deduplicate the event ID.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setSecret('');
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const result = await api<Schema['NewWebhook']>('/v1/webhook-endpoints', 'POST', {
                  url,
                  events: selected,
                });
                setSecret(result.signing_secret);
              }, 'Endpoint created');
            }}
          >
            <Field label="Endpoint URL">
              <input
                type="url"
                required
                placeholder="https://your.app/webhooks/agents"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <fieldset className="choice-fieldset">
              <legend>Events</legend>
              {events.map((event) => (
                <label className="checkbox-label" key={event}>
                  <input
                    type="checkbox"
                    checked={selected.includes(event)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? [...selected, event] : selected.filter((v) => v !== event),
                      )
                    }
                  />
                  {event}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button busy={busy} disabled={!selected.length}>
              Create endpoint
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        open={!!remove}
        onOpenChange={(v) => !v && setRemove(undefined)}
        title="Delete this endpoint?"
        description="Future deliveries will stop. Existing delivery records remain available."
      >
        <Button
          variant="danger"
          busy={busy}
          onClick={() =>
            perform(async () => {
              await api(`/v1/webhook-endpoints/${remove!.id}`, 'DELETE');
              setRemove(undefined);
            }, 'Endpoint deleted')
          }
        >
          Delete endpoint
        </Button>
      </Modal>
    </div>
  );
}
