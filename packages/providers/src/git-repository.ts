import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import git, { type TreeEntry } from 'isomorphic-git';
import { saveContent, readContent } from './storage';
import type { FileRecord } from '../../core/src/files';
import { normalizePath } from '../../core/src/files';
import { assert } from '../../core/src/errors';

export const GIT_BYTES = 250 * 1024 * 1024;
export const GIT_ENTRIES = 100_000;
const identity = { name: 'Hosted workspace', email: 'workspace@localhost' };
const configuration =
  '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\thooksPath = /dev/null\n\tfsmonitor = false\n[credential]\n\thelper =\n[commit]\n\tgpgsign = false\n[user]\n\tname = Hosted workspace\n\temail = workspace@localhost\n';
export type GitState = {
  git_files: FileRecord[];
  git_commit?: string;
  git_status: 'ready' | 'attention';
  git_error?: string | null;
};
export function branchName(value: string) {
  assert(
    /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,150}$/.test(value) &&
      !value.includes('..') &&
      !value.includes('//') &&
      !value.endsWith('/') &&
      !value.endsWith('.') &&
      !value.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock')),
    400,
    'invalid_branch',
    'Choose a valid Git branch name.',
  );
  return value;
}
/** A cloud checkpoint can contain arbitrary .git config, hooks and symlinks. The control plane only
 * imports inert objects, refs and index data. Repository content never selects a URL or executes code. */
export function gitMetadataPath(value: string) {
  if (
    !value.startsWith('.git/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    return false;
  const relative = value.slice(5);
  return (
    /^(HEAD|index|packed-refs|shallow|ORIG_HEAD|MERGE_HEAD|MERGE_MSG|MERGE_MODE|AUTO_MERGE|config)$/.test(
      relative,
    ) ||
    /^(refs|logs)\/[a-zA-Z0-9/_.-]+$/.test(relative) ||
    /^objects\/(?:[a-f0-9]{2}\/[a-f0-9]{38}|pack\/pack-[a-f0-9]{40}\.(?:pack|idx|rev))$/.test(relative) ||
    relative === 'info/exclude'
  );
}
export async function withRepository<T>(records: FileRecord[], action: (repo: Repository) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hosted-git-'));
  try {
    const repo = new Repository(dir);
    let bytes = 0;
    for (const record of records) {
      if (!gitMetadataPath(record.path) || record.path === '.git/config') continue;
      assert(record.type === 'file', 409, 'unsafe_git_metadata', 'Git metadata must contain ordinary files.');
      bytes += Number(record.size_bytes);
      assert(
        bytes <= GIT_BYTES,
        413,
        'git_size_limit',
        'Git metadata exceeds the 250 MiB maintenance limit. Files remain preserved.',
      );
      await mkdir(path.dirname(path.join(dir, record.path)), { recursive: true });
      await writeFile(path.join(dir, record.path), await readContent(record.key, record.sha256), {
        mode: 0o600,
      });
    }
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, '.git/config'), configuration, { mode: 0o600 });
    if (!records.some((r) => r.path === '.git/HEAD'))
      await git.init({ ...repo.options, defaultBranch: 'main' });
    return await action(repo);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export class Repository {
  readonly filesystem: typeof fs;
  constructor(readonly dir: string) {
    const inside = (value: unknown) => {
      const absolute = path.resolve(String(value));
      assert(
        absolute === dir || absolute.startsWith(dir + path.sep),
        409,
        'unsafe_git_metadata',
        'Git metadata attempted to leave its repository directory.',
      );
    };
    const promises = new Proxy(fs.promises, {
      get(target, property) {
        const method = Reflect.get(target, property);
        if (typeof method !== 'function') return method;
        return async (...args: unknown[]) => {
          inside(args[0]);
          if (['rename', 'copyFile', 'cp', 'link'].includes(String(property))) inside(args[1]);
          assert(
            property !== 'symlink',
            409,
            'unsafe_git_metadata',
            'The control plane does not materialize Git symlinks.',
          );
          return Reflect.apply(method, target, args);
        };
      },
    });
    this.filesystem = { ...fs, promises };
  }
  get options() {
    return { fs: this.filesystem, dir: this.dir };
  }
  async head(ref = 'HEAD') {
    try {
      return await git.resolveRef({ ...this.options, ref });
    } catch (e) {
      if ((e as { code?: string }).code === 'NotFoundError') return undefined;
      throw e;
    }
  }
  async tree(ref = 'HEAD'): Promise<Map<string, TreeEntry>> {
    const oid = await this.head(ref),
      result = new Map<string, TreeEntry>();
    if (!oid) return result;
    const walk = async (oid: string, prefix: string) => {
      const tree = await git.readTree({ ...this.options, oid });
      for (const entry of tree.tree) {
        const name = prefix + entry.path;
        normalizePath(name);
        assert(result.size < GIT_ENTRIES, 413, 'git_entry_limit', 'Repository exceeds the file entry limit.');
        if (entry.type === 'tree') await walk(entry.oid, name + '/');
        else result.set(name, entry);
      }
    };
    await walk((await git.readCommit({ ...this.options, oid })).commit.tree, '');
    return result;
  }
  async select(branch: string, ref?: string) {
    branchName(branch);
    const head = await this.head(ref || 'HEAD');
    assert(
      !ref || head,
      404,
      'git_ref_not_found',
      'The requested source ref is absent from this checkpoint.',
    );
    if (head) await git.writeRef({ ...this.options, ref: `refs/heads/${branch}`, value: head, force: true });
    await git.writeRef({
      ...this.options,
      ref: 'HEAD',
      value: `refs/heads/${branch}`,
      symbolic: true,
      force: true,
    });
  }
  async commitFiles(files: FileRecord[], message: string) {
    assert(
      !(await this.exists('.git/MERGE_HEAD')),
      409,
      'git_merge_pending',
      'Resolve and commit the pending merge in a native agent session before automatic Git sync.',
    );
    const previous = await this.tree();
    // Only ignore files are materialized. Untracked caches can be many GiB and remain in object storage.
    for (const record of files.filter(
      (f) => path.posix.basename(f.path) === '.gitignore' && f.type === 'file',
    )) {
      normalizePath(record.path);
      assert(Number(record.size_bytes) <= 1024 * 1024, 413, 'git_ignore_limit', '.gitignore exceeds 1 MiB.');
      await mkdir(path.dirname(path.join(this.dir, record.path)), { recursive: true });
      await writeFile(path.join(this.dir, record.path), await readContent(record.key, record.sha256), {
        mode: 0o600,
      });
    }
    const entries = new Map<string, TreeEntry>(),
      classified: FileRecord[] = [];
    let size = 0;
    const modules = [...previous].filter(([, entry]) => entry.type === 'commit');
    for (const [name, entry] of modules) entries.set(name, entry);
    for (const file of files) {
      normalizePath(file.path);
      const insideModule = modules.some(([name]) => file.path === name || file.path.startsWith(name + '/'));
      const ignored =
        insideModule ||
        (!previous.has(file.path) && (await git.isIgnored({ ...this.options, filepath: file.path })));
      classified.push({ ...file, git_ignored: ignored });
      if (ignored) continue;
      size += Number(file.size_bytes);
      assert(
        size <= GIT_BYTES,
        413,
        'git_size_limit',
        'Tracked files exceed the 250 MiB maintenance limit. Add generated data to .gitignore; file checkpoints remain available.',
      );
      const oid = await git.writeBlob({ ...this.options, blob: await readContent(file.key, file.sha256) });
      entries.set(file.path, {
        path: path.posix.basename(file.path),
        oid,
        type: 'blob',
        mode: file.type === 'symlink' ? '120000' : (file.mode || 0) & 0o111 ? '100755' : '100644',
      });
    }
    const writeTree = async (prefix: string): Promise<string> => {
      const immediate: TreeEntry[] = [],
        directories = new Set<string>();
      for (const [name, entry] of entries)
        if (name.startsWith(prefix)) {
          const tail = name.slice(prefix.length),
            slash = tail.indexOf('/');
          if (slash < 0) immediate.push({ ...entry, path: tail });
          else directories.add(tail.slice(0, slash));
        }
      for (const name of directories) {
        assert(
          !immediate.some((e) => e.path === name),
          409,
          'file_tree_conflict',
          'A file cannot also be an ancestor directory.',
        );
        immediate.push({
          path: name,
          type: 'tree',
          mode: '040000',
          oid: await writeTree(prefix + name + '/'),
        });
      }
      return git.writeTree({ ...this.options, tree: immediate });
    };
    const tree = await writeTree(''),
      parent = await this.head();
    const unchanged = parent && (await git.readCommit({ ...this.options, oid: parent })).commit.tree === tree;
    const commit = unchanged
      ? parent
      : await git.commit({
          ...this.options,
          tree,
          message,
          author: identity,
          parent: parent ? [parent] : [],
        });
    // Rebuild the index without executing checkout filters or materializing symlinks.
    await rm(path.join(this.dir, '.git/index'), { force: true });
    for (const [filepath, entry] of entries)
      await git.updateIndex({
        ...this.options,
        filepath,
        oid: entry.oid,
        mode: parseInt(entry.mode, 8),
        add: true,
      });
    return { files: classified, commit };
  }
  async exists(relative: string) {
    return lstat(path.join(this.dir, relative)).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    );
  }
  async save(org: string): Promise<FileRecord[]> {
    const result: FileRecord[] = [];
    let size = 0;
    const walk = async (relative: string) => {
      for (const name of (await readdir(path.join(this.dir, relative))).sort()) {
        const filepath = relative + '/' + name,
          stat = await lstat(path.join(this.dir, filepath));
        assert(!stat.isSymbolicLink(), 409, 'unsafe_git_metadata', 'Git metadata may not contain symlinks.');
        if (stat.isDirectory()) {
          await walk(filepath);
          continue;
        }
        if (!gitMetadataPath(filepath)) continue;
        size += stat.size;
        assert(
          size <= GIT_BYTES && result.length < GIT_ENTRIES,
          413,
          'git_size_limit',
          'Git history exceeds the maintenance limit.',
        );
        result.push({
          ...(await saveContent(org, await readFile(path.join(this.dir, filepath)))),
          path: filepath,
          type: 'file',
          modified_at: stat.mtime.toISOString(),
          git_ignored: true,
          mode: 0o600,
        });
      }
    };
    await walk('.git');
    return result;
  }
  async files(org: string, ref = 'HEAD'): Promise<FileRecord[]> {
    const entries = await this.tree(ref),
      result: FileRecord[] = [];
    let size = 0;
    for (const [filepath, entry] of entries) {
      if (entry.type === 'commit') continue; // Gitlinks are preserved, submodules are never recursively fetched.
      const { blob } = await git.readBlob({ ...this.options, oid: entry.oid });
      size += blob.length;
      assert(size <= GIT_BYTES, 413, 'git_size_limit', 'The checked-out repository exceeds 250 MiB.');
      result.push({
        ...(await saveContent(org, Buffer.from(blob))),
        path: filepath,
        type: entry.mode === '120000' ? 'symlink' : 'file',
        mode: entry.mode === '100755' ? 0o755 : 0o644,
        git_ignored: false,
        modified_at: new Date().toISOString(),
      });
    }
    return result;
  }
  async bundle(ref = 'HEAD') {
    const head = await this.head(ref);
    assert(head, 409, 'git_uninitialized', 'Create a Git checkpoint before exporting.');
    const seen = new Set<string>();
    let size = 0;
    const visit = async (oid: string) => {
      if (seen.has(oid)) return;
      seen.add(oid);
      assert(seen.size <= GIT_ENTRIES, 413, 'git_entry_limit', 'Git export exceeds the object count limit.');
      const value = await git.readObject({ ...this.options, oid, format: 'content' });
      size += (value.object as Uint8Array).byteLength;
      assert(size <= GIT_BYTES, 413, 'git_size_limit', 'Git export exceeds 250 MiB of uncompressed objects.');
      if (value.type === 'commit') {
        const c = (await git.readCommit({ ...this.options, oid })).commit;
        await visit(c.tree);
        for (const parent of c.parent) await visit(parent);
      }
      if (value.type === 'tree')
        for (const e of (await git.readTree({ ...this.options, oid })).tree)
          if (e.type !== 'commit') await visit(e.oid);
    };
    await visit(head);
    const pack = await git.packObjects({ ...this.options, oids: [...seen] });
    // Git's standard v2 bundle framing. Native Git verifies this format in integration tests.
    return {
      bytes: Buffer.concat([
        Buffer.from(`# v2 git bundle\n${head} refs/heads/export\n${head} HEAD\n\n`),
        Buffer.from(pack.packfile!),
      ]),
      commit: head,
    };
  }
}
export async function gitRevision(
  org: string,
  branch: string,
  files: FileRecord[],
  state: FileRecord[],
  message: string,
) {
  return withRepository(state, async (repo) => {
    await repo.select(branch);
    const revision = await repo.commitFiles(files, message);
    return {
      files: revision.files,
      git_files: await repo.save(org),
      git_commit: revision.commit,
      git_status: 'ready' as const,
      git_error: null,
    };
  });
}
