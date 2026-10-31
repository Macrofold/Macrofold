import type { ProviderError } from '../../core/src/decision';

const maximumMessageBytes = 16 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isProviderErrorEnvelope(value: unknown) {
  return record(value) && (Boolean(value.error) || value.type === 'error');
}

/** Provider messages are caller content, never log fields or application authority.
 * Retain only the message/code, excluding bodies/headers and known credentials. */
export function extractProviderError(
  value: unknown,
  httpStatus: number,
  secrets: readonly string[] = [],
  plainText = false,
): ProviderError | undefined {
  const rejected = httpStatus < 200 || httpStatus >= 300;
  const source = record(value) && record(value.error) ? value.error : value;
  let message: unknown;
  if (record(value) && typeof value.error === 'string') message = value.error;
  else if (record(source) && (rejected || isProviderErrorEnvelope(value))) message = source.message;
  else if (rejected && plainText && typeof value === 'string') message = value;
  if (typeof message !== 'string' || !message.trim()) return;
  if (
    source === value &&
    typeof value === 'string' &&
    /^\s*<(?:!doctype|html|head|body)(?:\s|>)/i.test(value)
  )
    return;

  const redact = (text: string) => {
    for (const secret of secrets) {
      if (!secret) continue;
      text = text.replaceAll(secret, '[REDACTED]');
      const credential = secret.replace(/^(?:Bearer|Basic)\s+/i, '');
      if (credential) text = text.replaceAll(credential, '[REDACTED]');
    }
    return text
      .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk|pk)-(?:lf-|proj-|ant-)?[\w-]{16,}/g, '[REDACTED]')
      .replace(/https?:\/\/[^\s"<>]+/g, (url) =>
        /[?&](?:token|sig|signature|x-amz-signature)=/i.test(url) ? url.split('?')[0] + '?[REDACTED]' : url,
      );
  };
  const sanitized = redact(message);
  const bytes = Buffer.from(sanitized);
  const code = record(source) ? (source.code ?? source.type) : undefined;
  const normalizedCode =
    typeof code === 'string'
      ? redact(code).slice(0, 200)
      : typeof code === 'number' && Number.isFinite(code)
        ? String(code)
        : undefined;
  return {
    http_status: httpStatus,
    // Streaming decode drops an incomplete final UTF-8 sequence at the byte cap.
    message: new TextDecoder().decode(bytes.subarray(0, maximumMessageBytes), { stream: true }),
    ...(normalizedCode ? { code: normalizedCode } : {}),
    ...(bytes.length > maximumMessageBytes ? { truncated: true } : {}),
  };
}
