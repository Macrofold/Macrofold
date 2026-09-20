import { transaction } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import { getRun, terminal, waitingFields } from './runs';
import { advanceInference } from './inference-engine';

export function respondAsync(request: Request) {
  return (request.headers.get('prefer') || '')
    .split(',')
    .some((value) => value.trim().toLowerCase() === 'respond-async');
}

/** Admission has already committed and claimed capacity. Drive the existing
 * durable stages directly, without polling, sleeping, or another executor.
 * A replay reads persisted state; dispatch CAS still prevents duplicate calls. */
export async function completeDirectInference(
  p: Principal,
  accepted: unknown,
  execute: boolean,
  background?: (task: () => Promise<void>) => void,
) {
  assert(
    accepted && typeof accepted === 'object' && 'run_id' in accepted && typeof accepted.run_id === 'string',
    500,
    'invalid_inference_receipt',
    'The inference receipt is unavailable.',
  );
  const runId = accepted.run_id;
  if (execute) {
    try {
      // One preparation, one provider invocation, one settlement. Bounded agents
      // never enter this path and cannot extend the HTTP request with a tool loop.
      for (let step = 0; step < 3; step++) {
        const result = await advanceInference(p.organizationId, runId, background);
        if (result.done || result.queued || result.delaySeconds > 0) break;
      }
    } catch {
      // Return the durable identity rather than turn an admitted/possibly billed
      // request into an apparent submission failure. Recovery never repeats a
      // dispatch_started call whose outcome is unknown.
      console.error(JSON.stringify({ code: 'direct_inference_interrupted', run_id: runId }));
      await transaction(p.organizationId, (tx) =>
        tx.query(
          "UPDATE dispatch_jobs SET available_at=now(),lease_until=NULL WHERE kind='run' AND resource_id=$1 AND state<>'done'",
          [runId],
        ),
      ).catch(() => {}); // The admission-time recovery deadline is the fallback.
    }
  }
  const run = await transaction(p.organizationId, (tx) => getRun(tx, runId, p));
  assert(
    run.kind === 'inference',
    409,
    'unsupported_run_kind',
    'Direct execution requires a single inference.',
  );
  const final = terminal(run.status);
  return {
    status: final ? 200 : 202,
    body: {
      ...accepted,
      status: run.status,
      ...waitingFields(run),
      ...(final
        ? {
            result: {
              run_id: runId,
              final,
              execution_outcome: 'pending',
              persistence_status: 'pending',
              ...run.result,
            },
          }
        : {}),
    },
  };
}
