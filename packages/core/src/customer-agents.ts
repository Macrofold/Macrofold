/** Optional integration path: customer identity belongs to the integrating app.
 * This module composes core resources; it does not introduce another run engine. */
import { lock, type Tx } from '../../db';
import type { components } from '../../contracts/api';
import { requireWorkspace, type Principal } from './auth';
import { id } from './crypto';
import { assert } from './errors';
import { createWorkspace } from './workspaces';
import * as resources from './resources';
import { validateConfiguration, getRun } from './runs';

type Schema = components['schemas'];
export type CustomerBinding = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  customer_id: string;
  agent_key: string;
  name: string;
  workspace_id: string;
  agent_id: string;
  worktree_id: string;
  created_at: Date;
};
export const presentBinding = (b: CustomerBinding): Schema['CustomerAgentBinding'] => ({
  id: b.id,
  integration_path: 'customer-agents',
  customer_id: b.customer_id,
  key: b.agent_key,
  name: b.name,
  workspace_id: b.workspace_id,
  agent_id: b.agent_id,
  worktree_id: b.worktree_id,
  created_at: b.created_at.toISOString(),
});

/** Never resolve a customer solely by its external ID: owner and tenant are authority. */
export async function getCustomerBinding(tx: Tx, p: Principal, customerId: string, bindingId: string) {
  const b = (
    await tx.query<CustomerBinding>(
      'SELECT * FROM customer_agent_bindings WHERE id=$1 AND owner_user_id=$2 AND customer_id=$3',
      [bindingId, p.userId, customerId],
    )
  ).rows[0];
  assert(b, 404, 'not_found', 'Customer agent not found.');
  await resources.get(tx, 'workspaces', b.workspace_id, p);
  await resources.get(tx, 'worktrees', b.worktree_id, p);
  await resources.get(tx, 'agents', b.agent_id, p);
  return b;
}

export async function ensureCustomerAgent(
  tx: Tx,
  p: Principal,
  customerId: string,
  input: Schema['CustomerAgentEnsure'],
) {
  assert(p.userId, 403, 'forbidden', 'Use a credential owned by a current organization member.');
  await lock(tx, `customer-agent:${p.organizationId}:${p.userId}:${customerId}:${input.key}`);
  const existing = (
    await tx.query<CustomerBinding>(
      'SELECT * FROM customer_agent_bindings WHERE owner_user_id=$1 AND customer_id=$2 AND agent_key=$3',
      [p.userId, customerId, input.key],
    )
  ).rows[0];
  if (existing) return presentBinding(await getCustomerBinding(tx, p, customerId, existing.id));
  await validateConfiguration(tx, p, input.configuration, 'preset');
  const workspace = await createWorkspace(tx, p, { name: input.name });
  const agent = await resources.create(tx, 'agents', p.organizationId, {
    ...input.configuration,
    name: input.name,
    connection_grants: [],
  });
  const b = (
    await tx.query<CustomerBinding>(
      `INSERT INTO customer_agent_bindings(id,organization_id,owner_user_id,customer_id,agent_key,name,workspace_id,agent_id,worktree_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id(),
        p.organizationId,
        p.userId,
        customerId,
        input.key,
        input.name,
        workspace.id,
        agent.id,
        workspace.default_worktree_id,
      ],
    )
  ).rows[0];
  return presentBinding(b);
}

export async function listCustomerAgents(tx: Tx, p: Principal, customerId: string, query: URLSearchParams) {
  const limit = Number(query.get('limit') || 25);
  const rows = (
    await tx.query<CustomerBinding>(
      `SELECT b.* FROM customer_agent_bindings b
     JOIN workspaces p ON p.id=b.workspace_id JOIN worktrees w ON w.id=b.worktree_id JOIN agents a ON a.id=b.agent_id
     WHERE b.owner_user_id=$1 AND b.customer_id=$2 AND ($3::uuid IS NULL OR b.id<$3)
     AND (cardinality($4::uuid[])=0 OR b.workspace_id=ANY($4::uuid[]))
     AND coalesce(p.data->>'deleted','false')<>'true' AND coalesce(w.data->>'deleted','false')<>'true'
     AND coalesce(a.data->>'deleted','false')<>'true' ORDER BY b.id DESC LIMIT $5`,
      [p.userId, customerId, query.get('cursor'), p.workspaceIds, limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map(presentBinding),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

export async function customerConversation(tx: Tx, p: Principal, b: CustomerBinding, sessionId: string) {
  requireWorkspace(p, b.workspace_id);
  const session = await resources.get(tx, 'sessions', sessionId, p);
  assert(
    session.worktree_id === b.worktree_id && session.agent_id === b.agent_id,
    404,
    'not_found',
    'Conversation not found.',
  );
  return session;
}
export async function customerRun(tx: Tx, p: Principal, b: CustomerBinding, runId: string) {
  const run = await getRun(tx, runId, p);
  assert(
    run.worktree_id === b.worktree_id && run.config.agent_id === b.agent_id,
    404,
    'not_found',
    'Run not found.',
  );
  return run;
}
