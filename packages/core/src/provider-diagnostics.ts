import { AppError } from './errors';

/** Bounded application diagnostics, never request headers or credential values. */
export function providerErrorDetails(error: unknown, secret: string): Record<string, unknown> {
  const redact = (value: string) => {
    const withoutSecret = secret ? value.replaceAll(secret, '[REDACTED]') : value;
    return withoutSecret.replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[\w-]+/g, '[REDACTED]').slice(0, 32768);
  };
  const describe = (value: unknown, depth: number): Record<string, unknown> => {
    if (!(value instanceof Error)) return { message: 'Non-Error exception' };
    return {
      name: value.name,
      message: redact(value.message),
      stack: value.stack ? redact(value.stack) : undefined,
      ...(value instanceof AppError ? {
        code: value.code, status: value.status,
        details: redact(JSON.stringify(value.details)),
      } : {}),
      ...(depth < 2 && value.cause ? { cause: describe(value.cause, depth + 1) } : {}),
    };
  };
  return describe(error, 0);
}
