import type { Tx } from '../../db';
import { transaction } from '../../db';
import { id } from './crypto';
import { assert } from './errors';
import { enqueueWebhook, type WebhookEvent } from './webhooks';
export async function emit(
  tx: Tx,
  org: string,
  runId: string,
  type: string,
  data: Record<string, unknown>,
  producer?: { id: string; sequence: number },
) {
  await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
  if (producer) {
    const old = await tx.query(
      'SELECT * FROM run_events WHERE run_id=$1 AND producer_id=$2 AND producer_sequence=$3',
      [runId, producer.id, producer.sequence],
    );
    if (old.rowCount) return publicEvent(old.rows[0]);
  }
  const row = await tx.query(
    'UPDATE runs SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
    [runId],
  );
  assert(row.rowCount, 404, 'not_found', 'Run not found.');
  const result = await tx.query(
    'INSERT INTO run_events(id,organization_id,run_id,sequence,type,data,producer_id,producer_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [
      id(),
      org,
      runId,
      row.rows[0].event_sequence,
      type,
      JSON.stringify(data),
      producer?.id || null,
      producer?.sequence || null,
    ],
  );
  const eventType: WebhookEvent | undefined =
    type === 'run.succeeded'
      ? 'run.completed'
      : type === 'run.failed' || type === 'run.timed_out'
        ? 'run.failed'
        : type === 'run.cancelled'
          ? 'run.cancelled'
          : undefined;
  if (eventType) {
    const run = (
      await tx.query('SELECT project_id,workspace_id,status,config FROM runs WHERE id=$1', [runId])
    ).rows[0];
    await enqueueWebhook(
      tx,
      org,
      eventType,
      {
        run_id: runId,
        project_id: run.project_id,
        workspace_id: run.workspace_id,
        status: run.status,
        ...(typeof data.code === 'string' ? { failure_code: data.code } : {}),
      },
      { eventId: result.rows[0].id, endpointIds: run.config.webhook_endpoint_ids, projectId: run.project_id },
    );
  }
  return publicEvent(result.rows[0]);
}
export function publicEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    schema_version: 1,
    run_id: row.run_id,
    sequence: String(row.sequence),
    type: row.type,
    occurred_at: new Date(row.occurred_at as string | Date).toISOString(),
    ingested_at: new Date(row.ingested_at as string | Date).toISOString(),
    data: row.data,
  };
}
export async function eventsAfter(org: string, run: string, after: string, limit = 100) {
  return transaction(org, async (tx) =>
    (
      await tx.query('SELECT * FROM run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [
        run,
        after,
        limit,
      ])
    ).rows.map(publicEvent),
  );
}
export async function streamEvents(org: string, run: string, after: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let cursor = after;
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const deadline = Date.now() + 55000;
      try {
        while (!signal.aborted && !closed && Date.now() < deadline) {
          const events = await eventsAfter(org, run, cursor);
          for (const event of events) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequence;
          }
          if (!events.length) controller.enqueue(encoder.encode(': heartbeat\n\n'));
          const state = await transaction(
            org,
            async (tx) =>
              (await tx.query('SELECT status,event_sequence FROM runs WHERE id=$1', [run])).rows[0],
          );
          if (
            state &&
            ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(state.status) &&
            BigInt(cursor) >= BigInt(state.event_sequence)
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, events.length ? 150 : 750));
        }
      } catch {
        if (!signal.aborted && !closed)
          controller.enqueue(encoder.encode('event: transport.error\ndata: {}\n\n'));
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
}
