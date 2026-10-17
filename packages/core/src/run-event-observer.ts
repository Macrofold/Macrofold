import { transaction } from '../../db';
import { mapConcurrent } from './concurrent';
import { listenRunEvents, type EventListener } from './run-event-notifications';

type State = { sequence: string; terminal: boolean };
type ReadRow = { id: string; event_sequence: string; status: string; failure_code: string | null };
type Reader = (org: string, runs: string[]) => Promise<ReadRow[]>;
type Wake = 'changed' | 'heartbeat' | 'closed';
type Subscription = { expires: number; heartbeat: number; wake?: (reason: Wake) => void };
type ObservedRun = {
  org: string;
  run: string;
  version: number;
  state?: State;
  subscribers: Set<Subscription>;
};
const readStates: Reader = (org, runs) =>
  transaction(
    org,
    async (tx) =>
      (
        await tx.query<ReadRow>(
          `SELECT id,event_sequence,status,CASE WHEN EXISTS(SELECT 1 FROM dispatch_jobs j
        WHERE j.kind='run' AND j.resource_id=runs.id AND j.state='blocked')
        THEN 'run_recovery_required' ELSE NULL END AS failure_code FROM runs WHERE id=ANY($1::uuid[])`,
          [runs],
        )
      ).rows,
  );

/** One content-free repair observer per process. Local commits wake immediately;
 * other replicas are discovered in bounded pages. Readers retain their own
 * authorized replay cursor and backpressure, never a connection or poll timer. */
export class RunEventObserver {
  private readonly runs = new Map<string, ObservedRun>();
  private timer?: NodeJS.Timeout;
  private reading = false;
  private nextRead = 0;
  private listener?: ReturnType<EventListener>;
  constructor(
    private readonly read: Reader = readStates,
    private readonly listen?: EventListener,
  ) {}
  private key(org: string, run: string) {
    return `${org}:${run}`;
  }
  hint(org: string, run: string) {
    const observed = this.runs.get(this.key(org, run));
    if (observed) {
      observed.version++;
      this.wake(observed, 'changed');
    }
  }
  subscribe(org: string, run: string) {
    const key = this.key(org, run);
    let observed = this.runs.get(key);
    if (!observed) {
      observed = { org, run, version: 0, subscribers: new Set() };
      this.runs.set(key, observed);
    }
    const owner = observed;
    const subscription: Subscription = { expires: Date.now() + 55_000, heartbeat: Date.now() + 15_000 };
    owner.subscribers.add(subscription);
    const dispose = () => {
      subscription.wake?.('closed');
      subscription.wake = undefined;
      owner.subscribers.delete(subscription);
      if (!owner.subscribers.size) this.runs.delete(key);
      if (!this.runs.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.stopListenerWhenIdle();
      }
    };
    this.listener ??= this.listen?.((org, run) => this.hint(org, run));
    this.schedule();
    return {
      version: () => owner.version,
      state: () => owner.state,
      active: () => owner.subscribers.has(subscription) && subscription.expires > Date.now(),
      wait: (version: number): Promise<Wake> => {
        if (!owner.subscribers.has(subscription)) return Promise.resolve('closed');
        if (owner.version !== version) return Promise.resolve('changed');
        return new Promise((resolve) => {
          subscription.wake = (reason) => {
            subscription.wake = undefined;
            resolve(reason);
          };
        });
      },
      dispose,
    };
  }
  private wake(observed: ObservedRun, reason: Wake) {
    for (const subscriber of observed.subscribers) subscriber.wake?.(reason);
  }
  private stopListenerWhenIdle() {
    if (this.runs.size) return;
    this.listener?.close();
    this.listener = undefined;
    this.nextRead = 0;
  }
  private schedule() {
    if (this.timer || !this.runs.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tick();
    }, 50);
    this.timer.unref();
  }
  private tick() {
    const now = Date.now();
    for (const [key, observed] of this.runs) {
      for (const subscriber of observed.subscribers) {
        if (subscriber.expires <= now) {
          subscriber.wake?.('closed');
          observed.subscribers.delete(subscriber);
        } else if (subscriber.heartbeat <= now) {
          subscriber.heartbeat = now + 15_000;
          subscriber.wake?.('heartbeat');
        }
      }
      if (!observed.subscribers.size) this.runs.delete(key);
    }
    this.stopListenerWhenIdle();
    if (!this.reading && now >= this.nextRead && this.runs.size) {
      this.reading = true;
      // A connected local LISTEN socket supplies fast commit hints. Its one-second
      // repair still catches missed notifications; pooled hosts share 100-ms reads.
      // Neither work nor connections grow with the number of readers of one Run.
      this.nextRead = now + (this.listener?.connected() ? 1000 : 100);
      void this.refresh()
        .catch(() => {
          // An outage is a transport failure, never an invented empty/terminal Run.
          for (const observed of this.runs.values()) this.wake(observed, 'closed');
        })
        .finally(() => {
          this.reading = false;
          this.schedule();
        });
    }
    this.schedule();
  }
  private async refresh() {
    const groups = new Map<string, ObservedRun[]>();
    for (const observed of this.runs.values()) {
      const group = groups.get(observed.org) ?? [];
      group.push(observed);
      groups.set(observed.org, group);
    }
    const pages = [...groups].flatMap(([org, runs]) => {
      const pages: { org: string; runs: ObservedRun[] }[] = [];
      for (let offset = 0; offset < runs.length; offset += 256)
        pages.push({ org, runs: runs.slice(offset, offset + 256) });
      return pages;
    });
    await mapConcurrent(pages, 4, async (page) => {
      const rows = new Map(
        (
          await this.read(
            page.org,
            page.runs.map((run) => run.run),
          )
        ).map((row) => [row.id, row]),
      );
      for (const observed of page.runs) {
        if (this.runs.get(this.key(observed.org, observed.run)) !== observed) continue;
        const row = rows.get(observed.run);
        if (!row) {
          this.wake(observed, 'closed');
          continue;
        }
        const state = {
          sequence: String(row.event_sequence),
          terminal:
            ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(row.status) ||
            row.failure_code === 'run_recovery_required',
        };
        if (
          !observed.state ||
          observed.state.sequence !== state.sequence ||
          observed.state.terminal !== state.terminal
        ) {
          observed.state = state;
          observed.version++;
          this.wake(observed, 'changed');
        }
      }
    });
  }
}
export const runEventObserver = new RunEventObserver(readStates, listenRunEvents);
