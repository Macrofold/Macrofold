import type { operations, components } from './schema.js';
import { routes } from './routes.js';
import { Resources, DEFAULT_ORIGIN } from './resources.js';
export { DEFAULT_ORIGIN } from './resources.js';
export type Schema = components['schemas'];
export type Operation = keyof operations;
export type RequestMethod<K extends Operation> = (typeof routes)[K]['method'];
export const requestMethod = <K extends Operation>(operation: K): RequestMethod<K> =>
  routes[operation].method;
type Value<T> = T[keyof T];
type Content<T> = T extends { content: infer C }
  ? C extends { 'application/json': infer J }
    ? J
    : Value<C>
  : undefined;
type Responses<O extends Operation> = operations[O] extends { responses: infer R } ? R : never;
export type Result<O extends Operation> = O extends 'readFile' | 'readCustomerAgentFile'
  ? Uint8Array
  : Content<Responses<O>[Extract<keyof Responses<O>, 200 | 201 | 202 | 204>]>;
type Body<O extends Operation> = operations[O] extends { requestBody?: infer R }
  ? Content<NonNullable<R>>
  : never;
type RequestHeaders<O extends Operation> = Omit<
  NonNullable<operations[O]['parameters']['header']>,
  'Idempotency-Key'
>;
type RequestParameters<O extends Operation> = Omit<operations[O]['parameters'], 'header'> &
  ({} extends RequestHeaders<O> ? { header?: RequestHeaders<O> } : { header: RequestHeaders<O> });
export type RequestOptions<O extends Operation> = {
  params?: RequestParameters<O>;
  body?: Body<O> | Uint8Array;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Immediate inference only: explicit confirmed pre-admission retries, 0–2. */
  inferenceRetries?: number;
  timeoutMs?: number;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
    public idempotencyKey?: string,
    public runId?: string,
    public urls?: Schema['InferenceUrls'],
    public retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export class TransportError extends Error {
  constructor(
    message: string,
    public idempotencyKey?: string,
    public runId?: string,
    public urls?: Schema['InferenceUrls'],
    cause?: unknown,
    public requestId?: string,
  ) {
    super(message, { cause });
    this.name =
      cause instanceof Error && ['AbortError', 'TimeoutError'].includes(cause.name)
        ? cause.name
        : 'TransportError';
  }
}
export type ClientOptions = {
  baseURL?: string;
  apiKey?: string;
  token?: string | (() => Promise<string>);
  /** Same-origin browser cookie authentication; API clients normally use apiKey. */
  sessionAuth?: boolean;
  organization?: string;
  clientType?: 'sdk' | 'cli' | 'dashboard';
  fetch?: typeof fetch;
  retries?: number;
};
export function serviceOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use an origin such as https://agents.example.com');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('HTTPS is required except for local development');
  return url.origin;
}
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
/** Credential suppliers cannot be cancelled, but cannot extend request lifetime.
 * Both settlement paths stay observed after abort, without retaining a listener. */
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(cause);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
/** Build the encoded relative URL from the generated contract. Shared by browser
 * query keys and SDK transport; callers never maintain another route registry. */
export function requestPath<O extends Operation>(operation: O, params?: RequestOptions<O>['params']): string {
  const route = routes[operation];
  const parameters = params as
    | { path?: Record<string, unknown>; query?: Record<string, unknown>; header?: Record<string, unknown> }
    | undefined;
  const path = route.path.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = parameters?.path?.[key];
    if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
  const url = new URL(path, 'http://route.invalid');
  for (const [key, value] of Object.entries(parameters?.query || {}))
    if (value !== undefined && value !== null)
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  return url.pathname + url.search;
}
export class Client extends Resources {
  readonly baseURL: string;
  private readonly fetcher: typeof fetch;
  private readonly token: string | (() => Promise<string>);
  constructor(private options: ClientOptions = {}) {
    super();
    if (
      options.retries !== undefined &&
      (!Number.isSafeInteger(options.retries) || options.retries < 0 || options.retries > 8)
    )
      throw new RangeError('retries must be an integer between 0 and 8');
    this.baseURL = serviceOrigin(options.baseURL ?? DEFAULT_ORIGIN);
    if (options.apiKey !== undefined && options.token !== undefined)
      throw new Error('Pass apiKey or token, not both.');
    if (options.sessionAuth && (options.apiKey !== undefined || options.token !== undefined))
      throw new Error('Session authentication cannot be combined with an API key.');
    this.token = options.sessionAuth
      ? ''
      : (options.apiKey ??
        options.token ??
        (typeof process !== 'undefined' ? process.env.MACROFOLD_API_KEY : undefined) ??
        '');
    if (!options.sessionAuth && typeof this.token === 'string' && !this.token.trim())
      throw new Error('Missing Macrofold API key. Pass apiKey or set MACROFOLD_API_KEY.');
    // Browser fetch requires its global receiver, not this Client instance.
    this.fetcher = options.fetch || ((...args) => globalThis.fetch(...args));
  }
  async raw<O extends Operation>(operation: O, options: RequestOptions<O> = {}): Promise<Response> {
    const immediate = operation === 'createInference';
    const timeoutMs = options.timeoutMs ?? (immediate ? 300_000 : 70_000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      throw new RangeError('timeoutMs must be a positive timer duration');
    const retries = immediate ? (options.inferenceRetries ?? 0) : (this.options.retries ?? 2);
    if (immediate && (!Number.isSafeInteger(retries) || retries < 0 || retries > 2))
      throw new RangeError('inferenceRetries must be between 0 and 2');
    const deadline = Date.now() + timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout };
    const route = routes[operation];
    const url = new URL(requestPath(operation, options.params), this.baseURL);
    const mutation = !['GET', 'HEAD'].includes(route.method);
    const idempotencyKey = mutation ? options.idempotencyKey || crypto.randomUUID() : undefined;
    let body: Uint8Array | string | undefined;
    try {
      body =
        options.body === undefined
          ? undefined
          : options.body instanceof Uint8Array
            ? options.body
            : JSON.stringify(options.body);
    } catch (cause) {
      if (!immediate) throw cause;
      throw new TransportError(
        'The inference request could not be encoded.',
        idempotencyKey,
        undefined,
        undefined,
        cause,
      );
    }
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted)
        throw new TransportError(
          'Request aborted; inspect the saved inference identity.',
          idempotencyKey,
          undefined,
          undefined,
          options.signal.reason,
        );
      let token: string;
      try {
        token = typeof this.token === 'function' ? await abortable(this.token(), options.signal) : this.token;
        if (!this.options.sessionAuth && !token.trim())
          throw new Error('Missing Macrofold API key. Pass apiKey or set MACROFOLD_API_KEY.');
      } catch (cause) {
        if (!immediate) throw cause;
        throw new TransportError(
          'The request credential could not be prepared.',
          idempotencyKey,
          undefined,
          undefined,
          cause,
        );
      }
      const headers = new Headers({
        ...(this.options.sessionAuth ? {} : { Authorization: `Bearer ${token}` }),
        'X-Client-Type': this.options.clientType || 'sdk',
        ...options.headers,
      });
      if (this.options.organization) headers.set('X-Organization-Id', this.options.organization);
      for (const [key, value] of Object.entries(options.params?.header || {}))
        if (value !== undefined) headers.set(key, String(value));
      if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
      if (body !== undefined)
        headers.set(
          'Content-Type',
          body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
        );
      if (options.signal?.aborted || Date.now() >= deadline)
        throw new TransportError(
          'Request aborted before dispatch.',
          idempotencyKey,
          undefined,
          undefined,
          options.signal?.reason ?? new DOMException('Request deadline exceeded', 'TimeoutError'),
        );
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: route.method,
          headers,
          body: body as BodyInit | undefined,
          signal: options.signal,
          redirect: 'error',
          ...(this.options.sessionAuth ? { credentials: 'same-origin' as const } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted)
          throw new TransportError(
            'Request aborted; inspect the saved mutation identity.',
            idempotencyKey,
            undefined,
            undefined,
            options.signal.reason,
          );
        if (!immediate && attempt < retries) {
          await delay(200 * 2 ** attempt, options.signal);
          continue;
        }
        throw new TransportError(
          'The service could not confirm the request. Reuse the same idempotency key to check a mutation safely.',
          idempotencyKey,
          undefined,
          undefined,
          error,
        );
      }
      if (response.ok) return response;
      if (!immediate && [429, 502, 503, 504].includes(response.status) && attempt < retries) {
        const retryAfter = Math.min(60, Math.max(0, Number(response.headers.get('retry-after')) || 0)) * 1000;
        void response.body?.cancel().catch(() => {});
        await delay(Math.max(retryAfter, 200 * 2 ** attempt), options.signal);
        continue;
      }
      const payload = ((await response.json().catch((cause: unknown) => {
        if (immediate)
          throw new TransportError(
            'The error response was incomplete. Recover with the same identity.',
            idempotencyKey,
            response.headers.get('x-run-id') ?? undefined,
            undefined,
            cause,
            response.headers.get('x-request-id') ?? undefined,
          );
        return {};
      })) ?? {}) as {
        error?: {
          code?: string;
          message?: string;
          request_id?: string;
          retryable?: boolean;
          details?: { run_id?: string; urls?: Schema['InferenceUrls'] };
        };
      };
      const error = new ApiError(
        response.status,
        payload.error?.code || 'http_error',
        payload.error?.message || `Request failed (${response.status})`,
        response.headers.get('x-request-id') || payload.error?.request_id,
        payload.error?.details,
        idempotencyKey,
        payload.error?.details?.run_id ?? response.headers.get('x-run-id') ?? undefined,
        payload.error?.details?.urls,
        payload.error?.retryable === true,
      );
      const confirmed =
        payload.error?.retryable === true &&
        !error.runId &&
        [
          'rate_limited',
          'inference_capacity_unavailable',
          'streaming_capacity_unavailable',
          'inference_service_unavailable',
          'inference_admission_timeout',
          'inference_host_budget_exhausted',
        ].includes(error.code);
      if (immediate && attempt < retries && confirmed && [429, 503].includes(response.status)) {
        const hint = response.headers.get('retry-after');
        const seconds =
          hint && /^\d+(?:\.\d+)?$/.test(hint.trim())
            ? Number(hint) * 1000
            : hint
              ? Math.max(0, Date.parse(hint) - Date.now())
              : 0;
        const wait =
          Math.max(Number.isNaN(seconds) ? 0 : seconds, 200 * 2 ** attempt) +
          (Math.floor(Math.random() * 100) + 1);
        // A retry never shortens the server hint or starts a fresh timeout window.
        if (Date.now() + wait >= deadline) throw error;
        try {
          await delay(wait, options.signal);
        } catch (cause) {
          throw new TransportError(
            'Request aborted while waiting to retry.',
            idempotencyKey,
            undefined,
            undefined,
            cause,
          );
        }
        continue;
      }
      throw error;
    }
  }
  async request<O extends Operation>(operation: O, options: RequestOptions<O> = {}): Promise<Result<O>> {
    if (
      operation === 'createInference' &&
      options.body &&
      'stream' in options.body &&
      options.body.stream === true
    )
      throw new Error('Use inferences.stream(request) for incremental inference output.');
    const requestOptions = ['GET', 'HEAD'].includes(routes[operation].method)
      ? options
      : { ...options, idempotencyKey: options.idempotencyKey || crypto.randomUUID() };
    const response = await this.raw(operation, requestOptions);
    if (response.status === 204) return undefined as Result<O>;
    try {
      if (operation === 'readFile' || operation === 'readCustomerAgentFile')
        return new Uint8Array(await response.arrayBuffer()) as Result<O>;
      return (await response.json()) as Result<O>;
    } catch (cause) {
      // Receiving success headers does not guarantee the response body arrived.
      // Preserve the mutation identity without repeating a possibly committed action.
      throw new TransportError(
        'The service response was incomplete. Reuse the same idempotency key to check a mutation safely.',
        requestOptions.idempotencyKey,
        response.headers.get('x-run-id') ?? undefined,
        undefined,
        cause,
        response.headers.get('x-request-id') ?? undefined,
      );
    }
  }
  /** A direct stream is single-attempt after headers. Closing it detaches;
   * use the accepted run ID to recover the final result, never replay deltas. */
  async *streamInference(
    body: Schema['InferenceCreate'],
    options: RequestOptions<'createInference'> = {},
  ): AsyncGenerator<Schema['InferenceStreamEvent']> {
    const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    const response = await this.raw('createInference', {
      ...options,
      idempotencyKey,
      body: { ...body, stream: true },
      headers: { ...options.headers, Accept: 'text/event-stream' },
    });
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      void response.body?.cancel().catch(() => {});
      throw new TransportError(
        'Expected a direct event stream.',
        idempotencyKey,
        response.headers.get('x-run-id') ?? undefined,
        undefined,
        undefined,
        response.headers.get('x-request-id') ?? undefined,
      );
    }
    let runId: string | undefined = response.headers.get('x-run-id') ?? undefined;
    let urls: Schema['InferenceUrls'] | undefined;
    const failure = (message: string, cause?: unknown) =>
      new TransportError(
        message,
        idempotencyKey,
        runId,
        urls,
        cause,
        response.headers.get('x-request-id') ?? undefined,
      );
    try {
      for await (const frame of sseFrames(response, options.signal, Math.max(1, deadline - Date.now()))) {
        const parsed: unknown = JSON.parse(frame.data);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('schema_version' in parsed) ||
          parsed.schema_version !== 1 ||
          !('run_id' in parsed) ||
          typeof parsed.run_id !== 'string' ||
          !('type' in parsed) ||
          typeof parsed.type !== 'string' ||
          !('data' in parsed) ||
          !parsed.data ||
          typeof parsed.data !== 'object'
        )
          throw new SyntaxError('Invalid inference stream frame');
        // Generated types describe the remaining server-owned payload fields.
        const event = parsed as Schema['InferenceStreamEvent'];
        runId = event.run_id;
        if ('urls' in event.data) urls = event.data.urls;
        yield event;
        if (event.type === 'transport.error')
          throw failure('Stream interrupted. Retrieve the saved run result.');
        if (
          ['run.succeeded', 'run.failed', 'run.cancelled', 'run.timed_out', 'run.recovery_required'].includes(
            event.type,
          )
        )
          return;
      }
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw failure('Stream interrupted. Retrieve the saved run result.', error);
    }
    throw failure('Stream ended before its terminal result. Retrieve the saved run result.');
  }
  stream(runId: string, options: { after?: string; signal?: AbortSignal } = {}) {
    return this.streamFrom(
      {
        open: (cursor) =>
          this.raw('streamRun', {
            params: { path: { run_id: runId }, query: { after: cursor } },
            headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor },
            signal: options.signal,
          }),
        get: () => this.request('getRun', { params: { path: { run_id: runId } }, signal: options.signal }),
        events: (cursor) =>
          this.request('listRunEvents', {
            params: { path: { run_id: runId }, query: { after: cursor, limit: 100 } },
            signal: options.signal,
          }),
      },
      options,
    );
  }
  /** Optional customer-agent integration path; every reconnect rechecks the binding. */
  streamCustomerAgent(
    customerId: string,
    customerAgentId: string,
    runId: string,
    options: { after?: string; signal?: AbortSignal } = {},
  ) {
    const path = { customer_id: customerId, customer_agent_id: customerAgentId, run_id: runId };
    return this.streamFrom(
      {
        open: (cursor) =>
          this.raw('streamCustomerAgentRun', {
            params: { path, query: { after: cursor } },
            headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor },
            signal: options.signal,
          }),
        get: () => this.request('getCustomerAgentRun', { params: { path }, signal: options.signal }),
        events: (cursor) =>
          this.request('listCustomerAgentRunEvents', {
            params: { path, query: { after: cursor, limit: 100 } },
            signal: options.signal,
          }),
      },
      options,
    );
  }
  /** One cursor/reconnect algorithm for primitive and integration-path event streams. */
  private async *streamFrom(
    source: {
      open(cursor: string): Promise<Response>;
      get(): Promise<Schema['Run']>;
      events(cursor: string): Promise<{ data: Schema['Event'][] }>;
    },
    options: { after?: string; signal?: AbortSignal },
  ): AsyncGenerator<Schema['Event']> {
    if (options.after !== undefined && !/^\d+$/.test(options.after))
      throw new Error('Use a numeric event cursor');
    let cursor = options.after || '0',
      failures = 0;
    for (let connections = 0; connections < 2048; connections++) {
      options.signal?.throwIfAborted();
      try {
        const response = await source.open(cursor);
        for await (const frame of sseFrames(response, options.signal)) {
          if (!frame.data) continue;
          let event: Schema['Event'];
          try {
            event = JSON.parse(frame.data);
          } catch {
            continue;
          }
          if (!event.sequence || !/^\d+$/.test(event.sequence) || BigInt(event.sequence) <= BigInt(cursor))
            continue;
          cursor = event.sequence;
          failures = 0;
          yield event;
          if (
            [
              'run.succeeded',
              'run.failed',
              'run.cancelled',
              'run.timed_out',
              'run.recovery_required',
            ].includes(event.type)
          )
            return;
        }
        const run = await source.get();
        if (run.failure_code === 'run_recovery_required') return;
        if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)) {
          // A caller reconnecting after the terminal event already rendered does not wait forever.
          const remaining = await source.events(cursor);
          if (!remaining.data.length) return;
        }
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (error instanceof ApiError && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
        if (++failures > 8) throw error;
      }
      await delay(Math.min(10_000, 250 * 2 ** failures), options.signal);
    }
    throw new TransportError(
      `Stream attachment limit reached. Reattach after ${cursor}; the run has not been cancelled.`,
    );
  }
  async waitOperation(operationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0))
      throw new RangeError('timeoutMs must be finite and non-negative');
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    while (Date.now() < deadline) {
      const value = await this.request('getOperation', {
        params: { path: { operation_id: operationId } },
        signal: options.signal,
      });
      if (['succeeded', 'failed', 'cancelled'].includes(value.status)) return value;
      await delay(750, options.signal);
    }
    throw new TransportError('The operation is still pending. Inspect its operation ID later.');
  }
}
export async function* sseFrames(
  response: Response,
  signal?: AbortSignal,
  lifetimeMs = 70_000,
): AsyncGenerator<{ id?: string; event?: string; data: string }> {
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 2_147_483_647)
    throw new RangeError('Stream lifetime must be a positive, finite timer duration.');
  const reader = response.body?.getReader();
  if (!reader) return;
  const controller = new AbortController();
  const deadline = Date.now() + lifetimeMs;
  const timer = setTimeout(
    () => controller.abort(new Error('Stream connection deadline exceeded')),
    lifetimeMs,
  );
  signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let emptyChunks = 0;
  let frame: { id?: string; event?: string; data: string } = { data: '' };
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      if (Date.now() >= deadline) throw new Error('Stream connection deadline exceeded');
      emptyChunks = part.value.byteLength ? 0 : emptyChunks + 1;
      if (emptyChunks >= 16) throw new Error('Stream stopped making progress');
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024) throw new Error('SSE frame exceeds the client limit');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) {
          if (frame.data) yield { ...frame, data: frame.data.replace(/\n$/, '') };
          frame = { data: '' };
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') frame.data += value + '\n';
        if (field === 'event') frame.event = value;
        if (field === 'id') frame.id = value;
        if (frame.data.length > 4 * 1024 * 1024) throw new Error('SSE frame exceeds the client limit');
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Detach immediately even if the source never acknowledges cleanup.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
