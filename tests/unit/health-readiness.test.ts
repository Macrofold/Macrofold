import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  query: vi.fn(async () => ({})),
  issues: [] as string[],
  local: true,
  simulated: true,
  loaded: vi.fn(),
  initialize: vi.fn(),
  initializeTracing: vi.fn(),
  initializePerformance: vi.fn(),
  handleApi: vi.fn<typeof import('../../packages/core/src/http').handleApi>(),
  after: vi.fn(),
  dispatch: vi.fn(),
  flush: vi.fn(),
  importsReady: undefined as Promise<void> | undefined,
  importFailure: false,
}));

vi.mock('../../packages/db', () => ({ pool: { query: fixture.query } }));
vi.mock('../../packages/core/src/config', () => ({
  isLocal: () => fixture.local,
  isSimulated: () => fixture.simulated,
  readinessErrors: () => fixture.issues,
}));
vi.mock('next/server', () => ({ after: fixture.after }));
vi.mock('workflow/next', () => ({ withWorkflow: (config: unknown) => async () => config }));
vi.mock('../../apps/web/lib/dispatch', () => ({ dispatchRuns: fixture.dispatch }));
vi.mock('../../apps/web/lib/trace-flush', () => ({ scheduleTraceFlush: fixture.flush }));
vi.mock('../../packages/core/src/tracing', () => ({ initializeTracing: fixture.initializeTracing }));
vi.mock('../../packages/core/src/performance-composition', () => ({
  initializePerformance: fixture.initializePerformance,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VERCEL', '');
  fixture.issues = [];
  fixture.local = fixture.simulated = true;
  fixture.importsReady = undefined;
  fixture.importFailure = false;
  vi.doMock('../../packages/core/src/http', async () => {
    fixture.loaded();
    await fixture.importsReady;
    if (fixture.importFailure) throw new Error('Internal initialization detail');
    return { handleApi: fixture.handleApi, initializeApi: fixture.initialize };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('reports self-hosted readiness after REST composition loads without invoking a request or background work', async () => {
  let release!: () => void;
  fixture.importsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { GET } = await import('../../apps/web/app/health/route');
  let responded = false;
  const response = GET().then((value) => {
    responded = true;
    return value;
  });
  try {
    await vi.waitFor(() => expect(fixture.loaded).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    expect(fixture.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
  } finally {
    release();
  }
  const ready = await response;
  expect(ready.status).toBe(200);
  expect(await ready.json()).toEqual({
    status: 'ok',
    mode: 'local_simulation',
    configuration_ready: true,
  });
  expect((await GET()).status).toBe(200);
  expect(fixture.loaded).toHaveBeenCalledOnce();
  expect(fixture.initialize).toHaveBeenCalledTimes(2);
  expect(fixture.initializeTracing).toHaveBeenCalledTimes(2);
  expect(fixture.initializePerformance).toHaveBeenCalledTimes(2);
  expect(fixture.handleApi).not.toHaveBeenCalled();
  expect(fixture.after).not.toHaveBeenCalled();
  expect(fixture.dispatch).not.toHaveBeenCalled();
  expect(fixture.flush).not.toHaveBeenCalled();
});

it('preserves the REST route deadline, response and Next background lifecycle after readiness', async () => {
  const health = await import('../../apps/web/app/health/route');
  expect((await health.GET()).status).toBe(200);
  const route = await import('../../apps/web/app/v1/[[...path]]/route');
  expect(route.runtime).toBe('nodejs');
  expect(route.maxDuration).toBe(300);
  for (const method of [route.GET, route.PUT, route.PATCH, route.DELETE]) expect(method).toBe(route.POST);
  const now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const request = new Request('http://localhost/v1/inferences', { method: 'POST' });
  const response = new Response('accepted', { status: 202 });
  const backgroundTask = vi.fn(async () => {});
  fixture.handleApi.mockImplementationOnce(async (forwardedRequest, surface, background, options) => {
    expect(forwardedRequest).toBe(request);
    expect(surface).toBe('rest');
    expect(options?.hostDeadlineAtMs).toBe(now + 300_000);
    expect(fixture.flush).toHaveBeenCalledOnce();
    background?.(backgroundTask);
    options?.onMutation?.();
    return response;
  });
  expect(await route.POST(request, { params: Promise.resolve({ path: ['inferences'] }) })).toBe(response);
  expect(fixture.loaded).toHaveBeenCalledOnce();
  expect(fixture.handleApi).toHaveBeenCalledOnce();
  expect(fixture.after.mock.calls).toEqual([[backgroundTask], [fixture.dispatch]]);
  expect(backgroundTask).not.toHaveBeenCalled();
  expect(fixture.dispatch).not.toHaveBeenCalled();
});

it('keeps Vercel readiness independent of another route function', async () => {
  vi.stubEnv('VERCEL', '1');
  fixture.local = fixture.simulated = false;
  const { GET } = await import('../../apps/web/app/health/route');
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    mode: 'production',
    configuration_ready: true,
  });
  expect(fixture.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
  expect(fixture.loaded).not.toHaveBeenCalled();
  expect(fixture.initialize).not.toHaveBeenCalled();
  expect(fixture.initializeTracing).not.toHaveBeenCalled();
  expect(fixture.initializePerformance).not.toHaveBeenCalled();
});

it('returns unavailable when API initialization fails without exposing its exception', async () => {
  fixture.importFailure = true;
  const { GET } = await import('../../apps/web/app/health/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
  expect(fixture.loaded).toHaveBeenCalledOnce();
  expect(fixture.handleApi).not.toHaveBeenCalled();
});

it('returns unavailable when validator initialization fails', async () => {
  fixture.initialize.mockImplementationOnce(() => {
    throw new Error('Internal validator detail');
  });
  const { GET } = await import('../../apps/web/app/health/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
  expect(fixture.handleApi).not.toHaveBeenCalled();
});

it('preserves configuration readiness failures without loading the API graph', async () => {
  fixture.issues = ['Database is not configured'];
  fixture.simulated = false;
  const { GET } = await import('../../apps/web/app/health/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: 'not_ready',
    mode: 'local_docker',
    configuration_ready: false,
  });
  expect(fixture.loaded).not.toHaveBeenCalled();
});

it('preserves database failures without loading the API graph', async () => {
  fixture.query.mockRejectedValueOnce(new Error('Internal connection detail'));
  const { GET } = await import('../../apps/web/app/health/route');
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
  expect(fixture.loaded).not.toHaveBeenCalled();
});

it('serves rewritten health through the REST route without API authentication or background work', async () => {
  const route = await import('../../apps/web/app/v1/[[...path]]/route');
  const context = { params: Promise.resolve({ path: ['_health'] }) };
  // Next preserves the original URL, so route parameters must select health.
  const response = await route.GET(new Request('http://localhost/health'), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', configuration_ready: true });
  const head = await route.HEAD(new Request('http://localhost/health', { method: 'HEAD' }), context);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('content-type')).toBe(response.headers.get('content-type'));
  fixture.query.mockRejectedValueOnce(new Error('Private database error'));
  const failed = await route.GET(new Request('http://localhost/health'), context);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ status: 'unavailable' });
  expect(fixture.handleApi).not.toHaveBeenCalled();
  expect(fixture.flush).not.toHaveBeenCalled();
  expect(fixture.after).not.toHaveBeenCalled();
  expect(fixture.dispatch).not.toHaveBeenCalled();
});

it('preserves health methods and REST OPTIONS without invoking application work', async () => {
  const route = await import('../../apps/web/app/v1/[[...path]]/route');
  const context = { params: Promise.resolve({ path: ['_health'] }) };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
    const response = await route[method](new Request('http://localhost/health', { method }), context);
    expect(response.status).toBe(method === 'OPTIONS' ? 204 : 405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  }
  const response = await route.OPTIONS(new Request('http://localhost/v1/runs', { method: 'OPTIONS' }), {
    params: Promise.resolve({ path: ['runs'] }),
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('allow')).toBe('DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT');
  expect(fixture.query).not.toHaveBeenCalled();
  expect(fixture.initialize).not.toHaveBeenCalled();
  expect(fixture.handleApi).not.toHaveBeenCalled();
  expect(fixture.flush).not.toHaveBeenCalled();
  expect(fixture.after).not.toHaveBeenCalled();
});

it('limits operational routing to the exact matched health path', async () => {
  const route = await import('../../apps/web/app/v1/[[...path]]/route');
  fixture.handleApi.mockResolvedValue(new Response(null, { status: 404 }));
  await route.GET(new Request('http://localhost/v1/_health/runs'), {
    params: Promise.resolve({ path: ['_health', 'runs'] }),
  });
  expect(fixture.handleApi).toHaveBeenCalledOnce();
  expect(fixture.query).not.toHaveBeenCalled();
});

it('uses self-hosted readiness rewrites while preserving marketing priority and Vercel isolation', async () => {
  const { default: configure } = await import('../../apps/web/next.config');
  const config = await configure('phase-production-server', { defaultConfig: {} });
  vi.stubEnv('MARKETING_HOMEPAGE', 'true');
  expect(await config.rewrites!()).toEqual({
    beforeFiles: [{ source: '/health', destination: '/v1/_health' }],
    afterFiles: [{ source: '/', destination: '/site' }],
    fallback: [],
  });
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('MARKETING_HOMEPAGE', 'false');
  expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
});
