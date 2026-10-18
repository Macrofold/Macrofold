import './config';
import { LangfuseTraceSink } from '../../providers/src/langfuse';
import type { TraceObservation, TraceSink } from './trace';
import { startInferenceTiming } from './inference-timing';

let sink: TraceSink | undefined;
let initialized = false;
type TracePolicy = Readonly<{ enabled: boolean; captureContent: boolean }>;
let policy: TracePolicy | undefined;
let captureContent = true;
/** Composition may select another diagnostics backend before serving requests.
 * This also lets qualification exercise the real SDK with an offline exporter. */
export function configureTraceSink(target: TraceSink, options: { captureContent?: boolean } = {}) {
  if (initialized || policy) throw new Error('Tracing has already been configured.');
  sink = target;
  captureContent = options.captureContent ?? true;
  initialized = true;
}
/** Explicit disable wins over credentials, especially in disposable test fixtures. */
export function tracePolicy(): TracePolicy {
  return (policy ??= Object.freeze({
    enabled:
      process.env.TRACING_ENABLED !== 'false' &&
      (Boolean(sink) ||
        Boolean(
          process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL,
        )),
    captureContent: captureContent && process.env.TRACING_CAPTURE_CONTENT !== 'false',
  }));
}
export function tracingEnabled() {
  return tracePolicy().enabled;
}
/** Producer policy avoids preparing content that a backend would discard. */
export function tracingContentEnabled() {
  const current = tracePolicy();
  return current.enabled && current.captureContent;
}
/** Prepare configured telemetry during host readiness, without emitting a span
 * or contacting its backend. Other hosts retain lazy first-observation setup. */
export function initializeTracing() {
  if (!tracingEnabled()) return;
  if (!initialized) {
    initialized = true;
    const stopInitialization = startInferenceTiming('trace.initialize');
    try {
      sink = new LangfuseTraceSink({ capture: tracingContentEnabled() });
    } catch {
      traceDiagnostic('tracing_configuration_failed');
    } finally {
      stopInitialization();
    }
  }
}
export function traceDiagnostic(code: string) {
  // Never print exporter exceptions: HTTP errors can contain auth or payloads.
  console.warn(JSON.stringify({ component: 'tracing', code }));
}
export function recordTrace(observation: TraceObservation) {
  try {
    initializeTracing();
    const target = tracingEnabled() ? sink : undefined;
    if (!target) return;
    const stopRecording = startInferenceTiming('trace.record');
    try {
      // Copy only allowed fields: spreading or destructuring input/output would
      // still evaluate content getters in metadata mode, including custom sinks.
      target.record(
        tracingContentEnabled()
          ? observation
          : {
              context: observation.context,
              id: observation.id,
              name: observation.name,
              type: observation.type,
              startedAt: observation.startedAt,
              endedAt: observation.endedAt,
              metadata: observation.metadata,
              level: observation.level,
              model: observation.model,
              usage: observation.usage,
              chargedMicroUsd: observation.chargedMicroUsd,
              firstOutputAt: observation.firstOutputAt,
            },
      );
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
          provider_reported_cost_usd: m?.provider_reported_cost_usd,
          provider_reported_cost_status: m?.provider_reported_cost_status,
          upstream_inference_cost_usd: m?.upstream_inference_cost_usd,
          provisional: m?.provisional,
          level: observation.level || 'DEFAULT',
        }),
      );
    } finally {
      stopRecording();
    }
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
