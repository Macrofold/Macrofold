import { transaction } from '../../packages/db';
import type { Principal } from '../../packages/core/src/auth';
import { prepareFileMutation } from '../../packages/core/src/files';

export async function writeFixtureFile(p: Principal, workspaceId: string, path: string, bytes: Buffer, revision: string) {
  const prepared = await prepareFileMutation(p, workspaceId, revision, { kind: 'file_write', path, bytes, createOnly: false });
  try {
    return await transaction(p.organizationId, (tx) => prepared.commit(tx, p));
  } finally { await prepared.dispose(); }
}
