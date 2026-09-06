import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config, isLocal } from '../../core/src/config';
import { createHash } from 'node:crypto';
import { sha256, seal, unseal } from '../../core/src/crypto';
export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  uploadURL?(
    key: string,
    size: number,
    expires: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  readUpload?(key: string, expectedSize: number): Promise<Buffer>;
  list?(
    prefix: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ objects: StoredObject[]; next_cursor?: string }>;
}
export type StoredObject = { key: string; size: number; modified_at: string };
function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_-]+(?:\.[a-z0-9]+)?$/.test(key) || key.includes('..'))
    throw new Error('Invalid object key');
  return key;
}
class LocalStore implements ObjectStore {
  async list(prefix: string, cursor?: string, limit = 1000) {
    if (prefix) safeKey(prefix);
    const base = path.join(config.dataDir, 'objects'),
      names: string[] = [];
    async function walk(dir: string) {
      for (const file of await readdir(dir, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })) {
        const item = path.join(dir, file.name);
        if (file.isDirectory()) await walk(item);
        else if (file.isFile() && !file.name.endsWith('.tmp'))
          names.push(path.relative(base, item).split(path.sep).join('/'));
      }
    }
    await walk(path.join(base, prefix));
    const selected = names
        .filter((k) => !cursor || k > cursor)
        .sort()
        .slice(0, limit + 1),
      objects: StoredObject[] = [];
    for (const key of selected.slice(0, limit)) {
      const info = await stat(path.join(base, key));
      objects.push({ key, size: info.size, modified_at: info.mtime.toISOString() });
    }
    return { objects, next_cursor: selected.length > limit ? selected[limit - 1] : undefined };
  }
  async put(key: string, bytes: Buffer) {
    const dest = path.join(config.dataDir, 'objects', safeKey(key));
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, dest);
  }
  get(key: string) {
    return readFile(path.join(config.dataDir, 'objects', safeKey(key)));
  }
  async delete(key: string) {
    await unlink(path.join(config.dataDir, 'objects', safeKey(key))).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
export class R2Store implements ObjectStore {
  constructor(
    private client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
    private bucket = process.env.R2_BUCKET,
  ) {}
  async list(prefix: string, cursor?: string, limit = 1000) {
    if (prefix) safeKey(prefix);
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
        MaxKeys: Math.min(1000, limit),
      }),
    );
    return {
      objects: (result.Contents || []).map((o) => ({
        key: o.Key!,
        size: o.Size!,
        modified_at: o.LastModified!.toISOString(),
      })),
      next_cursor: result.IsTruncated ? result.NextContinuationToken : undefined,
    };
  }
  async put(key: string, bytes: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: bytes,
        ContentType: 'application/octet-stream',
      }),
    );
  }
  async get(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Buffer.from(await response.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
  async uploadURL(key: string, size: number, expires: number) {
    if (!key.startsWith('staging/') || !Number.isSafeInteger(size) || size < 0 || size > 25 * 1024 * 1024)
      throw new Error('Invalid upload plan');
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        ContentLength: size,
        ContentType: 'application/octet-stream',
      }),
      {
        expiresIn: Math.max(1, Math.min(1800, Math.floor((expires - Date.now()) / 1000))),
        signableHeaders: new Set(['content-length', 'content-type']),
      },
    );
    // Fetch and browsers compute Content-Length from the body. Supplying it twice
    // breaks Node's bundled fetch when an Undici 8 dispatcher is installed.
    return { url, headers: { 'Content-Type': 'application/octet-stream' } };
  }
  async readUpload(key: string, expectedSize: number) {
    if (!key.startsWith('staging/') || expectedSize > 25 * 1024 * 1024 || expectedSize < 0)
      throw new Error('Invalid upload plan');
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    if (response.ContentLength !== expectedSize) {
      (response.Body as { destroy?: () => void })?.destroy?.();
      throw new Error('Upload size mismatch');
    }
    const parts: Buffer[] = [];
    let total = 0;
    for await (const part of response.Body as AsyncIterable<Uint8Array>) {
      total += part.byteLength;
      if (total > expectedSize) {
        (response.Body as { destroy?: () => void }).destroy?.();
        throw new Error('Upload exceeds planned size');
      }
      parts.push(Buffer.from(part));
    }
    if (total !== expectedSize) throw new Error('Upload incomplete');
    return Buffer.concat(parts);
  }
}
export const storage: ObjectStore = isLocal() ? new LocalStore() : new R2Store();
export async function saveContent(org: string, bytes: Buffer) {
  const hash = sha256(bytes),
    key = `${org}/content/${hash}`;
  await storage.put(key, Buffer.from(seal({ bytes: bytes.toString('base64') })));
  return { key, sha256: hash, size_bytes: String(bytes.length) };
}
export async function readContent(key: string, hash?: string) {
  const parts: Buffer[] = [];
  for await (const part of contentChunks(key, hash)) parts.push(part);
  return Buffer.concat(parts);
}
export type StoredChunk = { key: string; sha256: string; size: number };
type StoredValue = { bytes: string } | { version: 2; sha256: string; size: number; chunks: StoredChunk[] };
export async function* contentChunks(key: string, expectedHash?: string): AsyncGenerator<Buffer> {
  const value = unseal<StoredValue>((await storage.get(key)).toString());
  const hasher = createHash('sha256');
  let size = 0;
  if ('bytes' in value) {
    const bytes = Buffer.from(value.bytes, 'base64');
    hasher.update(bytes);
    size = bytes.length;
    yield bytes;
  } else {
    for (const chunk of value.chunks) {
      // One level only: a malicious/corrupt manifest cannot recurse forever or leave its tenant prefix.
      if (!chunk.key.startsWith(`${key.split('/')[0]}/content/`)) throw new Error('Invalid content manifest');
      const item = unseal<{ bytes: string }>((await storage.get(chunk.key)).toString());
      const bytes = Buffer.from(item.bytes, 'base64');
      if (sha256(bytes) !== chunk.sha256 || bytes.length !== chunk.size)
        throw new Error('Content chunk integrity failure');
      hasher.update(bytes);
      size += bytes.length;
      yield bytes;
    }
    if (size !== value.size) throw new Error('Content size integrity failure');
  }
  const actual = hasher.digest('hex');
  if ((expectedHash && actual !== expectedHash) || (!('bytes' in value) && value.sha256 !== actual))
    throw new Error('Stored content integrity check failed');
}
export async function verifyContent(key: string, hash: string) {
  for await (const _ of contentChunks(key, hash)) {
    /* Consume to verify without buffering a large file. */
  }
}
export async function saveChunkManifest(org: string, hash: string, size: number, chunks: StoredChunk[]) {
  const key = `${org}/manifest/${hash}`;
  await storage.put(key, Buffer.from(seal({ version: 2, sha256: hash, size, chunks })));
  await verifyContent(key, hash);
  return { key, sha256: hash, size_bytes: String(size) };
}
export async function describeContent(key: string, expectedHash: string): Promise<StoredChunk[]> {
  const value = unseal<StoredValue>((await storage.get(key)).toString());
  if (!('bytes' in value)) {
    if (value.sha256 !== expectedHash) throw new Error('Content manifest mismatch');
    return value.chunks;
  }
  const bytes = Buffer.from(value.bytes, 'base64');
  if (sha256(bytes) !== expectedHash) throw new Error('Content integrity failure');
  const chunks: StoredChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
    const part = bytes.subarray(offset, offset + 4 * 1024 * 1024);
    const saved = await saveContent(key.split('/')[0], part);
    chunks.push({ key: saved.key, sha256: saved.sha256, size: part.length });
  }
  return chunks;
}
