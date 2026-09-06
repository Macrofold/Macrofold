import { createHmac } from 'node:crypto';
import { pool, transaction, type Tx } from '../../db';
import { id, unseal } from './crypto';
import { isLocal } from './config';
import { safeFetch } from '../../providers/src/network';
import * as resources from './resources';

export const webhookEvents = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'git_sync.updated',
  'connection.expired',
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];
const delays = [10, 60, 300, 1800, 7200, 28800, 86400];
export function webhookSignature(secret: string, timestamp: string, body: string) {
  return 'v1,' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
/** Payloads contain stable resource references, never prompts, files, secrets or complete transcripts.
 * The outbox and event are committed together. Consumers must deduplicate the stable event ID. */
export async function enqueueWebhook(
  tx: Tx,
  org: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  options: { eventId?: string; endpointIds?: string[]; projectId?: string } = {},
) {
  const eventId = options.eventId || id();
  const endpoints = await tx.query(
    "SELECT id,data FROM webhooks WHERE data->>'enabled'='true' AND COALESCE(data->>'deleted','false')<>'true' AND data->'events' ? $1",
    [event],
  );
  for (const endpoint of endpoints.rows) {
    if (options.endpointIds?.length && !options.endpointIds.includes(endpoint.id)) continue;
    const deliveryId = id();
    const payload = JSON.stringify({
      id: eventId,
      schema_version: 1,
      type: event,
      created_at: new Date().toISOString(),
      data,
    });
    const inserted = await tx.query(
      `INSERT INTO deliveries(id,organization_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
      [
        deliveryId,
        org,
        JSON.stringify({
          event_id: eventId,
          endpoint_id: endpoint.id,
          status: 'pending',
          attempts: 0,
          payload,
          ...(options.projectId ? { project_id: options.projectId } : {}),
        }),
      ],
    );
    if (inserted.rowCount)
      await tx.query(
        "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'webhook',$3)",
        [id(), org, deliveryId],
      );
  }
  return eventId;
}
export async function deliverWebhook(org: string, deliveryId: string, transport: typeof fetch = safeFetch) {
  return transaction(org, async (tx) => {
    const acquired = await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
      `delivery:${deliveryId}`,
    ]);
    if (!acquired.rows[0].locked) return;
    const d = await resources.get(tx, 'deliveries', deliveryId);
    if (['delivered', 'exhausted'].includes(String(d.status))) {
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='webhook' AND resource_id=$1",
        [deliveryId],
      );
      return;
    }
    const endpoint = await resources.get(tx, 'webhooks', String(d.endpoint_id));
    let status = 0;
    let reason: string | undefined;
    const attempt = Number(d.attempts) + 1;
    if (!endpoint.enabled || endpoint.deleted) reason = 'endpoint_disabled';
    else {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secrets = [endpoint.secret_ciphertext];
      if (
        endpoint.previous_secret_ciphertext &&
        Date.parse(String(endpoint.previous_secret_expires_at)) > Date.now()
      )
        secrets.push(endpoint.previous_secret_ciphertext);
      const signature = secrets
        .map((secret) => webhookSignature(unseal<string>(String(secret)), timestamp, String(d.payload)))
        .join(' ');
      try {
        const response = await transport(String(endpoint.url), {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'Webhook-Id': String(d.event_id),
            'Webhook-Timestamp': timestamp,
            'Webhook-Signature': signature,
            'User-Agent': 'Hosted-Agents-Webhooks/1',
          },
          body: String(d.payload),
          signal: AbortSignal.timeout(10000),
        });
        status = response.status;
        await response.body?.cancel(); // Destination response bodies are neither trusted nor retained.
      } catch {
        reason = 'delivery_unreachable';
      }
    }
    const succeeded = status >= 200 && status < 300;
    const exhausted =
      !succeeded && (attempt >= 8 || !!endpoint.deleted || !endpoint.enabled || status === 410);
    const next = new Date(
      Date.now() + (delays[attempt - 1] || 86400) * (0.9 + Math.random() * 0.2) * 1000,
    ).toISOString();
    await resources.update(tx, 'deliveries', deliveryId, {
      status: succeeded ? 'delivered' : exhausted ? 'exhausted' : 'retrying',
      attempts: attempt,
      last_status_code: status,
      error_code: reason || null,
      next_attempt_at: next,
      completed_at: succeeded || exhausted ? new Date().toISOString() : null,
    });
    await tx.query(
      "UPDATE dispatch_jobs SET state=$2,available_at=$3,lease_until=NULL,attempts=attempts+1 WHERE kind='webhook' AND resource_id=$1",
      [deliveryId, succeeded || exhausted ? 'done' : 'pending', next],
    );
    if (d.replay_operation_id && (succeeded || exhausted))
      await resources.update(tx, 'operations', String(d.replay_operation_id), {
        status: succeeded ? 'succeeded' : 'failed',
        result: { delivery_id: deliveryId, status: succeeded ? 'delivered' : 'exhausted' },
      });
  });
}
export async function dispatchWebhooks(transport?: typeof fetch) {
  if (isLocal() && !transport) return { webhook_deliveries: 0 };
  const jobs = await pool.query(
    "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='webhook' AND state='pending' AND available_at<=now() ORDER BY available_at LIMIT 10",
  );
  await Promise.all(jobs.rows.map((job) => deliverWebhook(job.organization_id, job.resource_id, transport)));
  return { webhook_deliveries: jobs.rowCount || 0 };
}
