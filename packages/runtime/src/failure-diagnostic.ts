/** Only allowlisted facts leave the native process: SDK messages can embed
 * credentials, prompts, config files or complete HTTP responses. */
export type RuntimeStage =
  | 'transport_start'
  | 'permissions_prepare'
  | 'attachments_prepare'
  | 'harness_initialize'
  | 'server_start'
  | 'session_create'
  | 'event_subscribe'
  | 'turn_execute';

const codes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENOSPC',
  'ERR_MODULE_NOT_FOUND',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const names = new Set(['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError']);
const messages: Record<string, string> = {
  'OpenCode could not create a session': 'session_create_failed',
  'OpenCode turn failed': 'turn_failed',
  'OpenCode final message unavailable': 'final_message_unavailable',
  'OpenCode event stream ended before subscription': 'event_stream_closed',
  'OpenCode event stream closed during the turn': 'event_stream_closed',
  'OpenCode event stream ended before the turn completed': 'event_stream_closed',
  'Checked file service unavailable.': 'file_service_unavailable',
};

const modelRequestFailures: Record<number, { code: string; message: string }> = {
  401: {
    code: 'model_request_authentication_failed',
    message: 'Authentication for the model request was rejected (HTTP 401).',
  },
  402: {
    code: 'model_request_payment_required',
    message: 'The model request was rejected for insufficient credits or a spending limit (HTTP 402).',
  },
  403: {
    code: 'model_request_access_denied',
    message: 'Access to the model request was denied (HTTP 403).',
  },
  429: {
    code: 'model_request_rate_limited',
    message: 'The model request was rate limited (HTTP 429).',
  },
};
class ModelRequestError extends Error {
  constructor(readonly diagnostic: { code: string; message: string }) {
    super(diagnostic.message);
  }
}

/** Native SDK bodies may contain secrets; retain only a recognized HTTP category.
 * See docs/features/execution/runtime.md#execution-tracing. */
export function modelRequestError(status: unknown) {
  if (typeof status === 'number' && Object.hasOwn(modelRequestFailures, status))
    return new ModelRequestError(modelRequestFailures[status]);
  if (typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599)
    return new ModelRequestError({
      code: 'model_request_unavailable',
      message: 'The model request failed (HTTP 5xx).',
    });
}

export function failureDiagnostic(error: unknown, stage: RuntimeStage) {
  let code = 'unknown_error';
  let message = 'Native execution failed; untrusted error text was withheld.';
  const errorType = error instanceof Error && names.has(error.name) ? error.name : 'Error';
  // Node fetch often wraps the useful network code in its cause.
  let current = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    if (current instanceof ModelRequestError) {
      ({ code, message } = current.diagnostic);
      break;
    }
    if (Object.hasOwn(messages, current.message)) {
      code = messages[current.message];
      message = current.message;
      break;
    }
    if ('code' in current && typeof current.code === 'string' && codes.has(current.code)) {
      code = current.code;
      message = `Native operation failed with ${code}.`;
      break;
    }
    if (/^Timeout waiting for server to start after \d+ms$/.test(current.message)) {
      code = 'server_start_timeout';
      message = 'The harness server did not become ready within its startup deadline.';
      break;
    }
    if (/^Server exited with code (?:-?\d+|null)(?:\n|$)/.test(current.message)) {
      code = 'server_exited';
      message = 'The harness server exited before becoming ready.';
      break;
    }
    current = current.cause;
  }
  return { stage, code, error_type: errorType, message };
}
