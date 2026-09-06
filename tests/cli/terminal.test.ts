import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, chmod, lstat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '../../sdk/typescript/src/client';
import { terminalText } from '../../packages/cli/src/output';
import contract from '../../docs/api/cli.json';
import { git } from '../../packages/cli/src/local-project';

const root = process.cwd(),
  executable = path.join(root, 'packages/cli/dist/index.mjs');
let directory: string, configDirectory: string, key: string, client: Client;
async function command(
  args: string[],
  options: { cwd?: string; stdin?: string; apiKey?: string | null } = {},
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const env = {
      ...process.env,
      AGENT_HOST: 'http://localhost:3210',
      AGENT_CONFIG_DIR: configDirectory,
      AGENT_API_KEY: options.apiKey === null ? '' : options.apiKey || key,
      NO_COLOR: '1',
    };
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: options.cwd || directory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(options.stdin);
  });
}
async function json(args: string[], options: Parameters<typeof command>[1] = {}) {
  const value = await command([...args, '--json'], options);
  expect(value.code, value.stderr || value.stdout).toBe(0);
  expect(value.stdout.trim().split('\n')).toHaveLength(1);
  return JSON.parse(value.stdout).data;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'hosted-cli-test-'));
  configDirectory = path.join(directory, 'credentials');
  const seed = JSON.parse(await readFile(path.join(root, '.data/demo.json'), 'utf8'));
  key = seed.api_key;
  client = new Client({ baseURL: 'http://localhost:3210', token: key });
  await client.request('getIdentity');
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('packaged CLI against the local API and worker', () => {
  it('documents all contracted commands and keeps invalid JSON output machine readable', async () => {
    for (const entry of contract.commands) {
      const value = await command([...entry.command.split(' '), '--help']);
      expect(value.code, entry.command + ' ' + value.stderr).toBe(0);
      expect(value.stdout).toContain('Usage:');
    }
    const invalid = await command(['run', 'prompt', '--secret-api-key', 'oops', '--json']);
    expect(invalid.code).toBe(2);
    expect(JSON.parse(invalid.stdout).ok).toBe(false);
    for (const flags of [
      ['--queue-timeout', '86401'],
      ['--scheduling', 'urgent'],
    ]) {
      const rejected = await command(['run', 'prompt', ...flags, '--json']);
      expect(rejected.code).toBe(2);
      expect(JSON.parse(rejected.stdout).ok).toBe(false);
    }
    const preflags = await json(['--profile', 'unused', 'version']);
    expect(preflags.version).toBe('0.1.0');
    expect(terminalText('\x1b]52;c;c2VjcmV0\x07Hello\x1b[31m world')).toBe('Hello world');
  }, 60000);
  it('links without upload, isolates remote worktrees, transfers explicit files, streams and restores', async () => {
    const project = await json(['project', 'create', `CLI integration ${Date.now()}`]);
    const repo = path.join(directory, 'repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'local.txt'), 'Local work stays here until an explicit push.\n');
    await json(['link', project.id], { cwd: repo });
    const link = JSON.parse(await readFile(path.join(repo, '.agent/link.json'), 'utf8'));
    expect(link).not.toHaveProperty('apiKey');
    expect((await json(['files', 'list'], { cwd: repo })).entries).toHaveLength(0);
    const plan = await json(['files', 'push', 'local.txt', '--dry-run'], { cwd: repo });
    expect(plan.actions[0].action).toBe('upload');
    expect(plan.actions[0]).not.toHaveProperty('url');
    await json(['files', 'push', 'local.txt', '--yes'], { cwd: repo });
    expect((await json(['files', 'cat', 'local.txt'], { cwd: repo })).content).toBe(
      Buffer.from('Local work stays here until an explicit push.\n').toString('base64'),
    );
    const checkpoint = await json(['checkpoint', 'create', '--pin'], { cwd: repo });
    expect(checkpoint.status).toBe('succeeded');
    const created = await json(['worktree', 'create', 'experiment', '--from', 'main', '--use'], {
      cwd: repo,
    });
    expect(created.status).toBe('succeeded');
    const linked = JSON.parse(await readFile(path.join(repo, '.agent/link.json'), 'utf8'));
    expect(linked.workspaceId).not.toBe(link.workspaceId);
    const run = await json(
      [
        'run',
        'Write a progress note',
        '--harness',
        'codex',
        '--model',
        'fixture-model',
        '--detach',
        '--queue-timeout',
        '900',
        '--scheduling',
        'interactive',
      ],
      { cwd: repo },
    );
    expect(run.run_id).toBeTruthy();
    const attached = await command(['run', 'attach', run.run_id, '--after', '0', '--jsonl'], { cwd: repo });
    expect(attached.code, attached.stderr).toBe(0);
    const events = attached.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.some((e) => e.type === 'tool.completed')).toBe(true);
    expect(events.at(-1).type).toBe('run.succeeded');
    expect(new Set(events.map((e) => e.sequence)).size).toBe(events.length);
    const history = await json(['run', 'show', run.run_id], { cwd: repo });
    expect(history.result.final).toBe(true);
    expect(history.result.persistence_status).toBe('verified');
    expect(history.run.scheduling_class).toBe('interactive');
    expect(
      new Date(history.run.queue_expires_at).getTime() - new Date(history.run.created_at).getTime(),
    ).toBe(900000);
    expect(history.run.reserved_micro_usd).toBe('0');
    expect(history.run.waiting_reason).toBeNull();
    const continued = await json(['run', 'Continue this conversation', '--session', run.session_id], {
      cwd: repo,
    });
    expect(continued.execution_outcome).toBe('success');
    expect((await json(['files', 'list'], { cwd: repo })).entries.length).toBeGreaterThan(1);
    await json(['files', 'pull', '--yes'], { cwd: repo });
    const diff = await json(['files', 'diff', '--local', 'local.txt'], { cwd: repo });
    expect(diff.actions.every((a: { action: string }) => a.action === 'unchanged')).toBe(true);
    await writeFile(path.join(repo, 'local.txt'), 'Local edit\n');
    const workspace = await client.request('getWorkspace', {
      params: { path: { workspace_id: linked.workspaceId } },
    });
    await client.request('writeFile', {
      params: {
        path: { workspace_id: workspace.id },
        query: { path: 'local.txt' },
        header: { 'If-Match': workspace.revision },
      },
      body: new TextEncoder().encode('Remote edit\n'),
    });
    const conflict = await command(['files', 'push', 'local.txt', '--yes', '--json'], { cwd: repo });
    expect(conflict.code).toBe(5);
    expect(await readFile(path.join(repo, 'local.txt'), 'utf8')).toBe('Local edit\n');
    await json(['worktree', 'use', 'main'], { cwd: repo });
    expect((await json(['files', 'list'], { cwd: repo })).entries).toHaveLength(1);
    await json(['checkpoint', 'restore', checkpoint.result.checkpoint_id, '--yes'], { cwd: repo });
    await json(['worktree', 'remove', 'experiment', '--yes'], { cwd: repo });
    await json(['unlink'], { cwd: repo });
    expect(await lstat(path.join(repo, '.agent/link.json')).catch(() => null)).toBe(null);
    expect(await readFile(path.join(repo, 'local.txt'), 'utf8')).toBe('Local edit\n');
  }, 120000);
  it('uses protected stdin credentials, redacts config and refuses symlinked metadata', async () => {
    const login = await json(
      ['login', '--host', 'http://localhost:3210', '--profile', 'ci', '--api-key-stdin'],
      { stdin: key, apiKey: null },
    );
    expect(login.profile).toBe('ci');
    expect((await lstat(path.join(configDirectory, 'profiles.json'))).mode & 0o077).toBe(0);
    const profiles = await command(['config', '--json'], { apiKey: null });
    expect(profiles.stdout).not.toContain(key);
    expect(JSON.parse(profiles.stdout).data.profiles[0].authentication).toBe('API key');
    const identity = await json(['whoami', '--profile', 'ci'], { apiKey: null });
    expect(identity.principal_type).toBe('api_key');
    const unsafe = path.join(directory, 'unsafe');
    await mkdir(unsafe);
    await symlink(directory, path.join(unsafe, '.agent'));
    const denied = await command(['project', 'list', '--json'], { cwd: unsafe });
    expect(denied.code).not.toBe(0);
    await chmod(path.join(configDirectory, 'profiles.json'), 0o644);
    const permissions = await command(['whoami', '--profile', 'ci', '--json'], { apiKey: null });
    expect(permissions.code).not.toBe(0);
    expect(permissions.stdout).not.toContain(key);
    await chmod(path.join(configDirectory, 'profiles.json'), 0o600);
    const logout = await json(['logout', '--profile', 'ci'], { apiKey: null });
    expect(logout).toEqual({ removed: true, revoked: false });
  });
  it('imports a verified remote bundle into an explicit local Git worktree', async () => {
    const repo = path.join(directory, 'review-repo'),
      destination = path.join(directory, 'review-checkout');
    await mkdir(repo);
    await git(['init', '--initial-branch=main'], repo);
    const project = await json(['project', 'create', 'Git review test']);
    await json(['link', project.id], { cwd: repo });
    await writeFile(path.join(repo, 'review.txt'), 'Verified remote content\n');
    await json(['files', 'push', 'review.txt', '--yes'], { cwd: repo });
    const checked = await json(['worktree', 'checkout', 'main', '--local', destination], { cwd: repo });
    expect(checked.review_snapshot).toBe(true);
    expect(await readFile(path.join(destination, 'review.txt'), 'utf8')).toBe('Verified remote content\n');
    expect((await git(['rev-parse', 'HEAD'], destination)).trim()).toBe(checked.export_commit);
    expect((await git(['status', '--porcelain'], destination)).trim()).toBe('');
    const occupied = await command(['worktree', 'checkout', 'main', '--local', destination, '--json'], {
      cwd: repo,
    });
    expect(occupied.code).toBe(5);
  });
});
