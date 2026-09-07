import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  affectedDashboardQuery,
  dashboardRefreshBatch,
  followDashboardChanges,
} from '../../apps/web/lib/dashboard-freshness';
import { DashboardStreamHub, dashboardStream } from '../../apps/web/lib/dashboard-stream-hub';
import type { DashboardAccess, DashboardSnapshot } from '../../packages/core/src/dashboard-freshness';

afterEach(() => vi.useRealTimers());
const access: DashboardAccess = {
  organizationId: 'org',
  userId: 'user',
  sessionId: 'session',
  role: 'owner',
};
const snapshot = (runs = '0'): DashboardSnapshot => ({
  authorizedSessions: new Set(['session:owner']),
  revisions: { runs, workspace: '0', git: '0' },
});
const decode = (part: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(part.value);

describe('shared dashboard stream', () => {
  it('limits concurrent reads and drops disconnected subscribers while a snapshot is pending', async () => {
    vi.useFakeTimers();
    const releases: ((value: DashboardSnapshot) => void)[] = [];
    const read = vi.fn(() => new Promise<DashboardSnapshot>((resolve) => releases.push(resolve)));
    const hub = new DashboardStreamHub(read);
    const aborts = [new AbortController(), new AbortController(), new AbortController()];
    const responses = aborts.map((abort, i) =>
      dashboardStream(hub, { ...access, organizationId: String(i) }, abort.signal),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    aborts.forEach((abort) => abort.abort());
    releases.forEach((release) => release(snapshot()));
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(2);
    for (const response of responses) expect(await response.text()).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends a bounded heartbeat while an idle connection is healthy', async () => {
    vi.useFakeTimers();
    const hub = new DashboardStreamHub(async () => snapshot());
    const abort = new AbortController();
    const reader = dashboardStream(hub, access, abort.signal).body!.getReader();
    await vi.advanceTimersByTimeAsync(0);
    await reader.read();
    await vi.advanceTimersByTimeAsync(15000);
    expect(decode(await reader.read())).toBe(': heartbeat\n\n');
    abort.abort();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('batches tabs by tenant, signals only changes, checks revocation, and stops all polling on disconnect', async () => {
    vi.useFakeTimers();
    let current = snapshot();
    const read = vi.fn(async () => current);
    const hub = new DashboardStreamHub(read, 2000);
    const a = new AbortController(),
      b = new AbortController();
    const first = dashboardStream(hub, access, a.signal).body!.getReader();
    const second = dashboardStream(hub, access, b.signal).body!.getReader();
    await vi.advanceTimersByTimeAsync(0);
    expect(decode(await first.read())).toBe('event: ready\ndata: {}\n\n');
    expect(decode(await second.read())).toContain('event: ready');
    expect(read).toHaveBeenCalledOnce();
    current = snapshot('20');
    await vi.advanceTimersByTimeAsync(2000);
    expect(decode(await first.read())).toBe(
      'event: change\ndata: {"category":"runs","organization_id":"org"}\n\n',
    );
    expect(decode(await second.read())).toContain('"category":"runs"');
    a.abort();
    current = { ...snapshot('21'), authorizedSessions: new Set() };
    await vi.advanceTimersByTimeAsync(2000);
    expect(decode(await second.read())).toBe('event: access.changed\ndata: {}\n\n');
    expect((await second.read()).done).toBe(true);
    expect((await first.read()).done).toBe(true);
    const stopped = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100000);
    expect(read).toHaveBeenCalledTimes(stopped);
    first.releaseLock();
    second.releaseLock();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds subscriptions, expires streams, and fails closed when database reads fail', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => snapshot());
    const hub = new DashboardStreamHub(read, 2000, 2, 1);
    const abort = new AbortController();
    const response = dashboardStream(hub, access, abort.signal, 3000);
    const reader = response.body!.getReader();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(dashboardStream(hub, { ...access, organizationId: 'foreign' }, abort.signal).status).toBe(503);
    const other = dashboardStream(hub, access, abort.signal, 3000).body!.getReader();
    expect(dashboardStream(hub, access, abort.signal).status).toBe(503);
    await vi.advanceTimersByTimeAsync(0);
    await reader.read();
    await other.read();
    read.mockRejectedValueOnce(new Error('database unavailable'));
    await vi.advanceTimersByTimeAsync(2000);
    expect((await reader.read()).done).toBe(true);
    expect((await other.read()).done).toBe(true);
    const expiring = dashboardStream(hub, access, abort.signal, 1000).body!.getReader();
    await vi.advanceTimersByTimeAsync(0);
    await expiring.read();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await expiring.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds slow-reader buffering and handles cancellation before/during a read', async () => {
    vi.useFakeTimers();
    let revision = 0;
    const read = vi.fn(async () => snapshot(String(++revision)));
    const hub = new DashboardStreamHub(read, 10);
    const abort = new AbortController();
    const response = dashboardStream(hub, access, abort.signal);
    await vi.advanceTimersByTimeAsync(500);
    const stopped = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(stopped);
    expect((await response.text()).split('event:').length).toBeLessThanOrEqual(17);
    abort.abort();
    expect(dashboardStream(hub, access, abort.signal).status).toBe(503);
    const live = dashboardStream(hub, access, new AbortController().signal);
    await live.body!.cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('dashboard query refresh', () => {
  it('matches category/query families without invalidating unrelated settings or detailed event data', () => {
    expect(affectedDashboardQuery(['/v1/runs?status=queued', 'pages'], new Set(['runs']))).toBe(true);
    expect(affectedDashboardQuery(['file', 'workspace', 'README.md'], new Set(['workspace']))).toBe(true);
    expect(affectedDashboardQuery(['/v1/workspaces/a/checkpoints'], new Set(['workspace']))).toBe(true);
    expect(affectedDashboardQuery(['/v1/projects/a/workspaces'], new Set(['git']))).toBe(true);
    expect(affectedDashboardQuery(['/v1/runs/a/result'], new Set(['git']))).toBe(true);
    expect(affectedDashboardQuery(['/v1/api-keys'], new Set(['runs']))).toBe(false);
    expect(affectedDashboardQuery(['detailed-events', 'run'], new Set(['all']))).toBe(false);
    expect(affectedDashboardQuery([null], new Set(['all']))).toBe(false);
  });

  it('coalesces bursts, refreshes active views, marks inactive views stale, and retains in-flight changes', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ['/v1/runs?limit=100'];
    client.setQueryData(key, ['old']);
    client.setQueryData(['/v1/workspaces/a/checkpoints'], ['checkpoint']);
    client.setQueryData(['/v1/api-keys'], ['key']);
    let release: (value: string[]) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          release = resolve;
        }),
    );
    const observer = new QueryObserver(client, { queryKey: key, queryFn: fetcher });
    const unsubscribe = observer.subscribe(() => {});
    const batch = dashboardRefreshBatch(client);
    for (let i = 0; i < 1000; i++) {
      batch.add('runs');
      batch.add('workspace');
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(client.getQueryData(key)).toEqual(['old']);
    expect(client.getQueryState(['/v1/workspaces/a/checkpoints'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['/v1/api-keys'])?.isInvalidated).toBe(false);
    batch.add('runs');
    release(['new']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    release(['newest']);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(key)).toEqual(['newest']);
    batch.add('all');
    batch.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.clear();
  });
});

describe('best-effort browser transport', () => {
  it('cancels a stalled reader and reconnects, and never starts an already-aborted subscription', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }),
      )
      .mockResolvedValueOnce(
        new Response('event: access.changed\ndata: {}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );
    const accessChanged = vi.fn();
    const options = {
      signal: new AbortController().signal,
      refresh: vi.fn(),
      accessChanged,
      fetch: fetcher,
      random: () => 0.5,
    };
    const follow = followDashboardChanges('org', options);
    await vi.advanceTimersByTimeAsync(66000);
    await follow;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(accessChanged).toHaveBeenCalledOnce();
    const stopped = new AbortController();
    stopped.abort();
    await followDashboardChanges('org', { ...options, signal: stopped.signal });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reconnects after EOF, refreshes on each ready, filters foreign/unknown signals, and sends no replay cursor', async () => {
    vi.useFakeTimers();
    const abort = new AbortController(),
      refresh = vi.fn(),
      accessChanged = vi.fn();
    const frame = (event: string, data: unknown) =>
      `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('same-origin');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).has('Last-Event-ID')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return new Response(
        frame('ready', {}) +
          frame('change', { category: 'runs', organization_id: 'org' }) +
          frame('change', { category: 'runs', organization_id: 'foreign' }) +
          frame('change', { category: 'output.delta', organization_id: 'org' }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const following = followDashboardChanges('org', {
      signal: abort.signal,
      refresh,
      accessChanged,
      fetch: fetcher,
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(['all', 'runs', 'all', 'runs']);
    abort.abort();
    await following;
    expect(accessChanged).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 409])('stops permanently on HTTP %i and clears identity', async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    const accessChanged = vi.fn();
    await followDashboardChanges('org', {
      signal: new AbortController().signal,
      refresh: vi.fn(),
      accessChanged,
      fetch: fetcher,
    });
    expect(accessChanged).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('backs off through outages and responds to an in-stream permission change', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response('event: access.changed\ndata: {}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );
    const accessChanged = vi.fn();
    const following = followDashboardChanges('org', {
      signal: new AbortController().signal,
      refresh: vi.fn(),
      accessChanged,
      fetch: fetcher,
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await following;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(accessChanged).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
