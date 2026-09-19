'use client';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { PermissionSettings } from './permission-editor';
import { CopyButton } from './copy-button';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Clock3,
  Download,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  List,
  ArrowUpRight,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, relative, type Schema } from '../lib/client';
import { WorkspaceCard, RunTable } from './dashboard-shared';
import { CreateWorktree } from './create-worktree';
import { FileBrowser } from './files/file-browser';
import './workspaces.css';
import { GitView } from './github';
import { WorkspaceDeletion } from './workspace-deletion';
import { RunComposer } from './run-composer';
import { Select } from './select';
import { TerminalHandoff } from './terminal-handoff';
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
export function WorkspacesView() {
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem('macrofold.workspaces.layout') === 'grid') setLayout('grid');
    } catch {
      /* The list remains usable without storage. */
    }
  }, []);
  function chooseLayout(value: 'list' | 'grid') {
    setLayout(value);
    try {
      localStorage.setItem('macrofold.workspaces.layout', value);
    } catch {
      /* Keep the current page preference. */
    }
  }
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [search, setSearch] = useState(''),
    [view, setView] = useState('active'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const workspaces = useDataPages({
    operation: 'listWorkspaces',
    params: { query: { limit: 25, archived: view === 'archived', query: search } },
  });
  const client = useQueryClient(),
    router = useRouter();
  const emptyWorkspaces = (
    <Empty
      icon={<FolderOpen />}
      title={
        search ? 'No matching workspaces' : view === 'archived' ? 'No archived workspaces' : 'No workspaces yet'
      }
      description={
        search ? 'Try a different workspace name.' : 'Create a workspace to give your agents a place to work.'
      }
    />
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="PERSISTENT BY DESIGN"
        title="Workspaces"
        description="A place for your agents to work, learn, and pick up where they left off."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            New workspace
          </Button>
        }
      />
      <div className="view-toolbar workspaces-toolbar">
        <div className="search-input input-surface">
          <Search size={17} />
          <input
            aria-label="Search workspaces"
            placeholder="Search workspaces…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Workspace status"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'active', label: 'Active workspaces' },
            { value: 'archived', label: 'Archived & pending deletion' },
          ]}
        />
        <div className="view-switcher" role="group" aria-label="Workspace layout">
          <button
            aria-label="List view"
            title="List view"
            aria-pressed={layout === 'list'}
            onClick={() => chooseLayout('list')}
          >
            <List size={16} />
          </button>
          <button
            aria-label="Grid view"
            title="Grid view"
            aria-pressed={layout === 'grid'}
            onClick={() => chooseLayout('grid')}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>
      {workspaces.isPending ? (
        <Loading />
      ) : workspaces.error ? (
        <ErrorState error={workspaces.error} retry={() => workspaces.refetch()} />
      ) : layout === 'list' ? (
        <div className="workspace-list" role="region" aria-label="Workspace list">
          <div className="workspace-list-heading" aria-hidden="true">
            <span>Workspace</span>
            <span className="workspace-list-branch">Branch</span>
            <span>Status</span>
            <span className="workspace-list-updated">Created</span>
            <span />
          </div>
          {workspaces.data?.data.map((workspace, index) => (
            <Link className="workspace-list-row" href={`/workspaces/${workspace.id}`} key={workspace.id}>
              <div className="workspace-list-name">
                <span className={`workspace-icon color-${index % 4}`}>
                  <FolderOpen size={18} />
                </span>
                <h3>{workspace.name}</h3>
              </div>
              <span className="workspace-list-branch">
                <GitBranch size={13} />
                {workspace.github?.target_branch ?? 'main'}
              </span>
              <span>
                {workspace.deletion_due_at ? 'Pending deletion' : workspace.archived ? 'Archived' : 'Active'}
              </span>
              <span className="workspace-list-updated">{relative(workspace.created_at)}</span>
              <ArrowUpRight size={15} />
            </Link>
          ))}
          {!workspaces.data?.data.length && emptyWorkspaces}
        </div>
      ) : (
        <div className="workspace-grid full-grid">
          {workspaces.data?.data.map((p, i) => (
            <WorkspaceCard workspace={p} index={i} key={p.id} />
          ))}
          {!workspaces.data?.data.length && emptyWorkspaces}
          <button className="workspace-card new-workspace" onClick={() => setOpen(true)}>
            <span>
              <Plus size={24} />
            </span>
            <strong>Create a workspace</strong>
            <p>Start something worth keeping.</p>
          </button>
        </div>
      )}
      <More query={workspaces} label="More workspaces" />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create a workspace"
        description="Your files and agent conversations will persist in this workspace."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const workspace = await api<Schema['Workspace']>('/v1/workspaces', 'POST', {
                name,
                persistence: 'persistent',
              });
              await client.invalidateQueries();
              setOpen(false);
              router.push(`/workspaces/${workspace.id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Workspace name">
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="e.g. Research workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="info-note">
            <GitBranch size={18} />
            <p>
              Your workspace starts with a main worktree. Create independent worktrees for parallel agent tasks.
            </p>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
export function WorktreeView({ workspaceId, worktreeId }: { workspaceId: string; worktreeId?: string }) {
  const workspace = useData({ operation: 'getWorkspace', params: { path: { workspace_id: workspaceId } } });
  const worktrees = useDataPages({
    operation: 'listWorktrees',
    params: { path: { workspace_id: workspaceId } },
  });
  const chosen = worktreeId || workspace.data?.default_worktree_id || worktrees.data?.data[0]?.id;
  const worktree = useData(
    chosen ? { operation: 'getWorktree', params: { path: { worktree_id: chosen } } } : undefined,
  );
  const router = useRouter();
  const [tab, setTab] = useState('files'),
    [compose, setCompose] = useState(false),
    [create, setCreate] = useState(false),
    [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('tab') === 'git') setTab('git');
  }, []);
  if (workspace.isPending || worktrees.isPending) return <Loading />;
  if (workspace.error || worktrees.error) return <ErrorState error={(workspace.error || worktrees.error)!} />;
  if (chosen && worktree.isPending) return <Loading />;
  if (worktree.error) return <ErrorState error={worktree.error} retry={() => void worktree.refetch()} />;
  if (worktree.data && worktree.data.workspace_id !== workspaceId)
    return <ErrorState error={new Error('This worktree belongs to a different workspace.')} />;
  return (
    <div className={`page workspace-detail ${tab === 'files' ? 'workspace-files-page' : ''}`}>
      <Link className="back-link" href="/workspaces">
        <ArrowLeft size={14} />
        All workspaces
      </Link>
      <PageHeading
        title={workspace.data!.name}
        description="Files, conversations, and independent branches for your agents."
        action={
          <div className="button-row">
            {chosen && <TerminalHandoff workspaceId={workspaceId} worktreeId={chosen} />}
            <Button
              onClick={() => setCompose(true)}
              disabled={!chosen || workspace.data!.archived || hasDraft}
              title={hasDraft ? 'Save or discard your draft first' : undefined}
            >
              <Play size={15} />
              New run
            </Button>
          </div>
        }
      />
      {workspace.data!.deletion_due_at && (
        <div className="form-error" role="status">
          Deletion is scheduled for {new Date(workspace.data!.deletion_due_at).toLocaleString()}. Open Settings
          to undo it.
        </div>
      )}
      <div className="worktree-bar">
        <div className="worktree-selector">
          <GitBranch size={16} />
          <Select
            aria-label="Active worktree"
            disabled={hasDraft}
            value={chosen || ''}
            onValueChange={(next) => router.push(`/workspaces/${workspaceId}/worktrees/${next}`)}
            options={[
              ...(worktrees.data?.data.map((ws) => ({
                value: ws.id,
                label: (
                  <>
                    {ws.name ?? `Untitled worktree · ${ws.id.slice(-6)}`}
                    {ws.branch ? ` · ${ws.branch}` : ''}
                  </>
                ),
              })) ?? []),
            ]}
          />
          <More query={worktrees} label="More worktrees" />
          <Button variant="ghost" onClick={() => setCreate(true)} disabled={hasDraft}>
            <Plus size={15} />
            Worktree
          </Button>
        </div>
        <div className="worktree-meta">
          {worktree.data && (
            <>
              <Badge status={worktree.data.status} />
              <span>Revision {worktree.data.revision}</span>
            </>
          )}
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Workspace sections">
        {['files', 'runs', 'checkpoints', 'git', 'settings'].map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'selected' : ''}
            onClick={() => {
              if (hasDraft) {
                toast.error('Save or discard your draft before switching tabs.');
                return;
              }
              setTab(name);
            }}
          >
            {name === 'git' ? 'Git sync' : name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {chosen &&
        worktree.data &&
        (tab === 'files' ? (
          <FileBrowser key={worktree.data.id} worktree={worktree.data} onDirtyChange={setHasDraft} />
        ) : tab === 'runs' ? (
          <WorktreeRuns worktreeId={chosen} />
        ) : tab === 'checkpoints' ? (
          <Checkpoints worktree={worktree.data} />
        ) : tab === 'git' ? (
          <GitView workspace={workspace.data!} worktree={worktree.data} />
        ) : (
          <>
            <WorkspaceSettings workspace={workspace.data!} />
            <PermissionSettings
              key={worktree.data.id}
              scope="worktree"
              id={worktree.data.id}
              value={worktree.data.permissions}
            />
          </>
        ))}
      <RunComposer open={compose} onOpenChange={setCompose} worktreeId={chosen} />
      {create && (
        <CreateWorktree
          workspaceId={workspaceId}
          source={worktree.data}
          open={create}
          onOpenChange={setCreate}
        />
      )}
    </div>
  );
}
function WorktreeRuns({ worktreeId }: { worktreeId: string }) {
  const runs = useDataPages({ operation: 'listRuns', params: { query: { worktree_id: worktreeId } } });
  return runs.isPending ? (
    <Loading />
  ) : runs.error ? (
    <ErrorState error={runs.error} />
  ) : (
    <>
      <RunTable runs={runs.data?.data || []} />
      <More query={runs} label="Older runs" />
    </>
  );
}
function Checkpoints({ worktree }: { worktree: Schema['Worktree'] }) {
  const query = useDataPages({
    operation: 'listCheckpoints',
    params: { path: { worktree_id: worktree.id } },
  });
  const [restore, setRestore] = useState<Schema['Checkpoint']>(),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  async function change(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await client.invalidateQueries();
      toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SectionHeading
        title="Recovery points"
        description="Verified snapshots of your files. Restore whenever you need to."
        action={
          <Button
            variant="secondary"
            disabled={worktree.status === 'busy'}
            busy={busy}
            onClick={() =>
              change(
                () => api(`/v1/worktrees/${worktree.id}/checkpoints`, 'POST', {}),
                'Checkpoint created',
              )
            }
          >
            <Plus size={15} />
            Create checkpoint
          </Button>
        }
      />
      {query.isPending ? (
        <Loading />
      ) : (
        <div className="checkpoint-list">
          {query.data?.data.map((cp) => (
            <div className="checkpoint-row" key={cp.id}>
              <div className="checkpoint-icon">
                <Clock3 size={19} />
              </div>
              <div className="checkpoint-label">
                <strong>
                  {cp.id === worktree.latest_checkpoint_id
                    ? 'Latest checkpoint'
                    : `Checkpoint ${cp.id.slice(-8)}`}
                </strong>
                <span>
                  {relative(cp.created_at)} · {Math.ceil(Number(cp.size_bytes || 0) / 1024)} KB ·{' '}
                  {cp.consistency.replace('_', ' ')}
                </span>
              </div>
              <Badge status={cp.verification} />
              <button
                className={`icon-button ${cp.pinned ? 'is-pinned' : ''}`}
                aria-label={cp.pinned ? 'Unpin checkpoint' : 'Pin checkpoint'}
                onClick={() =>
                  change(
                    () => api(`/v1/checkpoints/${cp.id}`, 'PATCH', { pinned: !cp.pinned }),
                    cp.pinned ? 'Checkpoint unpinned' : 'Checkpoint pinned',
                  )
                }
              >
                <Pin size={15} />
              </button>
              <Button variant="ghost" onClick={() => setRestore(cp)} disabled={worktree.status === 'busy'}>
                <RotateCcw size={14} />
                Restore
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    const op = await api<Schema['ExportOperation']>(
                      `/v1/checkpoints/${cp.id}/exports`,
                      'POST',
                      { format: 'portable_archive' },
                    );
                    if (op.result) location.assign(op.result.download_url);
                    else toast.info('Export queued.');
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Download size={14} />
                Export
              </Button>
            </div>
          ))}
        </div>
      )}
      <More query={query} label="Older checkpoints" />
      <Modal
        open={Boolean(restore)}
        onOpenChange={() => setRestore(undefined)}
        title="Restore this checkpoint?"
        description="Current files will be checkpointed first, then replaced by this snapshot. Agent history remains available."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRestore(undefined)}>
            Cancel
          </Button>
          <Button
            busy={busy}
            onClick={() =>
              change(async () => {
                await api(`/v1/worktrees/${worktree.id}/restore`, 'POST', { checkpoint_id: restore!.id });
                setRestore(undefined);
              }, 'Worktree restored')
            }
          >
            Restore worktree
          </Button>
        </div>
      </Modal>
    </div>
  );
}
function WorkspaceSettings({ workspace }: { workspace: Schema['Workspace'] }) {
  const [name, setName] = useState(workspace.name),
    [archive, setArchive] = useState(false);
  const client = useQueryClient(),
    router = useRouter();
  return (
    <div className="settings-stack">
      <div className="panel">
        <h2>Workspace details</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await request('updateWorkspace', {
                params: { path: { workspace_id: workspace.id } },
                body: { name },
              });
              await client.invalidateQueries();
              toast.success('Workspace updated');
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Field label="Workspace name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Workspace ID">
            <div className="copy-field">
              <code>{workspace.id}</code>
              <CopyButton
                variant="plain"
                className="icon-button"
                label="Copy workspace ID"
                text={workspace.id}
                iconOnly
              />
            </div>
          </Field>
          <Button type="submit">Save changes</Button>
        </form>
      </div>
      <PermissionSettings scope="workspace" id={workspace.id} value={workspace.permissions} />
      <WorkspaceDeletion workspace={workspace} />
      <div className="panel danger-panel">
        <h2>Archive workspace</h2>
        <p>Stop new work while retaining files and history.</p>
        {workspace.archived ? (
          <Button
            variant="secondary"
            disabled={!!workspace.deletion_due_at}
            onClick={async () => {
              try {
                await request('updateWorkspace', {
                  params: { path: { workspace_id: workspace.id } },
                  body: { archived: false },
                });
                await client.invalidateQueries();
                toast.success('Workspace restored');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Restore archived workspace
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setArchive(true)}>
            Archive workspace
          </Button>
        )}
      </div>
      <Modal
        open={archive}
        onOpenChange={setArchive}
        title="Archive this workspace?"
        description="Cancel any pending runs first. Existing checkpoints and history will remain stored."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setArchive(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await request('deleteWorkspace', { params: { path: { workspace_id: workspace.id } } });
                await client.invalidateQueries();
                router.push('/workspaces');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <Archive size={15} />
            Archive workspace
          </Button>
        </div>
      </Modal>
    </div>
  );
}
