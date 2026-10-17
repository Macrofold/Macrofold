import type { components } from '../../contracts/api';
import { assert } from './errors';

export type RawConnectionTool = Omit<components['schemas']['Tool'], 'granted'>;
type Entry = { tools: RawConnectionTool[]; bytes: number; expiresAt: number };

/** Raw discovery only: callers project current grants after every cache read.
 * Bounded, process-local and disposable; failed discovery is never cached. */
export class ConnectionToolCatalog {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, { work: Promise<RawConnectionTool[]>; invalidated: boolean }>();
  private bytes = 0;
  constructor(
    private readonly limits = { entries: 128, bytes: 32 * 1024 * 1024, pending: 16, ttlMs: 60_000 },
    private readonly now = Date.now,
  ) {}

  invalidate(key?: string) {
    if (key === undefined) {
      this.entries.clear();
      this.bytes = 0;
      for (const pending of this.pending.values()) pending.invalidated = true;
    } else {
      this.remove(key);
      const pending = this.pending.get(key);
      if (pending) pending.invalidated = true;
    }
  }

  async read(key: string, discover: () => Promise<RawConnectionTool[]>, refresh = false) {
    if (refresh) this.remove(key);
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.tools;
    }
    this.remove(key);
    const pending = this.pending.get(key);
    if (pending) return pending.work;
    assert(
      this.pending.size < this.limits.pending,
      503,
      'tool_catalog_busy',
      'Tool discovery is busy. Retry shortly.',
    );
    const work = Promise.resolve()
      .then(discover)
      .then((tools) => {
        const bytes = Buffer.byteLength(JSON.stringify(tools));
        // collectToolPages separately bounds each catalog. Oversized cache entries
        // remain usable for this caller without retaining them indefinitely.
        if (!this.pending.get(key)?.invalidated && bytes <= this.limits.bytes) {
          while (this.entries.size >= this.limits.entries || this.bytes + bytes > this.limits.bytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
          }
          this.entries.set(key, { tools, bytes, expiresAt: this.now() + this.limits.ttlMs });
          this.bytes += bytes;
        }
        return tools;
      });
    this.pending.set(key, { work, invalidated: false });
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private remove(key: string) {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
  }
}

export const connectionToolCatalog = new ConnectionToolCatalog();
