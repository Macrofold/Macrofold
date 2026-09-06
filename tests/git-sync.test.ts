import { it, expect } from 'vitest';
import { gitServer } from './fixtures/git-server';
import { gitRevision, withRepository } from '../packages/providers/src/git-repository';
import { synchronizeGit } from '../packages/providers/src/git-sync';
import { readContent, saveContent } from '../packages/providers/src/storage';
it('imports, pushes, reconciles retry and preserves both versions on conflict over real Git HTTP', async () => {
  const server = await gitServer(),
    org = crypto.randomUUID();
  try {
    const initial = await gitRevision(org, 'main', [], [], 'Empty workspace');
    const imported = await synchronizeGit(
      org,
      'main',
      'main',
      'pull',
      initial.files,
      initial.git_files,
      server.remote,
    );
    expect(imported.status).toBe('synced');
    expect((await readContent(imported.files[0].key)).toString()).toBe('initial\n');
    const local = await gitRevision(
      org,
      'main',
      [{ ...imported.files[0], ...(await saveContent(org, Buffer.from('local change\n'))) }],
      imported.git_files,
      'Local change',
    );
    const pushed = await synchronizeGit(
      org,
      'main',
      'main',
      'push',
      local.files,
      local.git_files,
      server.remote,
    );
    expect(pushed.status).toBe('synced');
    const repeated = await synchronizeGit(
      org,
      'main',
      'main',
      'push',
      local.files,
      local.git_files,
      server.remote,
    );
    expect(repeated.git_commit).toBe(pushed.git_commit);
    expect((await server.command(['--git-dir=../repo.git', 'show', 'main:README.md'])).stdout).toBe(
      'local change\n',
    );
    const ours = await gitRevision(
      org,
      'main',
      [{ ...local.files[0], ...(await saveContent(org, Buffer.from('conflicting local\n'))) }],
      pushed.git_files,
      'Ours',
    );
    await server.change('conflicting remote\n');
    const conflicted = await synchronizeGit(
      org,
      'main',
      'main',
      'push',
      ours.files,
      ours.git_files,
      server.remote,
    );
    expect(conflicted.status).toBe('conflict');
    expect(conflicted.git_commit).toBe(ours.git_commit);
    expect((await readContent(conflicted.files[0].key)).toString()).toBe('conflicting local\n');
    await withRepository(conflicted.git_files, async (repo) => {
      expect(await repo.head('refs/remotes/origin/main')).not.toBe(ours.git_commit);
    });
    const config = conflicted.git_files.find((f) => f.path === '.git/config')!;
    expect((await readContent(config.key)).toString()).not.toContain(server.remote.token);
  } finally {
    await server.close();
  }
}, 30000);
