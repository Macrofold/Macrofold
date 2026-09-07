/** Retry timing derives from submission time, so restarts cannot reset backoff.
 * Stable per-run jitter spreads crowded accounts. Eligibility notifications may
 * wake work sooner; the queue deadline always bounds the next durable check. */
export function queueRetryAt(run: { id: string; created_at: Date; queue_expires_at: Date }, now: number) {
  const age = Math.max(0, (now - run.created_at.getTime()) / 1000);
  const seconds = age < 5 ? 5 : age < 15 ? 10 : age < 35 ? 20 : age < 75 ? 40 : 60;
  let hash = 0;
  for (const character of run.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const jitter = 0.8 + (hash % 201) / 1000;
  return new Date(Math.min(run.queue_expires_at.getTime(), now + seconds * jitter * 1000));
}
