import { downloadVerified } from './checkout';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Client, Schema } from '../../../sdk/typescript/src/client';
import { git, relativeFile, safeLocalPath, loadBaseline, saveBaseline } from './local-project';
import { CliError, confirm, output } from './output';
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function permitted(file: string) {
  return !file
    .split('/')
    .some(
      (p) =>
        ['.git', '.agent', '.aws', '.ssh', '.platform-runtime'].includes(p) ||
        /^\.env(?:\.|$)/.test(p) ||
        /^id_(rsa|ed25519)$/.test(p) ||
        /\.(pem|p12|pfx|key)$/.test(p),
    );
}
async function readLocal(root: string, file: string) {
  const full = await safeLocalPath(root, file);
  try {
    const metadata = await lstat(full);
    if (!metadata.isFile()) throw new CliError(`Transfers require a regular file: ${file}`, 5);
    if (metadata.size > 25 * 1024 * 1024) throw new CliError(`File exceeds 25 MiB: ${file}`, 6);
    const bytes = await readFile(full);
    return { bytes, hash: digest(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: undefined, hash: null };
    throw error;
  }
}
async function filesUnder(root: string, relative: string): Promise<string[]> {
  const full = await safeLocalPath(root, relative);
  try {
    const metadata = await lstat(full);
    if (metadata.isDirectory()) {
      const values: string[] = [];
      for (const name of await readdir(full)) values.push(...(await filesUnder(root, `${relative}/${name}`)));
      return values;
    }
    return [relativeFile(relative)];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [relativeFile(relative)];
    throw error;
  }
}
async function inventory(root: string, paths: string[], includeIgnored: boolean) {
  if (includeIgnored && !paths.length) throw new CliError('--include-ignored requires explicit paths.');
  let tracked: string[] | undefined;
  try {
    tracked = (await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root))
      .split('\0')
      .filter(Boolean);
  } catch {}
  if (!tracked && !paths.length) throw new CliError('For a folder without Git, choose explicit file paths.');
  let candidates = paths.length
    ? (await Promise.all(paths.map((p) => filesUnder(root, relativeFile(p))))).flat()
    : tracked!;
  if (!includeIgnored)
    candidates = candidates.filter((p) => permitted(p) && (!tracked || tracked.includes(p)));
  return [...new Set(candidates)];
}
async function remoteFiles(client: Client, workspaceId: string) {
  let cursor: string | undefined;
  const files: Schema['FileEntry'][] = [];
  do {
    const page = await client.request('listFiles', {
      params: { path: { workspace_id: workspaceId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    files.push(...page.entries);
    cursor = page.next_cursor || undefined;
  } while (cursor);
  return files;
}
export function publicTransfer(plan: Schema['Transfer']) {
  return { ...plan, actions: plan.actions.map(({ url, required_headers, ...action }) => action) };
}
function objectURL(value: string, origin: string) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && url.origin !== origin))
    throw new CliError('The service returned an unsafe object URL.', 7);
  return url;
}
export async function transferFiles(
  client: Client,
  root: string,
  workspaceId: string,
  direction: 'push' | 'pull',
  paths: string[],
  options: { includeIgnored?: boolean; delete?: boolean; dryRun?: boolean; yes?: boolean; json?: boolean },
) {
  const workspace = await client.request('getWorkspace', { params: { path: { workspace_id: workspaceId } } });
  const baseline = await loadBaseline(root, workspaceId);
  let candidates: string[];
  if (direction === 'push') candidates = await inventory(root, paths, Boolean(options.includeIgnored));
  else {
    const files = await remoteFiles(client, workspaceId);
    candidates = files
      .filter(
        (f) =>
          (!paths.length || paths.some((p) => f.path === p || f.path.startsWith(p + '/'))) &&
          (options.includeIgnored || (!f.git_ignored && permitted(f.path))),
      )
      .map((f) => f.path);
    if (options.delete)
      candidates.push(
        ...Object.keys(baseline).filter(
          (f) => !paths.length || paths.some((p) => f === p || f.startsWith(p + '/')),
        ),
      );
    if (options.includeIgnored && !paths.length)
      throw new CliError('--include-ignored requires explicit paths.');
  }
  if (options.delete && direction === 'push')
    candidates.push(
      ...Object.keys(baseline).filter(
        (f) => !paths.length || paths.some((p) => f === p || f.startsWith(p + '/')),
      ),
    );
  candidates = [...new Set(candidates)];
  if (candidates.length > 1000) throw new CliError('Select at most 1,000 files per transfer.', 6);
  const manifest: Schema['TransferManifestEntry'][] = [];
  let bytes = 0;
  for (const file of candidates) {
    const local = await readLocal(root, file);
    bytes += local.bytes?.length || 0;
    manifest.push({
      path: file,
      local_sha256: local.hash,
      local_size_bytes: local.bytes?.length || 0,
      baseline_known: file in baseline,
      baseline_sha256: baseline[file] ?? null,
    });
  }
  if (bytes > 250 * 1024 * 1024) throw new CliError('Select at most 250 MiB per transfer.', 6);
  const plan = await client.request('createTransfer', {
    params: { path: { workspace_id: workspaceId } },
    body: {
      direction,
      base_revision: workspace.revision,
      manifest,
      paths,
      include_ignored: Boolean(options.includeIgnored),
      delete: Boolean(options.delete),
      dry_run: Boolean(options.dryRun),
    },
  });
  if (options.dryRun) return publicTransfer(plan);
  if (plan.actions.some((a) => a.action === 'conflict')) {
    if (!options.json) output(publicTransfer(plan));
    throw new CliError('Resolve the listed conflicts before applying this transfer.', 5);
  }
  if (!options.json) output(publicTransfer(plan));
  await confirm(
    `Apply ${plan.actions.filter((a) => a.action !== 'unchanged').length} ${direction} changes?`,
    options.yes,
  );
  const completed: string[] = [];
  for (const action of plan.actions) {
    const local = await readLocal(root, action.path);
    if (local.hash !== action.local_sha256)
      throw new CliError(
        `Local file changed after planning: ${action.path}. Remote changes were not applied.`,
        5,
      );
    if (action.action === 'upload') {
      if (!local.bytes) throw new CliError(`Local file disappeared: ${action.path}`, 5);
      const response = await fetch(objectURL(action.url!, client.baseURL), {
        method: 'PUT',
        headers: action.required_headers,
        body: local.bytes,
        redirect: 'error',
      });
      if (!response.ok)
        throw new CliError(
          `Could not stage ${action.path} (${response.status}). Remote files remain unchanged.`,
          7,
        );
    }
    if (direction === 'pull' && action.action === 'download') {
      const bytes = await downloadVerified(
        objectURL(action.url!, client.baseURL).href,
        action.remote_sha256!,
        25 * 1024 * 1024,
        client.baseURL,
        action.required_headers,
      );
      const dest = await safeLocalPath(root, action.path);
      await mkdir(path.dirname(dest), { recursive: true });
      const temp = `${dest}.${crypto.randomUUID()}.download`;
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      // Recheck immediately before replacing; another editor may have saved during the download.
      if ((await readLocal(root, action.path)).hash !== action.local_sha256) {
        await unlink(temp);
        throw new CliError(`Local edit preserved: ${action.path}.`, 5);
      }
      await rename(temp, dest);
    }
    if (direction === 'pull' && action.action === 'delete')
      await unlink(await safeLocalPath(root, action.path)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    if (['download', 'delete'].includes(action.action)) completed.push(action.path);
    if (direction === 'pull') {
      baseline[action.path] = action.action === 'delete' ? null : action.remote_sha256;
      await saveBaseline(root, workspaceId, baseline);
    }
  }
  const operation = await client.request('applyTransfer', {
    params: { path: { transfer_id: plan.id } },
    body: {
      expected_revision: workspace.revision,
      ...(direction === 'pull' ? { completed_paths: completed } : {}),
    },
  });
  const result = await client.waitOperation(operation.id);
  if (result.status !== 'succeeded') throw new CliError(result.error?.message || 'Transfer apply failed.', 5);
  if (direction === 'push') {
    for (const action of plan.actions)
      baseline[action.path] = action.action === 'delete' ? null : action.local_sha256;
    await saveBaseline(root, workspaceId, baseline);
  }
  const final = await client.request('getTransfer', { params: { path: { transfer_id: plan.id } } });
  return publicTransfer(final);
}
