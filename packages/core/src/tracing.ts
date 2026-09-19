import './config';
import { LangfuseTraceSink } from '../../providers/src/langfuse';
import type { TraceObservation, TraceSink } from './trace';

let sink: TraceSink | undefined;
let initialized = false;
/** Explicit disable wins over credentials, especially in disposable test fixtures. */
export function tracingEnabled() {
  return (
    process.env.TRACING_ENABLED !== 'false' &&
    Boolean(
      process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL,
    )
  );
}
function tracing(): TraceSink | undefined {
  if (!tracingEnabled()) return undefined;
  if (!initialized) {
    initialized = true;
    try {
      sink = new LangfuseTraceSink();
    } catch {
      traceDiagnostic('tracing_configuration_failed');
    }
  }
  return sink;
}
export function traceDiagnostic(code: string) {
  // Never print exporter exceptions: HTTP errors can contain auth or payloads.
  console.warn(JSON.stringify({ component: 'tracing', code }));
}
export function recordTrace(observation: TraceObservation) {
  try {
    const target = tracing();
    if (!target) return;
    target.record(observation);
    const { context: c, metadata: m } = observation;
    console.info(
      JSON.stringify({
        component: 'execution',
        observation: observation.name,
        organization_id: c.organization_id,
        workspace_id: c.workspace_id,
        worktree_id: c.worktree_id,
        run_id: c.run_id,
        session_id: c.session_id,
        customer_id: c.customer_id,
        request_id: observation.id,
        model: observation.model,
        billing_mode: c.billing_mode,
        duration_ms: observation.endedAt.getTime() - observation.startedAt.getTime(),
        usage: observation.usage,
        charged_micro_usd: observation.chargedMicroUsd ?? m?.charged_micro_usd,
        budget_cost_micro_usd: m?.budget_cost_micro_usd,
        provider_cost_micro_usd: m?.provider_cost_micro_usd,
        provisional: m?.provisional,
        level: observation.level || 'DEFAULT',
      }),
    );
  } catch {
    traceDiagnostic('trace_record_failed');
  }
}
export async function flushTraces() {
  try {
    await sink?.flush();
  } catch {
    traceDiagnostic('trace_flush_failed');
  }
}
export async function shutdownTracing() {
  try {
    await sink?.shutdown();
  } catch {
    traceDiagnostic('trace_shutdown_failed');
  }
}
