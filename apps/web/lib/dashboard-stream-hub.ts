import { dashboardCategories, type DashboardSignal } from '../../../packages/contracts/dashboard';
import type { DashboardAccess, DashboardSnapshot } from '@platform/core/dashboard-freshness';

type Subscriber = {
  access: DashboardAccess;
  send: (event: string, data: DashboardSignal | Record<string, never>) => void;
  close: () => void;
  revisions?: DashboardSnapshot['revisions'];
};

/** Sharing is only an optimization. Cross-instance delivery comes from committed
 * SQL resource revisions; this hub stores no history and owns no DB connection. */
export class DashboardStreamHub {
  private subscribers = new Set<Subscriber>();
  private timer?: ReturnType<typeof setTimeout>;
  private polling = false;
  constructor(
    private read: (organization: string, accesses: DashboardAccess[]) => Promise<DashboardSnapshot>,
    private interval = 2000,
    private maxSubscriptions = 256,
    private maxOrganizations = 64,
  ) {}

  subscribe(subscriber: Subscriber): (() => void) | undefined {
    const organizations = new Set([...this.subscribers].map((s) => s.access.organizationId));
    if (
      this.subscribers.size >= this.maxSubscriptions ||
      (!organizations.has(subscriber.access.organizationId) && organizations.size >= this.maxOrganizations)
    )
      return;
    this.subscribers.add(subscriber);
    this.schedule(0);
    return () => {
      this.subscribers.delete(subscriber);
      if (!this.subscribers.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private schedule(delay: number) {
    if (this.timer || this.polling || !this.subscribers.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delay);
  }

  private async poll() {
    this.polling = true;
    const groups = new Map<string, Subscriber[]>();
    for (const s of this.subscribers) {
      const group = groups.get(s.access.organizationId) || [];
      group.push(s);
      groups.set(s.access.organizationId, group);
    }
    const pending = [...groups];
    // At most two concurrent short transactions, regardless of the tab count.
    const consume = async () => {
      for (let group = pending.shift(); group; group = pending.shift()) {
        const [organization, subscribers] = group;
        if (!subscribers.some((s) => this.subscribers.has(s))) continue;
        try {
          const snapshot = await this.read(
            organization,
            subscribers.map((s) => s.access),
          );
          for (const s of subscribers) {
            if (!this.subscribers.has(s)) continue;
            if (!snapshot.authorizedSessions.has(`${s.access.sessionId}:${s.access.role}`)) {
              s.send('access.changed', {});
              s.close();
              continue;
            }
            if (!s.revisions) s.send('ready', {});
            else
              for (const category of dashboardCategories) {
                if (s.revisions[category] !== snapshot.revisions[category])
                  s.send('change', { category, organization_id: organization });
              }
            s.revisions = snapshot.revisions;
          }
        } catch {
          // Fail closed if permissions cannot be checked. The client reconnects
          // with backoff; ordinary query reconciliation remains independent.
          for (const s of subscribers) if (this.subscribers.has(s)) s.close();
        }
      }
    };
    try {
      await Promise.all([consume(), consume()]);
    } finally {
      this.polling = false;
      this.schedule(this.interval);
    }
  }
}

export function dashboardStream(
  hub: DashboardStreamHub,
  access: DashboardAccess,
  signal: AbortSignal,
  lifetime = 50000,
): Response {
  let cleanup = () => {};
  const encoder = new TextEncoder();
  let accepted = false;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        let unsubscribe: (() => void) | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (closeController: boolean) => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(timeout);
          signal.removeEventListener('abort', close);
          unsubscribe?.();
          if (closeController) controller.close();
        };
        const close = () => finish(true);
        const write = (text: string) => {
          if (closed) return;
          // Slow/disconnected readers reconnect and refresh instead of accumulating
          // an unbounded queue. This stream intentionally has no replay contract.
          if ((controller.desiredSize ?? 0) <= 0) {
            close();
            return;
          }
          controller.enqueue(encoder.encode(text));
        };
        cleanup = () => finish(false);
        if (signal.aborted) {
          close();
          return;
        }
        unsubscribe = hub.subscribe({
          access,
          close,
          send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        });
        if (!unsubscribe) {
          close();
          return;
        }
        accepted = true;
        signal.addEventListener('abort', close, { once: true });
        heartbeat = setInterval(() => write(': heartbeat\n\n'), 15000);
        timeout = setTimeout(close, lifetime);
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 16 },
  );
  return accepted
    ? new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'private, no-store, no-transform',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
          Vary: 'Cookie',
        },
      })
    : Response.json(
        { error: { code: 'stream_capacity', message: 'Live refresh is temporarily unavailable.' } },
        { status: 503, headers: { 'Retry-After': '15', 'Cache-Control': 'no-store' } },
      );
}
