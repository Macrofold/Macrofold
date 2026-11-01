import { writeFixtureFile } from '../fixtures/file-mutation';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorktree, type FileRecord } from '../../packages/core/src/files';
import {
  admitRun,
  cancelRun,
  getNativeRun as getRun,
  presentRun,
  submitInput,
} from '../../packages/core/src/runs';
import { credit, reserve } from '../../packages/core/src/ledger';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import {
  advanceCloudRun,
  MAX_RUN_ADVANCES,
  MAX_RECOVERY_FAILURES,
  type CloudRunContext,
} from '../../packages/core/src/cloud-engine';
import * as runSource from '../../packages/core/src/runs';
import { FaultMachine } from '../fixtures/cloud-machine';
import { readContent, saveContent } from '../../packages/providers/src/storage';
import type { AgentPermissions } from '../../packages/contracts/permissions';
import { AppError } from '../../packages/core/src/errors';
import { streamEvents } from '../../packages/core/src/events';
import { dispatchFailed, MAX_DISPATCH_FAILURES } from '../../packages/core/src/dispatch-failures';
import { retireFixtureRuns } from '../fixtures/account';
import { requireNativeLaunch } from '../../packages/core/src/host-runtime';

const organizations = new Set<string>();
async function scenario(attachments?: string[], permissions?: AgentPermissions) {
  const user = (
    await auth.api.signUpEmail({
      body: {
        email: `cloud-${id()}@example.test`,
        password: 'cloud-test-password-123',
        name: 'Cloud fixture',
      },
    })
  ).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  organizations.add(org);
  const p: Principal = {
    id: user.id,
    userId: user.id,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    scopes: customerScopes,
    workspaceIds: [],
    operator: false,
  };
  const ws = await transaction(org, async (tx) => {
    await credit(tx, org, 10_000_000n, `fixture:${id()}`);
    const workspace = await resources.create(tx, 'workspaces', org, { name: 'Cloud fixture' });
    const created = await createWorktree(tx, p, workspace.id, { name: 'main', branch: 'main' });
    const worktreeId = (created.result as { worktree_id: string }).worktree_id;
    const ws = await resources.get(tx, 'worktrees', worktreeId);
    return ws;
  });
  const worktreeId = ws.id;
  await writeFixtureFile(p, worktreeId, 'initial.txt', Buffer.from('Original checkpoint'), ws.revision);
  return transaction(org, async (tx) => {
    const run = await admitRun(tx, p, {
      worktree_id: worktreeId,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      attachments,
      permissions,
      limits: { timeout_seconds: 900, max_cost_micro_usd: '2000000' },
    });
    // Local admission intentionally holds no real money. This test funds a ledger reservation explicitly.
    await reserve(tx, org, 2_000_000n);
    await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [run.run_id]);
    return { org, p, runId: run.run_id, worktreeId };
  });
}
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  // Recovery tests intentionally stop at live/blocked phases. Release only
  // their fixture occupancy so later global-fairness tests see no orphan work.
  for (const organization of organizations) await retireFixtureRuns(organization);
  organizations.clear();
});
async function advanceTo(s: Awaited<ReturnType<typeof scenario>>, provider: FaultMachine, phase: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    if (run.execution_binding?.phase === phase) return;
    await advanceCloudRun(s.org, s.runId, provider);
  }
  throw new Error(`Fixture did not reach ${phase}`);
}

/** Model lease expiry/takeover while a provider request is in flight. */
async function transferPhaseOwnership(s: Awaited<ReturnType<typeof scenario>>) {
  const owner = id();
  await transaction(s.org, async (tx) => {
    await tx.query('UPDATE runs SET execution_binding=execution_binding||$2::jsonb WHERE id=$1', [
      s.runId,
      JSON.stringify({ lock: owner, lockExpires: Date.now() + 120_000 }),
    ]);
    await tx.query("UPDATE dispatch_jobs SET available_at=now()+interval '2 minutes' WHERE resource_id=$1", [
      s.runId,
    ]);
  });
  return owner;
}

describe('prepared native phase advancement', () => {
  it('reuses immutable configuration while observing cancellation before the next phase', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const context: CloudRunContext = {};
    const reads = vi.spyOn(runSource, 'getRun');
    await advanceCloudRun(s.org, s.runId, provider, context);
    expect(context.run?.execution_binding?.phase).toBe('input');
    const fullReads = reads.mock.calls.length;
    expect(fullReads).toBeGreaterThan(0);
    await transaction(s.org, (tx) =>
      tx.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [s.runId]),
    );
    const staging = vi.spyOn(provider, 'stage');
    const stopped = await advanceCloudRun(s.org, s.runId, provider, context);
    expect(context.run?.cancel_requested).toBe(true);
    expect(stopped.delaySeconds).toBeGreaterThan(0);
    expect(staging).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(fullReads);
    expect(provider.starts).toBe(0);
  });

  it('does not reuse cached phase ownership after another controller claims it', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const context: CloudRunContext = {};
    await advanceCloudRun(s.org, s.runId, provider, context);
    const foreignClaim = id();
    await transaction(s.org, (tx) =>
      tx.query(`UPDATE runs SET execution_binding=execution_binding||$2::jsonb WHERE id=$1`, [
        s.runId,
        JSON.stringify({ lock: foreignClaim, lockExpires: Date.now() + 120_000 }),
      ]),
    );
    expect(await advanceCloudRun(s.org, s.runId, provider, context)).toMatchObject({
      done: false,
      delaySeconds: 5,
      canContinue: false,
      nextDispatchClass: 'transfer',
    });
    const current = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(current.execution_binding?.lock).toBe(foreignClaim);
    expect(provider.starts).toBe(0);
  });

  it('publishes due time atomically and retains dispatcher backoff only for a reserved local slot', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const retain = vi.fn(() => true);
    const context: CloudRunContext = { retainReady: retain };
    await advanceCloudRun(s.org, s.runId, provider, context);
    const due = async () =>
      transaction(
        s.org,
        async (tx) =>
          (
            await tx.query<{ due: boolean; phase: string }>(
              `SELECT j.available_at<=clock_timestamp() AS due,r.execution_binding->>'phase' AS phase
       FROM runs r JOIN dispatch_jobs j ON j.resource_id=r.id AND j.kind='run' WHERE r.id=$1`,
              [s.runId],
            )
          ).rows[0],
      );
    expect(retain).toHaveBeenCalledWith('transfer');
    expect(await due()).toEqual({ due: false, phase: 'input' });
    retain.mockReturnValue(false);
    await advanceCloudRun(s.org, s.runId, provider, context);
    expect(await due()).toEqual({ due: true, phase: 'hydrate' });
  });

  it('rejects a prepared context for another Run before touching execution', async () => {
    const first = await scenario(),
      second = await scenario(),
      provider = new FaultMachine();
    const context: CloudRunContext = {};
    await advanceCloudRun(first.org, first.runId, provider, context);
    await expect(advanceCloudRun(second.org, second.runId, provider, context)).rejects.toMatchObject({
      code: 'execution_context_mismatch',
    });
    expect(provider.starts).toBe(0);
  });

  it('stops a stale provisioning response before preparing or cleaning up its successor', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await transaction(s.org, (tx) =>
      tx.query('UPDATE runs SET execution_binding=$2 WHERE id=$1', [
        s.runId,
        { provider: 'vercel', phase: 'provision', failures: 2 },
      ]),
    );
    const original = provider.provision.bind(provider);
    let owner = '';
    vi.spyOn(provider, 'provision').mockImplementation(async (...args) => {
      const binding = await original(...args);
      owner = await transferPhaseOwnership(s);
      return binding;
    });
    const prepare = vi.spyOn(provider, 'prepare');
    expect(await advanceCloudRun(s.org, s.runId, provider)).toMatchObject({
      done: false,
      canContinue: false,
      delaySeconds: 5,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(provider.closes).toEqual([]);
    const row = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(row.execution_binding).toMatchObject({ lock: owner, phase: 'provision', failures: 2 });
  });

  it('does not run failure recovery after a transport error loses phase ownership', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'launch');
    await transaction(s.org, (tx) =>
      tx.query(
        "UPDATE runs SET execution_binding=jsonb_set(execution_binding,'{failures}','2') WHERE id=$1",
        [s.runId],
      ),
    );
    let owner = '';
    vi.spyOn(provider, 'launch').mockImplementation(async () => {
      owner = await transferPhaseOwnership(s);
      throw new Error('Synthetic transport response after phase takeover');
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toMatchObject({
      done: false,
      canContinue: false,
      delaySeconds: 5,
    });
    expect(provider.closes).toEqual([]);
    const row = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(row.execution_binding).toMatchObject({ lock: owner, phase: 'launch', failures: 2 });
    expect(
      (await pool.query('SELECT state FROM dispatch_jobs WHERE resource_id=$1', [s.runId])).rows[0].state,
    ).toBe('running');
  });

  it('retains SQLSTATE for owned phase failures without logging private exception text', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(provider, 'prepare').mockImplementation(async () => {
      await transaction(s.org, (tx) => tx.query('SELECT "fixture_private_value_not_for_logs"'));
    });
    await advanceCloudRun(s.org, s.runId, provider);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      code: 'native_phase_failed',
      phase: 'provision',
      organization_id: s.org,
      run_id: s.runId,
      error_type: 'Error',
      sqlstate: '42703',
    });
    const text = log.mock.calls.flat().join(' ');
    expect(text).not.toContain('fixture_private_value_not_for_logs');
    expect(text).not.toContain('SELECT');
  });

  it('cannot finish its successor dispatch job after a stale close response', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'close');
    let owner = '';
    vi.spyOn(provider, 'close').mockImplementation(async () => {
      owner = await transferPhaseOwnership(s);
      return {};
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toMatchObject({
      done: false,
      canContinue: false,
    });
    const row = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(row).toMatchObject({ status: 'succeeded', execution_binding: { lock: owner, phase: 'close' } });
    expect(
      (await pool.query('SELECT state FROM dispatch_jobs WHERE resource_id=$1', [s.runId])).rows[0].state,
    ).toBe('running');
    expect(provider.starts).toBe(1);
  });

  it('rejects terminal execution through the shared automatic and Worker launch gate', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'close');
    const expected = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(expected.status).toBe('succeeded');
    await expect(transaction(s.org, (tx) => requireNativeLaunch(tx, expected))).rejects.toMatchObject({
      code: 'run_stopped',
    });
    expect(provider.starts).toBe(1);
  });

  it('delivers an acknowledged answer once while continuing to poll the native Run', async () => {
    const s = await scenario(undefined, { version: 1, questions: 'allow' }),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'poll');
    let answered = false;
    const answer = vi.spyOn(provider, 'answer').mockImplementation(async () => {
      answered = true;
    });
    vi.spyOn(provider, 'probe').mockImplementation(async (_binding, offset) => ({
      events: [],
      nextOffset: offset,
      status: { state: 'running' },
      result: null,
      input: answered ? null : { id: 'fixture-question', question: 'Synthetic question', details: {} },
    }));
    await advanceCloudRun(s.org, s.runId, provider);
    await transaction(s.org, (tx) =>
      submitInput(tx, s.p, s.runId, {
        input_request_id: 'fixture-question',
        answer: { text: 'Synthetic answer' },
      }),
    );
    await advanceCloudRun(s.org, s.runId, provider);
    await advanceCloudRun(s.org, s.runId, provider);
    expect(answer).toHaveBeenCalledOnce();
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('running');
  });

  it.each(['cancellation', 'timeout'] as const)('does not deliver a queued answer after %s', async (stop) => {
    const s = await scenario(undefined, { version: 1, questions: 'allow' }),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'poll');
    const answer = vi.spyOn(provider, 'answer');
    vi.spyOn(provider, 'probe').mockImplementation(async (_binding, offset) => ({
      events: [],
      nextOffset: offset,
      status: { state: 'running' },
      result: null,
      input: {
        id: provider.cancellations ? 'stopped-late-question' : 'stopped-question',
        question: 'Synthetic question',
        details: {},
      },
    }));
    await advanceCloudRun(s.org, s.runId, provider);
    await transaction(s.org, async (tx) => {
      await submitInput(tx, s.p, s.runId, {
        input_request_id: 'stopped-question',
        answer: { text: 'Late answer' },
      });
      if (stop === 'cancellation') await cancelRun(tx, s.p, s.runId);
      else
        await tx.query("UPDATE runs SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", [
          s.runId,
        ]);
    });
    await advanceCloudRun(s.org, s.runId, provider);
    expect(provider.cancellations).toBe(1);
    expect(answer).not.toHaveBeenCalled();
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).input_request?.id).toBe(
      'stopped-question',
    );
  });
});

describe('finite native recovery', () => {
  it.each(['poll', 'publish'])(
    'preserves checkpoint and provisional settlement after a model failure at %s',
    async (phase) => {
      const s = await scenario(),
        provider = new FaultMachine();
      await advanceTo(s, provider, phase);
      const requestId = id();
      await transaction(s.org, async (tx) => {
        await tx.query(
          `UPDATE runs SET config=jsonb_set(config,'{limits,stop_on_model_error}','true'),
        model_reserved_micro_usd=17,model_error_request_id=$2 WHERE id=$1`,
          [s.runId, phase === 'poll' ? requestId : null],
        );
        await tx.query(
          `INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd)
        VALUES($1,$2,$3,1,'fixture-model','openai','managed','in_flight',17)`,
          [requestId, s.org, s.runId],
        );
      });
      // At publish this emulates recovery of a lost model response: orphan
      // reconciliation must not let the nominal harness success win.
      await advanceTo(s, provider, 'done');
      const result = await transaction(s.org, async (tx) => ({
        run: await getRun(tx, s.runId),
        usage: (await tx.query('SELECT * FROM model_usage WHERE run_id=$1', [s.runId])).rows,
        org: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org])).rows[0],
      }));
      expect(result.run).toMatchObject({
        status: 'failed',
        cancel_requested: false,
        model_error_request_id: requestId,
        result: {
          execution_outcome: 'failure',
          persistence_status: 'verified',
          failure_code: 'model_request_failed',
        },
      });
      expect(result.usage).toHaveLength(1);
      expect(result.usage[0]).toMatchObject({ completeness: 'missing', cost_micro_usd: '17' });
      expect(result.org.reserved_micro_usd).toBe('0');
      expect(provider.starts).toBe(1);
      if (phase === 'poll') expect(provider.cancellations).toBeGreaterThan(0);
    },
  );
  it.each(['questions_denied', 'model_request_failed'] as const)(
    'rejects a native question after %s without losing the checkpoint',
    async (failureCode) => {
      const s = await scenario(undefined, {
        version: 1,
        questions: failureCode === 'questions_denied' ? 'deny' : 'allow',
      });
      const provider = new FaultMachine();
      const probe = provider.probe.bind(provider);
      vi.spyOn(provider, 'probe').mockImplementation(async (...args) => {
        if (provider.cancellations) return probe(...args);
        // A model failure committed after the poller's initial Run read must
        // suppress even an otherwise permitted question returned by this probe.
        if (failureCode === 'model_request_failed')
          await transaction(s.org, (tx) =>
            tx.query('UPDATE runs SET model_error_request_id=$2 WHERE id=$1', [s.runId, id()]),
          );
        return {
          events: [],
          nextOffset: args[1],
          status: { state: 'running' },
          result: null,
          input: { id: 'denied-question', question: 'Synthetic question', details: {} },
        };
      });
      await advanceTo(s, provider, 'done');
      const saved = await transaction(s.org, async (tx) => ({
        run: await getRun(tx, s.runId),
        questions: (
          await tx.query("SELECT 1 FROM run_events WHERE run_id=$1 AND type='input.requested'", [s.runId])
        ).rowCount,
      }));
      expect(saved.run).toMatchObject({
        status: 'failed',
        input_request: null,
        result: {
          failure_code: failureCode,
          execution_outcome: 'failure',
          persistence_status: 'verified',
        },
      });
      expect(saved.questions).toBe(0);
      expect(provider.cancellations).toBeGreaterThan(0);
    },
  );
  it('stops exhausted publication without releasing money, replacing files or replaying the agent', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceTo(s, provider, 'publish');
    const before = await transaction(s.org, (tx) => resources.get(tx, 'worktrees', s.worktreeId));
    const update = resources.update;
    vi.spyOn(resources, 'update').mockImplementation(async (...args) => {
      if (args[1] === 'worktrees')
        throw new AppError(503, 'fixture_publication_failure', 'Synthetic persistence outage');
      return update(...args);
    });
    let done = false;
    for (let attempt = 0; attempt < MAX_RECOVERY_FAILURES + 5 && !done; attempt++)
      done = (await advanceCloudRun(s.org, s.runId, provider)).done;
    expect(done).toBe(true);
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      worktree: await resources.get(tx, 'worktrees', s.worktreeId),
      holds: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org])).rows[0]
        .reserved_micro_usd,
      job: (await tx.query("SELECT state FROM dispatch_jobs WHERE kind='run' AND resource_id=$1", [s.runId]))
        .rows[0],
      recoveryEvents: (
        await tx.query(
          "SELECT count(*)::integer AS count FROM run_events WHERE run_id=$1 AND type='run.recovery_required'",
          [s.runId],
        )
      ).rows[0].count,
    }));
    expect(saved.run.execution_binding).toMatchObject({ recoveryBlocked: true });
    expect(saved.run.result.failure_code).toBe('run_recovery_required');
    expect(presentRun(saved.run).failure_code).toBe('run_recovery_required');
    expect(saved.worktree.files).toEqual(before.files);
    expect(saved.worktree.latest_checkpoint_id).toBe(before.latest_checkpoint_id);
    expect(saved.holds).toBe('2000000');
    expect(saved.job.state).toBe('blocked');
    expect(saved.recoveryEvents).toBe(1);
    const replay = await new Response(
      await streamEvents(s.org, s.runId, '0', new AbortController().signal),
    ).text();
    expect(replay).toContain('event: run.recovery_required');
    expect(replay).toContain('"step":"finalization"');
    expect(replay).toContain('"cause":"fixture_publication_failure"');
    expect(replay).toContain('"attempts":8');
    const starts = provider.starts;
    expect((await advanceCloudRun(s.org, s.runId, provider)).done).toBe(true);
    expect(provider.starts).toBe(starts);
  });
  it('reports dispatch failure before execution without pretending that files were lost', async () => {
    const s = await scenario();
    for (let attempt = 0; attempt < MAX_DISPATCH_FAILURES; attempt++)
      await dispatchFailed(s.org, 'run', s.runId, 'docker_image_missing');
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      events: (
        await tx.query("SELECT data FROM run_events WHERE run_id=$1 AND type='run.recovery_required'", [
          s.runId,
        ])
      ).rows,
    }));
    expect(saved.run.started_at).toBeNull();
    expect(saved.events).toEqual([
      {
        data: { code: 'run_recovery_required', step: 'dispatch', cause: 'docker_image_missing', attempts: 8 },
      },
    ]);
  });
  it.each(['billing', 'cleanup'] as const)(
    'records the actual failed %s step and preserves checkpoint/charge distinctions',
    async (step) => {
      const s = await scenario(),
        provider = new FaultMachine();
      await advanceTo(s, provider, step === 'billing' ? 'publish' : 'close');
      if (step === 'billing')
        await transaction(s.org, (tx) =>
          tx.query('UPDATE runs SET cost_micro_usd=2000001 WHERE id=$1', [s.runId]),
        );
      else
        vi.spyOn(provider, 'close').mockRejectedValue(
          new AppError(503, 'docker_command_timeout', 'Unsafe provider error must not be emitted'),
        );
      let done = false;
      for (let attempt = 0; attempt < MAX_RECOVERY_FAILURES + 5 && !done; attempt++)
        done = (await advanceCloudRun(s.org, s.runId, provider)).done;
      expect(done).toBe(true);
      const saved = await transaction(s.org, async (tx) => ({
        run: await getRun(tx, s.runId),
        event: (
          await tx.query("SELECT data FROM run_events WHERE run_id=$1 AND type='run.recovery_required'", [
            s.runId,
          ])
        ).rows[0].data,
        holds: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org])).rows[0]
          .reserved_micro_usd,
      }));
      expect(saved.event).toMatchObject({
        step,
        attempts: 8,
        cause: step === 'billing' ? 'accounting_bound_failed' : 'docker_command_timeout',
      });
      expect(JSON.stringify(saved.event)).not.toContain('Unsafe provider error');
      expect(saved.run.result.persistence_status).toBe(step === 'cleanup' ? 'verified' : undefined);
      expect(saved.holds).toBe(step === 'cleanup' ? '0' : '2000000');
      expect(provider.starts).toBe(1);
    },
  );
  it.each(['events', 'snapshot', 'advances', 'cancellation'] as const)(
    'bounds stalled %s without a new native launch',
    async (failure) => {
      const s = await scenario(),
        provider = new FaultMachine();
      await advanceTo(s, provider, failure === 'snapshot' ? 'index' : 'poll');
      if (failure === 'events')
        vi.spyOn(provider, 'probe').mockImplementation(async (_binding, offset) => ({
          events: [{ sequence: 1, type: 'output.delta', data: { text: 'fixture' } }],
          nextOffset: offset,
          status: { state: 'running' },
          input: null,
          result: null,
        }));
      if (failure === 'snapshot')
        vi.spyOn(provider, 'snapshotPage').mockResolvedValue({ entries: [], total: 1, totalBytes: 1 });
      if (failure === 'advances')
        await transaction(s.org, (tx) =>
          tx.query(
            `UPDATE runs SET execution_binding=jsonb_set(execution_binding,'{advances}',$2::jsonb) WHERE id=$1`,
            [s.runId, String(MAX_RUN_ADVANCES)],
          ),
        );
      if (failure === 'cancellation') {
        provider.pendingPolls = 100;
        vi.spyOn(provider, 'cancel').mockResolvedValue(undefined);
        await transaction(s.org, (tx) =>
          tx.query(
            `UPDATE runs SET cancel_requested=true,execution_binding=jsonb_set(execution_binding,'{cancelStartedAt}',$2::jsonb) WHERE id=$1`,
            [s.runId, String(Date.now() - 61_000)],
          ),
        );
      }
      let done = false;
      for (let attempt = 0; attempt < 15 && !done; attempt++)
        done = (await advanceCloudRun(s.org, s.runId, provider)).done;
      expect(done).toBe(true);
      expect(provider.starts).toBe(1);
      const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
      expect(run.result.failure_code).toBe(
        {
          events: 'runtime_cursor_stalled',
          snapshot: 'checkpoint_cursor_stalled',
          advances: 'execution_progress_exhausted',
          cancellation: 'cancellation_unconfirmed',
        }[failure],
      );
    },
  );
});
describe('durable cloud lifecycle with fault injection', () => {
  it.each(['restore', 'poll', 'publish'] as const)(
    'finalizes guarded %s failure without deleting protected files, replacing session state or replaying execution',
    async (phase) => {
      const s = await scenario(undefined, {
        version: 1,
        files: { read: { include: ['**'] }, write: { include: ['**'], exclude: ['initial.txt'] } },
        shell: 'deny',
      });
      const provider = new FaultMachine();
      if (phase === 'restore')
        vi.spyOn(provider, 'restore').mockRejectedValue(
          new AppError(503, 'restore_failed', 'Fixture restore failure'),
        );
      if (phase === 'poll') provider.lostVM = true;
      // The verified fixture output omits protected initial.txt: that deletion must still be rejected.
      const before = await transaction(s.org, async (tx) => {
        const run = await getRun(tx, s.runId);
        await resources.update(tx, 'sessions', run.session_id, { native_session_id: 'previous-session' });
        return {
          worktree: await resources.get(tx, 'worktrees', s.worktreeId),
          session: await resources.get(tx, 'sessions', run.session_id),
        };
      });
      let done = false;
      for (let i = 0; i < 40 && !done; i++) done = (await advanceCloudRun(s.org, s.runId, provider)).done;
      expect(done).toBe(true);
      // Retrying terminal completion must neither launch again nor settle twice.
      expect((await advanceCloudRun(s.org, s.runId, provider)).done).toBe(true);
      const saved = await transaction(s.org, async (tx) => {
        const run = await getRun(tx, s.runId);
        return {
          run,
          worktree: await resources.get(tx, 'worktrees', s.worktreeId),
          session: await resources.get(tx, 'sessions', run.session_id),
          reserved: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org]))
            .rows[0].reserved_micro_usd,
          journals: (
            await tx.query(
              'SELECT count(DISTINCT journal_id)::int AS n,sum(amount_micro_usd) AS balance FROM ledger WHERE reference=$1',
              [`run:${s.runId}`],
            )
          ).rows[0],
        };
      });
      expect(saved.run).toMatchObject({
        status: 'failed',
        result: {
          persistence_status: 'failed',
          last_verified_checkpoint_id: before.worktree.latest_checkpoint_id,
          failure_code:
            phase === 'restore'
              ? 'restore_failed'
              : phase === 'poll'
                ? 'execution_transport_failed'
                : 'file_permission_denied',
        },
      });
      expect(saved.run.result.checkpoint_id).toBeUndefined();
      expect(saved.worktree).toMatchObject({
        status: 'degraded',
        files: before.worktree.files,
        latest_checkpoint_id: before.worktree.latest_checkpoint_id,
      });
      expect(saved.session).toEqual(before.session);
      expect(saved.reserved).toBe('0');
      expect(saved.journals).toEqual({ n: 1, balance: '0' });
      expect(provider.starts).toBe(phase === 'restore' ? 0 : 1);
      expect(provider.closes.every(Boolean)).toBe(true);
    },
  );

  it('finalizes cancelled guarded capture failure while preserving the last verified checkpoint', async () => {
    const s = await scenario(undefined, {
      version: 1,
      files: { read: { include: ['**'] }, write: { include: [] } },
      shell: 'deny',
    });
    const provider = new FaultMachine();
    provider.lostVM = true;
    for (let i = 0; i < 25; i++) {
      await advanceCloudRun(s.org, s.runId, provider);
      if ((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase === 'publish')
        break;
    }
    await transaction(s.org, (tx) =>
      tx.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [s.runId]),
    );
    let done = false;
    for (let i = 0; i < 10 && !done; i++) done = (await advanceCloudRun(s.org, s.runId, provider)).done;
    expect(done).toBe(true);
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run).toMatchObject({
      status: 'cancelled',
      result: { persistence_status: 'failed', failure_code: 'execution_transport_failed' },
    });
    expect(run.result.checkpoint_id).toBeUndefined();
    expect(provider.starts).toBe(1);
  });

  it('skips regenerable home objects before restoration and upload while publishing native history', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const saved = await saveContent(s.org, Buffer.from('synthetic native history'));
    const history: FileRecord = {
      ...saved,
      path: '.codex/memories_1.sqlite',
      type: 'file',
      mode: 0o600,
      git_ignored: true,
      modified_at: new Date().toISOString(),
    };
    await transaction(s.org, async (tx) => {
      const run = await getRun(tx, s.runId);
      await resources.update(tx, 'sessions', run.session_id, {
        state_files: [
          history,
          {
            ...history,
            path: '.unknown-runtime/install-v2/plugin.js',
            sha256: '0'.repeat(64),
            key: `${s.org}/content/${'0'.repeat(64)}`,
          },
        ],
      });
    });
    const snapshot = provider.snapshotPage.bind(provider);
    vi.spyOn(provider, 'snapshotPage').mockImplementation(async (binding, offset) => {
      const page = await snapshot(binding, offset);
      return {
        ...page,
        total: page.total + 2,
        entries: [
          ...page.entries,
          { ...page.entries[2], path: '.codex/memories_1.sqlite' },
          {
            ...page.entries[2],
            path: '.unknown-runtime/downloads-v2/cache',
            sha256: '0'.repeat(64),
            chunks: [{ hash: '0'.repeat(64), size: provider.bytes.length }],
          },
        ],
      };
    });
    for (let i = 0; i < 40; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('succeeded');
    expect(run.result.persistence_status).toBe('verified');
    expect(provider.stageFiles.get(`/platform-control/restore/chunks/${history.sha256}`)).toEqual(
      Buffer.from('synthetic native history'),
    );
    const pages = [...provider.stageFiles.entries()].filter(([name]) => /page-\d+\.json$/.test(name));
    expect(pages.length).toBeGreaterThan(0);
    for (const [, bytes] of pages) expect(bytes.toString()).not.toContain('.unknown-runtime/install-v2');
    const session = await transaction(s.org, (tx) => resources.get(tx, 'sessions', run.session_id));
    expect(session.state_files?.map((file) => file.path).sort()).toEqual([
      '.codex/memories_1.sqlite',
      '.codex/sessions/history.jsonl',
    ]);
    for (const file of session.state_files || [])
      expect(await readContent(file.key, file.sha256)).toEqual(provider.bytes);
    expect(provider.starts).toBe(1);
  });

  it('advances ready phases immediately, batches restoration, and preserves progress after a lost upload acknowledgement', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const extra: FileRecord[] = [];
    for (let i = 0; i < 40; i++) {
      const saved = await saveContent(s.org, Buffer.from(`small file ${i}`));
      extra.push({
        ...saved,
        path: `file-${i}.txt`,
        type: 'file',
        mode: 0o644,
        git_ignored: false,
        modified_at: new Date().toISOString(),
      });
    }
    await transaction(s.org, async (tx) => {
      const ws = await resources.get(tx, 'worktrees', s.worktreeId);
      await tx.query("UPDATE worktrees SET data=jsonb_set(data,'{files}',$2::jsonb) WHERE id=$1", [
        s.worktreeId,
        JSON.stringify([...(ws.files || []), ...extra]),
      ]);
    });
    for (let i = 0; i < 10; i++) {
      expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
      if ((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase === 'hydrate')
        break;
    }
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase).toBe('hydrate');
    const write = provider.stage.bind(provider);
    const stage = vi.spyOn(provider, 'stage').mockImplementationOnce(async (binding, files) => {
      await write(binding, files.slice(0, 1));
      throw new Error('Lost batch acknowledgement');
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toMatchObject({ done: false, delaySeconds: 2 });
    const processed = await transaction(s.org, (tx) =>
      tx.query("SELECT id FROM execution_objects WHERE run_id=$1 AND kind LIKE 'input_%' AND processed", [
        s.runId,
      ]),
    );
    expect(processed.rowCount).toBe(0);
    expect(provider.starts).toBe(0);
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    expect(stage.mock.calls[0][1]).toHaveLength(32);
    expect(stage.mock.calls[1][1]).toEqual(stage.mock.calls[0][1]);
    for (let i = 0; i < 40; i++) {
      const result = await advanceCloudRun(s.org, s.runId, provider);
      expect(result.delaySeconds).toBe(0);
      if (result.done) break;
    }
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('succeeded');
    expect(run.result.persistence_status).toBe('verified');
    expect(provider.starts).toBe(1);
    expect(stage).toHaveBeenCalledTimes(3); // one uncertain upload, then two successful batches
    for (const file of extra)
      expect(provider.stageFiles.get(`/platform-control/restore/chunks/${file.sha256}`)).toEqual(
        await readContent(file.key, file.sha256),
      );
    expect(run.execution_binding?.phaseTimings?.hydrate).toMatchObject({
      attempts: 4,
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      activeMs: expect.any(Number),
    });
    expect(run.execution_binding?.phaseTimings?.hydrate?.activeMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps actual restore and execution waits without delaying ready work in the SQL poller', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    vi.spyOn(provider, 'restored').mockResolvedValueOnce('pending');
    const first = await dispatchCloudPoller(provider, 1, s.org);
    expect(first).toMatchObject({ advanced: 1, failed: 0, ready: true });
    // No forced available_at update: the next phase must already be due.
    expect(await dispatchCloudPoller(provider, 1, s.org)).toMatchObject({
      advanced: 1,
      failed: 0,
      ready: true,
    });
    for (let i = 0; i < 10; i++) {
      const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
      if (run.execution_binding?.phase === 'restore_wait') break;
      expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    }
    expect(await advanceCloudRun(s.org, s.runId, provider)).toMatchObject({ done: false, delaySeconds: 3 });
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    expect((await advanceCloudRun(s.org, s.runId, provider)).delaySeconds).toBe(0);
    provider.pendingPolls = 1;
    const waiting = await dispatchCloudPoller(provider, 1, s.org);
    expect(waiting).toMatchObject({ advanced: 1, ready: false });
    const next = await pool.query(
      'SELECT available_at>now() AS delayed FROM dispatch_jobs WHERE resource_id=$1',
      [s.runId],
    );
    expect(next.rows[0].delayed).toBe(true);
    for (let i = 0; i < 30; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
  });
  it('carries attachment hashes into the native configuration and publishes verified deliverables once', async () => {
    const s = await scenario(['initial.txt']),
      provider = new FaultMachine();
    const prepare = vi.spyOn(provider, 'prepare');
    const snapshot = provider.snapshotPage.bind(provider);
    vi.spyOn(provider, 'snapshotPage').mockImplementation(async (binding, offset) => {
      const page = await snapshot(binding, offset);
      return {
        ...page,
        entries: page.entries.map((entry) =>
          entry.path === 'durable.txt' ? { ...entry, path: 'outputs/report.txt' } : entry,
        ),
      };
    });
    for (let i = 0; i < 80; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect(prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ path: 'initial.txt', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        ],
      }),
    );
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('succeeded');
    expect(run.result.artifact_ids).toHaveLength(1);
    const artifact = await transaction(s.org, (tx) =>
      resources.get(tx, 'artifacts', run.result.artifact_ids![0], s.p),
    );
    expect(artifact.name).toBe('outputs/report.txt');
    expect(await readContent(artifact.key, artifact.sha256)).toEqual(provider.bytes);
    await advanceCloudRun(s.org, s.runId, provider);
    expect((await transaction(s.org, (tx) => tx.query('SELECT id FROM artifacts'))).rowCount).toBe(1);
  });
  it('waits for an owned execution phase lease and resumes after expiry without double launching', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await advanceCloudRun(s.org, s.runId, provider);
    await transaction(s.org, async (tx) => {
      const run = await getRun(tx, s.runId);
      await tx.query('UPDATE runs SET execution_binding=$2 WHERE id=$1', [
        s.runId,
        { ...run.execution_binding, lock: 'other-worker', lockExpires: Date.now() + 60000 },
      ]);
    });
    expect(await advanceCloudRun(s.org, s.runId, provider)).toEqual({
      done: false,
      delaySeconds: 5,
      nextDispatchClass: 'transfer',
      canContinue: false,
    });
    expect(provider.starts).toBe(0);
    await transaction(s.org, (tx) =>
      tx.query(
        "UPDATE runs SET execution_binding=jsonb_set(execution_binding,'{lockExpires}','0') WHERE id=$1",
        [s.runId],
      ),
    );
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
    expect(provider.starts).toBe(1);
  });
  it('drops native authentication entries before reading or persisting their chunks', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    const originalPage = provider.snapshotPage.bind(provider);
    vi.spyOn(provider, 'snapshotPage').mockImplementation(async (binding, offset) => {
      const page = await originalPage(binding, offset);
      const credential = {
        ...page.entries[0],
        namespace: 'home' as const,
        path: '.claude/.credentials.json',
        sha256: 'a'.repeat(64),
        chunks: [{ hash: 'a'.repeat(64), size: 11 }],
      };
      return { ...page, entries: [...page.entries, credential], total: page.total + 1 };
    });
    const chunk = vi.spyOn(provider, 'chunk');
    for (let i = 0; i < 80; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const saved = await transaction(s.org, async (tx) => {
      const run = await getRun(tx, s.runId);
      return { run, session: await resources.get(tx, 'sessions', run.session_id) };
    });
    expect(saved.run.status).toBe('succeeded');
    expect(JSON.stringify(saved.session.state_files)).not.toContain('.credentials');
    expect(chunk).not.toHaveBeenCalledWith(expect.anything(), 'a'.repeat(64));
    expect(provider.starts).toBe(1);
  });
  it('fails a recovered gated subscription job without launching or losing its reservation', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    await transaction(s.org, (tx) =>
      tx.query("UPDATE runs SET config=jsonb_set(config,'{billing_mode}','\"subscription\"') WHERE id=$1", [
        s.runId,
      ]),
    );
    await advanceCloudRun(s.org, s.runId, provider);
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      balance: (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [s.org])).rows[0],
    }));
    expect(saved.run).toMatchObject({
      status: 'failed',
      result: { failure_code: 'claude_subscription_unavailable' },
    });
    expect(saved.balance.reserved_micro_usd).toBe('0');
    expect(provider.starts).toBe(0);
    await advanceCloudRun(s.org, s.runId, provider);
    expect(provider.starts).toBe(0);
  });
  it('settles with the admitted compute rate after operator pricing changes', async () => {
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '8000');
    const s = await scenario(),
      provider = new FaultMachine();
    for (let i = 0; i < 60; i++) {
      await advanceCloudRun(s.org, s.runId, provider);
      if ((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase === 'publish')
        break;
    }
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).execution_binding?.phase).toBe('publish');
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    await transaction(s.org, (tx) =>
      tx.query('UPDATE runs SET started_at=$2 WHERE id=$1', [s.runId, new Date(now - 60000)]),
    );
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '8000000');
    for (let i = 0; i < 5; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      account: (
        await tx.query('SELECT reserved_micro_usd,balance_micro_usd FROM organizations WHERE id=$1', [s.org])
      ).rows[0],
      charges: (
        await tx.query("SELECT amount_micro_usd FROM ledger WHERE reference=$1 AND account='consumption'", [
          `run:${s.runId}`,
        ])
      ).rows,
    }));
    expect(saved.run.status).toBe('succeeded');
    expect(saved.run.cost_micro_usd).toBe('8000');
    expect(saved.account).toEqual({ reserved_micro_usd: '0', balance_micro_usd: '9992000' });
    expect(saved.charges).toEqual([{ amount_micro_usd: '8000' }]);
    expect(provider.starts).toBe(1);
  });
  it('recovers a lost launch acknowledgement without repeating the native prompt; persists worktree, Git, and session state', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostLaunch = true;
    let done = false;
    for (let i = 0; i < 60 && !done; i++) done = (await advanceCloudRun(s.org, s.runId, provider)).done;
    expect(done).toBe(true);
    expect(provider.attempts).toBe(2);
    expect(provider.starts).toBe(1);
    expect(provider.closes).toEqual([false]);
    expect(provider.stageFiles.has('/platform-control/restore/page-0.json')).toBe(true);
    const saved = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      ws: await resources.get(tx, 'worktrees', s.worktreeId),
    }));
    expect(saved.run.status).toBe('succeeded');
    expect(saved.run.result.persistence_status).toBe('verified');
    const file = (saved.ws.files as FileRecord[])[0];
    expect((await readContent(file.key, file.sha256)).toString()).toBe(provider.bytes.toString());
    expect((saved.ws.git_files as FileRecord[])[0].path).toBe('.git/HEAD');
    const session = await transaction(s.org, (tx) => resources.get(tx, 'sessions', saved.run.session_id));
    expect(session.native_session_id).toBe('native-session');
    expect((session.state_files as FileRecord[])[0].path).toBe('.codex/sessions/history.jsonl');
    const journal = await transaction(s.org, (tx) =>
      tx.query('SELECT sum(amount_micro_usd) AS balance FROM ledger WHERE reference=$1', [`run:${s.runId}`]),
    );
    expect(journal.rows[0].balance).toBe('0');
  });
  it('continues a session on a prepared Host by restoring only the namespaces that Host lacks', async () => {
    const s = await scenario();
    let done = false;
    for (let i = 0; i < 60 && !done; i++)
      done = (await advanceCloudRun(s.org, s.runId, new FaultMachine())).done;
    expect(done).toBe(true);
    const followUp = await transaction(s.org, async (tx) => {
      const first = await getRun(tx, s.runId);
      const next = await admitRun(tx, s.p, {
        session_id: first.session_id,
        prompt: 'Continue on a warm Host',
      });
      await reserve(tx, s.org, 2_000_000n);
      await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [next.run_id]);
      return next.run_id;
    });
    // The Host already holds a clean materialization of this Worktree; only native home state is missing.
    const host = new FaultMachine();
    host.prepared = { reused: false, restoreNamespaces: ['home'] };
    done = false;
    for (let i = 0; i < 60 && !done; i++) done = (await advanceCloudRun(s.org, followUp, host)).done;
    expect(done).toBe(true);
    const pages = await transaction(s.org, (tx) =>
      tx.query<{ data: { entries: { namespace: string; path: string }[] } }>(
        "SELECT data FROM execution_objects WHERE run_id=$1 AND kind='input_page'",
        [followUp],
      ),
    );
    const staged = pages.rows.flatMap((row) => row.data.entries).map((e) => `${e.namespace}/${e.path}`);
    expect(staged).toEqual(['home/.codex/sessions/history.jsonl']);
    const restored = JSON.parse(host.stageFiles.get('/platform-control/restore/page-0.json')!.toString());
    expect(restored.map((e: { namespace: string }) => e.namespace)).toEqual(['home']);
    const run = await transaction(s.org, (tx) => getRun(tx, followUp));
    expect(run).toMatchObject({
      status: 'succeeded',
      session_id: (await transaction(s.org, (tx) => getRun(tx, s.runId))).session_id,
    });
    expect(run.result.persistence_status).toBe('verified');
  });
  it('runs the same durable lifecycle through competing standalone pollers', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostLaunch = true;
    // Establish real overlap. Promise.all alone also allows sequential ready
    // phases to finish and be claimed again, which is valid immediate progress.
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provision = provider.provision.bind(provider);
    vi.spyOn(provider, 'provision').mockImplementationOnce(async (name) => {
      entered();
      await gate;
      return provision(name);
    });
    const first = dispatchCloudPoller(provider, 1, s.org);
    try {
      await started;
      expect(await dispatchCloudPoller(provider, 1, s.org)).toMatchObject({ advanced: 0, failed: 0 });
    } finally {
      release();
      await first;
    }
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await pool.query("UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND resource_id=$1", [
        s.runId,
      ]);
      const results = await Promise.all([
        dispatchCloudPoller(provider, 1, s.org),
        dispatchCloudPoller(provider, 1, s.org),
      ]);
      expect(results.every((result) => result.failed === 0)).toBe(true);
      const row = await transaction(s.org, (tx) => getRun(tx, s.runId));
      done = row.execution_binding?.phase === 'done';
    }
    expect(done).toBe(true);
    expect(provider.starts).toBe(1);
    expect(provider.attempts).toBe(2);
    expect((await transaction(s.org, (tx) => getRun(tx, s.runId))).status).toBe('succeeded');
  });
  it('publishes modified files even when the native agent fails', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.outcome = 'failure';
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const run = await transaction(s.org, (tx) => getRun(tx, s.runId));
    expect(run.status).toBe('failed');
    expect(run.result.persistence_status).toBe('verified');
    expect(run.result.checkpoint_id).toBeTruthy();
    expect(provider.closes).toEqual([false]);
  });
  it('retains an unavailable VM for recovery and blocks further writers instead of publishing stale files as a new checkpoint', async () => {
    const s = await scenario(),
      provider = new FaultMachine();
    provider.lostVM = true;
    for (let i = 0; i < 60; i++) if ((await advanceCloudRun(s.org, s.runId, provider)).done) break;
    const { run, ws } = await transaction(s.org, async (tx) => ({
      run: await getRun(tx, s.runId),
      ws: await resources.get(tx, 'worktrees', s.worktreeId),
    }));
    expect(run.status).toBe('failed');
    expect(run.result.persistence_status).toBe('failed');
    expect(run.result.checkpoint_id).toBeUndefined();
    expect(ws.status).toBe('degraded');
    expect(provider.closes.every(Boolean)).toBe(true);
    expect(provider.starts).toBe(1);
  });
});
