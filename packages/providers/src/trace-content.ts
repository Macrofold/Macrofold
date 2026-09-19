import { createHash } from 'node:crypto';

const secretField =
  /^(authorization|cookie|set-cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|.*ciphertext|encrypted_content)$/i;
const sensitiveText = /\b(?:Bearer\s+\S+|(?:sk|pk)-(?:lf-|proj-|ant-)?[\w-]{16,}|rt_[\w.-]{20,})/g;

/** Preserve useful text/JSON, but never export known credential fields, opaque
 * reasoning, signed URL queries or inline binary data. This is not a PII detector. */
export function traceContent(value: unknown, maxBytes: number, capture = true): unknown {
  if (value === undefined) return undefined;
  if (!capture) return { omitted: 'content_capture_disabled' };
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (secretField.test(key) || key === 'thinking' || key === 'signature') return '[redacted]';
    if (typeof item === 'string') {
      if (/^data:[^;]+;base64,/.test(item) || (key === 'data' && /^[A-Za-z0-9+/=]{1024,}$/.test(item)))
        return {
          omitted: 'inline_media',
          sha256: createHash('sha256').update(item).digest('hex'),
          bytes: Buffer.byteLength(item),
        };
      return item
        .replace(sensitiveText, '[redacted]')
        .replace(/https?:\/\/[^\s"<>]+/g, (url) =>
          /[?&](?:token|sig|signature|x-amz-signature)=/i.test(url) ? url.split('?')[0] + '?[redacted]' : url,
        );
    }
    return typeof item === 'bigint' ? item.toString() : item;
  });
  if (json === undefined) return undefined;
  const bytes = Buffer.byteLength(json);
  if (bytes <= maxBytes) return JSON.parse(json);
  return {
    truncated: true,
    original_bytes: bytes,
    preview: Buffer.from(json).subarray(0, maxBytes).toString('utf8'),
  };
}
