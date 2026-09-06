import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, lstat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Client, Schema } from '../../../sdk/typescript/src/client';
import { git, relativeFile, safeLocalPath, saveBaseline } from './local-project';
import { CliError } from './output';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifestSchema = z.object({
  schema_version: z.literal(1),
  checkpoint_id: z.uuid(),
  files: z
    .array(
      z.object({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size_bytes: z.string().regex(/^\d+$/),
        git_ignored: z.boolean().optional(),
        type: z.enum(['file', 'symlink']).default('file'),
        mode: z.number().int().min(0).max(511).default(0o644),
      }),
    )
    .max(100000),
});
export async function downloadVerified(
  url: string,
  expectedHash: string,
  maxBytes: number,
  origin: string,
  headers: Record<string, string> = {},
) {
  const target = new URL(url);
  if (target.username || target.password || (target.protocol !== 'https:' && target.origin !== origin))
    throw new CliError('Unsafe download URL.', 7);
  const response = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new CliError(`Download failed (${response.status}).`, 7);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new CliError('Download exceeds the allowed size.', 6);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new CliError('Download exceeds the allowed size.', 6);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== expectedHash) throw new CliError('Downloaded content failed its SHA-256 check.', 7);
  return bytes;
}
export async function checkout(
  client: Client,
  root: string,
  workspace: Schema['Workspace'],
  destination: string,
  branch?: string,
) {
  await git(['rev-parse', '--show-toplevel'], root);
  const target = path.resolve(destination);
  try {
    await lstat(target);
    throw new CliError('The checkout destination already exists.', 5);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!workspace.latest_checkpoint_id)
    throw new CliError('Create a verified checkpoint before checking out this workspace.', 5);
  const operation = await client.request('exportCheckpoint', {
    params: { path: { checkpoint_id: workspace.latest_checkpoint_id } },
    body: { format: 'git_bundle' },
  });
  const completed = await client.waitOperation(operation.id);
  if (completed.status !== 'succeeded') throw new CliError(completed.error?.message || 'Export failed.', 5);
  const exported = completed.result as Schema['CheckpointExport'];
  if (
    !exported ||
    exported.format !== 'git_bundle' ||
    !exported.export_commit ||
    !/^[a-f0-9]{40,64}$/.test(exported.export_commit)
  )
    throw new CliError('The service returned an invalid Git export.', 7);
  const manifest = manifestSchema.parse(
    JSON.parse(
      (
        await downloadVerified(
          exported.manifest_url,
          exported.manifest_sha256,
          16 * 1024 * 1024,
          client.baseURL,
        )
      ).toString(),
    ),
  );
  if (
    manifest.checkpoint_id !== workspace.latest_checkpoint_id ||
    new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
  )
    throw new CliError('The export manifest does not match this checkpoint.', 7);
  // Reject metadata collisions, nonportable filenames and symlink ancestors before
  // creating any local branch/worktree. Remote content cannot become CLI state.
  const folded = new Set<string>();
  const links = new Set(manifest.files.filter((f) => f.type === 'symlink').map((f) => f.path.toLowerCase()));
  let total = 0n;
  for (const file of manifest.files) {
    relativeFile(file.path);
    const name = file.path.toLowerCase();
    if (folded.has(name)) throw new CliError('Export paths collide on a case-insensitive filesystem.', 7);
    folded.add(name);
    const parts = name.split('/');
    if (parts.some((_, i) => i > 0 && links.has(parts.slice(0, i).join('/'))))
      throw new CliError('An exported file cannot be below a symlink.', 7);
    total += BigInt(file.size_bytes);
    if (total > 250n * 1024n * 1024n) throw new CliError('Exported files exceed the allowed size.', 6);
  }
  const bytes = await downloadVerified(
    exported.download_url,
    exported.sha256,
    250 * 1024 * 1024,
    client.baseURL,
  );
  if (BigInt(bytes.length) !== BigInt(exported.size_bytes))
    throw new CliError('Git bundle size mismatch.', 7);
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-review-')),
    bundle = path.join(dir, 'workspace.bundle'),
    reference = `refs/hosted-reviews/${crypto.randomUUID()}`;
  const localBranch =
    branch || `review/${workspace.name.replace(/[^a-zA-Z0-9_-]/g, '-')}-${workspace.id.slice(-8)}`;
  await git(['check-ref-format', '--branch', localBranch], root);
  try {
    await writeFile(bundle, bytes, { mode: 0o600 });
    await git(['bundle', 'verify', bundle], root);
    await git(
      [
        '-c',
        'fetch.fsckObjects=true',
        '-c',
        'maintenance.auto=false',
        '-c',
        'gc.auto=0',
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        bundle,
        `${exported.export_commit}:${reference}`,
      ],
      root,
    );
    await mkdir(path.dirname(target), { recursive: true });
    await git(['worktree', 'add', '--no-checkout', '-b', localBranch, target, reference], root);
    // Avoid checkout filters entirely. Repository .gitattributes must never execute a local smudge command.
    await git(['read-tree', exported.export_commit], target);
    const baseline: Record<string, string> = {};
    for (const file of manifest.files) {
      if (file.git_ignored)
        throw new CliError('A Git review export unexpectedly included an ignored file.', 7);
      const dest = await safeLocalPath(target, file.path);
      const content = await gitBlob(target, exported.export_commit, file.path, Number(file.size_bytes));
      if (hash(content) !== file.sha256) throw new CliError(`Git content mismatch for ${file.path}.`, 7);
      await mkdir(path.dirname(dest), { recursive: true });
      if (file.type === 'symlink') {
        const link = content.toString('utf8'),
          resolved = path.resolve(path.dirname(dest), link);
        if (
          path.isAbsolute(link) ||
          link.includes('\0') ||
          !(resolved === target || resolved.startsWith(target + path.sep))
        )
          throw new CliError(`Refusing a symlink that leaves the review folder: ${file.path}.`, 7);
        await symlink(link, dest);
      } else await writeFile(dest, content, { mode: file.mode & 0o111 ? 0o755 : 0o644, flag: 'wx' });
      baseline[file.path] = file.sha256;
    }
    await saveBaseline(target, workspace.id, baseline);
    return {
      directory: target,
      branch: localBranch,
      checkpoint_id: exported.checkpoint_id,
      source_commit: exported.source_commit,
      export_commit: exported.export_commit,
      review_snapshot: true,
    };
  } finally {
    await git(['update-ref', '-d', reference], root).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
async function gitBlob(cwd: string, commit: string, file: string, size: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 250 * 1024 * 1024)
    throw new CliError('Invalid exported file size.', 7);
  const { spawn } = await import('node:child_process');
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        'cat-file',
        'blob',
        `${commit}:${file}`,
      ],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let received = 0;
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => {
      received += chunk.length;
      if (received > size) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 && received === size
        ? resolve(Buffer.concat(chunks))
        : reject(new CliError('Could not verify exported Git blob.', 7)),
    );
  });
}
