import type { components } from '../../contracts/api';
import { transaction, type Tx } from '../../db';
import { saveContent, readContent } from '../../providers/src/storage';
import { requireScopes, type Principal } from './auth';
import { requireApplication, requireDecisionWorkspace } from './decision-authority';
import { assert } from './errors';
import { canonical } from './crypto';
import { digest, validateEvidence } from './explicit-context';
import { storagePreparation } from './storage-preparation';
import { requireStorageCapacity } from './storage-maintenance';
import { getRun } from './runs';
import * as resources from './resources';
import type { ExplicitContext } from './decision';
import { releasePublishedArtifact } from './artifacts';

type Schema = components['schemas'];
type Reference = Schema['ContextReference'];
/** Typed, read-only boundary. Remote registration is intentionally absent until
 * a consumer needs it; credentials and arbitrary URLs never enter context. */
export interface ContextReader {
  read(p: Principal, workspaceId: string | null | undefined, reference: Reference): Promise<ExplicitContext>;
}
export async function contextArtifact(tx: Tx, p: Principal, artifactId: string) {
  requireScopes(p, ['files:read']);
  const artifact = await resources.get(tx, 'artifacts', artifactId, p);
  assert(artifact.kind === 'context' && artifact.audience, 404, 'not_found', 'Context artifact not found.');
  return artifact;
}
export function presentContext(artifact: resources.Document<'artifacts'>): Schema['ContextArtifact'] {
  assert(artifact.audience, 500, 'invalid_context_artifact', 'The context binding is missing.');
  return {
    id: artifact.id,
    workspace_id: artifact.workspace_id,
    name: artifact.name,
    revision: artifact.revision,
    sha256: artifact.sha256,
    size_bytes: artifact.size_bytes,
    audience: artifact.audience,
    created_at: artifact.created_at,
  };
}
export async function authorizeContext(tx: Tx, p: Principal, workspaceId: string | null | undefined, reference: Reference) {
  assert(workspaceId, 400, 'workspace_required', 'Stored context requires a workspace.');
  requireApplication(p, workspaceId);
  const artifact = await contextArtifact(tx, p, reference.artifact_id);
  assert(
    artifact.workspace_id === workspaceId &&
      artifact.application_namespace === workspaceId &&
      digest(artifact.audience) === digest(reference.audience),
    403,
    'context_audience_mismatch',
    'The snapshot is bound to another application or audience.',
  );
  assert(
    artifact.revision === reference.revision,
    409,
    'context_revision_mismatch',
    'Use the exact published snapshot revision.',
  );
  return artifact;
}
export const storedContextReader: ContextReader = {
  async read(p, workspaceId, reference) {
    const artifact = await transaction(p.organizationId, (tx) =>
      authorizeContext(tx, p, workspaceId, reference),
    );
    const bytes = await readContent(artifact.key, artifact.sha256);
    // Only createContextArtifact publishes this bounded, validated format.
    return JSON.parse(bytes.toString()) as ExplicitContext;
  },
};
export async function prepareContextArtifact(p: Principal, input: Schema['ContextArtifactCreate']) {
  requireScopes(p, ['files:write']);
  requireApplication(p, input.workspace_id);
  validateEvidence(input.context);
  const preparation = await storagePreparation(p.organizationId, async (tx) => {
    await requireDecisionWorkspace(tx, p, input.workspace_id);
    await requireStorageCapacity(tx, p.organizationId);
    if (input.source_run_id) {
      const run = await getRun(tx, input.source_run_id, p);
      assert(
        run.workspace_id === input.workspace_id,
        403,
        'source_workspace_mismatch',
        'The source run belongs to another workspace.',
      );
    }
  });
  try {
    const object = await saveContent(p.organizationId, Buffer.from(canonical(input.context)));
    return {
      async commit(tx: Tx, principal: Principal) {
        requireScopes(principal, ['files:write']);
        requireApplication(principal, input.workspace_id);
        await preparation.assertActive(tx);
        await requireDecisionWorkspace(tx, principal, input.workspace_id);
        await requireStorageCapacity(tx, principal.organizationId);
        const artifact = await resources.create(tx, 'artifacts', principal.organizationId, {
          ...object,
          name: input.name,
          workspace_id: input.workspace_id,
          run_id: input.source_run_id || null,
          kind: 'context',
          retention: 'published',
          application_namespace: input.workspace_id,
          audience: input.context.audience,
          media_type: 'application/json',
        });
        return presentContext(artifact);
      },
      dispose: preparation.dispose,
    };
  } catch (error) {
    await preparation.dispose();
    throw error;
  }
}
export async function releaseContext(tx: Tx, p: Principal, artifactId: string) {
  requireScopes(p, ['files:write']);
  await contextArtifact(tx, p, artifactId);
  const artifact = await releasePublishedArtifact(tx, p, artifactId);
  return presentContext(artifact);
}
