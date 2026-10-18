import { canonical } from './crypto';

/** Trusted internal encoding bound to the exact immutable value it represents. */
export type EncodedJson<T> = Readonly<{ value: T; json: string; bytes: number }>;

export interface JsonPreparation {
  stringify(value: unknown): string;
  encode<T>(value: T): EncodedJson<T>;
  remember<T extends object>(value: T): EncodedJson<T>;
  stats(): Readonly<{ entries: number; retainedBytes: number; peakBytes: number }>;
  dispose(): void;
}

export function encodeJson<T>(value: T): EncodedJson<T> {
  const json = canonical(value);
  return { value, json, bytes: Buffer.byteLength(json) };
}

/** One synchronous preparation owns these immutable roots. Never carry this
 * memo across await, SQL, provider I/O or a changed evidence/step generation.
 * The budget only limits reuse; exhausting it cannot reject a valid request. */
export function createJsonPreparation(): JsonPreparation {
  const entries = new Map<object, EncodedJson<object>>();
  let retainedBytes = 0,
    peakBytes = 0,
    disposed = false;
  const stringify = (value: unknown) => canonical(value, (object) => entries.get(object)?.json);
  function encode<T>(value: T): EncodedJson<T> {
    const cached = value !== null && typeof value === 'object' ? entries.get(value) : undefined;
    if (cached) return { value, json: cached.json, bytes: cached.bytes };
    const json = stringify(value);
    return { value, json, bytes: Buffer.byteLength(json) };
  }
  return {
    stringify,
    encode,
    remember(value) {
      const encoded = encode(value);
      if (
        !disposed &&
        !entries.has(value) &&
        entries.size < 16 &&
        retainedBytes + encoded.bytes <= 8 * 1024 * 1024
      ) {
        entries.set(value, encoded);
        retainedBytes += encoded.bytes;
        peakBytes = Math.max(peakBytes, retainedBytes);
      }
      return encoded;
    },
    stats: () => ({ entries: entries.size, retainedBytes, peakBytes }),
    dispose() {
      entries.clear();
      retainedBytes = 0;
      disposed = true;
    },
  };
}
