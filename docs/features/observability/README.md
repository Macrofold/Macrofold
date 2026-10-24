# Execution tracing

Follow an agent run from its request through model calls, tools, and final result. Macrofold can export detailed execution traces to Langfuse, including Jev calls through OpenRouter or TypeSafe, while keeping the tracing backend replaceable.

This is a deployment-level integration. Macrofold Cloud operators configure and control access to their tracing workspace; a Cloud API key does not grant access to that workspace. Self-hosted operators configure their own backend. No change to your app's run requests is needed.

## Enable Langfuse

1. Create workspace API keys in your Langfuse workspace settings. Use the region-specific base URL shown there.
2. Add the following server-only variables to the web application and every execution worker. For local development, use the repository's ignored `.env` file.
3. Restart those processes, then complete a run. Open Langfuse's observations view and filter by `run_id` or `workspace_id` in metadata.

```dotenv
LANGFUSE_PUBLIC_KEY=YOUR_WORKSPACE_PUBLIC_KEY
LANGFUSE_SECRET_KEY=YOUR_WORKSPACE_SECRET_KEY
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
```

All three credentials/URL settings must be present. Use your own HTTPS URL for a self-hosted Langfuse deployment. Set the environment to `staging` or `production` as appropriate; otherwise it defaults to `VERCEL_ENV`, then `development`. `LANGFUSE_RELEASE` optionally identifies the application revision and defaults to `VERCEL_GIT_COMMIT_SHA`.

The expected result is one trace per run, with a separate generation for each model request. Successive conversation turns share a session. Bounded decision steps use the same run trace, and related task runs share a task session. The parent agent observation appears when the run finishes; its children can arrive earlier.

## Find the right work

Every observation carries the dimensions available for that run:

| Filter                                                                | Meaning                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `organization_id`, `user_id`                                          | Owning account and initiating user                                        |
| `workspace_id`, `workspace_name`                                      | Workspace identity and display name                                       |
| `worktree_id`, `worktree_name`                                        | Worktree identity and optional name; API/storage keys remain `worktree_*` |
| `run_id`, `session_id`                                                | Execution and conversation                                                |
| `customer_id`, `customer_binding_id`, `agent_key`                     | Customer-agent integration binding, when that path was used               |
| `agent_id`, `agent_version`, `harness`                                | Native agent preset and runtime                                           |
| `task_id`, `application_namespace`, `actor_id`, `definition_revision` | Explicit-context decision/task identity                                   |
| `deployment_id`, `deployment_revision_id`, `inference_protocol`       | Admitted custom-model service, immutable revision and native protocol     |
| `provider`, `model`, `billing_mode`, `client_type`                    | Model route, billing and caller category                                  |

IDs are metadata, not a proliferation of tags. Tags group common dimensions: `kind:inference`, `provider:openrouter`, `billing:managed`, `harness:codex`, `client:api`, and `integration:customer-agents`, for example. Unknown or inapplicable dimensions are omitted. An explicit decision actor is recorded as `actor_id`; it is not assumed to be a customer-agent binding.

Langfuse user/session keys include tenant context where needed. These labels help filter observations; they do not authorize access. Restrict access to the tracing workspace separately from Macrofold's customer API.

## Understand usage and billing

Each generation includes model, timing, input/output token usage, cache usage when reported, and its Macrofold charge in USD. Missing usage remains unknown instead of being presented as zero. Input, cached-input and cache-write categories are disjoint to avoid counting the same tokens twice.

Billing metadata distinguishes `charged_micro_usd`, `budget_cost_micro_usd`, the reserved ceiling, reported cost, provisional settlement, and bound breaches. Frozen retail/provider rate cards are included when available. `provider_cost_micro_usd` is a separately labeled estimate from known provider rates, not an invoice. Its `provider_cost_status` describes that rate-card estimate only; it is `unavailable` without an estimate.

Provider-reported amounts are separate metadata, available on each generation and in content-free application logs:

| Metadata                        | Meaning                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `provider_reported_cost_usd`    | Provider-reported account charge, preserving sub-micro-dollar precision; unknown is null internally and omitted by Langfuse |
| `provider_reported_cost_status` | `reported` or `unavailable`; a reported zero is distinct from unknown                                                       |
| `upstream_inference_cost_usd`   | OpenRouter's separately reported upstream inference cost, omitted when unknown; do not add it to the account charge         |

OpenRouter's completed JSON/streaming usage supplies these values for native agents and direct inference/decision calls. Missing or invalid amounts remain unknown, including interrupted requests without reported cost. Direct OpenAI/Anthropic usage does not report a dollar amount, so rate-card estimates and reported amounts remain distinct. No additional provider request or trace-network wait is added. Historical traces are not backfilled.

Managed custom-model generations record the admitted deployment/revision/protocol without another metadata lookup. Their request charge remains zero under the initial BYOK policy; GPU startup/idle/execution costs belong to deployment resource/time accounting, not invented per-token request prices.

BYOK model generations have a zero Macrofold model charge in Langfuse's native cost field; their provider-reported cost, estimate and budget consumption remain separate. To report BYOK provider expense, filter **generation** observations by `billing_mode=byok`, sum known `provider_reported_cost_usd` values, and report the count with `provider_reported_cost_status=unavailable` separately. Use Langfuse's native total cost for Macrofold charges. Do not sum parent/billing-event copies of metadata with generations. Connector fees and sandbox compute are separate observations. Parent run totals are metadata only, so summing observation costs does not count the same charge twice. Langfuse is diagnostic: Macrofold's [billing ledger](../billing/README.md) and durable run receipts remain authoritative.

## Content and operating limits

Input/output capture is enabled with the integration. Meaningful requests, responses, tool arguments/results and retrieved context go to your private tracing backend. General application logs contain IDs, timings, usage and billing fields, not prompt/response bodies. Known credential fields, tokens, opaque reasoning/signatures, signed URL credentials and inline media bytes are redacted or omitted. This is not general-purpose PII detection; review backend access and retention for your data.

Set `TRACING_CAPTURE_CONTENT=false` to retain metadata, timing, usage and costs without preparing or retaining input/output bodies. Native streams still record first-output timing without retaining frames; decision traces avoid request-only decryption and optional content-retention checks. Set `TRACING_ENABLED=false` to disable attribution lookup, capture and export entirely. These process-level settings are fixed at startup: restart the web application and every worker after changing them. Neither setting changes execution, billing or existing run-history retention. Exported data has its own Langfuse retention; deleting a Macrofold run does not delete the external trace automatically.

Trace export runs in background batches. Requests/streams and execution phases do not wait for Langfuse; serverless lifecycle hooks keep pending exports alive after the response, and graceful worker shutdown drains them. Export timeouts or failures do not fail an agent run. Enabled tracing still has bounded metadata lookup and observation processing costs. Full-content mode additionally performs bounded capture, redaction and serialization; metadata mode skips that optional content work at its producers, before any backend sees it.

Capture is bounded to 1 MiB per input, output or metadata payload, with explicit truncation markers. It does not upload images/documents or expose private model reasoning. There is no sampling, but bounded queues may omit diagnostics during overload/outages or an abrupt process crash. Immediate inference also admits optional full-input capture before retaining its background closure (16 captures / 32 MiB encoded input plus sealed-response bytes per process); without a retained host callback it is omitted. Full content is exported only after a current retention check, with no second input-history store; compact generation cost/usage metadata is emitted when full capture is unavailable. Final results and billing never depend on this capture. Export failure never retries a model/tool action. There is no new trace database or durable trace-export queue.

For implementation boundaries, replacement guidance and diagnostic codes, see [implementation](implementation.md). Contributor acceptance and unverified deployment behavior are recorded separately in [verification](verification.md).

For optional content-free API and worker performance captures, see [performance profiling](performance.md).
