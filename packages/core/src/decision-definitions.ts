import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { requireScopes, requireWorkspace } from './auth';
import { id } from './crypto';
import { digest, schemaValidator } from './explicit-context';
import { assert } from './errors';
import { requireDecisionWorkspace } from './decision-authority';

type Schema = components['schemas'];
type DefinitionRow = Omit<Schema['DecisionDefinition'], 'created_at'> & {
  created_at: Date;
  withdrawn_at: Date | null;
};
const present = (row: DefinitionRow): Schema['DecisionDefinition'] => ({
  id: row.id,
  workspace_id: row.workspace_id,
  name: row.name,
  definition: row.definition,
  digest: row.digest,
  created_at: row.created_at.toISOString(),
});
export async function getDefinition(tx: Tx, p: Principal, definitionId: string) {
  requireScopes(p, ['runs:read']);
  const row = (
    await tx.query<DefinitionRow>('SELECT * FROM decision_definitions WHERE id=$1 AND withdrawn_at IS NULL', [
      definitionId,
    ])
  ).rows[0];
  assert(row, 404, 'not_found', 'Decision definition not found.');
  requireWorkspace(p, row.workspace_id);
  return present(row);
}
export async function createDefinition(tx: Tx, p: Principal, input: Schema['DecisionDefinitionCreate']) {
  requireScopes(p, ['runs:write']);
  await requireDecisionWorkspace(tx, p, input.workspace_id);
  schemaValidator(input.definition.input_schema);
  schemaValidator(input.definition.output_schema);
  const row = (
    await tx.query<DefinitionRow>(
      'INSERT INTO decision_definitions(id,organization_id,workspace_id,name,revision,definition,digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,workspace_id,name,revision) DO NOTHING RETURNING *',
      [
        id(),
        p.organizationId,
        input.workspace_id,
        input.name,
        input.definition.revision,
        JSON.stringify(input.definition),
        digest(input.definition),
      ],
    )
  ).rows[0];
  assert(
    row,
    409,
    'definition_revision_exists',
    'This name and revision already exist. Publish a new revision.',
  );
  return present(row);
}
export async function withdrawDefinition(tx: Tx, p: Principal, definitionId: string) {
  requireScopes(p, ['runs:write']);
  const definition = await getDefinition(tx, p, definitionId);
  await tx.query('UPDATE decision_definitions SET withdrawn_at=now() WHERE id=$1', [definitionId]);
  return definition;
}
