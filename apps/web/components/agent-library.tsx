'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import type { Schema } from '../lib/client';
import { Badge, Button, Empty, ErrorState, Field, Loading, Modal, More, PageHeading, Select } from './ui';
import { CopyButton } from './copy-button';
import { MemoryServiceSetup, type MemoryServiceSetupValue } from './memory-service-setup';
import { MemoryServiceControls } from './memory-service-controls';

type Installation = Schema['AgentIntegration'];

function InstallMemory({
  pack,
  close,
  installed,
}: {
  pack: Installation['pack_id'];
  close: () => void;
  installed: () => Promise<void>;
}) {
  const [service, setService] = useState<MemoryServiceSetupValue>({
    connection_id: '',
    namespace: pack === 'hindsight' ? 'mf-' + crypto.randomUUID() : '',
    required: false,
    external_cost_acknowledged: false,
    namespace_is_dedicated: false,
  });
  const remote = pack !== 'file-memory';
  const workspaces = useDataPages({ operation: 'listWorkspaces', params: { query: { limit: 100 } } });
  const [workspace, setWorkspace] = useState('');
  const [worktree, setWorktree] = useState('');
  const trees = useDataPages(
    workspace
      ? { operation: 'listWorktrees', params: { path: { workspace_id: workspace }, query: { limit: 100 } } }
      : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={
        remote ? `Set up ${pack === 'hindsight' ? 'Hindsight' : 'Claude-mem'} memory` : 'Add editable memory'
      }
      description="Choose one worktree. Separate worktrees keep separate memory, including customer-agent worktrees."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            if (
              remote &&
              (!service.connection_id ||
                !service.namespace ||
                !service.namespace_is_dedicated ||
                !service.external_cost_acknowledged)
            )
              throw new Error('Choose a dedicated service collection and approve external service costs.');
            await request('createAgentIntegration', {
              body: {
                workspace_id: workspace,
                worktree_id: worktree,
                pack_id: pack,
                ...(remote
                  ? {
                      service: { ...service, external_cost_acknowledged: true, namespace_is_dedicated: true },
                    }
                  : {}),
              },
            });
            await installed();
            close();
          } catch (failure) {
            setError(failure);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Workspace">
          <Select
            value={workspace || '__none'}
            onValueChange={(value) => {
              setWorkspace(value === '__none' ? '' : value);
              setWorktree('');
            }}
            options={[
              { value: '__none', label: 'Choose a workspace' },
              ...(workspaces.data?.data ?? []).map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
        {workspaces.isPending && <Loading label="Loading workspaces…" />}
        {workspaces.error && <ErrorState error={workspaces.error} retry={() => void workspaces.refetch()} />}
        <More query={workspaces} label="Load more workspaces" />
        {workspace && (
          <>
            <Field label="Worktree" hint="Use an idle worktree; existing notes are preserved.">
              <Select
                value={worktree || '__none'}
                onValueChange={(value) => setWorktree(value === '__none' ? '' : value)}
                options={[
                  { value: '__none', label: 'Choose a worktree' },
                  ...(trees.data?.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name || item.branch || 'Unnamed worktree',
                  })),
                ]}
              />
            </Field>
            {trees.isPending && <Loading label="Loading worktrees…" />}
            {trees.error && <ErrorState error={trees.error} retry={() => void trees.refetch()} />}
            <More query={trees} label="Load more worktrees" />
          </>
        )}
        {remote && (
          <MemoryServiceSetup
            provider={pack as 'hindsight' | 'claude-mem'}
            value={service}
            onChange={(patch) => setService((current) => ({ ...current, ...patch }))}
          />
        )}
        {!remote && (
          <p>
            Creates missing <code>profile.md</code>, <code>memory/README.md</code> and <code>tasks.json</code>
            . Your agent receives memory guidance on its next Run. Normal file permissions and Run charges
            still apply.
          </p>
        )}
        {!remote && (
          <details>
            <summary>What this does</summary>
            <p>
              Small, editable preferences, notes and tasks across conversations. Updates and recall depend on
              agent instructions. This pack has no background model or semantic index.
            </p>
          </details>
        )}
        {error !== undefined && (
          <ErrorState
            error={error instanceof Error ? error : new Error('The operation failed. Refresh and try again.')}
          />
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            busy={busy}
            disabled={
              !workspace ||
              !worktree ||
              (remote &&
                (!service.connection_id ||
                  !service.namespace ||
                  !service.namespace_is_dedicated ||
                  !service.external_cost_acknowledged))
            }
          >
            Add memory
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InstalledMemory({ item, refresh }: { item: Installation; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [remove, setRemove] = useState(false);
  const [inspect, setInspect] = useState(false);
  const memories = useDataPages(
    inspect && item.pack_id === 'file-memory'
      ? {
          operation: 'listAgentIntegrationMemories',
          params: { path: { integration_id: item.id }, query: { limit: 100 } },
        }
      : undefined,
  );
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      await refresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const state = (next: Installation['state']) =>
    act(() =>
      request('updateAgentIntegration', {
        params: { path: { integration_id: item.id }, header: { 'If-Match': `"${item.revision}"` } },
        body: { state: next },
      }),
    );
  return (
    <section
      className="panel"
      aria-label={`Installed ${item.pack_id === 'file-memory' ? 'editable memory' : item.pack_id}`}
    >
      <div className="section-heading">
        <h3>
          {item.pack_id === 'file-memory'
            ? 'Editable memory'
            : item.pack_id === 'hindsight'
              ? 'Hindsight'
              : 'Claude-mem'}
        </h3>
        <Badge status={item.detached ? 'Detached' : item.retired ? 'Retired' : item.state} />
      </div>
      {item.pack_id === 'file-memory' && (
        <p>
          <Link href={`/workspaces/${item.workspace_id}/worktrees/${item.worktree_id}`}>
            Open worktree and edit memory files
          </Link>
        </p>
      )}
      <p className="form-hint">
        {item.detached
          ? 'This installation is detached. Only its owner can inspect, export and request cleanup; recall and learning are stopped.'
          : item.retired
            ? 'This collection is permanently retired. Verify cleanup, then install a fresh dedicated collection and start a new conversation.'
            : item.state === 'active'
              ? 'Memory guidance is included in new Runs.'
              : item.state === 'paused'
                ? 'Read existing memory; instructions ask the agent to stop adding notes.'
                : 'Memory guidance is disabled. Current files remain.'}{' '}
        Start a fresh conversation after changing memory settings. An active model cannot unsee earlier
        context.
      </p>
      {item.pack_id !== 'file-memory' && inspect && (
        <MemoryServiceControls installation={item} refresh={refresh} />
      )}
      <div className="form-actions">
        <Button variant="secondary" disabled={busy} onClick={() => setInspect(!inspect)}>
          {inspect ? 'Hide memory' : 'View memory'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || item.detached || item.retired}
          onClick={() => void state(item.state === 'active' ? 'paused' : 'active')}
        >
          {item.state === 'active' ? 'Pause learning' : 'Enable'}
        </Button>
        {item.state !== 'disabled' && (
          <Button variant="ghost" disabled={busy} onClick={() => void state('disabled')}>
            Disable
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const data = await request('exportAgentIntegrationMemory', {
                params: { path: { integration_id: item.id } },
              });
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'agent-memory.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
          }
        >
          {item.pack_id === 'file-memory' ? 'Export current files' : 'Export captured sources'}
        </Button>
        <Button variant="ghost" disabled={busy || item.detached} onClick={() => setRemove(true)}>
          Remove
        </Button>
      </div>
      {busy && <Loading label="Updating memory…" />}
      {error !== undefined && (
        <ErrorState
          error={error instanceof Error ? error : new Error('The operation failed. Refresh and try again.')}
        />
      )}
      {inspect && item.pack_id === 'file-memory' && (
        <>
          {memories.isPending && <Loading label="Loading memory files…" />}
          {memories.error && <ErrorState error={memories.error} retry={() => void memories.refetch()} />}
          <ul>
            {memories.data?.data.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code> · {file.size_bytes} bytes
              </li>
            ))}
          </ul>
          <More query={memories} label="Load more memory files" />
          <p>
            Edit or delete a note in the worktree file browser. Deleting current files does not erase older
            checkpoints, conversations or provider records.
          </p>
        </>
      )}
      <details>
        <summary>Use from your application</summary>
        <pre>
          <code>{`macrofold integration get ${item.id}\nmacrofold integration memories ${item.id}\nmacrofold integration export ${item.id} --json`}</code>
        </pre>
        <CopyButton
          text={`macrofold integration get ${item.id}\nmacrofold integration memories ${item.id}\nmacrofold integration export ${item.id} --json`}
        />
      </details>
      <Modal
        open={remove}
        onOpenChange={setRemove}
        title={
          item.pack_id === 'file-memory' ? 'Remove editable memory?' : 'Detach this memory installation?'
        }
        description={
          item.pack_id === 'file-memory'
            ? 'Stops future memory guidance for this worktree. Your files, checkpoints and past conversations remain.'
            : 'Stops recall and automatic capture. Retained sources and external service data remain; this owner-only record stays available for export and explicit cleanup.'
        }
      >
        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setRemove(false)}>
            Keep memory
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() =>
              void act(() =>
                request('deleteAgentIntegration', { params: { path: { integration_id: item.id } } }),
              )
            }
          >
            Remove installation
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function AgentLibrary() {
  const catalog = useData({ operation: 'listIntegrationPacks' });
  const installations = useDataPages({
    operation: 'listAgentIntegrations',
    params: { query: { limit: 100 } },
  });
  const [install, setInstall] = useState<Installation['pack_id'] | null>(null);
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === 'string' &&
        (query.queryKey[0].startsWith('/v1/agent-integrations') || query.queryKey[0].includes('/worktrees')),
    });
  };
  return (
    <>
      <PageHeading
        title="Agent library"
        description="Optional capabilities for your agents. Add only what a worktree needs; existing permissions and budgets remain in control."
      />
      {catalog.isPending && <Loading label="Loading capabilities…" />}
      {catalog.error && <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />}
      <div className="connections-grid">
        {catalog.data?.data.map((pack) => (
          <section className="panel" key={pack.id}>
            <BookOpen size={22} />
            <h2>{pack.name}</h2>
            <p>{pack.summary}</p>
            <p className="form-hint">{pack.capture}</p>
            <details>
              <summary>Costs and setup</summary>
              <p>{pack.funding}</p>
            </details>
            {pack.availability === 'available' ? (
              <Button onClick={() => setInstall(pack.id)}>Add memory</Button>
            ) : (
              <Button variant="secondary" onClick={() => setInstall(pack.id)}>
                Set up service memory
              </Button>
            )}
          </section>
        ))}
      </div>
      <h2>Installed capabilities</h2>
      {installations.isPending && <Loading label="Loading installations…" />}
      {installations.error && (
        <ErrorState error={installations.error} retry={() => void installations.refetch()} />
      )}
      {installations.data && !installations.data.data.length && (
        <Empty
          icon={<BookOpen />}
          title="No capabilities installed"
          description="Start with editable memory for one worktree. You can inspect and remove it later."
        />
      )}
      {installations.data?.data.map((item) => (
        <InstalledMemory key={item.id} item={item} refresh={refresh} />
      ))}
      <More query={installations} label="Load more installations" />
      {install && <InstallMemory pack={install} close={() => setInstall(null)} installed={refresh} />}
    </>
  );
}
