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
import { ProjectCard, RunTable } from './dashboard-shared';
import { CreateWorktree } from './create-worktree';
import { FileBrowser } from './files/file-browser';
import './projects.css';
import { GitView } from './github';
import { ProjectDeletion } from './project-deletion';
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
export function ProjectsView() {
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem('macrofold.projects.layout') === 'grid') setLayout('grid');
    } catch {
      /* The list remains usable without storage. */
    }
  }, []);
  function chooseLayout(value: 'list' | 'grid') {
    setLayout(value);
    try {
      localStorage.setItem('macrofold.projects.layout', value);
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
  const projects = useDataPages({
    operation: 'listProjects',
    params: { query: { limit: 25, archived: view === 'archived', query: search } },
  });
  const client = useQueryClient(),
    router = useRouter();
  const emptyProjects = (
    <Empty
      icon={<FolderOpen />}
      title={
        search ? 'No matching projects' : view === 'archived' ? 'No archived projects' : 'No projects yet'
      }
      description={
        search ? 'Try a different project name.' : 'Create a project to give your agents a place to work.'
      }
    />
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="PERSISTENT BY DESIGN"
        title="Projects"
        description="A place for your agents to work, learn, and pick up where they left off."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            New project
          </Button>
        }
      />
      <div className="view-toolbar projects-toolbar">
        <div className="search-input input-surface">
          <Search size={17} />
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Project status"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'active', label: 'Active projects' },
            { value: 'archived', label: 'Archived & pending deletion' },
          ]}
        />
        <div className="view-switcher" role="group" aria-label="Project layout">
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
      {projects.isPending ? (
        <Loading />
      ) : projects.error ? (
        <ErrorState error={projects.error} retry={() => projects.refetch()} />
      ) : layout === 'list' ? (
        <div className="project-list" role="region" aria-label="Project list">
          <div className="project-list-heading" aria-hidden="true">
            <span>Project</span>
            <span className="project-list-branch">Branch</span>
            <span>Status</span>
            <span className="project-list-updated">Created</span>
            <span />
          </div>
          {projects.data?.data.map((project, index) => (
            <Link className="project-list-row" href={`/projects/${project.id}`} key={project.id}>
              <div className="project-list-name">
                <span className={`project-icon color-${index % 4}`}>
                  <FolderOpen size={18} />
                </span>
                <h3>{project.name}</h3>
              </div>
              <span className="project-list-branch">
                <GitBranch size={13} />
                {project.github?.target_branch ?? 'main'}
              </span>
              <span>
                {project.deletion_due_at ? 'Pending deletion' : project.archived ? 'Archived' : 'Active'}
              </span>
              <span className="project-list-updated">{relative(project.created_at)}</span>
              <ArrowUpRight size={15} />
            </Link>
          ))}
          {!projects.data?.data.length && emptyProjects}
        </div>
      ) : (
        <div className="project-grid full-grid">
          {projects.data?.data.map((p, i) => (
            <ProjectCard project={p} index={i} key={p.id} />
          ))}
          {!projects.data?.data.length && emptyProjects}
          <button className="project-card new-project" onClick={() => setOpen(true)}>
            <span>
              <Plus size={24} />
            </span>
            <strong>Create a project</strong>
            <p>Start something worth keeping.</p>
          </button>
        </div>
      )}
      <More query={projects} label="More projects" />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create a project"
        description="Your files and agent conversations will persist in this project."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const project = await api<Schema['Project']>('/v1/projects', 'POST', {
                name,
                persistence: 'persistent',
              });
              await client.invalidateQueries();
              setOpen(false);
              router.push(`/projects/${project.id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Project name">
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="e.g. Research project"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="info-note">
            <GitBranch size={18} />
            <p>
              Your project starts with a main worktree. Create independent worktrees for parallel agent tasks.
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
              Create project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
export function WorkspaceView({ projectId, workspaceId }: { projectId: string; workspaceId?: string }) {
  const project = useData({ operation: 'getProject', params: { path: { project_id: projectId } } });
  const workspaces = useDataPages({
    operation: 'listWorkspaces',
    params: { path: { project_id: projectId } },
  });
  const chosen = workspaceId || project.data?.default_workspace_id || workspaces.data?.data[0]?.id;
  const workspace = useData(
    chosen ? { operation: 'getWorkspace', params: { path: { workspace_id: chosen } } } : undefined,
  );
  const router = useRouter();
  const [tab, setTab] = useState('files'),
    [compose, setCompose] = useState(false),
    [create, setCreate] = useState(false),
    [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('tab') === 'git') setTab('git');
  }, []);
  if (project.isPending || workspaces.isPending) return <Loading />;
  if (project.error || workspaces.error) return <ErrorState error={(project.error || workspaces.error)!} />;
  if (chosen && workspace.isPending) return <Loading />;
  if (workspace.error) return <ErrorState error={workspace.error} retry={() => void workspace.refetch()} />;
  if (workspace.data && workspace.data.project_id !== projectId)
    return <ErrorState error={new Error('This worktree belongs to a different project.')} />;
  return (
    <div className={`page project-detail ${tab === 'files' ? 'project-files-page' : ''}`}>
      <Link className="back-link" href="/projects">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <PageHeading
        title={project.data!.name}
        description="Files, conversations, and independent branches for your agents."
        action={
          <div className="button-row">
            {chosen && <TerminalHandoff projectId={projectId} workspaceId={chosen} />}
            <Button
              onClick={() => setCompose(true)}
              disabled={!chosen || project.data!.archived || hasDraft}
              title={hasDraft ? 'Save or discard your draft first' : undefined}
            >
              <Play size={15} />
              New run
            </Button>
          </div>
        }
      />
      {project.data!.deletion_due_at && (
        <div className="form-error" role="status">
          Deletion is scheduled for {new Date(project.data!.deletion_due_at).toLocaleString()}. Open Settings
          to undo it.
        </div>
      )}
      <div className="workspace-bar">
        <div className="workspace-selector">
          <GitBranch size={16} />
          <Select
            aria-label="Active worktree"
            disabled={hasDraft}
            value={chosen || ''}
            onValueChange={(next) => router.push(`/projects/${projectId}/workspaces/${next}`)}
            options={[
              ...(workspaces.data?.data.map((ws) => ({
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
          <More query={workspaces} label="More worktrees" />
          <Button variant="ghost" onClick={() => setCreate(true)} disabled={hasDraft}>
            <Plus size={15} />
            Worktree
          </Button>
        </div>
        <div className="workspace-meta">
          {workspace.data && (
            <>
              <Badge status={workspace.data.status} />
              <span>Revision {workspace.data.revision}</span>
            </>
          )}
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Project sections">
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
        workspace.data &&
        (tab === 'files' ? (
          <FileBrowser key={workspace.data.id} workspace={workspace.data} onDirtyChange={setHasDraft} />
        ) : tab === 'runs' ? (
          <WorkspaceRuns workspaceId={chosen} />
        ) : tab === 'checkpoints' ? (
          <Checkpoints workspace={workspace.data} />
        ) : tab === 'git' ? (
          <GitView project={project.data!} workspace={workspace.data} />
        ) : (
          <>
            <ProjectSettings project={project.data!} />
            <PermissionSettings
              key={workspace.data.id}
              scope="worktree"
              id={workspace.data.id}
              value={workspace.data.permissions}
            />
          </>
        ))}
      <RunComposer open={compose} onOpenChange={setCompose} workspaceId={chosen} />
      {create && (
        <CreateWorktree
          projectId={projectId}
          source={workspace.data}
          open={create}
          onOpenChange={setCreate}
        />
      )}
    </div>
  );
}
function WorkspaceRuns({ workspaceId }: { workspaceId: string }) {
  const runs = useDataPages({ operation: 'listRuns', params: { query: { workspace_id: workspaceId } } });
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
function Checkpoints({ workspace }: { workspace: Schema['Workspace'] }) {
  const query = useDataPages({
    operation: 'listCheckpoints',
    params: { path: { workspace_id: workspace.id } },
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
            disabled={workspace.status === 'busy'}
            busy={busy}
            onClick={() =>
              change(
                () => api(`/v1/workspaces/${workspace.id}/checkpoints`, 'POST', {}),
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
                  {cp.id === workspace.latest_checkpoint_id
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
              <Button variant="ghost" onClick={() => setRestore(cp)} disabled={workspace.status === 'busy'}>
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
                await api(`/v1/workspaces/${workspace.id}/restore`, 'POST', { checkpoint_id: restore!.id });
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
function ProjectSettings({ project }: { project: Schema['Project'] }) {
  const [name, setName] = useState(project.name),
    [archive, setArchive] = useState(false);
  const client = useQueryClient(),
    router = useRouter();
  return (
    <div className="settings-stack">
      <div className="panel">
        <h2>Project details</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await request('updateProject', {
                params: { path: { project_id: project.id } },
                body: { name },
              });
              await client.invalidateQueries();
              toast.success('Project updated');
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Field label="Project name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Project ID">
            <div className="copy-field">
              <code>{project.id}</code>
              <CopyButton
                variant="plain"
                className="icon-button"
                label="Copy project ID"
                text={project.id}
                iconOnly
              />
            </div>
          </Field>
          <Button type="submit">Save changes</Button>
        </form>
      </div>
      <PermissionSettings scope="project" id={project.id} value={project.permissions} />
      <ProjectDeletion project={project} />
      <div className="panel danger-panel">
        <h2>Archive project</h2>
        <p>Stop new work while retaining files and history.</p>
        {project.archived ? (
          <Button
            variant="secondary"
            disabled={!!project.deletion_due_at}
            onClick={async () => {
              try {
                await request('updateProject', {
                  params: { path: { project_id: project.id } },
                  body: { archived: false },
                });
                await client.invalidateQueries();
                toast.success('Project restored');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Restore archived project
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setArchive(true)}>
            Archive project
          </Button>
        )}
      </div>
      <Modal
        open={archive}
        onOpenChange={setArchive}
        title="Archive this project?"
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
                await request('deleteProject', { params: { path: { project_id: project.id } } });
                await client.invalidateQueries();
                router.push('/projects');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <Archive size={15} />
            Archive project
          </Button>
        </div>
      </Modal>
    </div>
  );
}
