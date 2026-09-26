import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { id, unseal } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import { createWorkspace } from '../../packages/core/src/workspaces';
import { admitRun, getNativeRun, type NativeRunRow } from '../../packages/core/src/runs';
import { AutomaticMachines } from '../../packages/core/src/automatic-machines';
import * as hosts from '../../packages/providers/src/hosts';
import type {
  HostBinding,
  HostControlRequest,
  HostHealth,
  HostProvider,
} from '../../packages/contracts/host-control';
import type { NativeConfiguration } from '../../packages/runtime/src/types';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let run: NativeRunRow;
let binding: HostBinding;
let health: HostHealth;
const calls: HostControlRequest[] = [];
const provider: HostProvider = {
  provision: vi.fn(async () => binding),
  start: vi.fn(async () => {}),
  exists: vi.fn(async () => true),
  destroy: vi.fn(async () => true),
  control: vi.fn(async (_binding, _secret, request) => {
    calls.push(request);
    switch (request.action) {
      case 'health':
        return health;
      case 'prepare':
        return { reused: false, restoreNamespaces: ['workspace', 'home'] };
      case 'launch':
        return 'fixture-command';
      case 'restore':
        return 'fixture-restore';
      case 'restored':
        return 'success';
      case 'probe':
        return {
          events: [{ sequence: 1, type: 'output.delta', data: { text: 'fixture' } }],
          nextOffset: 1,
          status: { state: 'running' },
          result: null,
          input: null,
        };
      case 'snapshot':
        return { entries: [], total: 0, totalBytes: 0 };
      case 'chunk':
        return { content: Buffer.from('fixture chunk').toString('base64') };
      case 'stdio':
        return { content: [{ type: 'text', text: 'fixture tool' }] };
      default:
        return {};
    }
  }),
};
const physical = { close: vi.fn(async () => ({ snapshotId: 'fixture-snapshot' })) };
const tx = <T>(action: Parameters<typeof transaction<T>>[1]) => transaction(account.p.organizationId, action);
const configuration = (): NativeConfiguration => ({
  runId: run.id,
  harness: 'codex',
  model: 'fixture-model',
  provider: 'openai',
  prompt: 'synthetic fixture',
  workspace: '/workspace',
  stateHome: '/agent-home',
  gatewayURL: 'https://fixture.example.test/gateway',
  toolURL: 'https://fixture.example.test/tools',
  token: 'synthetic-token',
  deadline: run.deadline!.toISOString(),
  toolGrants: false,
});

beforeAll(async () => {
  account = await fixtureAccount('Automatic compute boundary');
  await tx((t) => credit(t, account.p.organizationId, 100000000n, `automatic:${id()}`));
});
beforeEach(async () => {
  calls.length = 0;
  vi.clearAllMocks();
  vi.spyOn(hosts, 'hostProvider').mockReturnValue(provider);
  run = await tx(async (t) => {
    const workspace = await createWorkspace(t, account.p, { name: `Automatic ${id()}` });
    const accepted = await admitRun(t, account.p, {
      worktree_id: workspace.default_worktree_id,
      prompt: 'Synthetic automatic execution',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
    await t.query("UPDATE runs SET deadline=now()+interval '10 minutes',lease_generation=1 WHERE id=$1", [
      accepted.run_id,
    ]);
    return getNativeRun(t, accepted.run_id);
  });
  binding = {
    name: `env-${run.id}-1`,
    sessionId: 'provider-session',
    createdAt: new Date().toISOString(),
    controlBootId: id(),
  };
  health = {
    boot_id: binding.controlBootId!,
    started_at: binding.createdAt,
    configured: true,
    active_assignments: 0,
    capabilities: { scoped_processes: true, sibling_isolation: true, resource_meter: true },
    meters: null,
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await retireFixtureRuns(account.p.organizationId);
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('persists one control credential and scopes all automatic execution operations to its Run', async () => {
  const machine = new AutomaticMachines(run, 'docker', physical);
  expect(await machine.provision(`run-${run.id}`, 600)).toEqual(binding);
  const saved = await tx((t) => getNativeRun(t, run.id));
  const secret = unseal<string>(saved.config.automatic_control_secret_ciphertext!);
  expect(secret).toMatch(/^host_/);
  expect(provider.provision).toHaveBeenCalledWith(
    expect.objectContaining({
      name: binding.name,
      secret,
      lifetime_seconds: 780,
      concurrency: 1,
      isolate_runs: true,
    }),
  );
  await new AutomaticMachines(saved, 'docker', physical).provision(`run-${run.id}`, 600);
  expect(provider.start).toHaveBeenLastCalledWith(binding, secret);
  expect(await machine.prepare(binding, configuration())).toEqual({
    reused: false,
    restoreNamespaces: ['workspace', 'home'],
  });
  expect(calls.find((call) => call.action === 'configure')).toMatchObject({
    concurrency: 1,
    isolate_runs: true,
    warm_memory_mib: 0,
  });
  expect(calls.find((call) => call.action === 'prepare')).toMatchObject({
    worktree_id: run.worktree_id,
    resources: { memory_mib: 3584, cpu_millis: 2000 },
  });
  await machine.stage(binding, [
    { path: '/platform-control/restore/page-0.json', content: Buffer.from('manifest') },
  ]);
  expect(calls.at(-1)).toMatchObject({
    action: 'stage',
    files: [{ path: 'page-0.json', content: Buffer.from('manifest').toString('base64') }],
  });
  expect(await machine.restore(binding)).toBe('fixture-restore');
  expect(await machine.restored(binding)).toBe('success');
  expect(await machine.launch(binding)).toBe('fixture-command');
  expect(await machine.probe(binding, 0)).toMatchObject({
    nextOffset: 1,
    events: [{ type: 'output.delta' }],
  });
  expect(await machine.snapshotPage(binding, 0)).toEqual({ entries: [], total: 0, totalBytes: 0 });
  expect(await machine.chunk(binding, 'a'.repeat(64))).toEqual(Buffer.from('fixture chunk'));
  await machine.answer(binding, 'question', { approved: true });
  expect(calls.at(-1)).toMatchObject({ action: 'answer', id: 'question', answer: { approved: true } });
  expect(
    await machine.invokeStdio(binding, {
      id: id(),
      runId: run.id,
      command: '/opt/platform/fixture',
      args: [],
      environment: {},
      tool: 'lookup',
      arguments: {},
    }),
  ).toEqual({ content: [{ type: 'text', text: 'fixture tool' }] });
  await machine.cancel(binding);
  expect(calls.at(-1)).toMatchObject({ action: 'cancel' });
  expect(
    calls
      .filter((call) => 'assignment_id' in call)
      .every((call) => 'assignment_id' in call && call.assignment_id === run.id && call.run_id === run.id),
  ).toBe(true);
  expect(await machine.close(binding, true)).toEqual({ snapshotId: 'fixture-snapshot' });
  expect(physical.close).toHaveBeenCalledWith(binding, true);
});

it('rejects foreign identities and unsafe restoration paths before provider side effects', async () => {
  const machine = new AutomaticMachines(run, 'docker', physical);
  await expect(machine.provision(`run-${id()}`, 600)).rejects.toMatchObject({ code: 'invalid_execution' });
  await expect(machine.prepare(binding, { ...configuration(), runId: id() })).rejects.toMatchObject({
    code: 'invalid_configuration',
  });
  await expect(machine.cancel({ ...binding, name: 'foreign-run' })).rejects.toMatchObject({
    code: 'host_assignment_changed',
  });
  await expect(machine.cancel({ ...binding, controlBootId: undefined })).rejects.toMatchObject({
    code: 'host_assignment_changed',
  });
  await expect(
    machine.stage(binding, [{ path: '/platform-control/config.json', content: Buffer.from('unsafe') }]),
  ).rejects.toMatchObject({ code: 'invalid_stage_path' });
  expect(() => machine.close({ ...binding, name: 'foreign-run' }, false)).toThrow();
  expect(provider.provision).not.toHaveBeenCalled();
  expect(provider.control).not.toHaveBeenCalled();
  expect(physical.close).not.toHaveBeenCalled();
});

it.each(['boot', 'isolation'] as const)(
  'does not configure or launch a Host whose %s guarantee changed',
  async (condition) => {
    const machine = new AutomaticMachines(run, 'docker', physical);
    if (condition === 'boot') health.boot_id = id();
    else health.capabilities.sibling_isolation = false;
    await expect(machine.prepare(binding, configuration())).rejects.toMatchObject({
      code: 'host_isolation_unavailable',
    });
    expect(calls.map((call) => call.action)).toEqual(['health']);
  },
);

it.each(['cancelled', 'lease'] as const)('rechecks %s state before native launch', async (condition) => {
  const machine = new AutomaticMachines(run, 'docker', physical);
  await tx((t) =>
    t.query(
      condition === 'cancelled'
        ? 'UPDATE runs SET cancel_requested=true WHERE id=$1'
        : 'UPDATE runs SET lease_generation=2 WHERE id=$1',
      [run.id],
    ),
  );
  await expect(machine.launch(binding)).rejects.toMatchObject({ code: 'run_stopped' });
  expect(provider.control).not.toHaveBeenCalled();
});

it('retains uncertain pre-launch allocations until deletion is confirmed', async () => {
  const machine = new AutomaticMachines(run, 'docker', physical);
  vi.mocked(provider.destroy).mockResolvedValueOnce(false);
  await expect(machine.cleanupUnbound()).rejects.toMatchObject({ code: 'host_stop_unconfirmed' });
  await machine.cleanupUnbound();
  expect(provider.destroy).toHaveBeenCalledWith(binding.name, null);
});
