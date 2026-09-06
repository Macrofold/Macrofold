import { assert } from './errors';
/** Enforce the limit while reading; Content-Length alone is controlled by the sender. */
export async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert(size <= maximum, 413, 'body_too_large', `Body exceeds the ${maximum}-byte limit.`);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function boundedJSON(response: Response, maximum: number): Promise<unknown> {
  const bytes = await boundedBody(response.body, maximum);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    assert(false, 502, 'upstream_invalid_json', 'The upstream service returned invalid JSON.');
  }
}
