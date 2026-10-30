import { boundedQuery } from '../../db';
import { apiKeyActorAuthorized, type ApiKeyActorFacts } from './actor-authorization';
import { immediateInferenceLimits } from './capacity';
import { AppError } from './errors';
import { errorDiagnostics } from './error-diagnostics';

export type InferenceControlRow = ApiKeyActorFacts & {
  deployment_allowed?: boolean;
  id: string;
  organization_id: string;
  lease_generation: string;
  status: string;
  cancel_requested: boolean;
  deadline: Date | null;
};
export type InferenceObservation = {
  runId: string;
  organizationId: string;
  generation: string;
  abort: AbortController;
  /** Admission's authoritative check, using this process's monotonic clock. */
  checkedAtMonotonicMs?: number;
};
type Registration = InferenceObservation & { checkedAt: number; observationFailed?: boolean };
type PageReader = (ids: string[]) => Promise<InferenceControlRow[]>;

const pageSize = 256;
const pageConcurrency = 2;
const cadenceMs = 500;
const healthyAgeMs = 1000;
const staleAgeMs = 2000;

async function readControlPage(ids: string[]) {
  return (
    await boundedQuery<InferenceControlRow>(
      'SELECT * FROM reporting.inference_control WHERE id=ANY($1::uuid[])',
      [ids],
      { deadlineAtMs: Date.now() + 500, statementTimeoutMs: 250 },
    )
  ).rows;
}

/** One process-local observer replaces per-Run polling. Its registrations own
 * only cancellation signals; durable identity and authority remain in SQL.
 * Injection is limited to the fixed content-free read boundary for tests. */
export class InferenceControlObserver {
  private readonly registrations = new Map<symbol, Registration>();
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;
  private lastSweepAt = 0;
  private pageDurationMs = 25;
  constructor(private readonly readPage: PageReader = readControlPage) {}

  available() {
    // An old slow sample cannot permanently close admission after all calls
    // drain. The next admitted owner supplies fresh authority and a new sample.
    if (!this.registrations.size) return !this.sweeping;
    const now = performance.now();
    if (this.sweeping && now - this.lastSweepAt >= healthyAgeMs - cadenceMs) return false;
    for (const registration of this.registrations.values())
      if (registration.observationFailed || now - registration.checkedAt >= healthyAgeMs) return false;
    // Keep one full sweep inside the freshness target, including its cadence.
    const pages = Math.ceil((this.registrations.size + 1) / pageSize);
    return cadenceMs + Math.ceil(pages / pageConcurrency) * this.pageDurationMs < healthyAgeMs;
  }

  register(observation: InferenceObservation) {
    const identity = Symbol(observation.runId);
    const now = performance.now();
    const registration = { ...observation, checkedAt: observation.checkedAtMonotonicMs ?? now };
    this.registrations.set(identity, registration);
    // Commit/delivery delay cannot reset the age of admission's authority check.
    if (!this.expire(identity, registration, now)) {
      if (this.registrations.size === 1 && !this.sweeping) this.lastSweepAt = now;
      this.schedule();
    }
    // No await: finishing a provider must never wait for unrelated SQL.
    return () => {
      this.registrations.delete(identity);
      if (!this.registrations.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private schedule() {
    if (this.timer || !this.registrations.size) return;
    const now = performance.now();
    let due = this.sweeping ? Infinity : this.lastSweepAt + cadenceMs;
    for (const registration of this.registrations.values())
      due = Math.min(due, registration.checkedAt + staleAgeMs);
    // One shared freshness timer targets the earliest absolute cutoff. A fixed
    // interval would add up to another interval beyond the two-second bound.
    this.timer = setTimeout(() => this.tick(), Math.max(1, due - now));
    this.timer.unref();
  }

  private tick() {
    this.timer = undefined;
    const now = performance.now();
    for (const [identity, registration] of this.registrations) this.expire(identity, registration, now);
    if (!this.sweeping && now - this.lastSweepAt >= cadenceMs && this.registrations.size) {
      this.lastSweepAt = now;
      this.sweeping = true;
      void this.sweep().finally(() => {
        this.sweeping = false;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.schedule();
      });
    }
    this.schedule();
  }

  private abort(identity: symbol, registration: Registration, code: string) {
    if (this.registrations.get(identity) !== registration) return;
    registration.abort.abort(new AppError(409, code, 'The inference can no longer continue.'));
    this.registrations.delete(identity);
    if (!this.registrations.size) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private expire(identity: symbol, registration: Registration, now: number) {
    if (now - registration.checkedAt < staleAgeMs) return false;
    this.abort(
      identity,
      registration,
      registration.observationFailed ? 'inference_control_unavailable' : 'inference_control_stale',
    );
    return true;
  }

  private async sweep() {
    const entries = [...this.registrations];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(pageConcurrency, Math.ceil(entries.length / pageSize)) }, async () => {
        while (cursor < entries.length) {
          const page = entries.slice(cursor, (cursor += pageSize));
          const startedAt = performance.now();
          try {
            const rows = new Map(
              (await this.readPage(page.map(([, registration]) => registration.runId))).map((row) => [
                row.id,
                row,
              ]),
            );
            this.pageDurationMs = Math.max(1, performance.now() - startedAt);
            for (const [identity, registration] of page) {
              if (this.registrations.get(identity) !== registration) continue;
              // A late query callback cannot beat a delayed freshness timer.
              if (this.expire(identity, registration, performance.now())) continue;
              const row = rows.get(registration.runId);
              const authorized =
                row &&
                row.organization_id === registration.organizationId &&
                row.lease_generation === registration.generation &&
                ['provisioning', 'running', 'waiting_for_input', 'persisting'].includes(row.status) &&
                !row.cancel_requested &&
                row.deployment_allowed !== false &&
                apiKeyActorAuthorized(row);
              if (!authorized)
                this.abort(
                  identity,
                  registration,
                  row?.cancel_requested ? 'cancelled' : 'authorization_revoked',
                );
              else {
                registration.checkedAt = startedAt;
                registration.observationFailed = false;
              }
            }
          } catch (error: unknown) {
            // A failed read is not revoked authority. Retry only this read on
            // the normal cadence, never extend the last confirmed 2s cutoff.
            // See docs/projects/immediate-inference-tech-design.md#cancellation-without-one-query-loop-per-call.
            const now = performance.now();
            let runCount = 0;
            let maxAgeMs = 0;
            for (const [identity, registration] of page)
              if (this.registrations.get(identity) === registration) {
                registration.observationFailed = true;
                runCount++;
                maxAgeMs = Math.max(maxAgeMs, now - registration.checkedAt);
              }
            if (runCount)
              console.warn(
                JSON.stringify({
                  code: 'inference_control_read_failed',
                  ...errorDiagnostics(error),
                  duration_ms: Math.round(now - startedAt),
                  run_count: runCount,
                  max_age_ms: Math.round(maxAgeMs),
                }),
              );
          }
        }
      }),
    );
  }
}

export const inferenceControl = new InferenceControlObserver();
export const observeInference = (observation: InferenceObservation) => inferenceControl.register(observation);

let inFlight = 0;
let admitting = 0;
let readingRequests = 0;

function unavailable(reason: string) {
  return new AppError(
    503,
    'inference_service_unavailable',
    'Inference serving capacity is temporarily unavailable.',
    { reason, retry_after_seconds: 1 },
  );
}

/** Bound buffered request bodies before replay can identify a completed Run.
 * This is independent of producer capacity, so busy models do not block replay.
 * Transfer the request to the producer permit before preparing new execution. */
export function acquireInferenceRequestPermit() {
  if (readingRequests >= immediateInferenceLimits().inFlight) throw unavailable('local_capacity');
  readingRequests++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      readingRequests--;
    }
  };
}

/** Completed identity replay happens before taking this memory/socket permit. */
export function acquireImmediateInferencePermit() {
  if (inFlight >= immediateInferenceLimits().inFlight) throw unavailable('local_capacity');
  if (!inferenceControl.available()) throw unavailable('observer_capacity');
  inFlight++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      inFlight--;
    }
  };
}

/** Admission never queues locally behind an occupied SQL pool. The caller's
 * cumulative deadline covers this gate and its eventual transaction. */
export function acquireInferenceAdmission(deadlineAtMs: number) {
  if (Date.now() >= deadlineAtMs)
    throw new AppError(503, 'inference_admission_timeout', 'Inference admission exhausted its time budget.', {
      retry_after_seconds: 1,
    });
  if (admitting >= immediateInferenceLimits().admission) throw unavailable('local_capacity');
  admitting++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      admitting--;
    }
  };
}
