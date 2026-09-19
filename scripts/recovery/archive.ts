import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { z } from 'zod';
import { seal, sha256, unseal } from '../../packages/core/src/crypto';
import { contentChunks, type ObjectStore } from '../../packages/providers/src/storage';

const objectSchema = z.object({
  key: z.string().regex(/^[a-f0-9-]+\/(content|manifest)\/[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});
const manifestSchema = z.object({
  version: z.literal(1),
  started_at: z.iso.datetime(),
  completed_at: z.iso.datetime(),
  database: z.string(),
  objects: z.array(objectSchema),
  key: z.string(),
  nonce: z.string(),
  tag: z.string(),
});
export type RecoveryManifest = z.infer<typeof manifestSchema>;
export type PostgresTools = { container?: string };
const databaseIdentity = (url: string) => {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
};
function postgres(tool: 'pg_dump' | 'pg_restore', url: string, args: string[], options: PostgresTools) {
  const u = new URL(url);
  // Secrets are passed only in the child environment, never arguments or diagnostic output.
  // pg_dump/pg_restore do not expand a connection URI in PGDATABASE. Use the
  // dedicated libpq environment fields so credentials stay out of argv.
  const env = {
    ...process.env,
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    ...(u.searchParams.has('sslmode') ? { PGSSLMODE: u.searchParams.get('sslmode')! } : {}),
  };
  const child = options.container
    ? spawn(
        'docker',
        [
          'exec',
          ...(tool === 'pg_restore' ? ['-i'] : []),
          options.container,
          tool,
          '-U',
          decodeURIComponent(u.username),
          '--dbname',
          decodeURIComponent(u.pathname.slice(1)),
          ...args,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )
    : spawn(tool, ['--dbname', env.PGDATABASE, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${tool} failed; verify PostgreSQL version, access and target roles.`)),
    );
  });
  return { child, done };
}
const archiveObject = (directory: string, key: string) => path.join(directory, 'objects', sha256(key));

/** Offline paired backup: pause ALL writers/maintenance first. No live-bucket/PITR pairing guesswork.
 * The database and manifest are authenticated ciphertext. Retained vault keys stay outside this directory. */
export async function backupRecoverySet(
  url: string,
  store: ObjectStore,
  directory: string,
  options: PostgresTools = {},
) {
  if (!store.list) throw new Error('Object inventory is required.');
  const started_at = new Date().toISOString();
  await mkdir(directory, { mode: 0o700 }); // Existing destinations are never overwritten.
  await mkdir(path.join(directory, 'objects'), { mode: 0o700 });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const key = randomBytes(32),
    nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  const objects: RecoveryManifest['objects'] = [];
  try {
    // Snapshot-bound dump; the pause also protects object copying from retention/key maintenance.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot'))
      .rows[0].snapshot;
    const organizations = (await client.query<{ id: string }>('SELECT id FROM organizations ORDER BY id'))
      .rows;
    const dump = postgres('pg_dump', url, ['--format=custom', `--snapshot=${snapshot}`], options);
    dump.child.stdin.end();
    await Promise.all([
      dump.done,
      pipeline(
        dump.child.stdout,
        cipher,
        createWriteStream(path.join(directory, 'database.enc'), { flags: 'wx', mode: 0o600 }),
      ),
    ]);
    for (const org of organizations) {
      let cursor: string | undefined;
      do {
        const page = await store.list(`${org.id}/`, cursor, 1000);
        for (const object of page.objects) {
          if (!object.key.startsWith(`${org.id}/`))
            throw new Error('Object inventory crossed a tenant boundary.');
          const bytes = await store.get(object.key);
          // Decryptability is checked before accepting the recovery set; plaintext is never written.
          unseal(bytes.toString());
          const entry = objectSchema.parse({ key: object.key, sha256: sha256(bytes), size: bytes.length });
          await writeFile(archiveObject(directory, entry.key), bytes, { flag: 'wx', mode: 0o600 });
          objects.push(entry);
        }
        cursor = page.next_cursor;
      } while (cursor);
    }
    await client.query('COMMIT');
    const manifest: RecoveryManifest = {
      version: 1,
      started_at,
      completed_at: new Date().toISOString(),
      database: databaseIdentity(url),
      objects,
      key: key.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
    // This authenticated completion marker is written last; partial archives cannot be restored.
    await writeFile(path.join(directory, 'manifest.enc'), seal(manifest), { flag: 'wx', mode: 0o600 });
    return { started_at, completed_at: manifest.completed_at, objects: objects.length };
  } finally {
    await client.end();
  }
}
export async function verifyRecoverySet(directory: string) {
  const manifest = manifestSchema.parse(unseal(await readFile(path.join(directory, 'manifest.enc'), 'utf8')));
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(manifest.key, 'base64'),
    Buffer.from(manifest.nonce, 'base64'),
  );
  cipher.setAuthTag(Buffer.from(manifest.tag, 'base64'));
  await pipeline(
    createReadStream(path.join(directory, 'database.enc')),
    cipher,
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
  const keys = new Set<string>();
  for (const object of manifest.objects) {
    if (keys.has(object.key)) throw new Error('Duplicate recovery object.');
    keys.add(object.key);
    const bytes = await readFile(archiveObject(directory, object.key));
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256)
      throw new Error('Recovery object is missing or corrupt.');
    unseal(bytes.toString());
  }
  const archiveStore = {
    get: (key: string) => {
      if (!keys.has(key)) throw new Error('Recovery manifest references a missing object.');
      return readFile(archiveObject(directory, key));
    },
  };
  for (const object of manifest.objects) {
    const hash = object.key.slice(object.key.lastIndexOf('/') + 1);
    for await (const _ of contentChunks(object.key, hash, archiveStore)) {
      /* Verify plaintext hashes and tenant-confined chunk references without writing plaintext. */
    }
  }
  return manifest;
}
/** Restore ONLY into an empty, independent database and store. Never clean, overwrite or resume execution. */
export async function restoreRecoverySet(
  directory: string,
  url: string,
  store: ObjectStore,
  options: PostgresTools = {},
) {
  const started = Date.now(),
    manifest = await verifyRecoverySet(directory);
  if (databaseIdentity(url) === manifest.database)
    throw new Error('Recovery must use an independent database.');
  if (!store.list || (await store.list('', undefined, 1)).objects.length)
    throw new Error('Recovery requires an empty, independent object store.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const present = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1",
    );
    if (present.rowCount) throw new Error('Recovery requires an empty database.');
  } finally {
    await client.end();
  }
  // Restore objects before the database can expose references. On failure the target stays quarantined.
  for (const object of manifest.objects)
    await store.put(object.key, await readFile(archiveObject(directory, object.key)));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(manifest.key, 'base64'),
    Buffer.from(manifest.nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(manifest.tag, 'base64'));
  const restore = postgres('pg_restore', url, ['--exit-on-error', '--single-transaction'], options);
  restore.child.stdout.resume();
  await Promise.all([
    restore.done,
    pipeline(createReadStream(path.join(directory, 'database.enc')), decipher, restore.child.stdin),
  ]);
  return {
    snapshot_at: manifest.started_at,
    restored_at: new Date().toISOString(),
    recovery_seconds: (Date.now() - started) / 1000,
    snapshot_age_seconds: (Date.now() - Date.parse(manifest.started_at)) / 1000,
    objects: manifest.objects.length,
  };
}
