import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { authPool, pool, transaction, afterCommit } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { ensureCustomerAgent } from '../../packages/core/src/customer-agents';
import { admitRun, getRun, cancelRun } from '../../packages/core/src/runs';
import { runTraceContext } from '../../packages/core/src/run-tracing';
import { emit } from '../../packages/core/src/events';
import * as tracing from '../../packages/core/src/tracing';

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('only notifies after a successful commit and releases the connection before notifications', async () => {
  const calls: string[] = [];
  await expect(
    transaction(null, async (tx) => {
      afterCommit(tx, () => calls.push('rollback'));
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(calls).toEqual([]);
  await transaction(null, async (tx) => {
    afterCommit(tx, () => calls.push('commit'));
    expect(calls).toEqual([]);
  });
  expect(calls).toEqual(['commit']);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(
    transaction(null, async (tx) => {
      afterCommit(tx, () => {
        throw new Error('private');
      });
      return 'committed';
    }),
  ).resolves.toBe('committed');
  expect(warn.mock.calls.flat().join(' ')).not.toContain('private');
});
it('resolves customer/worktree labels in the owning tenant and discards rolled back run traces', async () => {
  const account = await fixtureAccount('Trace attribution');
  const p = account.p;
  vi.spyOn(tracing, 'tracingEnabled').mockReturnValue(true);
  const trace = vi.spyOn(tracing, 'recordTrace').mockImplementation(() => {});
  const binding = await transaction(p.organizationId, (tx) =>
    ensureCustomerAgent(tx, p, 'customer-42', {
      key: 'assistant',
      name: 'Customer assistant',
      configuration: {
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        limits: { max_cost_micro_usd: '2000000', timeout_seconds: 900 },
      },
    }),
  );
  const run = await transaction(p.organizationId, (tx) =>
    admitRun(tx, p, {
      worktree_id: binding.worktree_id,
      agent_id: binding.agent_id,
      prompt: 'Synthetic input',
    }),
  );
  const context = await transaction(p.organizationId, async (tx) =>
    runTraceContext(tx, await getRun(tx, run.run_id)),
  );
  expect(context).toMatchObject({
    customer_id: 'customer-42',
    customer_binding_id: binding.id,
    workspace_id: binding.workspace_id,
    worktree_id: binding.worktree_id,
    agent_key: 'assistant',
  });
  trace.mockClear();
  await expect(
    transaction(p.organizationId, async (tx) => {
      await emit(tx, p.organizationId, run.run_id, 'run.started', {});
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(trace).not.toHaveBeenCalled();
  await transaction(p.organizationId, (tx) => cancelRun(tx, p, run.run_id));
  expect(trace.mock.calls.some(([o]) => o.id === 'run' && o.context.customer_id === 'customer-42')).toBe(
    true,
  );
});
