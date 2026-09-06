export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): asserts condition {
  if (!condition) throw new AppError(status, code, message, details);
}
export function errorBody(error: unknown, requestId: string) {
  const e =
    error instanceof AppError
      ? error
      : new AppError(
          500,
          'internal_error',
          'An unexpected error occurred. Include the request ID when contacting support.',
        );
  return {
    status: e.status,
    body: {
      error: {
        code: e.code,
        message: e.message,
        request_id: requestId,
        details: e.details,
        retryable: e.status >= 500 || e.status === 429,
      },
    },
  };
}
