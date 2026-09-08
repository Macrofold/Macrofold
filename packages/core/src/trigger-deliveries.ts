import { lock, type Tx } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import { id, seal, sha256 } from './crypto';
import { getTrigger, type TriggerRow } from './triggers';

export type TriggerDelivery = {
  id: string;
  organization_id: string;
  trigger_id: string;
  external_id: string;
  request_hash: string;
  prompt_ciphertext: string;
  trigger_revision: number;
  status: 'pending' | 'accepted' | 'failed' | 'skipped';
  run_id: string | null;
  error_code: string | null;
  received_at: Date;
  expires_at: Date;
  reply_thread: string | null;
  reply_connection_id: string | null;
  reply_channel: string | null;
  reply_state: 'none' | 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
  reply_ts: string | null;
};
export function presentDelivery(d: TriggerDelivery) {
  return {
    id: d.id,
    trigger_id: d.trigger_id,
    status: d.status,
    run_id: d.run_id,
    error_code: d.error_code,
    received_at: d.received_at.toISOString(),
    expires_at: d.expires_at.toISOString(),
    reply_state: d.reply_state,
  };
}
/** Receipt, deduplication and SQL outbox are a single commit. No model or Slack call belongs here. */
export async function enqueueTrigger(
  tx: Tx,
  t: TriggerRow,
  externalId: string,
  incoming = '',
  thread?: string,
  now = new Date(),
) {
  await lock(tx, `trigger:${t.id}`);
  const hash = sha256(JSON.stringify({ incoming, thread }));
  const previous = (
    await tx.query<TriggerDelivery>(
      'SELECT * FROM trigger_deliveries WHERE trigger_id=$1 AND external_id=$2',
      [t.id, externalId],
    )
  ).rows[0];
  if (previous) {
    assert(
      previous.request_hash === hash,
      409,
      'delivery_conflict',
      'This delivery ID already identifies another payload.',
    );
    return presentDelivery(previous);
  }
  assert(t.enabled && !t.deleted_at, 409, 'trigger_paused', 'This trigger is paused or deleted.');
  assert(
    Number(
      (
        await tx.query("SELECT count(*) FROM trigger_deliveries WHERE trigger_id=$1 AND status='pending'", [
          t.id,
        ])
      ).rows[0].count,
    ) < 100,
    429,
    'trigger_backlog_full',
    'This trigger has 100 waiting deliveries. Retry later with the same delivery ID.',
  );
  // Bound all arrivals, not just successful runs, to prevent an authenticated sender flooding storage.
  assert(
    Number(
      (
        await tx.query('SELECT count(*) FROM trigger_deliveries WHERE trigger_id=$1 AND received_at>$2', [
          t.id,
          new Date(now.getTime() - 86400000),
        ])
      ).rows[0].count,
    ) < t.max_runs_per_day,
    429,
    'trigger_daily_limit',
    'This trigger reached its rolling 24-hour delivery limit.',
  );
  const prompt = incoming ? `${t.prompt}\n\nIncoming message or webhook payload:\n${incoming}` : t.prompt;
  assert(prompt.length <= 60000, 413, 'payload_too_large', 'The combined prompt exceeds 60,000 characters.');
  const deliveryId = id();
  const d = (
    await tx.query<TriggerDelivery>(
      `INSERT INTO trigger_deliveries(id,organization_id,trigger_id,external_id,request_hash,prompt_ciphertext,trigger_revision,received_at,expires_at,reply_thread,reply_state,reply_connection_id,reply_channel)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        deliveryId,
        t.organization_id,
        t.id,
        externalId,
        hash,
        seal(prompt),
        t.revision,
        now,
        new Date(now.getTime() + 86400000),
        thread || null,
        thread ? 'pending' : 'none',
        thread ? t.slack_connection_id : null,
        thread ? t.channel_id : null,
      ],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'trigger',$3)",
    [id(), t.organization_id, deliveryId],
  );
  return presentDelivery(d);
}
export async function listTriggerDeliveries(tx: Tx, p: Principal, triggerId: string, query: URLSearchParams) {
  await getTrigger(tx, p, triggerId);
  const limit = Math.min(100, Number(query.get('limit')) || 25);
  const rows = (
    await tx.query<TriggerDelivery>(
      'SELECT * FROM trigger_deliveries WHERE trigger_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
      [triggerId, query.get('cursor'), limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map(presentDelivery),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function runTriggerNow(tx: Tx, p: Principal, triggerId: string, key: string) {
  const t = await getTrigger(tx, p, triggerId, true);
  assert(t.kind === 'schedule', 400, 'invalid_trigger_kind', 'Run now is available for scheduled tasks.');
  return enqueueTrigger(tx, t, `manual:${p.id}:${key}`);
}
export async function retryTriggerReply(tx: Tx, p: Principal, triggerId: string, deliveryId: string) {
  await getTrigger(tx, p, triggerId, true);
  await tx.query("SELECT id FROM dispatch_jobs WHERE kind='trigger' AND resource_id=$1 FOR UPDATE", [
    deliveryId,
  ]);
  const d = (
    await tx.query<TriggerDelivery>(
      "UPDATE trigger_deliveries SET reply_state='pending',error_code=NULL WHERE id=$1 AND trigger_id=$2 AND reply_state IN ('failed','uncertain') RETURNING *",
      [deliveryId, triggerId],
    )
  ).rows[0];
  assert(
    d,
    409,
    'reply_not_retryable',
    'Only failed or uncertain replies can be retried. Check Slack for an existing reply first.',
  );
  await tx.query(
    "UPDATE dispatch_jobs SET state='pending',available_at=now(),lease_until=NULL WHERE kind='trigger' AND resource_id=$1",
    [deliveryId],
  );
  return presentDelivery(d);
}
