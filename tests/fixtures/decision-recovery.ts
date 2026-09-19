import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decisionBrowserFixture } from './decision-browser';
import { pool, authPool, transaction } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { getRun } from '../../packages/core/src/runs';
import { getTask } from '../../packages/core/src/decision-tasks';
import { customerScopes, type Principal } from '../../packages/core/src/auth';
import { readContent } from '../../packages/providers/src/storage';
import { unseal } from '../../packages/core/src/crypto';

if (!isLocal() || config.allowPaid) throw new Error('Recovery fixture is local and unpaid only');
const file = path.join(config.dataDir, 'decision-recovery.json');
try {
  if (process.argv[2] === 'seed') {
    await writeFile(file, JSON.stringify(await decisionBrowserFixture()));
  } else {
    const fixture = JSON.parse(await readFile(file, 'utf8')) as Awaited<
      ReturnType<typeof decisionBrowserFixture>
    >;
    const member = (
      await pool.query<{ user_id: string; organization_id: string }>(
        'SELECT m.user_id,m.organization_id FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE u.email=$1',
        [fixture.email],
      )
    ).rows[0];
    assert(member);
    const p: Principal = {
      id: member.user_id,
      userId: member.user_id,
      email: fixture.email,
      organizationId: member.organization_id,
      kind: 'user',
      role: 'owner',
      scopes: customerScopes,
      workspaceIds: [],
      operator: false,
    };
    const artifact = await transaction(p.organizationId, async (tx) => {
      const run = await getRun(tx, fixture.runId);
      assert.equal(run.kind, 'inference');
      assert.equal(run.result.inference?.outcome, 'value');
      assert.equal(run.worktree_id, null);
      const task = await getTask(tx, p, fixture.taskId);
      assert.equal(task.status, 'proposal');
      assert.equal(task.runs.length, 1);
      assert.equal(task.outstanding_micro_usd, '0');
      const invocation = (
        await tx.query<{ body_ciphertext: string; response_ciphertext: string }>(
          'SELECT body_ciphertext,response_ciphertext FROM decision_invocations WHERE run_id=$1',
          [fixture.runId],
        )
      ).rows[0];
      assert(invocation.response_ciphertext.startsWith('v2.fixture-rotation.'));
      assert.equal(unseal<{ value: unknown }>(invocation.response_ciphertext).value, 'investigate');
      assert(unseal(invocation.body_ciphertext));
      const artifact = (
        await tx.query<{ data: { key: string; sha256: string } }>('SELECT data FROM artifacts WHERE id=$1', [
          task.proposal_artifact_id,
        ])
      ).rows[0];
      assert(artifact);
      assert.equal(
        (
          await tx.query('SELECT 1 FROM decision_task_evidence WHERE task_id=$1 AND artifact_id=$2', [
            task.id,
            task.proposal_artifact_id,
          ])
        ).rowCount,
        1,
      );
      return artifact.data;
    });
    const proposal = JSON.parse((await readContent(artifact.key, artifact.sha256)).toString());
    assert.equal(proposal.task_id, fixture.taskId);
    assert.equal(proposal.receipt.value, 'investigate');
    console.log('Restored decision receipt, task allocation, evidence pin and encrypted proposal verified.');
  }
} finally {
  await pool.end();
  await authPool.end();
}
