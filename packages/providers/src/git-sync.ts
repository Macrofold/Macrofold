import git from 'isomorphic-git';
import { withRepository, branchName } from './git-repository';
import type { FileRecord } from '../../core/src/files';
import type { GitRemote } from './github';
import { assert } from '../../core/src/errors';
export type SyncResult = {
  status: 'synced' | 'already_integrated' | 'conflict' | 'blocked';
  files: FileRecord[];
  git_files: FileRecord[];
  git_commit?: string;
  source_commit?: string;
  target_commit?: string;
  conflicting_paths?: string[];
  error_code?: string;
};
export async function synchronizeGit(
  org: string,
  branch: string,
  target: string,
  mode: 'push' | 'pull' | 'pull_request',
  files: FileRecord[],
  records: FileRecord[],
  remote: GitRemote,
): Promise<SyncResult> {
  branchName(branch);
  branchName(target);
  return withRepository(records, async (repo) => {
    const auth = () => ({ username: 'x-access-token', password: remote.token });
    const before = await repo.head();
    await git.addRemote({ ...repo.options, remote: 'origin', url: remote.url, force: true });
    await git.fetch({
      ...repo.options,
      http: remote.http,
      url: remote.url,
      remote: 'origin',
      ref: target,
      singleBranch: true,
      tags: false,
      onAuth: auth,
    });
    const remoteHead = await repo.head(`refs/remotes/origin/${target}`);
    const baseResult = async (
      status: SyncResult['status'],
      extra: Partial<SyncResult> = {},
    ): Promise<SyncResult> => ({
      status,
      files,
      git_files: await repo.save(org),
      git_commit: await repo.head(),
      source_commit: before,
      target_commit: remoteHead,
      ...extra,
    });
    if (!remoteHead) return baseResult('blocked', { error_code: 'remote_branch_missing' });
    // The initial empty platform commit has no customer history. Import adopts the remote graph.
    const history = before ? await git.log({ ...repo.options, ref: before, depth: 2 }) : [];
    if (!before || (!files.length && history.length === 1 && history[0].commit.parent.length === 0)) {
      await repo.select(branch, remoteHead);
    } else {
      try {
        await git.merge({
          ...repo.options,
          ours: branch,
          theirs: `refs/remotes/origin/${target}`,
          abortOnConflict: true,
          author: { name: 'Hosted workspace', email: 'workspace@localhost' },
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (!['MergeConflictError', 'MergeNotSupportedError', 'NoMergeBaseError'].includes(code || ''))
          throw error;
        const details = (error as { data?: { filepaths?: string[] } }).data;
        return baseResult('conflict', { conflicting_paths: details?.filepaths || [], error_code: code });
      }
    }
    const merged = await repo.files(org);
    const collisions = files
      .filter((f) => f.git_ignored && merged.some((m) => m.path === f.path && m.sha256 !== f.sha256))
      .map((f) => f.path);
    if (collisions.length) {
      if (before) await repo.select(branch, before);
      return baseResult('conflict', { conflicting_paths: collisions, error_code: 'ignored_file_collision' });
    }
    const next = [...merged, ...files.filter((f) => f.git_ignored && !merged.some((m) => m.path === f.path))];
    if (mode !== 'pull') {
      const result = await git.push({
        ...repo.options,
        http: remote.http,
        url: remote.url,
        ref: branch,
        remoteRef: mode === 'pull_request' ? branch : target,
        force: false,
        onAuth: auth,
      });
      assert(
        result.ok,
        409,
        'git_push_rejected',
        'GitHub rejected the push. Check branch protection or fetch new remote changes.',
      );
    }
    return baseResult(before === remoteHead && mode === 'pull' ? 'already_integrated' : 'synced', {
      files: next,
    });
  });
}
