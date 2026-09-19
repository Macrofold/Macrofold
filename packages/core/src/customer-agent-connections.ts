import { type Tx, lock } from '../../db';
import type { components } from '../../contracts/api';
import type { Principal } from './auth';
import type { CustomerBinding } from './customer-agents';
import { assert } from './errors';
import * as resources from './resources';
import { saveConnection } from './connections';
import { patchAccess, saveRule, safeConnection } from './connection-access';
import { disconnectConnection } from './connection-cleanup';

type Schema = components['schemas'];
export type CustomerConnectionRow = {
  organization_id: string;
  binding_id: string;
  connection_id: string;
  capabilities: Schema['ConnectionCapability'][];
  selected_capabilities: string[];
};
export function capabilityTools(capabilities: Schema['ConnectionCapability'][], selected: string[]) {
  assert(
    new Set(selected).size === selected.length &&
      selected.every((id) => capabilities.some((c) => c.id === id)),
    400,
    'invalid_capability',
    'Choose permissions offered by this connection.',
  );
  return [...new Set(capabilities.filter((c) => selected.includes(c.id)).flatMap((c) => c.tools))].sort();
}
export function validateCapabilities(
  capabilities: Schema['ConnectionCapability'][],
  tools: Schema['Tool'][],
) {
  assert(
    new Set(capabilities.map((c) => c.id)).size === capabilities.length,
    400,
    'invalid_capability',
    'Permission IDs must be unique.',
  );
  assert(
    capabilities.every((c) => c.tools.every((name) => tools.some((t) => t.name === name))),
    400,
    'unknown_tool',
    'Every permission must reference a tool in the enabled app catalog.',
  );
}
export async function getCustomerConnection(tx: Tx, p: Principal, b: CustomerBinding, connectionId: string) {
  const link = (
    await tx.query<CustomerConnectionRow>(
      'SELECT * FROM customer_agent_connections WHERE binding_id=$1 AND connection_id=$2',
      [b.id, connectionId],
    )
  ).rows[0];
  assert(link, 404, 'not_found', 'Customer connection not found.');
  const connection = await resources.get(tx, 'connections', connectionId, p);
  assert(connection.owner_subject_id === p.userId, 404, 'not_found', 'Customer connection not found.');
  return { link, connection };
}
export async function presentCustomerConnection(
  tx: Tx,
  p: Principal,
  b: CustomerBinding,
  connectionId: string,
): Promise<Schema['CustomerAgentConnection']> {
  const { link, connection } = await getCustomerConnection(tx, p, b, connectionId);
  return {
    connection: safeConnection(connection, p),
    capabilities: link.capabilities,
    selected_capabilities: link.selected_capabilities,
    access_version: connection.access_version,
    approved_tools: connection.access_tools,
  };
}
export async function createCustomerConnection(
  tx: Tx,
  p: Principal,
  b: CustomerBinding,
  value: Schema['CustomerAgentConnectionCreate'],
  tools: Schema['Tool'][],
) {
  validateCapabilities(value.capabilities, tools);
  const c = await saveConnection(tx, p, {
    name: value.name,
    kind: 'composio',
    provider: value.provider,
    auth_method: 'oauth',
  });
  await tx.query(
    'INSERT INTO customer_agent_connections(organization_id,binding_id,connection_id,capabilities) VALUES($1,$2,$3,$4)',
    [p.organizationId, b.id, c.id, JSON.stringify(value.capabilities)],
  );
  return presentCustomerConnection(tx, p, b, c.id);
}
export async function customerConnectionGrants(tx: Tx, b: CustomerBinding): Promise<Schema['Grant'][]> {
  const rows = (
    await tx.query<CustomerConnectionRow & { access_tools: string[] }>(
      `SELECT l.*,c.access_tools FROM customer_agent_connections l JOIN connections c ON c.id=l.connection_id
     WHERE l.binding_id=$1 AND coalesce(c.data->>'deleted','false')<>'true'
     AND c.data->>'status'='healthy' AND c.data->>'identity_verified'='true' ORDER BY c.id`,
      [b.id],
    )
  ).rows;
  return rows.flatMap((row) => {
    const tools = capabilityTools(row.capabilities, row.selected_capabilities).filter((t) =>
      row.access_tools.includes(t),
    );
    return tools.length ? [{ connection_id: row.connection_id, tools }] : [];
  });
}
export async function updateCustomerConnectionPermissions(
  tx: Tx,
  p: Principal,
  b: CustomerBinding,
  connectionId: string,
  selected: string[],
  expected: string,
  catalog: Schema['Tool'][],
) {
  await lock(tx, `customer-connections:${b.id}`);
  const { link, connection } = await getCustomerConnection(tx, p, b, connectionId);
  const tools = capabilityTools(link.capabilities, selected);
  assert(
    !tools.length || (connection.identity_verified && connection.status === 'healthy'),
    409,
    'authorization_required',
    'Connect this account before granting permissions.',
  );
  const access = await patchAccess(
    tx,
    p,
    connection.id,
    { tools, organization_wide: false },
    expected,
    catalog,
  );
  const rule = (
    await tx.query(
      "SELECT id FROM connection_access_rules WHERE connection_id=$1 AND scope='workspace_agent' AND workspace_id=$2 AND agent_id=$3",
      [connectionId, b.workspace_id, b.agent_id],
    )
  ).rows[0];
  if (tools.length && !rule)
    await saveRule(
      tx,
      p,
      connectionId,
      { scope: 'workspace_agent', workspace_id: b.workspace_id, agent_id: b.agent_id },
      `"${access.version}"`,
    );
  await tx.query('UPDATE customer_agent_connections SET selected_capabilities=$2 WHERE connection_id=$1', [
    connectionId,
    selected,
  ]);
  await resources.update(tx, 'agents', b.agent_id, {
    connection_grants: await customerConnectionGrants(tx, b),
  });
  return presentCustomerConnection(tx, p, b, connectionId);
}
export async function deleteCustomerConnection(
  tx: Tx,
  p: Principal,
  b: CustomerBinding,
  connectionId: string,
) {
  await lock(tx, `customer-connections:${b.id}`);
  const { connection } = await getCustomerConnection(tx, p, b, connectionId);
  await disconnectConnection(tx, p, connection);
  await resources.update(tx, 'agents', b.agent_id, {
    connection_grants: await customerConnectionGrants(tx, b),
  });
}
