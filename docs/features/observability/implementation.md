# Tracing implementation

The domain emits completed, vendor-neutral observations. A single composition module selects the backend; Langfuse/OTel types do not enter execution policy, provider protocols or billing calculations. No trace tables or migrations are added. Existing run events, encrypted decision receipts, model usage and ledger records retain their recovery/accounting purpose.

## Ownership

| Source                                                                                                                                                                                                                                                           | Responsibility                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [trace.ts](../../../packages/core/src/trace.ts)                                                                                                                                                                                                                  | `TraceContext`, `TraceObservation`, `TraceSink` port                                             |
| [tracing.ts](../../../packages/core/src/tracing.ts)                                                                                                                                                                                                              | Optional configuration, backend composition, content-free application logs and failure isolation |
| [run-tracing.ts](../../../packages/core/src/run-tracing.ts)                                                                                                                                                                                                      | Tenant-scoped identity lookup, lifecycle/tool observations and terminal run root                 |
| [langfuse.ts](../../../packages/providers/src/langfuse.ts)                                                                                                                                                                                                       | Official SDK mapping, deterministic IDs, private OTel provider and OTLP export                   |
| [trace-content.ts](../../../packages/providers/src/trace-content.ts)                                                                                                                                                                                             | Shared export redaction, binary omission and payload bounds                                      |
| [model-output-capture.ts](../../../packages/providers/src/model-output-capture.ts)                                                                                                                                                                               | Bounded streaming capture independent of metering/delivery                                       |
| [model-gateway.ts](../../../packages/core/src/model-gateway.ts)                                                                                                                                                                                                  | One generation per authorized native model request; committed billing diagnostics                |
| [direct-inference.ts](../../../packages/core/src/direct-inference.ts), [inference-engine.ts](../../../packages/core/src/inference-engine.ts), [bounded-decisions.ts](../../../packages/core/src/bounded-decisions.ts)                                            | Immediate/queued decision generations and explicit context retrieval                             |
| [events.ts](../../../packages/core/src/events.ts), [cloud-engine.ts](../../../packages/core/src/cloud-engine.ts)                                                                                                                                                 | Run/tool hooks and separate compute charges                                                      |
| [database transactions](../../../packages/db/index.ts)                                                                                                                                                                                                           | Synchronous `afterCommit` notifications after releasing SQL connections; discard on rollback     |
| [trace-flush.ts](../../../apps/web/lib/trace-flush.ts), [trace-background.ts](../../../apps/web/lib/trace-background.ts), [dispatch.ts](../../../apps/web/lib/dispatch.ts), [Workflow](../../../apps/web/workflows/run.ts), [worker](../../../scripts/worker.ts) | Request/step completion flushing and worker shutdown                                             |

To replace Langfuse, implement `TraceSink` and call `configureTraceSink` once at process composition before serving requests (the default remains Langfuse); leave execution hooks and domain data unchanged. `tracing.ts` resolves one startup policy for built-in and injected sinks. `configureTraceSink(sink, { captureContent: false })` can narrow content collection; explicit environment disable always wins. `tracingContentEnabled()` gates producer work, and `recordTrace` independently strips input/output before every metadata-only sink. Langfuse retains its redaction and size bounds as defense in depth and receives the effective policy from composition. New model transports should use the existing gateway/decision protocol ports, not add another independent tracing or billing calculation. A provider invoked outside these paths needs an explicit observation hook.

## Trace structure and identity

One run is one trace. SHA-256-derived OTel trace/span IDs incorporate the organization, run and durable observation ID. Generations use gateway request or decision invocation IDs; tool observations use their durable call IDs. Recovery therefore reuses identities instead of creating unrelated diagnostic executions. Upstream event producer deduplication remains authoritative. This is not an exactly-once export guarantee.

Generations, tools, context retrievers and lifecycle events are siblings beneath a single `agent` observation. Cross-process child spans carry an explicit parent and Langfuse trace baggage, preventing each serverless process from becoming another logical root. Only the terminal root covers the entire run. No active in-memory span must survive a durable wait. A killed process or unfinished run can leave an incomplete tree.

Decision generations own provider request/response content under the existing capture
limits. Metadata mode emits compact generations directly, without scheduling content jobs,
retaining request-body callbacks, decrypting requests solely for traces or issuing the
optional retention transaction. Native first-output classification is shared with full
frame capture, so metadata timing does not require serializing provider frames. Tool,
context and terminal-root callbacks retain a prepared compact observation; tool-start
queries omit arguments in metadata mode. Immediate full-content export is admitted before retaining its host callback,
bounded by 16 jobs and 32 MiB of encoded input plus sealed response. A current
retention check suppresses delayed content after purge; unavailable capacity or
dependency failure emits compact usage/cost metadata with `content_capture:omitted`.
There is no unused second SQL/object input-history store. Their terminal root links definition/context digests instead of
duplicating that potentially large input. Completion reuses its already locked,
current Run for root tracing; enabling tracing does not download the accepted
context again. Native roots retain their prompt/instructions. Export network I/O
remains asynchronous; capture, redaction and SDK serialization still consume
local CPU and must be included in latency measurements.

Deployment-backed direct inference copies deployment/revision/protocol identity from its admitted immutable target into `TraceContext`. This adds no database or provider read; resource/time hosting expense stays separate from generation charges.

Each observation receives the dimensions and low-cardinality tags in the [guide](README.md). Queries use the owning transaction's tenant authorization; tool output cannot override identity. Names remain stable (`model.generate`, `decision.generate`, `tool.<name>`, `context.read`, `billing.model`, `billing.compute`, `run.<kind>`). Decision normalization failures preserve bounded raw evidence and independently valid usage in the existing encrypted invocation checkpoint; the generation carries normalized outcome and settled charge. Successful native payloads are not duplicated. Direct deltas bypass replay storage; bounded/native deltas retain their existing replay stream. Neither becomes per-token spans.

## Cost ownership

Financial settlement remains in the gateway, tool broker and compute engine. Tracing receives their results; it never authorizes spending or calculates customer charges independently. Only generation/tool/compute observations have additive `costDetails.total`. The terminal root and `billing.model` event carry totals/detail as metadata, avoiding duplicate aggregation. Frozen rate cards explain the calculation; provider estimates are not substituted for customer charges.

A proven uninvoked request records zero. Provider rejection, normalization failure and interruption retain any validated usage and otherwise use explicit provisional liability; an HTTP/network exception alone is not proof of zero upstream cost. A committed decision response is traced after settlement, including evidence-only recovery. Tracing never moves settlement earlier, replays a model call or retries ambiguous side effects.

Provider adapters normalize OpenRouter `usage.cost` and `usage.cost_details.upstream_inference_cost` into optional USD fields on `ModelUsage`. The gateway stores these small accounting facts with the existing `model_usage.usage_details` and returns the same metadata on repeated settlement. Native and direct inference share this path. They never enter `costForUsage`, reservations or ledger amounts. Langfuse `costDetails.total` continues to use only `chargedMicroUsd`; reported costs are metadata with explicit null/unknown status. The existing billing REST fields remain rate-card estimates; reported-cost reporting is available through Langfuse metadata. No API schema, SDK or database migration is required.

Source: [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting). Account charge and upstream inference cost are distinct, potentially overlapping facts; do not add them together or infer missing cost from tokens.

## SDK and process lifecycle

Pinned Langfuse 5.11.1 uses its official attribute mapping and span processor with OTel's HTTP exporter. The endpoint is `/api/public/otel/v1/traces`, with the v4 ingestion header. A private tracer provider and fixed `platform.execution` service name avoid changing Next's global telemetry or exporting unrelated database/framework spans. SDK raw error logging and media uploading are disabled.

Serverless routes register Next `after()` before streaming starts, so flushing occurs after the complete response. Durable Workflow steps and dispatch completion register export promises with Vercel `waitUntil` in `finally`, without awaiting them. This is the same host lifecycle primitive used by the pinned Workflow runtime and avoids relying on Next request async storage inside the separately bundled step. The standalone worker shuts down the exporter after draining execution. Network delivery never gates a response, model result or next execution phase; only graceful process shutdown waits for the bounded exporter. Small bounded capture/serialization and attribution queries still have ordinary local overhead. SQL observers only enqueue diagnostics after a successful commit and connection release. A disabled integration skips attribution lookups/capture; token events never fetch full run configuration for tracing.

The SDK batches 16 observations or one second. HTTP export has a three-second timeout, and at most 64 observations may be outstanding. Input/output/metadata capture each has a 1 MiB limit. Queue overflow, truncation and outage loss are intentional bounds, not durable retry guarantees. Future durable export should be justified by diagnostic-loss requirements rather than putting full customer payloads back into SQL.

Fixed diagnostic codes include `tracing_configuration_failed`, `trace_record_failed`, `trace_export_failed`, `trace_queue_full`, `trace_flush_failed`, `trace_shutdown_failed`, `trace_flush_schedule_failed`, and `commit_observer_failed`. Exceptions are not printed because upstream errors can embed authorization headers or content. Capture removes known credential fields/text tokens, signed URL authentication, opaque reasoning/signatures and inline binary media. It does not promise to discover arbitrary secrets or PII in prose.

## Performance profiling

Execution tracing and content-free performance profiling have separate policy and lifetimes. The [operator guide](performance.md) owns the startup flags, bounds and interpretation. [Performance composition](../../../packages/core/src/performance-composition.ts) wires the shared collector, owned database-pool adapter and bounded JSONL sink once per Node process. API, model/tool, worker, stream and storage owners supply explicit scopes. Optional background work receives copied correlation IDs rather than retaining Request or payload objects. Submission-time tickets prevent driver callbacks and overlapping requests from borrowing another request's attribution.

Disabled profiling installs no collection timers, inspector, subscribers or database wrappers. Enabled profiling expires automatically; sink failures and capacity refusal lose diagnostics rather than customer work. An idle or in-flight output error clears outstanding diagnostic debt once and emits `performance_profile_sink_failed`; late write acknowledgments cannot corrupt its counters. Detaching preserves any newer database wrappers and reports `performance_profile_detach_conflict` once instead of overwriting another instrumentation owner. Hosted stdout can block depending on deployment logging, so the local asynchronous private-file sink is preferable to a slow terminal. No SQL text, parameters, model content or arbitrary labels enter profiles. Required business clocks and financial/recovery writes remain unchanged. The [technical design](../../projects/performance-profiling-tech-design.md) and [execution follow-up](../../projects/execution-efficiency/remaining-optimizations.md) retain the exact acceptance criteria; local measurements do not establish hosted overhead or capacity.

## Verification and deferred work

[Verification](verification.md) distinguishes actual Langfuse API evidence, paid Jev acceptance, isolated fixtures and deployment gaps. Default fixtures blank tracing credentials and explicitly disable export, even when the developer has configured `.env`.

Self-service tenant tracing destinations, external deletion synchronization, a durable exporter, automatic native-harness-internal subagent ancestry, image/media upload, trace sampling controls and provider invoice reconciliation are deferred. These require product/security or accounting decisions. The present integration covers platform-mediated model calls and surfaced harness/tool events; it cannot report calls that bypass the platform gateway.

Official references: [trace quality](https://langfuse.com/docs/observability/best-practices), [SDK](https://langfuse.com/docs/observability/sdk/overview), [usage/cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking), and [OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry).
