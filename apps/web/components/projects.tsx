'use client';
import { copyText } from '../lib/clipboard';
import { markdown } from '@codemirror/lang-markdown';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Clock3,
  Copy,
  Download,
  File,
  FolderOpen,
  GitBranch,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, relative, useApi, usePages, type Schema } from '../lib/client';
import { ProjectCard, RunTable } from './dashboard-shared';
import { FileUpload } from './file-upload';
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
const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false, loading: () => <Loading /> });
export function ProjectsView() {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [search, setSearch] = useState(''),
    [view, setView] = useState('active'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const projects = usePages<Schema['Project']>(
    `/v1/projects?limit=25&archived=${view === 'archived'}&query=${encodeURIComponent(search)}`,
  );
  const client = useQueryClient(),
    router = useRouter();
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
      <div className="view-toolbar">
        <div className="search-input">
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
      </div>
      {projects.isPending ? (
        <Loading />
      ) : projects.error ? (
        <ErrorState error={projects.error} retry={() => projects.refetch()} />
      ) : (
        <div className="project-grid full-grid">
          {projects.data?.data
            .filter(
              (p) =>
                (view === 'active' ? !p.archived : p.archived) &&
                p.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((p, i) => (
              <ProjectCard project={p} index={i} key={p.id} />
            ))}
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
              placeholder="e.g. Research workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="info-note">
            <GitBranch size={18} />
            <p>
              Your project starts with a main workspace. Create independent workspaces for parallel agent
              tasks.
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
  const project = useApi<Schema['Project']>(`/v1/projects/${projectId}`);
  const workspaces = usePages<Schema['Workspace']>(`/v1/projects/${projectId}/workspaces`);
  const chosen = workspaceId || project.data?.default_workspace_id || workspaces.data?.data[0]?.id;
  const workspace = useApi<Schema['Workspace']>(chosen ? `/v1/workspaces/${chosen}` : undefined);
  const client = useQueryClient(),
    router = useRouter();
  const [tab, setTab] = useState('files'),
    [compose, setCompose] = useState(false),
    [create, setCreate] = useState(false),
    [hasDraft, setHasDraft] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('tab') === 'git') setTab('git');
  }, []);
  if (project.isPending || workspaces.isPending) return <Loading />;
  if (project.error || workspaces.error) return <ErrorState error={(project.error || workspaces.error)!} />;
  if (chosen && workspace.isPending) return <Loading />;
  if (workspace.error) return <ErrorState error={workspace.error} retry={() => void workspace.refetch()} />;
  if (workspace.data && workspace.data.project_id !== projectId)
    return <ErrorState error={new Error('This workspace belongs to a different project.')} />;
  return (
    <div className="page project-detail">
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
            aria-label="Active workspace"
            disabled={hasDraft}
            value={chosen || ''}
            onValueChange={(next) => router.push(`/projects/${projectId}/workspaces/${next}`)}
            options={[
              ...(workspaces.data?.data.map((ws) => ({
                value: ws.id,
                label: (
                  <>
                    {ws.name} · {ws.branch}
                  </>
                ),
              })) ?? []),
            ]}
          />
          <More query={workspaces} label="More workspaces" />
          <Button variant="ghost" onClick={() => setCreate(true)} disabled={hasDraft}>
            <Plus size={15} />
            Workspace
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
          <FileBrowser workspace={workspace.data} onDirtyChange={setHasDraft} />
        ) : tab === 'runs' ? (
          <WorkspaceRuns workspaceId={chosen} />
        ) : tab === 'checkpoints' ? (
          <Checkpoints workspace={workspace.data} />
        ) : tab === 'git' ? (
          <GitView project={project.data!} workspace={workspace.data} />
        ) : (
          <ProjectSettings project={project.data!} />
        ))}
      <RunComposer open={compose} onOpenChange={setCompose} workspaceId={chosen} />
      <Modal
        open={create}
        onOpenChange={setCreate}
        title="Create an independent workspace"
        description="Branch from your current files and let another agent work in parallel."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const op = await api<Schema['Operation']>(`/v1/projects/${projectId}/workspaces`, 'POST', {
                name,
                branch: name.trim().replaceAll(' ', '-'),
                ...(workspace.data?.latest_checkpoint_id
                  ? { source: { kind: 'checkpoint', checkpoint_id: workspace.data.latest_checkpoint_id } }
                  : {}),
              });
              await client.invalidateQueries();
              setCreate(false);
              router.push(`/projects/${projectId}/workspaces/${op.result?.workspace_id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Workspace name">
            <input
              required
              autoFocus
              placeholder="e.g. explore-search"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && <div className="form-error">{error}</div>}
          <div className="dialog-actions">
            <Button type="submit" busy={busy}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
function FileBrowser({
  workspace,
  onDirtyChange,
}: {
  workspace: Schema['Workspace'];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState(''),
    [text, setText] = useState(''),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState(workspace.revision),
    [saving, setSaving] = useState(false),
    [newFile, setNewFile] = useState(false),
    [path, setPath] = useState(''),
    [search, setSearch] = useState(''),
    [deleteOpen, setDeleteOpen] = useState(false);
  const listing = usePages<Schema['FileEntry']>(
    `/v1/workspaces/${workspace.id}/files?limit=100&query=${encodeURIComponent(search)}`,
    false,
    'entries',
  );
  const client = useQueryClient();
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const unloading = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigating = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? (event.target.closest('a[href]') as HTMLAnchorElement | null)
          : null;
      if (!link || link.download || link.target === '_blank') return;
      const target = new URL(link.href, location.href);
      if (
        target.pathname.startsWith('/v1/') ||
        target.pathname.startsWith('/objects/') ||
        target.href === location.href
      )
        return;
      if (!window.confirm('Leave this page and discard your unsaved draft?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unloading);
    document.addEventListener('click', navigating, true);
    return () => {
      window.removeEventListener('beforeunload', unloading);
      document.removeEventListener('click', navigating, true);
    };
  }, [dirty]);
  useEffect(() => {
    setSelected('');
    setDirty(false);
  }, [workspace.id]);
  useEffect(() => {
    if (!selected && listing.data?.data.length)
      setSelected(listing.data.data.find((f) => f.path === 'README.md')?.path || listing.data.data[0].path);
  }, [listing.data, selected]);
  const content = useQuery({
    queryKey: ['file', workspace.id, selected],
    enabled:
      Boolean(selected) &&
      Number(listing.data?.data.find((f) => f.path === selected)?.size_bytes || 0) <= 4 * 1024 * 1024,
    queryFn: async () => {
      const response = await fetch(
        `/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(selected)}`,
        { headers: { 'X-Client-Type': 'dashboard' } },
      );
      if (!response.ok) throw new Error('Unable to read this file.');
      return {
        text: await response.text(),
        revision: (response.headers.get('etag') || '').replaceAll('"', ''),
      };
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    // Query invalidation can deliver a newer checkpoint while a local draft is dirty.
    // Keep both the draft and its original revision so Save detects the conflict.
    if (content.data && !dirty) {
      setText(content.data.text);
      setRevision(content.data.revision);
      setDirty(false);
    }
  }, [content.data, dirty]);
  async function save(filePath = selected, value = text, create = false) {
    setSaving(true);
    try {
      if (create) {
        // The visible listing can be filtered or paginated. Check the authoritative
        // path; If-Match below rejects a write if it changes after this check.
        const existing = await fetch(
          `/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(filePath)}`,
        );
        await existing.body?.cancel();
        if (existing.ok)
          throw new Error(
            'A file already exists at this path. Choose another name or edit the existing file.',
          );
        if (existing.status !== 404) throw new Error('Unable to check this path. No file was created.');
      }
      await api(`/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(filePath)}`, 'PUT', value, {
        'Content-Type': 'application/octet-stream',
        'If-Match': filePath === selected ? revision : workspace.revision,
      });
      setDirty(false);
      await client.invalidateQueries();
      if (create) setNewFile(false);
      setSelected(filePath);
      toast.success('File saved and checkpointed');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (listing.error) return <ErrorState error={listing.error} />;
  return (
    <>
      <div className="file-browser">
        <div className="file-tree">
          <div className="file-tree-heading">
            <strong>Explorer</strong>
            <FileUpload workspace={workspace} disabled={workspace.status === 'busy' || dirty || saving} />
            <button
              className="icon-button"
              title="New file"
              aria-label="New file"
              disabled={workspace.status === 'busy' || dirty || saving}
              onClick={() => setNewFile(true)}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="file-search">
            <Search size={13} />
            <input
              aria-label="Filter files"
              placeholder="Filter files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {listing.data?.data
            .filter((f) => f.path.toLowerCase().includes(search.toLowerCase()))
            .map((file) => (
              <button
                className={`file-row ${selected === file.path ? 'selected' : ''}`}
                key={file.path}
                disabled={saving}
                onClick={() => {
                  if (dirty) {
                    toast.error('Save your changes before opening another file.');
                    return;
                  }
                  setSelected(file.path);
                }}
              >
                <File size={15} />
                <span>{file.path}</span>
              </button>
            ))}
          {!listing.data?.data.length && (
            <p className="file-tree-empty">No files yet. Add your first file or start an agent run.</p>
          )}
          <More query={listing} label="More files" />
          <div className="file-tree-footer">
            <span className="tiny-dot" />
            {dirty
              ? 'Draft not saved'
              : workspace.status === 'busy'
                ? 'Last verified checkpoint'
                : 'All files persisted'}
          </div>
        </div>
        <div className="file-editor">
          {selected ? (
            <>
              <div className="editor-bar">
                <span>
                  <File size={15} />
                  {selected}
                  {dirty && <span className="dirty-dot" title="Unsaved changes" />}
                </span>
                <div>
                  {dirty && (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => {
                        if (window.confirm('Discard your unsaved changes and reload the saved file?')) {
                          setDirty(false);
                          void content.refetch();
                        }
                      }}
                    >
                      Discard
                    </Button>
                  )}
                  <a
                    className="icon-button"
                    aria-label="Download selected file"
                    href={`/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(selected)}&download=true`}
                  >
                    <Download size={15} />
                  </a>
                  <button
                    className="icon-button"
                    aria-label="Delete selected file"
                    onClick={() => setDeleteOpen(true)}
                    disabled={workspace.status === 'busy' || dirty || saving}
                  >
                    <Trash2 size={15} />
                  </button>
                  <Button
                    variant="secondary"
                    busy={saving}
                    disabled={!dirty || workspace.status === 'busy'}
                    onClick={() => save()}
                  >
                    <Save size={14} />
                    Save
                  </Button>
                </div>
              </div>
              {Number(listing.data?.data.find((f) => f.path === selected)?.size_bytes || 0) >
              4 * 1024 * 1024 ? (
                <Empty
                  icon={<File />}
                  title="Large file"
                  description="This file is safely persisted. Download it to open it locally, or ask an agent to work with it."
                  action={
                    <a
                      className="button secondary"
                      href={`/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(selected)}&download=true`}
                    >
                      Download file
                    </a>
                  }
                />
              ) : content.isPending ? (
                <Loading />
              ) : content.error ? (
                <ErrorState error={content.error} />
              ) : text.includes('\0') ? (
                <Empty
                  icon={<File />}
                  title="Binary file"
                  description="Download this file to view it in a compatible application."
                  action={
                    <a
                      className="button secondary"
                      href={`/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(selected)}`}
                    >
                      Download file
                    </a>
                  }
                />
              ) : (
                <CodeMirror
                  value={text}
                  height="480px"
                  extensions={selected.endsWith('.md') ? [markdown()] : []}
                  editable={workspace.status !== 'busy' && !saving}
                  onChange={(value) => {
                    setText(value);
                    setDirty(value !== content.data?.text);
                  }}
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
                  onCreateEditor={(view) => view.contentDOM.setAttribute('aria-label', 'File editor')}
                  aria-label="File editor"
                />
              )}
              <div className="editor-footer">
                <span>
                  {workspace.status === 'busy' ? 'Read only while an agent is working' : 'UTF-8'} ·{' '}
                  {selected.split('.').pop()?.toUpperCase()}
                </span>
                <span>{dirty ? 'Unsaved changes' : `Saved · revision ${revision}`}</span>
              </div>
            </>
          ) : (
            <Empty
              icon={<FolderOpen />}
              title="Your files live here"
              description="Create a file to give your agent some context."
              action={
                <Button
                  variant="secondary"
                  disabled={saving || workspace.status === 'busy'}
                  onClick={() => setNewFile(true)}
                >
                  <Plus size={15} />
                  New file
                </Button>
              }
            />
          )}
        </div>
      </div>
      <Modal
        open={newFile}
        onOpenChange={setNewFile}
        title="Create a file"
        description="Use a relative path. Folders are created automatically."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(path, '', true);
          }}
        >
          <Field label="File path">
            <input
              autoFocus
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="notes/ideas.md"
            />
          </Field>
          <div className="dialog-actions">
            <Button busy={saving} type="submit">
              Create file
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this file?"
        description={`${selected} will be removed from the current workspace. Earlier checkpoints remain available.`}
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            Keep file
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(
                  `/v1/workspaces/${workspace.id}/file?path=${encodeURIComponent(selected)}`,
                  'DELETE',
                  undefined,
                  { 'If-Match': workspace.revision },
                );
                setSelected('');
                setDeleteOpen(false);
                await client.invalidateQueries();
                toast.success('File removed');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Delete file
          </Button>
        </div>
      </Modal>
    </>
  );
}
function WorkspaceRuns({ workspaceId }: { workspaceId: string }) {
  const runs = usePages<Schema['Run']>(`/v1/runs?workspace_id=${workspaceId}`);
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
  const query = usePages<Schema['Checkpoint']>(`/v1/workspaces/${workspace.id}/checkpoints`);
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
              }, 'Workspace restored')
            }
          >
            Restore workspace
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
              await api(`/v1/projects/${project.id}`, 'PATCH', { name });
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
              <button
                type="button"
                className="icon-button"
                aria-label="Copy project ID"
                onClick={() => copyText(project.id, 'Project ID copied')}
              >
                <Copy size={15} />
              </button>
            </div>
          </Field>
          <Button type="submit">Save changes</Button>
        </form>
      </div>
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
                await api(`/v1/projects/${project.id}`, 'PATCH', { archived: false });
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
                await api(`/v1/projects/${project.id}`, 'DELETE');
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
