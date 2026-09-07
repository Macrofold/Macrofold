import { sseFrames } from '@hosted-agents/sdk';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { dashboardCategories, type DashboardCategory } from '../../../packages/contracts/dashboard';

type Refresh = DashboardCategory | 'all';
/** Deliberately category-wide: a burst may contain many resources, so retaining
 * only the last resource ID would leave other active queries stale. */
export function affectedDashboardQuery(key: QueryKey, categories: ReadonlySet<Refresh>): boolean {
  const path = key[0];
  if (typeof path !== 'string') return false;
  if (categories.has('all'))
    return path === 'file' || path.startsWith('/v1/') || path.startsWith('/admin/v1/');
  if (path === 'file') return categories.has('workspace');
  const resource = path.split('?')[0].split('/')[2];
  if (categories.has('runs') && ['runs', 'sessions', 'usage', 'billing', 'requests'].includes(resource))
    return true;
  if (
    (categories.has('workspace') || categories.has('git')) &&
    ['projects', 'workspaces', 'operations'].includes(resource)
  )
    return true;
  if (categories.has('git') && resource === 'runs') return true;
  return categories.has('runs') && path.startsWith('/admin/v1/');
}

/** A fixed window (not a reset-on-every-event debounce) bounds sustained bursts.
 * Serialize refetches and retain signals received while an earlier fetch is busy. */
export function dashboardRefreshBatch(client: QueryClient, delay = 1000) {
  const pending = new Set<Refresh>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false,
    stopped = false;
  const schedule = () => {
    if (stopped || running || timer || !pending.size) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  };
  const flush = async () => {
    if (stopped) return;
    const categories = new Set(pending);
    pending.clear();
    running = true;
    try {
      await client.invalidateQueries(
        { predicate: (q) => affectedDashboardQuery(q.queryKey, categories), refetchType: 'active' },
        { cancelRefetch: false },
      );
    } finally {
      running = false;
      schedule();
    }
  };
  return {
    add(category: Refresh) {
      if (!stopped) {
        pending.add(category);
        schedule();
      }
    },
    stop() {
      stopped = true;
      pending.clear();
      clearTimeout(timer);
    },
  };
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    if (signal.aborted) finish();
    else signal.addEventListener('abort', finish, { once: true });
  });
}

/** Reuse the SDK's bounded SSE framing, not its durable run/replay contract. */
export async function followDashboardChanges(
  organization: string,
  options: {
    signal: AbortSignal;
    refresh: (category: Refresh) => void;
    accessChanged: () => void;
    fetch?: typeof fetch;
    random?: () => number;
  },
) {
  const fetcher = options.fetch || fetch,
    random = options.random || Math.random;
  let failures = 0;
  while (!options.signal.aborted) {
    const connection = new AbortController();
    const abort = () => connection.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    // A black-holed TCP stream must not prevent reconnection indefinitely.
    const watchdog = setTimeout(abort, 65000);
    try {
      const response = await fetcher(`/account/events?organization_id=${encodeURIComponent(organization)}`, {
        headers: { Accept: 'text/event-stream', 'X-Client-Type': 'dashboard' },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: connection.signal,
      });
      if ([401, 403, 409].includes(response.status)) {
        await response.body?.cancel();
        if (!options.signal.aborted) options.accessChanged();
        return;
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        await response.body?.cancel();
        throw new Error('Dashboard stream unavailable');
      }
      for await (const frame of sseFrames(response, connection.signal)) {
        if (options.signal.aborted) return;
        if (frame.event === 'access.changed') {
          options.accessChanged();
          return;
        }
        if (frame.event === 'ready') {
          failures = 0;
          options.refresh('all');
        }
        if (frame.event === 'change') {
          const data = JSON.parse(frame.data);
          if (data.organization_id === organization && dashboardCategories.includes(data.category))
            options.refresh(data.category);
        }
      }
    } catch {
      /* Best effort: the independent reconciliation loop remains active. */
    } finally {
      clearTimeout(watchdog);
      options.signal.removeEventListener('abort', abort);
      connection.abort();
    }
    if (!options.signal.aborted)
      await pause(
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) * (0.75 + random() * 0.5),
        options.signal,
      );
  }
}
