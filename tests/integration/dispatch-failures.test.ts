import { afterAll, describe, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { authPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { executeGitJob } from '../../packages/core/src/git-jobs';
import {
  dispatchFailed,
  dispatchSucceeded,
  MAX_DISPATCH_FAILURES,
} from '../../packages/core/src/dispatch-failures';

afterAll(async () => {
  await pool.end();
  await authPool.end();
});
describe('durable dispatch failure budgets', () => {
  it('lets the scheduling view read blocked-job metadata without granting diagnostic access', async () => {
    await expect(pool.query('SELECT count(*) FROM reporting.worker_schedule')).resolves.toBeDefined();
    const grants = (
      await pool.query(
        `SELECT has_column_privilege('platform_reporting','dispatch_jobs','state','SELECT') AS state,
        has_column_privilege('platform_reporting','dispatch_jobs','error','SELECT') AS diagnostic`,
      )
    ).rows[0];
    expect(grants).toEqual({ state: true, diagnostic: false });
  });
  it('expires a Git operation even while another writer holds its worktree lock', async () => {
    const { p } = await fixtureAccount('Expired sync');
    const worktree = id();
    const op = await transaction(p.organizationId, async (tx) => {
      const row = await resources.create(tx, 'operations', p.organizationId, {
        kind: 'git_sync',
        status: 'queued',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        result: { worktree_id: worktree },
      });
      await tx.query(
        "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'operation',$3)",
        [id(), p.organizationId, row.id],
      );
      return row;
    });
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`worktree:${worktree}`]);
      await executeGitJob(p.organizationId, op.id);
      const saved = await transaction(p.organizationId, (tx) => resources.get(tx, 'operations', op.id));
      expect(saved.status).toBe('failed');
      expect(saved.error).toMatchObject({ code: 'operation_expired', retryable: false, request_id: op.id });
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
    }
  });
  it('bounds database lock waits and rolls back timed-out work before reusing the connection', async () => {
    const defaults = (
      await pool.query(
        "SELECT current_setting('statement_timeout') AS statement,current_setting('idle_in_transaction_session_timeout') AS idle",
      )
    ).rows[0];
    expect(defaults).toEqual({ statement: '1min', idle: '2min' });
    await expect(
      transaction(null, (tx) => tx.query('SELECT pg_sleep(1)'), { statementTimeoutMs: 10 }),
    ).rejects.toMatchObject({ code: '57014' });
    expect((await transaction(null, (tx) => tx.query('SELECT 1 AS value'))).rows[0].value).toBe(1);
    for (const limit of [0, Infinity, NaN, 60_001])
      await expect(
        transaction(null, (tx) => tx.query('SELECT 1'), { statementTimeoutMs: limit }),
      ).rejects.toThrow(RangeError);
  });
  it('blocks poison jobs while retaining delivery fences and rejects stale generation/tenant updates', async () => {
    const { p } = await fixtureAccount('Retry budget');
    const { p: other } = await fixtureAccount('Other retry budget');
    const resource = id();
    await pool.query(
      `INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,attempts,workflow_generation)
      VALUES($1,$2,'transfer_cleanup',$3,19,2)`,
      [id(), p.organizationId, resource],
    );
    expect(await dispatchFailed(other.organizationId, 'transfer_cleanup', resource, 'fixture')).toBe(false);
    expect(await dispatchFailed(p.organizationId, 'transfer_cleanup', resource, 'fixture', 1)).toBe(false);
    for (let attempt = 0; attempt < MAX_DISPATCH_FAILURES; attempt++)
      expect(await dispatchFailed(p.organizationId, 'transfer_cleanup', resource, 'fixture', 2)).toBe(
        attempt === MAX_DISPATCH_FAILURES - 1,
      );
    await dispatchSucceeded(p.organizationId, 'transfer_cleanup', resource, 2);
    const job = (
      await pool.query(
        'SELECT state,attempts,failure_attempts,error FROM dispatch_jobs WHERE resource_id=$1',
        [resource],
      )
    ).rows[0];
    expect(job).toEqual({ state: 'blocked', attempts: 19, failure_attempts: 8, error: 'fixture' });
  });
  it('resets transient failures after successful work without resetting external delivery attempts', async () => {
    const { p } = await fixtureAccount('Recovered retry budget');
    const resource = id();
    await transaction(p.organizationId, (tx) =>
      tx.query(
        `INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,attempts)
      VALUES($1,$2,'transfer_cleanup',$3,4)`,
        [id(), p.organizationId, resource],
      ),
    );
    await dispatchFailed(p.organizationId, 'transfer_cleanup', resource, 'fixture');
    await dispatchSucceeded(p.organizationId, 'transfer_cleanup', resource);
    expect(
      (
        await pool.query(
          'SELECT state,attempts,failure_attempts,error FROM dispatch_jobs WHERE resource_id=$1',
          [resource],
        )
      ).rows[0],
    ).toEqual({ state: 'pending', attempts: 4, failure_attempts: 0, error: null });
  });
});
