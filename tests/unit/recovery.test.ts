import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { seal, sha256 } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import { verifyRecoverySet, restoreRecoverySet, type RecoveryManifest } from '../../scripts/recovery/archive';
import { LocalStore } from '../../packages/providers/src/storage';
const dirs: string[] = [];
const vault = config.vaultKey;
afterEach(async () => {
  config.vaultKey = vault;
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});
async function archive() {
  const dir = await mkdtemp(path.join(tmpdir(), 'recovery-unit-'));
  dirs.push(dir);
  await mkdir(path.join(dir, 'objects'));
  const key = randomBytes(32),
    nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  await writeFile(
    path.join(dir, 'database.enc'),
    Buffer.concat([cipher.update('synthetic database dump'), cipher.final()]),
  );
  const bytes = Buffer.from('retained customer file'),
    objectKey = `00000000-0000-0000-0000-000000000001/content/${sha256(bytes)}`,
    encrypted = Buffer.from(seal({ bytes: bytes.toString('base64') }));
  const manifest: RecoveryManifest = {
    version: 1,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    database: 'localhost:5432/source',
    objects: [{ key: objectKey, sha256: sha256(encrypted), size: encrypted.length }],
    key: key.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
  await writeFile(path.join(dir, 'objects', sha256(objectKey)), encrypted);
  await writeFile(path.join(dir, 'manifest.enc'), seal(manifest));
  return { dir, manifest, objectFile: path.join(dir, 'objects', sha256(objectKey)) };
}
it('verifies a complete encrypted set and refuses restoring over its source', async () => {
  const a = await archive();
  expect((await verifyRecoverySet(a.dir)).objects).toHaveLength(1);
  await expect(
    restoreRecoverySet(a.dir, 'postgres://user:password@localhost/source', new LocalStore(a.dir)),
  ).rejects.toThrow('independent database');
});
it.each(['database', 'object', 'missing', 'manifest', 'key', 'hash'] as const)(
  'rejects %s damage before any restore can start',
  async (kind) => {
    const a = await archive();
    if (kind === 'key') config.vaultKey = 'wrong-key-that-is-only-for-tests';
    else if (kind === 'missing') await rm(a.objectFile);
    else if (kind === 'hash') {
      const bytes = Buffer.from(seal({ bytes: Buffer.from('wrong content').toString('base64') }));
      a.manifest.objects[0].sha256 = sha256(bytes);
      a.manifest.objects[0].size = bytes.length;
      await writeFile(a.objectFile, bytes);
      await writeFile(path.join(a.dir, 'manifest.enc'), seal(a.manifest));
    } else {
      const file =
        kind === 'object'
          ? a.objectFile
          : path.join(a.dir, kind === 'database' ? 'database.enc' : 'manifest.enc');
      const bytes = await readFile(file);
      bytes[bytes.length - 1] ^= 1;
      await writeFile(file, bytes);
    }
    await expect(verifyRecoverySet(a.dir)).rejects.toThrow();
  },
);
it('rejects cross-tenant content manifests even when their ciphertext is authentic', async () => {
  const a = await archive();
  const bytes = Buffer.from(
    seal({
      version: 2,
      size: 1,
      sha256: a.manifest.objects[0].key.split('/').at(-1),
      chunks: [{ key: 'foreign/content/test', size: 1, sha256: 'bad' }],
    }),
  );
  a.manifest.objects[0].sha256 = sha256(bytes);
  a.manifest.objects[0].size = bytes.length;
  await writeFile(a.objectFile, bytes);
  await writeFile(path.join(a.dir, 'manifest.enc'), seal(a.manifest));
  await expect(verifyRecoverySet(a.dir)).rejects.toThrow('Invalid content manifest');
});
