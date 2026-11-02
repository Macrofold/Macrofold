'use client';
import { useEffect, useState } from 'react';
import { request, useDataPages } from '../lib/dashboard-data';
import type { Schema } from '../lib/client';
import { Button, ErrorState, Field, Loading, Modal, More } from './ui';

export function MemoryServiceControls({
  installation,
  refresh,
}: {
  installation: Schema['AgentIntegration'];
  refresh: () => Promise<void>;
}) {
  const activity = useDataPages(
    {
      operation: 'listAgentIntegrationActivity',
      params: { path: { integration_id: installation.id }, query: { limit: 25 } },
    },
    5000,
  );
  const [query, setQuery] = useState(''),
    [note, setNote] = useState(''),
    [result, setResult] = useState('');
  const [error, setError] = useState<Error>(),
    [busy, setBusy] = useState(false),
    [forget, setForget] = useState(false);
  const [source, setSource] = useState<Schema['AgentMemorySource']>();
  useEffect(() => {
    setResult('');
    setSource(undefined);
  }, [installation.revision]);
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      await activity.refetch();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error('Could not confirm the memory operation.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Dedicated collection: <code>{installation.service?.namespace}</code>. Funding: external service
        account.{' '}
        {installation.last_error_code && (
          <>
            Last diagnostic: <code>{installation.last_error_code}</code>.
          </>
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const response = await request('searchAgentIntegrationMemory', {
              params: { path: { integration_id: installation.id } },
              body: { query },
            });
            setResult(response.context);
          });
        }}
      >
        <Field label="Find a memory" hint="This makes one service query and can incur external read charges.">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={4096}
            placeholder="What preferences should the agent remember?"
          />
        </Field>
        <Button busy={busy} disabled={!query.trim() || installation.state === 'disabled'} variant="secondary">
          Search memory
        </Button>
      </form>
      {result && (
        <pre>
          <code>{result}</code>
        </pre>
      )}
      <details>
        <summary>Add a confirmed note</summary>
        <p>Include its source and date. This adds evidence; it does not replace or erase earlier memories.</p>
        <Field label="Confirmed note">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={32768}
            rows={4}
          />
        </Field>
        <Button
          disabled={!note.trim() || installation.state !== 'active'}
          busy={busy}
          onClick={() =>
            void act(async () => {
              await request('createAgentIntegrationNote', {
                params: { path: { integration_id: installation.id } },
                body: { content: note },
              });
              setNote('');
            })
          }
        >
          Queue note
        </Button>
      </details>
      <details>
        <summary>Replace incorrect memory safely</summary>
        <ol>
          <li>Export captured sources if you need a personal copy.</li>
          <li>
            Forget this entire collection and verify cleanup in activity. All generated memories in it are
            lost.
          </li>
          <li>Install a fresh, dedicated collection with explicit service funding consent.</li>
          <li>Start a new conversation and add the corrected confirmed note.</li>
        </ol>
        <p>
          There is no automatic paid backfill. Existing conversations and independently retained traces are
          unchanged.
        </p>
      </details>
      {error && <ErrorState error={error} />}
      <h4>Capture and cleanup activity</h4>
      {activity.isPending && <Loading label="Loading memory activity…" />}
      {activity.error && <ErrorState error={activity.error} retry={() => void activity.refetch()} />}
      <ul>
        {activity.data?.data.map((item) => (
          <li key={item.id}>
            <code>{item.id.slice(0, 8)}</code> · {item.kind} · {item.state} · external cost{' '}
            {item.receipt?.external_cost_micro_usd === null ||
            item.receipt?.external_cost_micro_usd === undefined
              ? 'unknown'
              : `${item.receipt.external_cost_micro_usd} micro-USD`}
            {item.error_code && (
              <>
                {' '}
                · <code>{item.error_code}</code>
              </>
            )}
            {item.kind === 'capture' && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setSource(
                      await request('getAgentIntegrationSource', {
                        params: { path: { integration_id: installation.id, source_id: item.id } },
                      }),
                    );
                  })
                }
              >
                View source
              </Button>
            )}
            {['unknown', 'failed'].includes(item.state) &&
              (item.kind === 'purge' || item.receipt?.operation_id) && (
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() =>
                    void act(() =>
                      request('retryAgentIntegrationCheck', {
                        params: { path: { integration_id: installation.id, source_id: item.id } },
                      }),
                    )
                  }
                >
                  {item.kind === 'purge' ? 'Retry cleanup' : 'Check existing job'}
                </Button>
              )}
          </li>
        ))}
      </ul>
      <More query={activity} label="Load more activity" />
      <Modal
        open={!!source}
        onOpenChange={(open) => {
          if (!open) setSource(undefined);
        }}
        title="Captured conversation source"
        description="This is the source Macrofold captured, not a complete export of the service's generated memories."
      >
        {source?.content ? (
          <pre>
            <code>{source.content}</code>
          </pre>
        ) : (
          <p>Source text is pending, unavailable or erased. Activity retains its receipt.</p>
        )}
      </Modal>
      {!activity.isPending && activity.data?.data.length === 0 && (
        <p>No completed conversations have been captured yet. Start a new conversation after setup.</p>
      )}
      <Button variant="danger" disabled={busy} onClick={() => setForget(true)}>
        Forget service collection
      </Button>
      <Modal
        open={forget}
        onOpenChange={setForget}
        title="Forget this entire memory collection?"
        description="Disables recall immediately and requests deletion of all captured and generated memory in this dedicated service collection. Start a fresh conversation; an active model cannot unsee old context."
      >
        <p>
          Cleanup is confirmed separately in activity. An uncertain provider write can require
          service-operator verification. Existing Run history, traces and provider backups have separate
          retention. You will need a new dedicated collection to enable memory again.
        </p>
        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setForget(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() =>
              void act(async () => {
                await request('forgetAgentIntegrationMemory', {
                  params: {
                    path: { integration_id: installation.id },
                    header: { 'If-Match': `"${installation.revision}"` },
                  },
                  body: { confirm_delete_all: true },
                });
                setForget(false);
              })
            }
          >
            Disable recall and forget all
          </Button>
        </div>
      </Modal>
    </>
  );
}
