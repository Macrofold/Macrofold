# Hosting, scaling and recovery architecture

The exact account, callback, secret and release commands are in [launch guide](18-launch-guide.md). [deployment reference](22-deployment.md) describes both container targets and scheduler portability. This document explains operating decisions, not imaginary deploy commands.

## Default topology

| Component | Initial host | Operational responsibility |
|---|---|---|
| Next.js dashboard/REST/auth/SSE/docs/brokers | Vercel Pro, `iad1` | Git deployment, HTTPS, Function limits, edge abuse protection |
| Durable scheduler | Vercel Workflow + authenticated minutely Cron | Wake bounded steps, repair dispatch and maintenance |
| Isolated agent processes | Vercel Sandbox + private immutable VCR image | One run identity, egress policy, provider quota and recovery snapshots |
| Product/financial state | Neon PostgreSQL 18.6, AWS Ohio (local fixture: 17) | Restricted login/pooling, backups/PITR, capacity |
| Encrypted file content | Private Cloudflare R2 | Bucket policies, staging CORS/lifecycle, independent backups |
| Identity email | Resend | Domain verification and delivery reputation |
| Payments | Stripe | Verified business, prices/portal, signed event delivery |
| Git and tools | GitHub App, direct MCP, optional Composio/Brave | Explicit scope, credentials, provider consent and budgets |

There is no required E2B, Railway, Redis, SeaweedFS, restic, Connect or AI Gateway account. Local development uses Docker PostgreSQL/Mailpit, encrypted local objects and a simulator. The standalone alternative hosts the same web image plus SQL worker on a conventional Node/Docker host, initially still using Vercel Sandbox/R2 in production.

The current Sandbox adapter uses Vercel OIDC. Real execution on a non-Vercel control-plane host still needs the [static-credential adapter work and acceptance](22-deployment.md#alternative-standalone-control-plane); the presence of token/team/project environment fields does not implement that path. This does not change the chosen Vercel-first launch.

## Capacity controls

Per-plan concurrency is 2/10/50 active runs for Starter/Pro/Scale; maximum run windows are 30/60/120 minutes. See the authoritative [plan and scheduler limits](25-scheduling.md). `GLOBAL_CONCURRENT_RUN_LIMIT` defaults to 50 and serializes claims across all schedulers. One workspace has one active writer; queued continuations have an independent ten-message/session cap and one-hour expiry. Run maximum is two hours. These are application controls, not inferred provider entitlements. The private launch worksheet starts with a global cap of **5**. Start below the actual vendor sandbox quota and measure before offering larger concurrent cohorts.

`API_RATE_LIMIT_PER_MINUTE` defaults to 300 per credential/organization. Protect unauthenticated auth/API routes with the hosting platform's edge controls and allowlist expected webhook/runtime paths appropriately. Do not turn an upstream outage into unlimited automatic retries. Unknown external effects require reconciliation. Model bounds, prepaid reservations and provider spending alerts independently limit financial exposure.

Domain database pool is five connections/process, identity three, independent credential refresh two. Functions multiply this ceiling. Use provider pooling, retain transaction-local RLS semantics and test identity search_path compatibility. Keep headroom for migration/recovery/reporting. Operator queries time out after 30 seconds; live streams release connections while waiting. Requests and reports page by indexed cursors. Raw metadata retention is bounded. Large runtime files use chunked object storage, not JSON blobs or 25 MiB Function requests.

The standalone worker defaults to four simultaneous **steps**, with a 750 ms scheduling loop and maintenance every fifteen seconds. Cron and workers claim bounded due work; failed maintenance components do not starve others. Storage/finance claims rotate among organizations. At larger scale, measure scan freshness and queue age, then increase sweeps, worker/Function concurrency and database capacity together. Increasing a provider limit alone does not solve a database bottleneck.

## Measurement and scaling procedure

1. Observe one full representative workload period: requests/errors, incomplete observations, queued-job age, active/persisting runs, database connections, storage scan age and reconciliation health.
2. In provider consoles, record actual sandbox concurrency/quota, Function CPU/memory, Workflow events/data, R2 requests/bytes and invoices. The application reports missing provider telemetry honestly; do not derive it from configured limits.
3. If due jobs exceed two minutes, first inspect blocked jobs, revoked access, persistence failures, DB saturation and provider errors. Avoid scaling a poisoned queue blindly.
4. Increase one constrained component within a declared cost budget. Keep per-tenant caps and prepaid bounds in force. Compare before/after with the same interval/workload and rollback configuration if errors increase.
5. Revisit repository/capture limits before supporting larger data. Git/export work is deliberately bounded; larger maintenance must move behind an isolated-compute adapter and its own acceptance suite.

Local concurrent-burst tests prove correctness of shared funding/capacity/tenant context. They do not establish production p95 latency, thousands of simultaneous customers, provider autoscaling or an SLA. Start with a limited pilot and publish only measured capacity.

## Release and drain

Use additive numbered migrations with the private owner login, then deploy an immutable app revision. Runtime image and native harness versions are separately pinned. Run the free suite and verify staged health/auth/read-only requests. Retain compatible previous app/runtime images and vault keys for active sessions/backups.

Set `RUN_ADMISSION_ENABLED=false` to pause new work while existing runs continue with their already authorized provider access. Disable new account creation separately with `PUBLIC_SIGNUP_ENABLED=false`. Drain or explicitly cancel active work, verify checkpoints and stop the old scheduler before changing topology. `ALLOW_PAID_EXECUTION=false` is an emergency spending gate that also prevents further model/tool calls; it is not a graceful-drain substitute.

Compatible rollback selects the earlier app/image without reverting customer data. Incompatible database changes need a forward fix or a separately coordinated incident restore. Workflow history is not migrated automatically. Never restart an ambiguous native prompt to make a deployment look healthy.

## Incident runbooks

| Incident | First actions / exit evidence |
|---|---|
| Queue/Workflow outage | Pause admission if needed; repair durable dispatch; inspect known VM identity before any new launch |
| Lost launch acknowledgement | Reconnect to the named VM/session and marker; never blindly resubmit the prompt |
| Sandbox loss or capture failure | Preserve recovery snapshot/reference and last verified checkpoint; report loss interval; restore explicitly |
| Database outage | Stop admission; recover database with referenced objects/keys; reconcile external runs, payments and reservations before resuming |
| R2 outage/incomplete graph | Stop destructive collection; preserve VM recovery state; restore object access before publication |
| Lost/rotated key | Recover retained keyring; run dry-run rewrap/restore checks; no decryption is possible without a valid old key |
| Financial drift/unknown usage | Keep spending hold; inspect journals/provider receipts; append authorized correction only after establishing facts |
| Git conflict/protection | Preserve source and remote refs; resolve normally or use a PR; never force push |
| OAuth/App revocation | Block new tools/sync, retain customer work, require explicit reauthorization |
| Webhook outage | Retry durable deliveries; receiver deduplicates business event ID; manual replay changes delivery identity only |
| Storage quota | Preserve reads/recovery; increase explicit prepaid storage budget or delete unneeded history/data |

Backup recovery needs a consistent database point, every referenced object and retained keys. Fourteen-day delayed collection bounds how old a live-bucket database restore can safely be. Longer retention needs an immutable paired object copy. The local restore rehearsal proves database + object + key recovery through authenticated file reads and session continuation; the operator still measures production RPO/RTO and provider restoration behavior.


For the implemented three-tier fair scheduler, migration 024, 24-hour queue deadlines, measured local load evidence and the step-by-step global ceiling procedure, use [execution scheduling and scaling](25-scheduling.md).
