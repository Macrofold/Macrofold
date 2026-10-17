import { transaction, type Tx } from '../../db';
import { id } from './crypto';
import { assert } from './errors';
import { saveChunkManifest, verifyContent, type StoredChunk } from '../../providers/src/storage';

type ContentIdentity = { key: string; sha256: string; size_bytes: string };
/** Proof is deliberately process-local and bound to one GC guard. A previous
 * phase, runtime claim, or restarted process must verify the bytes again. */
class ContentVerificationScope {
  #active = true;
  readonly #expires = Date.now() + 5 * 60_000;
  readonly #verified = new Map<string, number>();
  readonly #manifests = new Map<string, Promise<ContentIdentity>>();
  constructor(private readonly org: string) {}
  private assertActive() {
    assert(
      this.#active && this.#expires > Date.now(),
      409,
      'preparation_expired',
      'File preparation expired. Reload and retry.',
    );
  }
  async verify(file: ContentIdentity) {
    this.assertActive();
    assert(
      file.key.startsWith(`${this.org}/`),
      500,
      'verification_scope_mismatch',
      'Content belongs to a different organization.',
    );
    const identity = `${file.key}:${file.sha256}`;
    let size = this.#verified.get(identity);
    if (size === undefined) size = await verifyContent(file.key, file.sha256);
    this.assertActive();
    assert(
      size === Number(file.size_bytes),
      502,
      'content_size_mismatch',
      'Stored content size does not match its file record.',
    );
    this.#verified.set(identity, size);
  }
  async manifest(hash: string, size: number, chunks: StoredChunk[]) {
    this.assertActive();
    const key = `${this.org}/manifest/${hash}`;
    let pending = this.#manifests.get(key);
    if (!pending) {
      pending = saveChunkManifest(this.org, hash, size, chunks);
      this.#manifests.set(key, pending);
    }
    const saved = await pending;
    this.assertActive();
    assert(
      Number(saved.size_bytes) === size,
      502,
      'content_size_mismatch',
      'Stored content size does not match its file record.',
    );
    this.#verified.set(`${saved.key}:${saved.sha256}`, size);
    return saved;
  }
  dispose() {
    this.#active = false;
    this.#verified.clear();
    this.#manifests.clear();
  }
}
export type ContentVerification = ContentVerificationScope;

/** A bounded GC guard, not a worktree writer lock. Concurrent work may proceed;
 * publication must still reauthorize and compare the source revision. */
export async function storagePreparation<T>(org: string, read: (tx: Tx) => Promise<T>) {
  const lease = id();
  const value = await transaction(org, async (tx) => {
    const value = await read(tx);
    await tx.query("INSERT INTO storage_preparations VALUES($1,$2,now()+interval '5 minutes')", [lease, org]);
    return value;
  });
  const verification = new ContentVerificationScope(org);
  return {
    value,
    verification,
    async assertActive(tx: Tx) {
      const active = await tx.query('SELECT 1 FROM storage_preparations WHERE id=$1 AND expires_at>now()', [
        lease,
      ]);
      assert(active.rowCount, 409, 'preparation_expired', 'File preparation expired. Reload and retry.');
    },
    async dispose() {
      verification.dispose();
      await transaction(org, (tx) => tx.query('DELETE FROM storage_preparations WHERE id=$1', [lease]));
    },
  };
}
