'use client';
import type { Schema } from './client';
import { request } from './dashboard-data';

/** Staged, hash-verified uploads shared by Files and run attachments.
 * Callers own cache refresh and UI state; retries retain the same destination paths. */
export async function uploadWorktreeFiles(
  worktreeId: string,
  uploads: { path: string; file: File }[],
  setProgress: (message: string) => void = () => {},
) {
  setProgress('Preparing your files…');
  const current = await request('getWorktree', { params: { path: { worktree_id: worktreeId } } });
  const entries: Schema['FileEntry'][] = [];
  let cursor: string | null = null;
  do {
    const page: Schema['FileListing'] = await request('listFiles', {
      params: { path: { worktree_id: worktreeId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    entries.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor);
  const manifest = [];
  for (const { file, path } of uploads) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    manifest.push({
      path: path,
      local_sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      local_size_bytes: file.size,
      baseline_known: true,
      baseline_sha256: entries.find((e) => e.path === path)?.sha256 || null,
    });
  }
  const plan = await request('createTransfer', {
    params: { path: { worktree_id: worktreeId } },
    body: {
      direction: 'push',
      base_revision: current.revision,
      include_ignored: false,
      delete: false,
      dry_run: false,
      paths: uploads.map((item) => item.path),
      manifest,
    },
  });
  if (plan.status === 'conflicted')
    throw new Error(
      'Some paths conflict with remote files. Rename those files or use the CLI to resolve them.',
    );
  let count = 0;
  for (const action of plan.actions.filter((a) => a.action === 'upload')) {
    setProgress(
      `Uploading ${++count} of ${plan.actions.filter((a) => a.action === 'upload').length}: ${action.path}`,
    );
    const headers = { ...action.required_headers };
    // Browsers set Content-Length from the File body; JavaScript may not set it.
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-length') delete headers[key];
    const response = await fetch(action.url!, {
      method: 'PUT',
      headers,
      body: uploads.find((item) => item.path === action.path)!.file,
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`Upload failed for ${action.path} (${response.status}). Your workspace is unchanged.`);
  }
  setProgress('Verifying and saving your checkpoint…');
  await request('applyTransfer', {
    params: { path: { transfer_id: plan.id } },
    body: { expected_revision: current.revision },
  });
}
