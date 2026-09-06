import type { Tx } from '../../db';
import { transaction, lock, pool } from '../../db';
import type { components } from '../../contracts/api';
import type { Principal } from './auth';
import { requireScopes } from './auth';
import { assert } from './errors';
import { id, seal, unseal, sha256 } from './crypto';
import { config } from './config';
import * as resources from './resources';
import {
  normalizePath,
  workspaceFiles,
  ensureWritable,
  checkpoint,
  checkpointState,
  assertFileTree,
} from './files';
import { saveContent, storage, contentChunks, verifyContent } from '../../providers/src/storage';

type Schema = components['schemas'];
type Capability = {
  organization: string;
  transfer?: string;
  path?: string;
  method: 'GET' | 'PUT';
  expires: number;
  sha: string;
  size?: number;
  key?: string;
  filename?: string;
};
export function objectURL(capability: Capability) {
  return `${config.origin}/objects/${encodeURIComponent(seal(capability))}`;
}
export function downloadURL(
  org: string,
  key: string,
  sha: string,
  filename: string,
  expires = Date.now() + 15 * 60000,
) {
  return {
    url: objectURL({ organization: org, method: 'GET', expires, sha, key, filename }),
    expires_at: new Date(expires).toISOString(),
  };
}
export async function serveObject(request: Request, token: string) {
  let cap: Capability;
  try {
    cap = unseal<Capability>(token);
  } catch {
    assert(false, 404, 'not_found', 'This object link is invalid.');
  }
  assert(cap.expires > Date.now(), 410, 'link_expired', 'This temporary object link expired.');
  assert(cap.method === request.method, 405, 'method_not_allowed', 'This link does not allow this method.');
  if (cap.method === 'GET') {
    assert(cap.key, 400, 'invalid_capability', 'Object key is missing.');
    const iterator = contentChunks(cap.key, cap.sha);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await iterator.next();
          if (part.done) controller.close();
          else controller.enqueue(new Uint8Array(part.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cap.filename || 'download')}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  assert(
    cap.transfer && cap.path && cap.size !== undefined,
    400,
    'invalid_capability',
    'The upload link is incomplete.',
  );
  const reader = request.body?.getReader();
  assert(reader, 400, 'invalid_request', 'Upload body is required.');
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap.size || size > 25 * 1024 * 1024) {
      await reader.cancel();
      assert(false, 413, 'file_too_large', 'Uploaded content exceeds the plan.');
    }
    parts.push(value);
  }
  const bytes = Buffer.concat(parts);
  assert(
    size === cap.size && sha256(bytes) === cap.sha,
    422,
    'content_mismatch',
    'Uploaded bytes do not match the planned size and hash.',
  );
  await transaction(cap.organization, async (tx) => {
    const transfer = await resources.get(tx, 'transfers', cap.transfer!);
    assert(
      ['planned', 'staging', 'ready'].includes(String(transfer.status)) &&
        Date.parse(String(transfer.expires_at)) > Date.now(),
      409,
      'transfer_unavailable',
      'The transfer is no longer accepting uploads.',
    );
    const object = await saveContent(cap.organization, bytes);
    await tx.query(
      "UPDATE transfers SET data=jsonb_set(data,'{staged}',COALESCE(data->'staged','{}') || $2::jsonb) WHERE id=$1",
      [transfer.id, JSON.stringify({ [cap.path!]: object })],
    );
  });
  return new Response(null, { status: 204 });
}
function selected(path: string, paths: string[]) {
  return !paths.length || paths.some((p) => path === p || path.startsWith(`${p}/`));
}
export async function createTransfer(
  tx: Tx,
  p: Principal,
  workspaceId: string,
  input: Schema['TransferCreate'],
) {
  if (input.direction === 'push') requireScopes(p, ['files:write']);
  if (!input.dry_run && input.direction === 'push') {
    await (await import('./storage-maintenance')).requireStorageCapacity(tx, p.organizationId);
    await lock(tx, `transfer-admission:${p.organizationId}`);
    const active = await tx.query(
      "SELECT count(*) FROM transfers WHERE organization_id=$1 AND data->>'direction'='push' AND data->>'status' IN ('planned','staging','ready') AND (data->>'expires_at')::timestamptz>now()",
      [p.organizationId],
    );
    assert(
      Number(active.rows[0].count) < 10,
      429,
      'too_many_transfers',
      'Complete existing transfers or wait for them to expire before planning more uploads.',
    );
  }
  const { workspace, files } = await workspaceFiles(tx, workspaceId, p);
  assert(
    workspace.revision === input.base_revision,
    412,
    'stale_revision',
    'Refresh the remote workspace before planning the transfer.',
  );
  const paths = input.paths.map(normalizePath);
  const seen = new Set<string>();
  let total = 0;
  for (const entry of input.manifest) {
    normalizePath(entry.path);
    assert(!seen.has(entry.path), 400, 'duplicate_path', 'A manifest path appears more than once.');
    seen.add(entry.path);
    total += entry.local_size_bytes;
    assert(
      entry.local_sha256 !== null || entry.local_size_bytes === 0,
      400,
      'invalid_manifest',
      'An absent file must have zero size.',
    );
  }
  assert(total <= 250 * 1024 * 1024, 413, 'transfer_too_large', 'A transfer is limited to 250 MiB.');
  const remote = new Map(
    files
      .filter((f) => selected(f.path, paths) && (!f.git_ignored || input.include_ignored))
      .map((f) => [f.path, f]),
  );
  const local = new Map(input.manifest.filter((f) => selected(f.path, paths)).map((f) => [f.path, f]));
  const transferId = id();
  const expires = Date.now() + 30 * 60000;
  const actions: Schema['TransferAction'][] = [];
  const uploads: Record<string, string> = {};
  for (const path of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(path);
    const r = remote.get(path);
    const lh = l?.local_sha256 ?? null;
    const rh = r?.sha256 ?? null;
    let action: Schema['TransferAction']['action'] = 'unchanged';
    let conflict: string | undefined;
    if (r?.type === 'symlink') {
      action = 'conflict';
      conflict = 'Symlinks require a checkpoint export.';
    } else if (lh !== rh) {
      const baseline = l?.baseline_known ? l.baseline_sha256 : undefined;
      if (input.direction === 'push') {
        if (lh === null) {
          if (input.delete && l?.baseline_known && baseline === rh) action = 'delete';
          else if (input.delete && rh !== null) {
            action = 'conflict';
            conflict = 'Remote content is newer than the local baseline.';
          }
        } else if (rh === null || baseline === rh) action = 'upload';
        else {
          action = 'conflict';
          conflict = 'Remote content changed or has no known baseline.';
        }
      } else {
        if (rh === null) {
          if (input.delete && baseline === lh) action = 'delete';
          else if (input.delete && lh !== null) {
            action = 'conflict';
            conflict = 'Local content changed or has no known baseline.';
          }
        } else if (lh === null || baseline === lh) action = 'download';
        else {
          action = 'conflict';
          conflict = 'Local content changed or has no known baseline.';
        }
      }
    }
    const item: Schema['TransferAction'] = {
      path,
      action,
      local_sha256: lh,
      remote_sha256: rh,
      ...(conflict ? { conflict_reason: conflict } : {}),
      size_bytes: String(input.direction === 'push' ? l?.local_size_bytes || 0 : r?.size_bytes || 0),
    };
    if (!input.dry_run && ['upload', 'download'].includes(action)) {
      item.method = action === 'upload' ? 'PUT' : 'GET';
      item.url_expires_at = new Date(expires).toISOString();
      item.required_headers = {};
      item.url = objectURL({
        organization: p.organizationId,
        transfer: transferId,
        path,
        expires,
        method: item.method,
        sha: action === 'upload' ? lh! : rh!,
        size: l?.local_size_bytes,
        key: r?.key,
        filename: path,
      });
      if (action === 'upload' && storage.uploadURL) {
        // Staging keys are random and write-only to the caller. Never give clients a
        // capability to replace verified content-addressed objects or manifests.
        const key = `staging/${p.organizationId}/${transferId}/${id()}`;
        const signed = await storage.uploadURL(key, l!.local_size_bytes, expires);
        uploads[path] = key;
        item.url = signed.url;
        item.required_headers = signed.headers;
      }
    }
    actions.push(item);
  }
  assert(
    actions.length <= 1000 && actions.reduce((n, a) => n + Number(a.size_bytes || 0), 0) <= 250 * 1024 * 1024,
    413,
    'transfer_too_large',
    'A transfer is limited to 1000 files and 250 MiB.',
  );
  if (input.direction === 'push') {
    const replaced = new Set(
      actions.filter((a) => ['upload', 'delete'].includes(a.action)).map((a) => a.path),
    );
    assertFileTree([
      ...files.filter((f) => !replaced.has(f.path)),
      ...actions.filter((a) => a.action === 'upload'),
    ]);
  }
  const transfer = await resources.create(
    tx,
    'transfers',
    p.organizationId,
    {
      workspace_id: workspaceId,
      project_id: workspace.project_id,
      direction: input.direction,
      base_revision: input.base_revision,
      status: actions.some((a) => a.action === 'conflict') ? 'conflicted' : 'planned',
      dry_run: input.dry_run || false,
      actions,
      expires_at: new Date(expires).toISOString(),
      staged: {},
      uploads,
      snapshot_files: files,
    },
    transferId,
  );
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,available_at) VALUES($1,$2,'transfer_cleanup',$3,$4)",
    [id(), p.organizationId, transferId, new Date(expires)],
  );
  return transfer;
}
export async function applyTransfer(
  tx: Tx,
  p: Principal,
  transferId: string,
  input: Schema['TransferApply'],
) {
  await lock(tx, `transfer:${transferId}`);
  const transfer = await resources.get(tx, 'transfers', transferId, p);
  if (transfer.operation_id && transfer.status === 'succeeded')
    return resources.get(tx, 'operations', String(transfer.operation_id), p);
  assert(!transfer.dry_run, 409, 'dry_run', 'A dry-run plan cannot be applied.');
  assert(
    Date.parse(String(transfer.expires_at)) > Date.now(),
    410,
    'transfer_expired',
    'Create a new transfer plan.',
  );
  assert(
    ['planned', 'staging', 'ready'].includes(String(transfer.status)),
    409,
    'transfer_conflicted',
    'Resolve conflicts and create a new transfer.',
  );
  const workspaceId = String(transfer.workspace_id);
  const actions = transfer.actions as Schema['TransferAction'][];
  if (transfer.direction === 'pull') {
    const completed = new Set(input.completed_paths || []);
    assert(
      [...completed].every((path) =>
        actions.some((a) => a.path === path && ['download', 'delete'].includes(a.action)),
      ),
      400,
      'invalid_receipt',
      'Receipt contains a path outside this transfer.',
    );
    const done = actions
      .filter((a) => ['download', 'delete'].includes(a.action))
      .every((a) => completed.has(a.path));
    const op = await resources.operation(tx, p, 'transfer_pull', {
      workspace_id: workspaceId,
      transfer_id: transferId,
      local_receipt_complete: done,
    });
    await resources.update(tx, 'transfers', transferId, {
      status: done ? 'succeeded' : 'ready',
      operation_id: op.id,
      local_receipt_complete: done,
    });
    return op;
  }
  requireScopes(p, ['files:write']);
  await ensureWritable(tx, workspaceId);
  const { workspace, files } = await workspaceFiles(tx, workspaceId, p);
  assert(
    workspace.revision === input.expected_revision && workspace.revision === transfer.base_revision,
    412,
    'stale_revision',
    'The workspace changed after planning. Create a fresh transfer.',
  );
  const staged = (transfer.staged || {}) as Record<
    string,
    { key: string; sha256: string; size_bytes: string }
  >;
  let next = [...files];
  for (const action of actions) {
    if (action.action === 'delete') next = next.filter((f) => f.path !== action.path);
    if (action.action === 'upload') {
      let object = staged[action.path];
      const rawKey = (transfer.uploads as Record<string, string> | undefined)?.[action.path];
      if (!object && rawKey && storage.readUpload) {
        const bytes = await storage.readUpload(rawKey, Number(action.size_bytes)).catch(() => null);
        assert(bytes, 409, 'upload_incomplete', `Upload ${action.path} before applying.`);
        assert(
          sha256(bytes) === action.local_sha256,
          422,
          'content_mismatch',
          `Uploaded content for ${action.path} does not match the plan.`,
        );
        object = await saveContent(p.organizationId, bytes);
        staged[action.path] = object;
      }
      assert(
        object && object.sha256 === action.local_sha256,
        409,
        'upload_incomplete',
        `Upload ${action.path} before applying.`,
      );
      await verifyContent(object.key, object.sha256);
      next = next.filter((f) => f.path !== action.path);
      next.push({
        ...object,
        path: action.path,
        type: 'file',
        modified_at: new Date().toISOString(),
        git_ignored: action.path.startsWith('.'),
      });
    }
  }
  const cp = await checkpoint(tx, p, workspaceId, 'Files uploaded', next);
  const updated = await resources.update(
    tx,
    'workspaces',
    workspaceId,
    checkpointState(cp),
    workspace.revision,
  );
  const op = await resources.operation(tx, p, 'transfer_push', {
    workspace_id: workspaceId,
    transfer_id: transferId,
    revision: updated.revision,
    checkpoint_id: cp.id,
  });
  await resources.update(tx, 'transfers', transferId, {
    status: 'succeeded',
    operation_id: op.id,
    result_revision: updated.revision,
    checkpoint_id: cp.id,
    staged,
  });
  // Cleanup happens after the transaction commits in maintenance. Deleting staging
  // here would make a rolled-back checkpoint impossible to retry.
  return op;
}

/** Uploaded bytes are untrusted until apply. Expired capabilities cannot keep staging alive. */
export async function cleanupTransfers(limit = 10) {
  const jobs = (
    await pool.query(
      "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='transfer_cleanup' AND state<>'done' AND available_at<=now() ORDER BY available_at LIMIT $1",
      [limit],
    )
  ).rows;
  for (const job of jobs) {
    try {
      await transaction(job.organization_id, async (tx) => {
        const locked = await tx.query(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
          [`transfer:${job.resource_id}`],
        );
        if (!locked.rows[0].acquired) return;
        const transfer = await resources.get(tx, 'transfers', job.resource_id);
        if (Date.parse(String(transfer.expires_at)) > Date.now()) return;
        for (const key of Object.values((transfer.uploads || {}) as Record<string, string>))
          await storage.delete(key);
        await resources.update(tx, 'transfers', transfer.id, {
          uploads: {},
          staged: {},
          snapshot_files: [],
          ...(transfer.status !== 'succeeded' ? { status: 'expired' } : {}),
        });
        await tx.query(
          "UPDATE dispatch_jobs SET state='done',error=NULL WHERE kind='transfer_cleanup' AND resource_id=$1",
          [transfer.id],
        );
      });
    } catch {
      await pool.query(
        "UPDATE dispatch_jobs SET attempts=attempts+1,available_at=now()+interval '1 minute',error='staging_cleanup_failed' WHERE kind='transfer_cleanup' AND resource_id=$1",
        [job.resource_id],
      );
    }
  }
  return { transfers: jobs.length };
}
