import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { mkdtemp, readFile, writeFile, mkdir, rm, chmod, lstat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '../../sdk/typescript/src/client';
import { terminalText } from '../../packages/cli/src/output';
import { config } from '../../packages/core/src/config';
import contract from '../../docs/api/cli.json';
import { git } from '../../packages/cli/src/local-workspace';

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
      AGENT_HOST: config.origin,
      AGENT_CONFIG_DIR: configDirectory,
      AGENT_API_KEY: options.apiKey === null ? '' : options.apiKey || key,
      NODE_V8_COVERAGE: process.env.CLI_V8_COVERAGE || '',
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
  const seed = JSON.parse(await readFile(path.join(config.dataDir, 'demo.json'), 'utf8'));
  key = seed.api_key;
  client = new Client({ baseURL: config.origin, token: key });
  await client.request('getIdentity');
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('packaged CLI against the local API and worker', () => {
  it('inherits tools by omission and narrows preset and continued runs without saving the selection', async () => {
    const workspace = await client.workspaces.create({ name: 'CLI access selection' });
    const connection = await client.connections.create({
      name: 'CLI search fixture',
      kind: 'search',
      provider: 'brave',
      auth_method: 'none',
    });
    await client.request('updateConnectionAccess', {
      params: { path: { connection_id: connection.id }, header: { 'If-Match': '"1"' } },
      body: { tools: ['web_search'] },
    });
    await client.request('createConnectionAccessRule', {
      params: { path: { connection_id: connection.id }, header: { 'If-Match': '"2"' } },
      body: { scope: 'workspace', workspace_id: workspace.id },
    });
    const organization = (await client.request('getIdentity')).organization_id;
    // Observe accepted server state; all CLI mutations still use the real API.
    const db = new pg.Client({ connectionString: config.databaseUrl });
    await db.connect();
    async function selection(runId: string) {
      await db.query('BEGIN');
      try {
        await db.query("SELECT set_config('app.organization_id',$1,true)", [organization]);
        return (await db.query("SELECT config->'connection_grants' AS grants FROM runs WHERE id=$1", [runId]))
          .rows[0].grants;
      } finally {
        await db.query('ROLLBACK');
      }
    }
    try {
      const inherited = await json([
        'run',
        'Inherit tools',
        '--workspace',
        workspace.id,
        '--harness',
        'codex',
        '--model',
        'fixture-model',
        '--detach',
      ]);
      expect(await selection(inherited.run_id)).toContainEqual({
        connection_id: connection.id,
        tools: ['web_search'],
      });
      expect((await client.sessions.get(inherited.session_id)).connection_grants).toBeUndefined();
      await client.runs.wait(inherited.run_id);
      const preset = await client.agents.create({
        name: 'CLI no-tool default',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        connection_grants: [],
      });
      const narrowed = await json([
        'run',
        'Explicit preset selection',
        '--workspace',
        workspace.id,
        '--agent',
        preset.id,
        '--connection',
        `${connection.id}:web_search`,
        '--detach',
      ]);
      expect(await selection(narrowed.run_id)).toEqual([
        { connection_id: connection.id, tools: ['web_search'] },
      ]);
      expect((await client.sessions.get(narrowed.session_id)).connection_grants).toEqual([]);
      await client.runs.wait(narrowed.run_id);
      const none = await json([
        'run',
        'No tools this time',
        '--session',
        inherited.session_id,
        '--no-connections',
        '--detach',
      ]);
      expect(await selection(none.run_id)).toEqual([]);
      await client.runs.wait(none.run_id);
      const selected = await json([
        'run',
        'Select on continuation',
        '--session',
        inherited.session_id,
        '--connection',
        `${connection.id}:web_search`,
        '--detach',
      ]);
      expect(await selection(selected.run_id)).toEqual([
        { connection_id: connection.id, tools: ['web_search'] },
      ]);
      await client.runs.wait(selected.run_id);
      const conflict = await command([
        'run',
        'Invalid combination',
        '--connection',
        `${connection.id}:web_search`,
        '--no-connections',
        '--json',
      ]);
      expect(conflict.code).toBe(2);
    } finally {
      await db.end();
    }
  }, 90000);

  it('runs a saved preset without overriding its selected credentials or limits', async () => {
    const workspace = await client.workspaces.create({ name: 'CLI named account fixture' });
    const connection = await client.connections.create({
      name: 'Selected fixture key',
      kind: 'model',
      provider: 'openai',
      auth_method: 'api_key',
      secret: 'unused-simulator-key',
    });
    const preset = await client.agents.create({
      name: 'CLI preset',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'byok',
      provider_connection_id: connection.id,
      limits: { timeout_seconds: 60, max_cost_micro_usd: '1230000' },
    });
    const run = await json([
      'run',
      'Use the selected configuration',
      '--workspace',
      workspace.id,
      '--agent',
      preset.id,
      '--detach',
    ]);
    const session = await client.sessions.get(run.session_id);
    expect(session).toMatchObject({
      provider_connection_id: connection.id,
      billing_mode: 'byok',
      limits: { max_cost_micro_usd: '1230000' },
    });
    const final = await command(['run', 'attach', run.run_id, '--json']);
    expect(final.code, final.stderr).toBe(0);
    const shorter = await json([
      'run',
      'Use a shorter execution timeout',
      '--workspace',
      workspace.id,
      '--agent',
      preset.id,
      '--timeout',
      '30',
      '--detach',
    ]);
    expect((await client.sessions.get(shorter.session_id)).limits).toEqual({
      timeout_seconds: 30,
      max_cost_micro_usd: '1230000',
    });
    await client.runs.wait(shorter.run_id);
    const invalid = await command([
      'run',
      'Conflicting settings',
      '--agent',
      preset.id,
      '--billing-mode',
      'managed',
      '--json',
    ]);
    expect(invalid.code).toBe(2);
  }, 60000);
  it('documents all contracted commands and keeps invalid JSON output machine readable', async () => {
    for (const entry of contract.commands) {
      const value = await command([...entry.command.split(' '), '--help']);
      expect(value.code, entry.command + ' ' + value.stderr).toBe(0);
      expect(value.stdout).toContain(`Usage: macrofold ${entry.command}`);
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
  it('manages a Worker by exact name and resolves Run compute only from an explicit --worker', async () => {
    const offerings = await json(['worker', 'offerings']);
    expect(
      offerings.data.some(
        (item: { compute: string; isolate_runs: boolean }) => item.compute === 'sandbox' && item.isolate_runs,
      ),
    ).toBe(true);
    const name = `cli-worker-${Date.now()}`;
    const created = await json([
      'worker',
      'create',
      name,
      '--compute',
      'sandbox',
      '--pooled',
      '--isolated-runs',
      '--max-hourly-cost',
      '1.5',
    ]);
    expect(created).toMatchObject({
      name,
      compute: 'sandbox',
      dedicated: false,
      isolate_runs: true,
      max_hourly_compute_cost_micro_usd: '1500000',
    });
    expect((await json(['worker', 'show', name])).id).toBe(created.id);
    expect(
      (await json(['worker', 'list', '--limit', '100'])).data.map((w: { id: string }) => w.id),
    ).toContain(created.id);
    const updated = await json(['worker', 'update', name, '--max-concurrency', '2']);
    expect(updated).toMatchObject({ id: created.id, max_concurrency: 2, revision: created.revision + 1 });
    expect(await json(['worker', 'pause', name])).toMatchObject({ desired_state: 'paused' });
    expect(await json(['worker', 'resume', created.id])).toMatchObject({ desired_state: 'enabled' });

    // Invalid money and resource overrides fail before any request; unknown names are distinct not-found errors.
    const cost = await command(['worker', 'create', 'bad-cost', '--max-hourly-cost', '1.1234567', '--json']);
    expect(cost.code).not.toBe(0);
    expect(cost.stdout + cost.stderr).toContain('at most six decimal places');
    const resources = await command([
      'run',
      'prompt',
      '--harness',
      'codex',
      '--model',
      'fixture-model',
      '--memory-mib',
      '512',
      '--detach',
      '--json',
    ]);
    expect(resources.code).not.toBe(0);
    expect(resources.stdout + resources.stderr).toContain('Per-Run resource overrides require --worker.');
    const missing = await command([
      'run',
      'prompt',
      '--harness',
      'codex',
      '--model',
      'fixture-model',
      '--worker',
      `${name}-missing`,
      '--detach',
      '--json',
    ]);
    expect(missing.code).toBe(5);
    expect(missing.stdout + missing.stderr).toContain('Worker not found');

    expect(await json(['worker', 'destroy', name, '--yes'])).toMatchObject({ desired_state: 'destroyed' });
    // A destroyed Worker keeps its identity but no longer resolves by display name.
    expect((await command(['worker', 'show', name, '--json'])).code).toBe(5);
    expect((await json(['worker', 'show', created.id])).desired_state).toBe('destroyed');
  }, 60000);
  it('links without upload, isolates remote worktrees, transfers explicit files, streams and restores', async () => {
    const workspace = await json(['workspace', 'create', `CLI integration ${Date.now()}`]);
    const repo = path.join(directory, 'repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'local.txt'), 'Local work stays here until an explicit push.\n');
    await json(['link', workspace.id], { cwd: repo });
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
    expect(linked.worktreeId).not.toBe(link.worktreeId);
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
    const beforePull = await client.request('getWorktree', {
      params: { path: { worktree_id: linked.worktreeId } },
    });
    await client.request('writeFile', {
      params: {
        path: { worktree_id: beforePull.id },
        query: { path: 'local.txt' },
        header: { 'If-Match': beforePull.revision },
      },
      body: new TextEncoder().encode('Remote update before pulling\n'),
    });
    await chmod(path.join(repo, 'local.txt'), 0o755);
    await json(['files', 'pull', 'local.txt', '--yes'], { cwd: repo });
    expect((await lstat(path.join(repo, 'local.txt'))).mode & 0o777).toBe(0o755);
    expect(await readFile(path.join(repo, 'local.txt'), 'utf8')).toBe('Remote update before pulling\n');
    await writeFile(path.join(repo, 'local.txt'), 'Local edit\n');
    const worktree = await client.request('getWorktree', {
      params: { path: { worktree_id: linked.worktreeId } },
    });
    await client.request('writeFile', {
      params: {
        path: { worktree_id: worktree.id },
        query: { path: 'local.txt' },
        header: { 'If-Match': worktree.revision },
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
    const login = await json(['login', '--host', config.origin, '--profile', 'ci', '--api-key-stdin'], {
      stdin: key,
      apiKey: null,
    });
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
    const denied = await command(['workspace', 'list', '--json'], { cwd: unsafe });
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
    const workspace = await json(['workspace', 'create', 'Git review test']);
    await json(['link', workspace.id], { cwd: repo });
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
