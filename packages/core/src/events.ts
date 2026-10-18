import { afterCommit, transaction, transactionIdentity, queryGroup, type Tx } from '../../db';
import type { QueryConfig, QueryResult } from 'pg';
import { canonical, id } from './crypto';
import { assert } from './errors';
import {
  enqueueWebhookBatch,
  webhookEligibilityQuery,
  type WebhookEvent,
  type WebhookInput,
  type WebhookSelection,
} from './webhooks';
import type { RunRow } from './runs';
import { runTraceContext, traceRunEvent, tracedRunEvent } from './run-tracing';
import { tracingEnabled } from './tracing';
import { runEventObserver } from './run-event-observer';
import { wakeParentTask } from './decision-task-wakes';
import { runEventChannel } from './run-event-notifications';

export type EventInput = {
  type: string;
  data: Record<string, unknown>;
  producer?: { id: string; sequence: number };
};
type ProducedEventRow = RunEventRow & { producer_id: string | null; producer_sequence: string | null };
type BatchOptions = { currentRun?: RunRow; execution?: { claim: string; offset: number } };

const preparedEventAppend = Symbol('preparedEventAppend');
export type PreparedEventAppend = { readonly [preparedEventAppend]: true };
type PreparedEventState = {
  tx: Tx;
  transaction: object;
  org: string;
  runId: string;
  events: readonly EventInput[];
  options: BatchOptions;
  unique: (EventInput & { id: string; ordinal: number })[];
  stored: Map<string, ProducedEventRow>;
  statements: QueryConfig[];
  webhookInputs?: WebhookInput[];
  consumed: boolean;
  finished?: boolean;
};
const eventAppends = new WeakMap<PreparedEventAppend, PreparedEventState>();
function identity(producer: NonNullable<EventInput['producer']>) {
  return JSON.stringify([producer.id, producer.sequence]);
}
/** The shared owner prepares producer deduplication and append/effect identities.
 * Coordinators may compose its statements only when no intervening policy decision is needed. */
export async function emitBatch(
  tx: Tx,
  org: string,
  runId: string,
  events: readonly EventInput[],
  options: BatchOptions = {},
) {
  const plan = await prepareEventAppend(tx, org, runId, events, options);
  const statements = eventAppendQueries(tx, plan);
  return finishEventAppend(tx, plan, statements.length ? await queryGroup(tx, statements) : []);
}
/** One publication owner for individual events and bounded native/model pages.
 * Producer identity, public sequence allocation and the source cursor commit
 * together; a lost acknowledgement can safely repeat this exact page. */
export async function prepareEventAppend(
  tx: Tx,
  org: string,
  runId: string,
  events: readonly EventInput[],
  options: BatchOptions = {},
) {
  assert(
    !options.currentRun || (options.currentRun.id === runId && options.currentRun.organization_id === org),
    500,
    'event_run_mismatch',
    'The event must describe the current Run.',
  );
  const produced = events.filter((event) => event.producer);
  const stored = new Map<string, ProducedEventRow>();
  if (produced.length) {
    const [locked, rows] = await queryGroup<ProducedEventRow>(tx, [
      {
        text: `SELECT id FROM runs WHERE id=$1 AND ($2::text IS NULL OR execution_binding->>'lock'=$2) FOR UPDATE`,
        values: [runId, options.execution?.claim ?? null],
      },
      {
        text: `SELECT e.* FROM run_events e JOIN jsonb_to_recordset($2::jsonb)
        AS p(id text,sequence bigint) ON e.producer_id=p.id AND e.producer_sequence=p.sequence WHERE e.run_id=$1`,
        values: [runId, JSON.stringify(produced.map((event) => event.producer))],
      },
    ]);
    assert(locked.rowCount, 409, 'lease_lost', 'Event publication no longer owns this Run.');
    for (const row of rows.rows) {
      assert(
        row.producer_id !== null,
        500,
        'invalid_event_identity',
        'A stored producer event is missing its identity.',
      );
      stored.set(identity({ id: row.producer_id, sequence: Number(row.producer_sequence) }), row);
    }
  }
  const unique: (EventInput & { id: string; ordinal: number })[] = [];
  const seen = new Map<string, EventInput>();
  for (const event of events) {
    if (event.producer) {
      assert(
        Number.isSafeInteger(event.producer.sequence) && event.producer.sequence >= 0,
        500,
        'invalid_event_sequence',
        'Invalid producer sequence.',
      );
      const key = identity(event.producer),
        prior = stored.get(key) ?? seen.get(key);
      if (prior) {
        assert(
          prior.type === event.type &&
            canonical(JSON.parse(JSON.stringify(prior.data))) ===
              canonical(JSON.parse(JSON.stringify(event.data))),
          409,
          'event_identity_conflict',
          'A producer event identity was reused with different content.',
        );
        continue;
      }
      seen.set(key, event);
    }
    unique.push({ ...event, id: id(), ordinal: unique.length + 1 });
  }
  const statements: QueryConfig[] = [];
  if (unique.length || options.execution)
    statements.push({
      text: `WITH next AS (
      UPDATE runs SET event_sequence=event_sequence+$4::bigint,
        execution_binding=CASE WHEN $5::text IS NULL THEN execution_binding ELSE
          jsonb_set(execution_binding,'{eventOffset}',to_jsonb(greatest(coalesce((execution_binding->>'eventOffset')::bigint,0),$6::bigint))) END
      WHERE id=$3 AND ($5::text IS NULL OR execution_binding->>'lock'=$5) RETURNING event_sequence
    ), inserted AS (
      INSERT INTO run_events(id,organization_id,run_id,sequence,type,data,producer_id,producer_sequence)
      SELECT item.id,$2,$3,next.event_sequence-$4::bigint+item.ordinal,item.type,item.data,item.producer_id,item.producer_sequence
      FROM next CROSS JOIN jsonb_to_recordset($1::jsonb)
        AS item(id uuid,ordinal bigint,type text,data jsonb,producer_id text,producer_sequence bigint)
      ORDER BY item.ordinal RETURNING *
    ), notified AS MATERIALIZED (
      SELECT pg_notify('${runEventChannel}',json_build_array($2::text,$3::text)::text) FROM next WHERE $4::bigint>0
    ) SELECT inserted.* FROM inserted CROSS JOIN notified ORDER BY sequence`,
      values: [
        JSON.stringify(
          unique.map((event) => ({
            ...event,
            producer_id: event.producer?.id ?? null,
            producer_sequence: event.producer?.sequence ?? null,
          })),
        ),
        org,
        runId,
        unique.length,
        options.execution?.claim ?? null,
        options.execution?.offset ?? null,
      ],
    });
  const webhookInputs = options.currentRun ? runWebhookInputs(runId, unique, options.currentRun) : undefined;
  if (webhookInputs?.length) statements.push(webhookEligibilityQuery(webhookInputs));
  const plan: PreparedEventAppend = { [preparedEventAppend]: true };
  eventAppends.set(plan, {
    tx,
    transaction: transactionIdentity(tx),
    org,
    runId,
    events,
    options,
    unique,
    stored,
    statements,
    webhookInputs,
    consumed: false,
  });
  return plan;
}
export function eventAppendQueries(tx: Tx, plan: PreparedEventAppend): readonly QueryConfig[] {
  const state = eventAppends.get(plan);
  assert(
    state && state.tx === tx && state.transaction === transactionIdentity(tx) && !state.consumed,
    500,
    'event_append_stale',
    'Prepare event publication in the current transaction.',
  );
  state.consumed = true;
  return state.statements;
}
export async function finishEventAppend(
  tx: Tx,
  plan: PreparedEventAppend,
  results: readonly QueryResult<Record<string, unknown>>[],
) {
  const state = eventAppends.get(plan);
  assert(
    state &&
      state.tx === tx &&
      state.transaction === transactionIdentity(tx) &&
      state.consumed &&
      !state.finished,
    500,
    'event_append_stale',
    'Prepare event publication in the current transaction.',
  );
  state.finished = true;
  const { org, runId, events, options, unique, stored } = state;
  let inserted: ProducedEventRow[] = [];
  if (unique.length || options.execution) {
    const result = results[0];
    assert(
      result?.rowCount === unique.length,
      409,
      'lease_lost',
      'Event publication no longer owns this Run.',
    );
    inserted = result.rows.map((row) => {
      assert(
        typeof row.id === 'string' &&
          typeof row.run_id === 'string' &&
          typeof row.sequence === 'string' &&
          typeof row.type === 'string' &&
          row.occurred_at instanceof Date &&
          row.ingested_at instanceof Date &&
          row.data !== null &&
          typeof row.data === 'object' &&
          !Array.isArray(row.data) &&
          (row.producer_id === null || typeof row.producer_id === 'string') &&
          (row.producer_sequence === null || typeof row.producer_sequence === 'string'),
        500,
        'event_publication_missing',
        'The event publication returned an invalid row.',
      );
      return {
        id: row.id,
        run_id: row.run_id,
        sequence: row.sequence,
        type: row.type,
        occurred_at: row.occurred_at,
        ingested_at: row.ingested_at,
        data: row.data as Record<string, unknown>,
        producer_id: row.producer_id,
        producer_sequence: row.producer_sequence,
      };
    });
    // The zero-event cursor update needs an explicit fence result as well.
    if (!unique.length && options.execution) {
      const current = await tx.query(`SELECT 1 FROM runs WHERE id=$1 AND execution_binding->>'lock'=$2`, [
        runId,
        options.execution.claim,
      ]);
      assert(current.rowCount, 409, 'lease_lost', 'Event publication no longer owns this Run.');
    }
    for (const row of inserted)
      if (row.producer_id !== null)
        stored.set(identity({ id: row.producer_id, sequence: Number(row.producer_sequence) }), row);
  }
  if (inserted.length) {
    const selection = state.webhookInputs?.length
      ? results[1].rows.map((row) => {
          assert(
            typeof row.event_index === 'number' && typeof row.endpoint_id === 'string',
            500,
            'webhook_publication_failed',
            'The selected webhook endpoint is unavailable.',
          );
          return { event_index: row.event_index, endpoint_id: row.endpoint_id };
        })
      : undefined;
    await eventEffects(tx, org, runId, inserted, options.currentRun, selection);
    afterCommit(tx, () => runEventObserver.hint(org, runId));
  }
  let next = 0;
  return events.map((event) => {
    const row = event.producer ? stored.get(identity(event.producer)) : inserted[nextNonProduced()];
    assert(row, 500, 'event_publication_missing', 'An event did not publish its durable identity.');
    return publicEvent(row);
  });
  function nextNonProduced() {
    while (unique[next]?.producer) next++;
    return next++;
  }
}

export async function emit(
  tx: Tx,
  org: string,
  runId: string,
  type: string,
  data: Record<string, unknown>,
  producer?: EventInput['producer'],
  currentRun?: RunRow,
) {
  return (await emitBatch(tx, org, runId, [{ type, data, producer }], { currentRun }))[0];
}
async function eventEffects(
  tx: Tx,
  org: string,
  runId: string,
  rows: RunEventRow[],
  currentRun?: RunRow,
  selection?: readonly WebhookSelection[],
) {
  if (
    rows.some((row) =>
      ['run.succeeded', 'run.failed', 'run.cancelled', 'run.timed_out'].includes(row.type),
    ) &&
    // Request-owned immediate Runs cannot be Task children; queued Tasks use
    // their durable dispatcher owner and still take the shared wake path.
    !(currentRun?.kind === 'inference' && currentRun.config.execution_owner === 'request')
  )
    await wakeParentTask(tx, runId);
  const traced = tracingEnabled() ? rows.filter((row) => tracedRunEvent(row.type)) : [];
  if (traced.length) {
    const run = currentRun ?? (await tx.query<RunRow>('SELECT * FROM runs WHERE id=$1', [runId])).rows[0];
    const context = await runTraceContext(tx, run);
    if (context) for (const row of traced) await traceRunEvent(tx, run, row, context);
  }
  const webhooks = rows.filter((row) => !!runWebhookType(row.type));
  if (!webhooks.length) return;
  const run = currentRun
    ? {
        workspace_id: currentRun.workspace_id,
        worktree_id: currentRun.worktree_id,
        status: currentRun.status,
        webhook_endpoint_ids: currentRun.config.webhook_endpoint_ids,
      }
    : (
        await tx.query<{
          workspace_id: string | null;
          worktree_id: string | null;
          status: string;
          webhook_endpoint_ids: string[] | undefined;
        }>(
          "SELECT workspace_id,worktree_id,status,config->'webhook_endpoint_ids' AS webhook_endpoint_ids FROM runs WHERE id=$1",
          [runId],
        )
      ).rows[0];
  await enqueueWebhookBatch(tx, org, runWebhookInputs(runId, webhooks, run), selection);
}
function runWebhookType(type: string): WebhookEvent | undefined {
  return type === 'run.succeeded'
    ? 'run.completed'
    : type === 'run.failed' || type === 'run.timed_out'
      ? 'run.failed'
      : type === 'run.cancelled'
        ? 'run.cancelled'
        : undefined;
}
function runWebhookInputs(
  runId: string,
  rows: readonly Pick<RunEventRow, 'id' | 'type' | 'data'>[],
  run: Pick<RunRow, 'workspace_id' | 'worktree_id'> & {
    status: string;
    config?: Pick<RunRow['config'], 'webhook_endpoint_ids'>;
    webhook_endpoint_ids?: string[];
  },
): WebhookInput[] {
  return rows.flatMap((row) => {
    const event = runWebhookType(row.type);
    return event
      ? [
          {
            event,
            data: {
              run_id: runId,
              workspace_id: run.workspace_id,
              worktree_id: run.worktree_id,
              status: run.status,
              ...(typeof row.data.code === 'string' ? { failure_code: row.data.code } : {}),
            },
            options: {
              eventId: row.id,
              endpointIds: run.config?.webhook_endpoint_ids ?? run.webhook_endpoint_ids,
              workspaceId: run.workspace_id ?? undefined,
            },
          },
        ]
      : [];
  });
}
export type RunEventRow = {
  id: string;
  run_id: string;
  sequence: string;
  type: string;
  occurred_at: Date;
  ingested_at: Date;
  data: Record<string, unknown>;
};
export function publicEvent(row: RunEventRow) {
  return {
    id: row.id,
    schema_version: 1 as const,
    run_id: row.run_id,
    sequence: String(row.sequence),
    type: row.type,
    occurred_at: new Date(row.occurred_at).toISOString(),
    ingested_at: new Date(row.ingested_at).toISOString(),
    data: row.data,
  };
}
export async function eventsAfter(org: string, run: string, after: string, limit = 100) {
  return transaction(org, async (tx) =>
    (
      await tx.query<RunEventRow>(
        'SELECT * FROM run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',
        [run, after, limit],
      )
    ).rows.map(publicEvent),
  );
}
export async function streamEvents(org: string, run: string, after: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let cursor = after,
    closed = false,
    cancelled = false;
  const observation = runEventObserver.subscribe(org, run);
  const close = () => {
    closed = true;
    observation.dispose();
    signal.removeEventListener('abort', close);
  };
  if (signal.aborted) close();
  else signal.addEventListener('abort', close, { once: true });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!closed) {
          if (!observation.active()) {
            close();
            break;
          }
          const version = observation.version();
          const events = await eventsAfter(org, run, cursor);
          if (closed || !observation.active()) {
            close();
            break;
          }
          for (const event of events) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequence;
          }
          const state = observation.state();
          if (state?.terminal && BigInt(cursor) >= BigInt(state.sequence)) {
            close();
            break;
          }
          // Return after one page, including a partial page, so backpressure
          // controls history reads and committed output is delivered promptly.
          if (events.length) return;
          const changed = await observation.wait(version);
          if (changed === 'closed') {
            close();
            break;
          }
          if (changed === 'heartbeat') {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
            return;
          }
        }
        if (!cancelled) controller.close();
      } catch {
        if (!closed) controller.enqueue(encoder.encode('event: transport.error\ndata: {}\n\n'));
        close();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      close();
    },
  });
}
