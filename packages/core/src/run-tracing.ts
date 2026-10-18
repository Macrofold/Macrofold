import { afterCommit, type Tx } from '../../db';
import type { RunRow, NativeRunRow, InferenceRunRow, RunConfig } from './runs';
import type { RunEventRow } from './events';
import type { TraceContext, TraceObservation } from './trace';
import { recordTrace, tracingEnabled, tracingContentEnabled } from './tracing';

/** Tenant-scoped lookup; external customer IDs are labels, never authority. */
type TraceSource =
  | (Pick<NativeRunRow, 'id' | 'organization_id' | 'workspace_id' | 'worktree_id' | 'session_id' | 'kind'> & {
      config: Pick<
        RunConfig,
        | 'agent_id'
        | 'agent_version'
        | 'user_id'
        | 'model'
        | 'rate_card'
        | 'billing_mode'
        | 'client_type'
        | 'harness'
      >;
    })
  | Pick<
      InferenceRunRow,
      'id' | 'organization_id' | 'workspace_id' | 'worktree_id' | 'session_id' | 'kind' | 'config'
    >;
export async function runTraceContext(tx: Tx, run: TraceSource): Promise<TraceContext | undefined> {
  if (!tracingEnabled()) return;
  const native = run.kind === 'native_agent';
  const row = run.workspace_id
    ? (
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
      ).rows[0]
    : undefined;
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
          application_namespace:
            'payload_kind' in run.config
              ? run.config.application_namespace
              : run.config.context.application_namespace,
          actor_id:
            'payload_kind' in run.config ? run.config.context_audience.id : run.config.context.audience.id,
          definition_revision:
            'payload_kind' in run.config ? run.config.definition_revision : run.config.definition.revision,
        }),
  };
}
export function tracedRunEvent(type: string) {
  return (
    ['run.succeeded', 'run.failed', 'run.cancelled', 'run.timed_out'].includes(type) ||
    type === 'runtime.started' ||
    type === 'runtime.failed' ||
    type.startsWith('tool.') ||
    type === 'input.requested' ||
    type === 'input.received' ||
    type === 'metering.review_required'
  );
}
export async function traceRunEvent(tx: Tx, run: RunRow, event: RunEventRow, preparedContext?: TraceContext) {
  if (!tracingEnabled()) return;
  if (
    event.type === 'tool.started' ||
    (event.type === 'tool.completed' && event.data.name === 'read_context')
  )
    return;
  const context = preparedContext ?? (await runTraceContext(tx, run));
  if (!context) return;
  const content = tracingContentEnabled();
  const done = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status);
  if (event.type === 'tool.completed') {
    const callId = typeof event.data.tool_call_id === 'string' ? event.data.tool_call_id : undefined;
    const start = callId
      ? (
          await tx.query<{
            occurred_at: Date;
            name?: string;
            connection_id?: string;
            arguments?: unknown;
          }>(
            `SELECT occurred_at,data->>'name' AS name,data->>'connection_id' AS connection_id${content ? ",data->'arguments' AS arguments" : ''} FROM run_events WHERE run_id=$1 AND type='tool.started' AND data->>'tool_call_id'=$2 ORDER BY sequence DESC LIMIT 1`,
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
    const observation: TraceObservation = {
      context,
      id: `tool:${callId || event.id}`,
      name: `tool.${start?.name || event.data.name || 'execute'}`,
      type: 'tool',
      startedAt: start?.occurred_at || event.occurred_at,
      endedAt: event.occurred_at,
      input: content ? start?.arguments : undefined,
      output: content ? (event.data.result ?? event.data) : undefined,
      metadata: {
        tool_call_id: callId,
        connection_id: start?.connection_id,
        charged_micro_usd: fee?.cost_micro_usd,
        outcome: fee?.status,
        source: fee ? 'connector_broker' : 'native_harness',
      },
      // Tool cost is distinct from model cost and included in trace aggregation.
      chargedMicroUsd: fee?.cost_micro_usd,
      level: event.data.is_error || event.data.isError ? 'ERROR' : 'DEFAULT',
    };
    afterCommit(tx, () => recordTrace(observation));
    return;
  }
  if (done && event.type === `run.${run.status}`) {
    const output = content ? { ...run.result } : undefined;
    if (run.kind !== 'native_agent' && output?.inference) {
      // The generation owns full response content; root traces retain the
      // receipt/provenance without a second large output serialization/export.
      const { value: _value, ...receipt } = output.inference;
      output.inference = receipt;
    }
    const observation: TraceObservation = {
      context,
      id: 'run',
      name: `run.${run.kind}`,
      type: 'agent',
      startedAt: run.created_at,
      endedAt: run.completed_at || event.occurred_at,
      input: !content
        ? undefined
        : run.kind === 'native_agent'
          ? { prompt: run.config.prompt, instructions: run.config.instructions }
          : {
              // decision.generate owns request content under the capture limits.
              // The root links its input instead of copying it again.
              definition_revision:
                'payload_kind' in run.config
                  ? run.config.definition_revision
                  : run.config.definition.revision,
              definition_digest: run.config.definition_digest,
              context_digest: run.config.context_digest,
            },
      output,
      metadata: {
        status: run.status,
        reserved_micro_usd: run.reservation_micro_usd,
        charged_micro_usd: run.cost_micro_usd,
        queue_ms: run.started_at ? run.started_at.getTime() - run.created_at.getTime() : null,
        phase_timings: run.execution_binding?.phaseTimings,
        ...(run.kind === 'native_agent'
          ? {}
          : {
              definition_revision: context.definition_revision,
              definition_digest: run.config.definition_digest,
              context_digest: run.config.context_digest,
            }),
      },
      level: run.status === 'failed' || run.status === 'timed_out' ? 'ERROR' : 'DEFAULT',
    };
    // Retain a compact completed observation rather than the Run/event closure.
    afterCommit(tx, () => recordTrace(observation));
    return;
  }
  // Deltas remain in the existing replay stream. Generations contain complete
  // model responses; sending each token as an observation would obscure them.
  const observation: TraceObservation = {
    context,
    id: event.id,
    name: event.type,
    level: event.type === 'runtime.failed' ? 'ERROR' : 'DEFAULT',
    type: 'event',
    startedAt: event.occurred_at,
    endedAt: event.occurred_at,
    output: content ? event.data : undefined,
    metadata: { event_sequence: event.sequence },
  };
  afterCommit(tx, () => recordTrace(observation));
}
