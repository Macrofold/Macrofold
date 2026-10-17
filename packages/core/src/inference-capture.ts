import { setImmediate as yieldToDelivery } from 'node:timers/promises';
import { transaction } from '../../db';

// This is an optional content-export envelope, not a second history store.
// The response owner already retains canonical output; original input is only
// useful to the configured diagnostics backend. Count both encoded payloads
// before a host callback may retain their objects (actual JS heap is larger).
const maximumCaptures = 16,
  maximumBytes = 32 * 1024 * 1024;
let captures = 0,
  retainedBytes = 0,
  omitted = 0;
export function inferenceCaptureStats() {
  return { captures, retainedBytes, omitted };
}

export function scheduleInferenceCapture(
  input: { organizationId: string; runId: string; bytes: number },
  background: ((task: () => Promise<void>) => void) | undefined,
  trace: (content: boolean) => void,
) {
  // A successful enqueue precedes guard COMMIT. A failed acknowledgment or
  // host scheduling error must not emit this same observation a second time.
  let emitted = false;
  const record = (content: boolean) => {
    if (emitted) return;
    emitted = true;
    trace(content);
  };
  if (!background || captures >= maximumCaptures || input.bytes > maximumBytes - retainedBytes) {
    omitted++;
    record(false);
    return false;
  }
  captures++;
  retainedBytes += input.bytes;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    captures--;
    retainedBytes -= input.bytes;
  };
  try {
    background(async () => {
      try {
        await yieldToDelivery();
        await transaction(
          input.organizationId,
          async (tx) => {
            // Enqueue synchronously while this retention guard still holds.
            // afterCommit is too late: PostgreSQL releases the lock before its
            // acknowledgment, allowing purge to win before the callback runs.
            // The configured sink owns asynchronous external delivery.
            const row = (
              await tx.query<{ expired: boolean }>(
                "SELECT coalesce((result->>'content_expired')::boolean,false) AS expired FROM runs WHERE id=$1 FOR SHARE",
                [input.runId],
              )
            ).rows[0];
            if (row && !row.expired) record(true);
            else {
              omitted++;
              record(false);
            }
          },
          { deadlineAtMs: Date.now() + 1000 },
        );
      } catch {
        if (!emitted) {
          omitted++;
          record(false);
        }
      } finally {
        release();
      }
    });
    return true;
  } catch {
    omitted++;
    release();
    record(false);
    return false;
  }
}
