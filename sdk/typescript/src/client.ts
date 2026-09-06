import type { operations, components } from './schema.js';
import { routes } from './routes.js';
export type Schema = components['schemas'];
export type Operation = keyof operations;
type Value<T> = T[keyof T];
type Content<T> = T extends { content: infer C } ? Value<C> : undefined;
type Responses<O extends Operation> = operations[O] extends { responses: infer R } ? R : never;
export type Result<O extends Operation> = O extends 'readFile'
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
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export class TransportError extends Error {
  constructor(
    message: string,
    public idempotencyKey?: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}
export type ClientOptions = {
  baseURL: string;
  token: string | (() => Promise<string>);
  organization?: string;
  clientType?: 'sdk' | 'cli';
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
export class Client {
  readonly baseURL: string;
  private readonly fetcher: typeof fetch;
  constructor(private options: ClientOptions) {
    this.baseURL = serviceOrigin(options.baseURL);
    this.fetcher = options.fetch || fetch;
  }
  async raw<O extends Operation>(operation: O, options: RequestOptions<O> = {}): Promise<Response> {
    const route = routes[operation];
    const parameters = options.params as
      | { path?: Record<string, unknown>; query?: Record<string, unknown>; header?: Record<string, unknown> }
      | undefined;
    const path = route.path.replace(/\{([^}]+)\}/g, (_, key) => {
      const value = parameters?.path?.[key];
      if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(path, this.baseURL);
    for (const [key, value] of Object.entries(parameters?.query || {}))
      if (value !== undefined && value !== null)
        url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    const mutation = !['GET', 'HEAD'].includes(route.method);
    const idempotencyKey = mutation ? options.idempotencyKey || crypto.randomUUID() : undefined;
    const body =
      options.body === undefined
        ? undefined
        : options.body instanceof Uint8Array
          ? options.body
          : JSON.stringify(options.body);
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      const token =
        typeof this.options.token === 'function' ? await this.options.token() : this.options.token;
      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        'X-Client-Type': this.options.clientType || 'sdk',
        ...options.headers,
      });
      if (this.options.organization) headers.set('X-Organization-Id', this.options.organization);
      for (const [key, value] of Object.entries(parameters?.header || {}))
        if (value !== undefined) headers.set(key, String(value));
      if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
      if (body !== undefined)
        headers.set(
          'Content-Type',
          body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
        );
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: route.method,
          headers,
          body: body as BodyInit | undefined,
          signal: options.signal,
          redirect: 'error',
        });
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (attempt < (this.options.retries ?? 2)) {
          await delay(200 * 2 ** attempt, options.signal);
          continue;
        }
        throw new TransportError(
          'The service could not confirm the request. Reuse the same idempotency key to check a mutation safely.',
          idempotencyKey,
        );
      }
      if (response.ok) return response;
      if ([429, 502, 503, 504].includes(response.status) && attempt < (this.options.retries ?? 2)) {
        const retryAfter = Math.min(60, Math.max(0, Number(response.headers.get('retry-after')) || 0)) * 1000;
        await response.body?.cancel();
        await delay(Math.max(retryAfter, 200 * 2 ** attempt), options.signal);
        continue;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; request_id?: string; details?: unknown };
      };
      throw new ApiError(
        response.status,
        payload.error?.code || 'http_error',
        payload.error?.message || `Request failed (${response.status})`,
        response.headers.get('x-request-id') || payload.error?.request_id,
        payload.error?.details,
      );
    }
  }
  async request<O extends Operation>(operation: O, options: RequestOptions<O> = {}): Promise<Result<O>> {
    const requestOptions = ['GET', 'HEAD'].includes(routes[operation].method)
      ? options
      : { ...options, idempotencyKey: options.idempotencyKey || crypto.randomUUID() };
    const response = await this.raw(operation, requestOptions);
    if (response.status === 204) return undefined as Result<O>;
    try {
      if (operation === 'readFile') return new Uint8Array(await response.arrayBuffer()) as Result<O>;
      return (await response.json()) as Result<O>;
    } catch {
      if (options.signal?.aborted) throw options.signal.reason;
      // Receiving success headers does not guarantee the response body arrived.
      // Preserve the mutation identity without repeating a possibly committed action.
      throw new TransportError(
        'The service response was incomplete. Reuse the same idempotency key to check a mutation safely.',
        requestOptions.idempotencyKey,
      );
    }
  }
  /** Reconnects from the last yielded durable event, including after a server stream rotation. */
  async *stream(
    runId: string,
    options: { after?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<Schema['Event']> {
    if (options.after !== undefined && !/^\d+$/.test(options.after))
      throw new Error('Use a numeric event cursor');
    let cursor = options.after || '0',
      failures = 0;
    for (;;) {
      options.signal?.throwIfAborted();
      try {
        const response = await this.raw('streamRun', {
          params: { path: { run_id: runId }, query: { after: cursor } },
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor },
          signal: options.signal,
        });
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
          if (['run.succeeded', 'run.failed', 'run.cancelled', 'run.timed_out'].includes(event.type)) return;
        }
        const run = await this.request('getRun', {
          params: { path: { run_id: runId } },
          signal: options.signal,
        });
        if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)) {
          // A caller reconnecting after the terminal event already rendered does not wait forever.
          const remaining = await this.request('listRunEvents', {
            params: { path: { run_id: runId }, query: { after: cursor, limit: 100 } },
            signal: options.signal,
          });
          if (!remaining.data.length) return;
        }
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (error instanceof ApiError && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
        if (++failures > 8) throw error;
      }
      await delay(Math.min(10_000, 250 * 2 ** failures), options.signal);
    }
  }
  async waitOperation(operationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const deadline = Date.now() + (options.timeoutMs || 300_000);
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
): AsyncGenerator<{ id?: string; event?: string; data: string }> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let frame: { id?: string; event?: string; data: string } = { data: '' };
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
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
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
