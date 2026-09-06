# Growth, usage and autonomous operations

## Facts and definitions

Reports are deterministic PostgreSQL queries, not model-generated estimates. The dashboard, operator REST and management MCP call the same reporting services. Public contract version is 0.9.0; metric definition version is 2. Every report includes from/to, UTC timezone, observed_at, filters, metrics with units/status and missing_sources.

| Fact                             | Meaning / boundaries                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_requests`                   | One HTTP attempt through the public/admin REST dispatcher, including failed authorization/rate limits and retries; route template, method, actor/client, status, duration and request ID |
| `product_events`                 | Committed product mutation or lifecycle event; metadata projection only; idempotent mutation replay does not create another fact                                                         |
| `actor_activity`                 | Successful human product mutations; polling, page impressions, operator-only requests and API service keys are excluded from human usage                                                 |
| `runs`                           | Accepted work with independent execution/persistence/sync state; a retrying HTTP attempt is not a new run                                                                                |
| `model_usage`                    | Gateway/provider attempt identity, exact or provisional input/output tokens, route, funding mode, frozen retail rate                                                                     |
| Credit/financial tables          | Customer funding, expiration, debt, authorized liability and consumption; not fabricated provider invoices                                                                               |
| Maintenance/storage observations | Measured health and byte inventory, with observation timestamps                                                                                                                          |
| `report_snapshots`               | Closed-day observations retained independently from live queries                                                                                                                         |

A request starter row is inserted before handler execution and enriched after authentication; finalization records status/duration. Interrupted observations retain missing status. Logging failures emit only a request ID/code. The REST table does not claim to count image/static assets, OAuth protocol traffic or every MCP JSON-RPC HTTP request; those have separate protocol/access handling. SSE connection duration measures dispatch setup, not the entire stream lifetime. General analytics never includes prompts, request bodies, customer file contents or tokens/credentials.

`human_dau`, `human_wau` and `human_mau` are distinct successful human actors over rolling 1/7/30-day windows ending at `to`, independent of the acquisition interval. Service-key activity is separate and requires a successful request. Authenticated CLI OAuth mutations count as human activity; API-key automation does not. This is an explicit attribution rule, not proof that a human was physically present for every OAuth call.

User totals/new/verified use human identity and current included organization memberships. Historical human counts can change when memberships are removed. Organization activation is its first succeeded non-`fixture-model` run; local simulation does not activate a commercial account. Weekly cohorts use UTC signup weeks, seven-day activation and successful return runs in days 7–14. Denominators include only organizations old enough to observe the full corresponding window. Growth excludes organizations with operator-set `settings.analytics_excluded=true`; usage/financial reports retain all traffic.

## Query and retention policy

Default interval is the last 30 days; a request can span at most 366 days. Usage dimensions include day/hour/organization/model/provider/harness/billing mode. Output is bounded to 1,000 dimensions and reports truncation explicitly. Operator SQL has a 30-second statement timeout; a timeout becomes an actionable bounded-query error. Paged raw request/account lists default to 25 and max 100. Account and project searches happen before pagination. The request table's quick filter explicitly filters loaded rows; REST supports server route/status filters.

Request, product-event and human-activity metadata are retained for 400 days in bounded maintenance batches. Queries reaching beyond retained request/activity facts identify the missing retention source. Run/financial identities have separate accounting retention; detailed customer traces expire at 30/90 days. Operator access audits are immutable to the runtime role and have no automatic purge. The operator must define longer statutory/business retention separately; this product does not claim an arbitrary global compliance policy.

Maintenance creates one report for the previous closed UTC day, using current committed facts at observation time. Snapshots retain growth and usage for two years; they are not rewritten for late records. After an outage, missing prior-day observations remain missing; request live historical queries rather than inventing what was observed during downtime. A weekly report is the same deterministic API with a seven-day interval; it needs no LLM or separate scheduler. `/admin/v1/reports/snapshots` supplies historical JSON downloads.

## Operator surface

The Operations dashboard shows registered users, human activity, active service credentials, verified people, organizations/activation, acquisition bars, mature cohorts, platform request/run/token/charge totals, stored report downloads, infrastructure health and searchable account drilldown. Account detail exposes plan, credits/debt/reservations and usage. Customer content is not available through operator diagnostics. Raw counts and reported cost do not imply that a paid provider run happened in the local fixture environment.

Infrastructure includes active/terminal run counts, due-job age/backlog/exhaustion, provider breakers, database connection usage, financial reconciliation and storage freshness/attention. `execution_enabled` is configuration, not proof of deployment success. Live provider quotas, region capacity and invoices remain explicitly missing: use provider consoles during the pilot. Adding provider readers is an independent adapter extension and must not wake a sandbox as a side effect of an operational read.

Capacity advice cites evidence and proposes investigation. A due-job age over two minutes triggers queue advice; financial drift triggers a hold/reconciliation recommendation. With missing provider capacity the report does not invent an autoscaling number. There is no infrastructure mutation, shell execution, refunds or financial correction endpoint in the management MCP. Operators keep the final decision.

## Management API and MCP

Customer API keys cannot access `/admin/v1` or `/admin/mcp`. Provision a separate operator service client with `scripts/provision-operator.ts`; request a token for each exact resource audience. Default scopes are `metrics:read`, `operations:read`, `accounts:read`. `accounts:pii:read` is an explicit extra grant and `include_contact=true` an explicit read. The dashboard permits only configured verified operator emails. Current client enablement, audience, scopes and membership are checked, not merely a valid signature.

The stateless Streamable HTTP MCP uses the official SDK. [Tool catalog](api/admin-mcp.json) declares schemas, REST mappings and read-only annotations. Tools cover growth, usage, infrastructure, account lists/details, requests, run diagnostics, capacity, operating reports and stored daily reports. Every call uses bounded known queries; arbitrary SQL/filter expressions are not accepted. Tool access is audited with outcome and request ID. REST operator reads record their operation/resource projection.

Suggested agent instruction: read the operating report and growth/usage for the last seven complete UTC days; compare the preceding seven days; state observed timestamps, definition version, missing sources and low-sample limitations; inspect queue or reconciliation evidence; propose changes with expected costs, but execute no infrastructure or customer-data mutation. The reporting tools themselves spend no inference money. Running the operator agent on a model can incur its own costs.

## Optional PostHog

Native reporting works without an analytics vendor. Export requires `POSTHOG_ENABLED=true`, US/EU region, project token, explicit start timestamp and daily event-attempt budget. It is disabled in local mode even with a token present. The SQL outbox claims at most 100 events, consumes budget before network delivery, retries at most eight times and preserves stable event UUID/name/timestamp/actor across retries.

The projection includes only allowlisted names, pseudonymous actor ID/type, organization ID and definition version, with person-profile processing disabled. It never spreads arbitrary event JSON. No browser analytics SDK or session replay is installed. Delivery failure does not affect product mutation or native reports. PostHog deduplication is eventual and downstream destinations may observe duplicates. Operators own the vendor plan, privacy/consent requirements and downstream deletion policy. [Batch capture](https://posthog.com/docs/api/capture), [event identity/deduplication](https://posthog.com/docs/data/events).

## Scaling and operations

The shared global execution ceiling defaults to 50 active runs and is configurable with `GLOBAL_CONCURRENT_RUN_LIMIT`; each plan also has its tenant ceiling. All schedulers take the same capacity lock before changing queued work to provisioning. API rate limit defaults to 300 requests/minute per credential within its organization. Configure hosting-edge abuse controls for unauthenticated traffic; provider quotas are a separate bound.

The portable worker handles four steps concurrently by default, not four total ongoing agents. Maintenance rotates bounded tenant work and isolates task failures so one failing connector cannot starve storage/finance. Increase sweeps before freshness deteriorates, then increase worker/Function/database capacity based on measurements. Production throughput/SLOs require a live load test; the local 32-request/32-reservation burst tests verify concurrency correctness, not a customers-per-second benchmark.

## Execution demand

The existing infrastructure capacity report and read-only management MCP also expose active executions versus the configured ceiling, eligible queued jobs, oldest eligible wait, submission-to-start mean/p95, and per-account wait summaries. These combine current capacity with the requested start-time window. See [scheduling metrics and scaling](25-scheduling.md) for field meanings, fairness limits, and the measured local load profile.
