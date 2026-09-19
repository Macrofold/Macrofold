import type { Tx } from '../../db';
import { mediaFormat } from '../../contracts/media';
import { fileAllowed } from '../../contracts/permissions';
import type { FileRecord } from './files';
import type { NativeRunRow } from './runs';
import * as resources from './resources';
import { requireScopes, type Principal } from './auth';
import { assert } from './errors';

/** Explicit publication lifetime, independent of originating-run diagnostics.
 * The row lock serializes release with task evidence acquisition. */
export async function releasePublishedArtifact(tx: Tx, p: Principal, artifactId: string) {
  requireScopes(p,['files:write']);
  await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE',[artifactId]);
  const artifact = await resources.get(tx,'artifacts',artifactId,p);
  assert(artifact.retention === 'published',409,'artifact_not_published','Run diagnostics follow run retention. Only published artifacts can be released here.');
  assert(!(await tx.query('SELECT 1 FROM decision_task_evidence WHERE artifact_id=$1',[artifactId])).rowCount,409,'evidence_in_use','Complete or close the task using this artifact before releasing it.');
  await resources.update(tx,'artifacts',artifactId,{deleted:true});
  return artifact;
}

/** Only verified new/changed deliverables are published. Existing checkpoint
 * storage and artifact retention own the bytes; no second copy or upload path. */
export async function publishArtifacts(tx: Tx, run: NativeRunRow, before: FileRecord[], after: FileRecord[]) {
  const previous = new Map(before.map((file) => [file.path, file.sha256]));
  const outputs = after.filter(
    (file) =>
      file.type === 'file' &&
      file.path.startsWith('outputs/') &&
      !file.path.split('/').some((part) => part.startsWith('.')) &&
      previous.get(file.path) !== file.sha256 &&
      fileAllowed(run.config.permission_layers || [], 'read', file.path),
  );
  const ids: string[] = [];
  for (const file of outputs) {
    const artifact = await resources.create(tx, 'artifacts', run.organization_id, {
      run_id: run.id,
      workspace_id: run.workspace_id,
      worktree_id: run.worktree_id,
      name: file.path,
      key: file.key,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
      media_type: mediaFormat(file.path)?.mime || 'application/octet-stream',
    });
    ids.push(artifact.id);
  }
  return ids;
}
