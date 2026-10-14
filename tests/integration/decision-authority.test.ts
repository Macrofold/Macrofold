import { afterAll, expect, it } from 'vitest';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { requireDecisionWorkspace } from '../../packages/core/src/decision-authority';
import { requestWorkspaceDeletion } from '../../packages/core/src/deletion';
import * as resources from '../../packages/core/src/resources';

afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it('allows concurrent workspace admissions while fencing deletion and rejecting admission afterward', async () => {
  const account = await fixtureAccount('Admission locking');
  const org = account.p.organizationId;
  const workspace = await transaction(org, (tx) =>
    resources.create(tx, 'workspaces', org, { name: 'Disposable' }),
  );
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader = transaction(org, async (tx) => {
    await requireDecisionWorkspace(tx, account.p, workspace.id);
    entered();
    await gate;
  });
  try {
    await ready;
    // A second admission must not wait for the first admission's transaction.
    await transaction(org, async (tx) => {
      await tx.query("SET LOCAL lock_timeout='1s'");
      await requireDecisionWorkspace(tx, account.p, workspace.id);
    });
    // Exercise the real deletion path. Its exclusive lock cannot overtake an
    // admitted writer; a short SQL deadline proves the conflict deterministically.
    await expect(
      transaction(org, async (tx) => {
        await tx.query("SET LOCAL lock_timeout='100ms'");
        return requestWorkspaceDeletion(
          tx,
          account.p,
          workspace.id,
          { confirmation: 'Disposable' },
          new Request('http://fixture.test', { headers: { authorization: 'Bearer fixture' } }),
        );
      }),
    ).rejects.toMatchObject({ code: '55P03' });
  } finally {
    release();
    await reader;
  }
  await transaction(org, (tx) =>
    requestWorkspaceDeletion(
      tx,
      account.p,
      workspace.id,
      { confirmation: 'Disposable' },
      new Request('http://fixture.test', { headers: { authorization: 'Bearer fixture' } }),
    ),
  );
  await expect(
    transaction(org, (tx) => requireDecisionWorkspace(tx, account.p, workspace.id)),
  ).rejects.toMatchObject({ code: 'workspace_unavailable' });
});
