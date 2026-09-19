import { createHash } from 'node:crypto';
import { ROOT_CONTEXT, trace, TraceFlags, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createObservationAttributes } from '@langfuse/tracing';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { configureGlobalLogger, LogLevel, setLangfuseTraceIdInBaggage } from '@langfuse/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { TraceObservation, TraceSink } from '../../core/src/trace';
import { traceContent } from './trace-content';

export function traceIdentity(organization: string, run: string, observation = 'run') {
  const hash = (value: string, size: number) =>
    createHash('sha256').update(value).digest('hex').slice(0, size);
  return {
    traceId: hash(`run:${organization}:${run}`, 32),
    spanId: hash(`observation:${organization}:${run}:${observation}`, 16),
  };
}

/** Official SDK attribute mapping and OTLP API export, isolated from Next's OTel
 * provider. Completed spans avoid keeping a process alive for a durable run. */
export class LangfuseTraceSink implements TraceSink {
  private readonly provider: BasicTracerProvider;
  private identity = { traceId: '', spanId: '' };
  private readonly capture: boolean;
  private readonly maxBytes: number;
  private pending = 0;
  constructor(options: { exporter?: SpanExporter; capture?: boolean; maxBytes?: number } = {}) {
    const baseUrl = process.env.LANGFUSE_BASE_URL;
    if (!options.exporter && (!baseUrl || new URL(baseUrl).protocol !== 'https:'))
      throw new Error('Langfuse requires an explicit HTTPS base URL.');
    this.capture = options.capture ?? process.env.TRACING_CAPTURE_CONTENT !== 'false';
    this.maxBytes = options.maxBytes ?? 1024 * 1024;
    // SDK debug/error objects may contain span bodies or HTTP credentials. Our
    // exporter reports fixed diagnostic codes instead, even if SDK debug is set.
    configureGlobalLogger({ level: LogLevel.NONE });
    const upstream =
      options.exporter ||
      new OTLPTraceExporter({
        url: `${baseUrl}/api/public/otel/v1/traces`,
        timeoutMillis: 3000,
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64')}`,
          'x-langfuse-ingestion-version': '4',
        },
      });
    const exporter: SpanExporter = {
      export: (spans, callback) =>
        upstream.export(spans, (result) => {
          this.pending = Math.max(0, this.pending - spans.length);
          if (result.code !== 0)
            console.warn(
              JSON.stringify({ component: 'tracing', code: 'trace_export_failed', count: spans.length }),
            );
          callback({ code: result.code });
        }),
      shutdown: () => upstream.shutdown(),
    };
    const processor = new LangfuseSpanProcessor({
      exporter,
      baseUrl,
      timeout: 3,
      flushAt: 16,
      flushInterval: 1,
      mediaUploadEnabled: false,
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || process.env.VERCEL_ENV || 'development',
      release: process.env.LANGFUSE_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
      additionalHeaders: { 'x-langfuse-ingestion-version': '4' },
      shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === 'platform.tracing',
    });
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'platform.execution' }),
      spanProcessors: [processor],
      // startSpan is synchronous. Only this private provider reads these IDs;
      // every record sets both, so concurrent requests cannot inherit context.
      idGenerator: {
        generateTraceId: () => this.identity.traceId,
        generateSpanId: () => this.identity.spanId,
      },
    });
  }
  record(observation: TraceObservation) {
    // Cap concurrent SDK work below its 2,048-span internal queue. Observability
    // must not exhaust worker memory when its backend is slow or unavailable.
    if (this.pending >= 64) {
      console.warn(JSON.stringify({ component: 'tracing', code: 'trace_queue_full' }));
      return;
    }
    const { context: c, metadata = {}, usage } = observation;
    this.identity = traceIdentity(c.organization_id, c.run_id, observation.id);
    const root = traceIdentity(c.organization_id, c.run_id);
    const tags = [
      `kind:${c.run_kind}`,
      `billing:${c.billing_mode}`,
      ...(c.provider ? [`provider:${c.provider}`] : []),
      ...(c.harness ? [`harness:${c.harness}`] : []),
      ...(c.client_type ? [`client:${c.client_type}`] : []),
      ...(c.customer_binding_id ? ['integration:customer-agents'] : []),
    ];
    const attributes = createObservationAttributes(observation.type, {
      input: traceContent(observation.input, this.maxBytes, this.capture),
      output: traceContent(observation.output, this.maxBytes, this.capture),
      metadata: traceContent({ ...c, ...metadata }, this.maxBytes) as Record<string, unknown>,
      level: observation.level,
      model: observation.model,
      completionStartTime: observation.firstOutputAt,
      // Cache categories are disjoint; input already includes both cache subsets.
      usageDetails: usage?.complete
        ? {
            input: Math.max(0, usage.input - usage.cached - usage.cacheWrite),
            output: usage.output,
            input_cached: usage.cached,
            input_cache_write: usage.cacheWrite,
          }
        : undefined,
      costDetails:
        observation.chargedMicroUsd === undefined
          ? undefined
          : { total: Number(observation.chargedMicroUsd) / 1_000_000 },
    });
    attributes['langfuse.user.id'] = c.customer_id
      ? `${c.organization_id}:${c.user_id}:${c.customer_id}`
      : c.user_id;
    if (c.session_id || c.task_id)
      attributes['langfuse.session.id'] = `${c.organization_id}:${c.session_id || c.task_id}`;
    attributes['langfuse.trace.name'] = `run.${c.run_kind}`;
    attributes['langfuse.trace.tags'] = tags;
    // Query dimensions must be present on EVERY observation for the v2 API.
    for (const [key, value] of Object.entries(c))
      if (value !== undefined && value !== null) attributes[`langfuse.trace.metadata.${key}`] = String(value);
    const parent =
      observation.id === 'run'
        ? ROOT_CONTEXT
        : setLangfuseTraceIdInBaggage(
            trace.setSpanContext(ROOT_CONTEXT, { ...root, traceFlags: TraceFlags.SAMPLED, isRemote: true }),
            root.traceId,
          );
    const span = this.provider
      .getTracer('platform.tracing')
      .startSpan(observation.name, { startTime: observation.startedAt, attributes }, parent);
    if (observation.level === 'ERROR') span.setStatus({ code: SpanStatusCode.ERROR });
    this.pending++;
    span.end(observation.endedAt);
  }
  flush() {
    return this.provider.forceFlush();
  }
  shutdown() {
    return this.provider.shutdown();
  }
}
