import { assert } from './errors';
/** Enforce the limit while reading; Content-Length alone is controlled by the sender. */
export async function boundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  timeoutMs = 60_000,
) {
  assert(
    Number.isSafeInteger(maximum) && maximum >= 0 && Number.isFinite(timeoutMs) && timeoutMs > 0,
    500,
    'invalid_body_limit',
    'Body limits must be finite and non-negative, with a positive read deadline.',
  );
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  let emptyChunks = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('body_read_timeout')), timeoutMs);
  const abort = () => {
    void reader.cancel(controller.signal.reason).catch(() => {});
  };
  controller.signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      assert(
        !controller.signal.aborted,
        408,
        'body_read_timeout',
        'The request body did not finish within its read deadline.',
      );
      if (done) break;
      emptyChunks = value.byteLength ? 0 : emptyChunks + 1;
      assert(emptyChunks < 16, 400, 'body_not_progressing', 'The body stream did not make progress.');
      size += value.byteLength;
      assert(size <= maximum, 413, 'body_too_large', `Body exceeds the ${maximum}-byte limit.`);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', abort);
    // Cancellation closes pending reads immediately; remote cleanup must not
    // turn the read deadline into another unbounded wait.
    void reader.cancel().catch(() => {});
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
