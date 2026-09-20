import { afterCommit, type Tx } from '../../db';
import type { RunRow } from './runs';
import type { RunEventRow } from './events';
import type { TraceContext } from './trace';
import { recordTrace, tracingEnabled } from './tracing';

/** Tenant-scoped lookup; external customer IDs are labels, never authority. */
export async function runTraceContext(tx: Tx, run: RunRow): Promise<TraceContext | undefined> {
  if (!tracingEnabled()) return;
  const native = run.kind === 'native_agent';
  const row = run.workspace_id ? (
    await tx.query<{
      workspace_name: string;
      worktree_name: string | null;
      customer_id: string | null;
      customer_binding_id: string | null;
      agent_key: string | null;
    }>(
      `SELECT p.data->>'name' AS workspace_name,w.data->>'name' AS worktree_name,
     b.customer_id,b.id AS customer_binding_id,b.agent_key
     FROM workspaces p LEFT JOIN worktrees w ON w.id=$2
     LEFT JOIN customer_agent_bindings b ON b.workspace_id=p.id AND b.worktree_id=$2 AND b.agent_id=$3 AND b.owner_user_id=$4
     WHERE p.id=$1`,
      [run.workspace_id, run.worktree_id, native ? run.config.agent_id : null, run.config.user_id],
    )
  ).rows[0] : undefined;
  return {
    organization_id: run.organization_id,
    run_id: run.id,
    workspace_id: run.workspace_id,
    worktree_id: run.worktree_id,
    session_id: run.session_id,
    user_id: run.config.user_id,
    workspace_name: row?.workspace_name,
    worktree_name: row?.worktree_name ?? undefined,
    customer_id: row?.customer_id ?? undefined,
    customer_binding_id: row?.customer_binding_id ?? undefined,
    agent_key: row?.agent_key ?? undefined,
    run_kind: run.kind,
    model: run.config.model,
    provider: run.config.rate_card?.provider,
    billing_mode: run.config.billing_mode,
    client_type: run.config.client_type,
    ...(run.kind === 'native_agent'
      ? {
          harness: run.config.harness,
          agent_id: run.config.agent_id,
          agent_version: run.config.agent_version,
        }
      : {
          task_id: run.config.task_id,
          application_namespace: run.config.context.application_namespace,
          actor_id: run.config.context.audience.id,
          definition_revision: run.config.definition.revision,
        }),
  };
}
export function tracedRunEvent(type: string) {
  return (
    type.startsWith('run.') ||
    type === 'runtime.started' ||
    type.startsWith('tool.') ||
    type === 'input.requested' ||
    type === 'input.received' ||
    type === 'metering.review_required'
  );
}
export async function traceRunEvent(tx: Tx, run: RunRow, event: RunEventRow) {
  if (
    event.type === 'tool.started' ||
    (event.type === 'tool.completed' && event.data.name === 'read_context')
  )
    return;
  const context = await runTraceContext(tx, run);
  if (!context) return;
  const done = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status);
  if (event.type === 'tool.completed') {
    const callId = typeof event.data.tool_call_id === 'string' ? event.data.tool_call_id : undefined;
    const start = callId
      ? (
          await tx.query<RunEventRow>(
            "SELECT * FROM run_events WHERE run_id=$1 AND type='tool.started' AND data->>'tool_call_id'=$2 ORDER BY sequence DESC LIMIT 1",
            [run.id, callId],
          )
        ).rows[0]
      : undefined;
    const fee = callId
      ? (
          await tx.query<{ cost_micro_usd: string; status: string }>(
            'SELECT cost_micro_usd,status FROM tool_invocations WHERE run_id=$1 AND id::text=$2',
            [run.id, callId],
          )
        ).rows[0]
      : undefined;
    afterCommit(tx, () =>
      recordTrace({
        context,
        id: `tool:${callId || event.id}`,
        name: `tool.${start?.data.name || event.data.name || 'execute'}`,
        type: 'tool',
        startedAt: start?.occurred_at || event.occurred_at,
        endedAt: event.occurred_at,
        input: start?.data.arguments,
        output: event.data.result ?? event.data,
        metadata: {
          tool_call_id: callId,
          connection_id: start?.data.connection_id,
          charged_micro_usd: fee?.cost_micro_usd,
          outcome: fee?.status,
          source: fee ? 'connector_broker' : 'native_harness',
        },
        // Tool cost is distinct from model cost and included in trace aggregation.
        chargedMicroUsd: fee?.cost_micro_usd,
        level: event.data.is_error || event.data.isError ? 'ERROR' : 'DEFAULT',
      }),
    );
    return;
  }
  if (done && event.type === `run.${run.status}`) {
    afterCommit(tx, () =>
      recordTrace({
        context,
        id: 'run',
        name: `run.${run.kind}`,
        type: 'agent',
        startedAt: run.created_at,
        endedAt: run.completed_at || event.occurred_at,
        input:
          run.kind === 'native_agent'
            ? { prompt: run.config.prompt, instructions: run.config.instructions }
            : { input: run.config.input, context: run.config.context, definition: run.config.definition },
        output: run.result,
        metadata: {
          status: run.status,
          reserved_micro_usd: run.reservation_micro_usd,
          charged_micro_usd: run.cost_micro_usd,
          queue_ms: run.started_at ? run.started_at.getTime() - run.created_at.getTime() : null,
          phase_timings: run.execution_binding?.phaseTimings,
        },
        level: run.status === 'failed' || run.status === 'timed_out' ? 'ERROR' : 'DEFAULT',
      }),
    );
  }
  // Deltas remain in the existing replay stream. Generations contain complete
  // model responses; sending each token as an observation would obscure them.
  afterCommit(tx, () =>
    recordTrace({
      context,
      id: event.id,
      name: event.type,
      type: 'event',
      startedAt: event.occurred_at,
      endedAt: event.occurred_at,
      output: event.data,
      metadata: { event_sequence: event.sequence },
    }),
  );
}
