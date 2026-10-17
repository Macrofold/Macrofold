import { storage } from '../../providers/src/storage';

const pending = new Set<string>();
const active = new Map<string, Promise<void>>();
let omitted = 0;
let failed = 0;

/** Only compact staging identities survive request completion. Staging expiry
 * remains the crash/overload backstop, so cleanup never delays model dispatch. */
export function cleanupModelStaging(key: string) {
  if (pending.has(key) || active.has(key)) return;
  if (pending.size + active.size >= 64) {
    omitted++;
    return;
  }
  pending.add(key);
  refill();
}
function refill() {
  while (active.size < 4 && pending.size) {
    const key = pending.values().next().value;
    if (key === undefined) break;
    pending.delete(key);
    const work = Promise.resolve()
      .then(() => storage.delete(key))
      .catch(() => {
        failed++;
      })
      .finally(() => {
        active.delete(key);
        refill();
      });
    active.set(key, work);
  }
}
export async function drainModelStagingCleanup() {
  while (active.size) await Promise.all(active.values());
}
export function modelStagingCleanupStatus() {
  return { pending: pending.size, active: active.size, omitted, failed };
}
