'use client';
import { Select } from './select';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  GitPullRequest,
  ArrowDownToLine,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, type Schema } from '../lib/client';
import { Badge, Button, Field, Modal } from './ui';
export function GitView({
  project,
  workspace,
}: {
  project: Schema['Project'];
  workspace: Schema['Workspace'];
}) {
  const client = useQueryClient();
  const sync = useApi<Schema['GitSync']>(`/v1/workspaces/${workspace.id}/sync`, 5000);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [installation, setInstallation] = useState(''),
    [repository, setRepository] = useState(''),
    [branch, setBranch] = useState('main'),
    [error, setError] = useState(''),
    [autoSync, setAutoSync] = useState(false);
  const installations = useApi<Schema['GithubInstallations']>(
    open ? '/v1/integrations/github/installations' : undefined,
  );
  const repositories = useApi<Schema['GithubRepositories']>(
    open && installation
      ? `/v1/integrations/github/repositories?installation_id=${encodeURIComponent(installation)}`
      : undefined,
  );
  const perform = async (mode: 'pull' | 'push' | 'pull_request') => {
    setBusy(true);
    try {
      await api(`/v1/workspaces/${workspace.id}/sync`, 'POST', { mode });
      toast.success('Git operation queued');
      await sync.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel git-panel">
      <div className="git-illustration">
        <GitBranch size={48} />
      </div>
      <h2>{project.github ? 'Your repository, kept in sync.' : 'Your files already have a history.'}</h2>
      <p>
        {project.github
          ? 'Bring in remote changes, publish this branch, or open a draft pull request. Conflicts keep both versions available for review.'
          : 'Every checkpoint keeps a Git revision alongside your persistent files. Connect GitHub whenever you are ready to collaborate.'}
      </p>
      <div className="git-revision">
        <ShieldCheck size={16} />
        <span>
          {workspace.git_status === 'attention'
            ? 'Files preserved · Git needs attention'
            : `Versioned on ${workspace.branch || 'main'}`}
        </span>
        {workspace.git_commit && <code>{workspace.git_commit.slice(0, 12)}</code>}
      </div>
      {workspace.git_status === 'attention' && (
        <p role="status">
          {workspace.git_error}. Use a native agent session to inspect and repair repository state; file
          checkpoints remain available.
        </p>
      )}
      {project.github ? (
        <>
          <label className="git-auto-sync">
            <input
              type="checkbox"
              checked={Boolean(project.github.auto_sync)}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await api(
                    `/v1/projects/${project.id}`,
                    'PATCH',
                    { github: { ...project.github, auto_sync: e.target.checked } },
                    { 'If-Match': `"${project.revision}"` },
                  );
                  await client.invalidateQueries();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />{' '}
            Automatically sync after agent runs
          </label>
          <label className="git-auto-sync">
            <input
              type="checkbox"
              checked={Boolean(project.github.auto_pull)}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await api(
                    `/v1/projects/${project.id}`,
                    'PATCH',
                    { github: { ...project.github, auto_pull: e.target.checked } },
                    { 'If-Match': `"${project.revision}"` },
                  );
                  await client.invalidateQueries();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />{' '}
            Fetch and merge incoming changes when idle
          </label>
          {workspace.remote_change && (
            <p role="status">
              {workspace.remote_change.deleted
                ? 'The remote target branch was deleted. Choose a new target before syncing.'
                : 'Remote changes are available. Fetch and merge to bring them into this workspace.'}
            </p>
          )}
          <Badge status={sync.data?.status || 'pending'} />
          <p className="mono">
            Repository {project.github.repository_id} · target {project.github.target_branch}
          </p>
          {sync.data?.error_code && (
            <div className="git-notice" role="status">
              <strong>
                {sync.data.status === 'conflict'
                  ? 'Review the conflicting changes'
                  : 'Sync needs your attention'}
              </strong>
              <p>
                {sync.data.error_code}. Your files are preserved. The agent can inspect the local branch and
                refs/remotes/origin/{project.github.target_branch} to resolve differences.
              </p>
              {sync.data.conflicting_paths?.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </div>
          )}
          <div className="git-actions">
            <Button variant="secondary" busy={busy} onClick={() => perform('pull')}>
              <ArrowDownToLine size={16} />
              Fetch and merge
            </Button>
            <Button busy={busy} onClick={() => perform('push')}>
              Sync to {project.github.target_branch}
            </Button>
            {workspace.branch !== project.github.target_branch && (
              <Button variant="secondary" busy={busy} onClick={() => perform('pull_request')}>
                <GitPullRequest size={16} />
                Open draft PR
              </Button>
            )}
          </div>
          {sync.data?.pull_request_url && (
            <a
              className="text-link"
              href={sync.data.pull_request_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review pull request <ArrowUpRight size={14} />
            </a>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/v1/projects/${project.id}/github`, 'DELETE');
                await client.invalidateQueries();
                toast.success('Repository disconnected. Files and Git history are preserved.');
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect repository
          </Button>
        </>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <GitPullRequest size={16} />
          Connect GitHub
        </Button>
      )}
      <div className="git-principles">
        <span>Independent branches</span>
        <span>No force pushes</span>
        <span>Visible conflicts</span>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Connect a repository"
        description="Choose the GitHub repository this project can read and publish to. Organization owners and admins manage this connection."
      >
        {!installations.data ? (
          <div className="git-connect-step">
            <p>Authorize your GitHub account so we can verify the repositories you can write to.</p>
            <a className="button primary" href={`/integrations/github/install?project_id=${project.id}`}>
              Authorize GitHub <ArrowUpRight size={15} />
            </a>
            {installations.error && <p className="muted">{installations.error.message}</p>}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api(
                  `/v1/projects/${project.id}`,
                  'PATCH',
                  {
                    github: {
                      installation_id: installation,
                      repository_id: repository,
                      target_branch: branch,
                      auto_sync: autoSync,
                    },
                  },
                  { 'If-Match': `"${project.revision}"` },
                );
                await client.invalidateQueries();
                setOpen(false);
                toast.success('Repository connected. Initial import queued.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="git-install-row">
              <span>Install the app on selected repositories.</span>
              <a href={installations.data.install_url} target="_blank" rel="noopener noreferrer">
                Manage access <ArrowUpRight size={14} />
              </a>
              <Button
                variant="ghost"
                type="button"
                aria-label="Refresh GitHub installations"
                onClick={() => installations.refetch()}
              >
                <RefreshCw size={15} />
              </Button>
            </div>
            <Field label="GitHub account">
              <Select
                required
                value={installation}
                onValueChange={(next) => {
                  setInstallation(next);
                  setRepository('');
                }}
                options={[
                  { value: '', label: 'Select an account' },
                  ...(installations.data.data.map((i) => ({
                    value: i.installation_id,
                    label: i.account_login,
                  })) ?? []),
                ]}
              />
            </Field>
            <Field label="Repository" hint="Only repositories where you have write access are listed.">
              <Select
                required
                value={repository}
                onValueChange={(next) => {
                  setRepository(next);
                  setBranch(
                    repositories.data?.data.find((r) => r.repository_id === next)?.default_branch || 'main',
                  );
                }}
                options={[
                  { value: '', label: 'Select a repository' },
                  ...(repositories.data?.data.map((r) => ({
                    value: r.repository_id,
                    label: r.full_name,
                  })) ?? []),
                ]}
              />
            </Field>
            {repositories.error && <p role="alert">{repositories.error.message}</p>}
            {(repositories.data?.truncated || installations.data.truncated) && (
              <p className="muted">
                Showing the first 100 results. Limit the app installation to the repositories you need.
              </p>
            )}
            <Field
              label="Target branch"
              hint="New repositories are imported into the default workspace. Existing, unrelated history is preserved for review."
            >
              <input required value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            <Field
              label="Automatic synchronization"
              hint="After each agent run, push its persisted changes to the target branch. Conflicts and protected branches stop the sync for review."
            >
              <span>
                <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />{' '}
                Enable after agent runs
              </span>
            </Field>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!repository}>
                Connect and import
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
