import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create as createTar } from 'tar';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import * as resources from './resources';
import { normalizePath, type FileRecord } from './files';
import { saveContent, readContent } from '../../providers/src/storage';
import { downloadURL } from './transfers';
import { withRepository, gitRevision } from '../../providers/src/git-repository';
export async function exportCheckpoint(
  tx: Tx,
  p: Principal,
  checkpointId: string,
  format: 'git_bundle' | 'portable_archive',
) {
  const cp = await resources.get(tx, 'checkpoints', checkpointId, p);
  assert(
    cp.verification === 'verified',
    409,
    'checkpoint_unverified',
    'Only verified checkpoints can be exported.',
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-export-'));
  const root = path.join(dir, 'workspace');
  await mkdir(root, { mode: 0o700 });
  try {
    let records = (cp.git_files || []) as FileRecord[];
    let checkpointFiles = cp.files as FileRecord[];
    if (format === 'git_bundle' && (!records.length || cp.git_status !== 'ready')) {
      const revision = await gitRevision(
        p.organizationId,
        'export',
        checkpointFiles,
        records,
        'Export checkpoint',
      );
      records = revision.git_files;
      checkpointFiles = revision.files;
    }
    const files = checkpointFiles.filter((f) => format === 'portable_archive' || !f.git_ignored);
    const entries = [];
    const links: { path: string; target: string }[] = [];
    const linkPaths = new Set(files.filter((f) => f.type === 'symlink').map((f) => f.path));
    for (const file of files) {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++)
        assert(
          !linkPaths.has(parts.slice(0, i).join('/')),
          409,
          'unsafe_symlink',
          'A checkpoint file cannot be below a symlink.',
        );
    }
    let size = 0;
    for (const file of files) {
      normalizePath(file.path);
      size += Number(file.size_bytes);
      assert(
        size <= 250 * 1024 * 1024,
        413,
        'export_too_large',
        'Export size exceeds the configured 250 MiB limit.',
      );
      const target = path.join(root, file.path);
      // Git exports pack objects directly; they never materialize repository symlinks or invoke filters.
      if (format === 'portable_archive') {
        const bytes = await readContent(file.key, file.sha256);
        await mkdir(path.dirname(target), { recursive: true });
        if (file.type === 'symlink') {
          const link = bytes.toString('utf8'),
            resolved = path.resolve(path.dirname(target), link);
          assert(
            !path.isAbsolute(link) &&
              !link.includes('\0') &&
              (resolved === root || resolved.startsWith(root + path.sep)),
            409,
            'unsafe_symlink',
            'Portable archives require relative symlinks confined to the workspace.',
          );
          links.push({ path: target, target: link });
        } else await writeFile(target, bytes, { mode: (file.mode || 0) & 0o111 ? 0o755 : 0o644 });
      }
      entries.push({
        type: file.type,
        mode: file.mode || 0o644,
        path: file.path,
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        git_ignored: file.git_ignored,
      });
    }
    const manifest = Buffer.from(
      JSON.stringify(
        { schema_version: 1, checkpoint_id: cp.id, created_at: cp.created_at, files: entries },
        null,
        2,
      ),
    );
    let bytes: Buffer, exportCommit: string | undefined;
    if (format === 'portable_archive') {
      for (const link of links) await symlink(link.target, link.path);
      await writeFile(path.join(dir, 'manifest.json'), manifest, { mode: 0o600 });
      const archive = path.join(dir, 'workspace.tar.gz');
      await createTar({ cwd: dir, file: archive, gzip: true, portable: true, noMtime: true, follow: false }, [
        'workspace',
        'manifest.json',
      ]);
      bytes = await readFile(archive);
    } else {
      const bundle = await withRepository(records, (repo) => repo.bundle());
      bytes = bundle.bytes;
      exportCommit = bundle.commit;
    }
    const object = await saveContent(p.organizationId, bytes),
      manifestObject = await saveContent(p.organizationId, manifest);
    const download = downloadURL(
      p.organizationId,
      object.key,
      object.sha256,
      format === 'git_bundle' ? 'workspace.bundle' : 'workspace.tar.gz',
    );
    const manifestLink = downloadURL(
      p.organizationId,
      manifestObject.key,
      manifestObject.sha256,
      'manifest.json',
    );
    return resources.operation(tx, p, 'checkpoint_export', {
      checkpoint_id: cp.id,
      format,
      download_url: download.url,
      expires_at: download.expires_at,
      size_bytes: object.size_bytes,
      sha256: object.sha256,
      manifest_url: manifestLink.url,
      manifest_sha256: manifestObject.sha256,
      ...(exportCommit ? { export_commit: exportCommit, source_commit: cp.git_commit || exportCommit } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
