import { fileAllowed, type PermissionLayers } from '../../contracts/permissions';
import { attachmentIssue, mediaFormat, type RunAttachment } from '../../contracts/media';
import { assert } from './errors';
import { normalizePath, type FileRecord } from './files';

/** Resolve only the authorized worktree's published metadata before reserving funds.
 * Runtime verifies these hashes again so queued work never reads a changed attachment. */
export function resolveRunAttachments(
  paths: string[],
  files: FileRecord[],
  permissions: PermissionLayers,
  configuration: { harness: string; model: string; rate_card: { provider: string } },
): RunAttachment[] {
  const selected = paths.map((path) => {
    normalizePath(path);
    const file = files.find((entry) => entry.path === path);
    assert(
      file?.type === 'file',
      404,
      'attachment_not_found',
      'Upload the attachment to this worktree first.',
    );
    assert(
      fileAllowed(permissions, 'read', path),
      403,
      'file_permission_denied',
      'The run cannot read this attachment.',
    );
    return file;
  });
  const issue = attachmentIssue(
    selected.map((file) => ({ path: file.path, size: Number(file.size_bytes) })),
    { ...configuration, provider: configuration.rate_card.provider },
  );
  if (issue) assert(false, issue.code === 'attachment_too_large' ? 413 : 400, issue.code, issue.message);
  return selected.map((file) => {
    const format = mediaFormat(file.path);
    assert(format, 400, 'unsupported_attachment', 'Unsupported attachment format.');
    return { path: file.path, sha256: file.sha256, size_bytes: file.size_bytes, media_type: format.mime };
  });
}
