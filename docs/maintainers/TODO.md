# Engineering TODO

## Native harness tool permissions

- [ ] Expose native harness tool selection through the existing API permissions model and permission adapters, including disabling OpenCode’s built-in `question` tool. Map supported restrictions to each harness’s native configuration so disabled tools and their descriptions are omitted from model requests, not merely discouraged by instructions. Preserve connector and file-access restrictions; report unsupported mappings explicitly. Cover run-level overrides and inherited policy, add focused adapter/API tests, and document copyable request examples.

## Harness prompt mode follow-up

- [ ] Test OpenCode default empty replacement and explicit `harness_prompt_mode: extend`, preserving configured instructions, permissions, tools and warm-session mode changes. Verify outgoing provider messages contain no default coding persona in replacement mode. OpenCode requires a nonempty blank agent prompt to bypass its truthiness fallback. Tests deferred by request.
- [ ] Document the per-run `harness_prompt_mode` API option (replace by default, extend opt-in), its current OpenCode-only support, and remaining harness context/tool/repository messages. Other harness adapters still need individually verified replacement mappings. Update generated public docs and SDK references; documentation deferred by request.

## Shared local environment follow-up

- [ ] Test shared `.env` loading for API, worker and Docker command aliases, including exported-variable precedence and unchanged paid-execution opt-in. Local Docker overrides were merged into `.env`; `.env.docker` and its example were retired. No tests were run at the operator's request.
- [ ] Update local setup/development guides and remove `.env.docker` references. Explain switching `EXECUTION_PROVIDER` in one file, `ORCHESTRATION_BACKEND=poller` for Docker, and restarting both API and worker after configuration changes. Review the simulator-only setup guard for an already-configured Docker developer.
- [ ] Revisit the local single-run global ceiling: retained checkpoint work occupied the sole slot and queued Jev until caller cancellation. Decide an appropriate local capacity explicitly; merging configuration does not change that ceiling or spending authorization.

## Worker stall diagnostics follow-up

- [ ] Test/document the operator-requested dot-path exclusion for new native checkpoints: omit any dot-prefixed path component in both worktree and home, prune hidden directories before capture, and filter at control-plane indexing too. This deliberately excludes `.git` and hidden native conversation state; validate cold-resume behavior and communicate its limitations. Rebuild/publish the runtime image and restart the intended worker to activate both boundaries. Existing checkpoint bytes and already-indexed in-flight uploads are unchanged. Tests and documentation deferred by request.

- [ ] Verify bounded parallel checkpoint upload (four chunks / eight manifests): successful items remain durable, hash/size verification remains enforced, failures drain all in-flight work before lease release, and recovery resumes only unfinished objects. Tests deferred by request. Inspect native home cache/dependency capture separately before excluding any files needed for conversation restoration.

- [ ] Test `WORKER_DIAGNOSTICS=1`: correlated start/wait/complete/failure events, five-second pending progress, timer cleanup, disabled mode, unchanged results/errors, and no secret/content disclosure. Tests and documentation were deferred at the operator's request; this logging change has not been run or typechecked.
- [ ] Exercise the Docker poller with a slow native persistence step plus newly queued inference. Its batch-wide `Promise.allSettled` and awaited maintenance can delay subsequent claims; establish the blocking phase before changing scheduling/cleanup. Preserve leases, capacity and checkpoint guarantees.
- [ ] Diagnose the observed cancelled native run remaining in checkpoint `upload`: use `worker.checkpoint_read.*` versus `worker.checkpoint_store.*` to separate sandbox chunk retrieval from encrypted content storage. The two affected inference runs had no `started_at`, confirming cancellation before provider execution; the exact reason for the upload stall remains unverified. Do not discard recoverable checkpoints or blindly replay provider requests.
- [ ] Document retry/triage: restart the intended local worker with `WORKER_DIAGNOSTICS=1 pnpm worker:docker`, retain its stdout/stderr separately from `pnpm dev:docker`, and correlate `run_id` with `worker.*` events. `worker.inference_provider.started` establishes provider dispatch; `worker.advance.waiting` without it locates pre-provider work, while maintenance/candidates/claim/reschedule waiting events locate other stalls. Existing run API `waiting_reason` and `started_at` distinguish queueing from execution. These diagnostics are independent of Langfuse and do not retry, cancel, or reset work.

This is the central list of unfinished implementation, testing, documentation, and deployment work. Add follow-ups here under the relevant feature instead of creating separate TODO documents. It is not part of the published documentation site's navigation, search index, or Markdown export. A checked-in adapter or a local simulation pass does not close a live deployment check.

Product and architecture proposals are tracked separately in [ranked improvements](../product/improvements.md). The Workflow/Temporal evaluation is conditional on product needs and is not a launch blocker or an approved migration.


## Stateless inference simplification

### Implementation in this change

- Direct `/v1/inferences` requests may omit `workspace_id` and use an account-level API key with `runs:write`.
- No workspace, worktree, or session is created for that request. Billing and execution authority remain account-scoped.
- A supplied workspace is still authorized. Workspace-restricted keys cannot submit or inspect account-scoped runs.
- Migration `042_account_inferences.sql` permits a null inference workspace and includes those runs in scheduling. Native-agent runs still require a workspace.
- Inline definition/context remain part of the current request envelope. Saved references and bounded-agent endpoints retain their existing workspace requirements pending simplification.
- OpenAPI and TypeScript schema declarations were regenerated. No tests, builds, migration application, or user-guide updates were performed at the user's request.

### Implementation TODOs

- [ ] Remove unnecessary saved-input/context-artifact and versioned-definition APIs, persistence, reference resolution, SDK/MCP methods, and UI surfaces. Inventory callers before removal; preserve ordinary uploaded files, generated outputs, billing records, and historical run results.
- [ ] Review the decision-task coordinator for removal separately from basic inference execution. Do not remove native runs, scheduling, cancellation, or accounting safeguards.
- [ ] Simplify the inline request envelope around caller-supplied model, input, instructions/schema, and limits; remove application-namespace/audience conventions that are unnecessary for stateless calls.
- [ ] Regenerate remaining language clients and rebuild distributed TypeScript packages from the updated contract.
- [ ] Apply migration 042 through the normal migration workflow after the parent task's terminology migration 041. Coordinate deployment; do not run new admission code against the old NOT NULL constraint.

### Testing TODOs — not run

- [ ] Unrestricted API key + inline inference without workspace: submit, schedule, execute, retrieve/stream/cancel, and inspect itemized billing and tracing.
- [ ] Explicit authorized workspace still works with an unrestricted key.
- [ ] Wrong scopes, revoked/expired keys, foreign accounts, and workspace-restricted keys attempting account-level runs are denied at admission and subsequent reads/dispatch.
- [ ] Confirm budgets, reservations, settlement, idempotency, and uncertain-provider handling remain unchanged.
- [ ] Rehearse migration with existing native/inference records; ensure native workspace constraints and reporting views remain correct.
- [ ] Check types, API response validation, SDKs, MCP, and dashboard handling of null workspace IDs. Test saved-reference rejection when no workspace is provided until that feature is removed.

### Documentation TODOs

- [ ] Update inference quickstart and examples to use the account API key without a workspace.
- [ ] Remove mandatory single-workspace-key instructions from public guides, MCP instructions, and agent onboarding prompts.
- [ ] Explain optional workspace attribution and account-scoped billing; update migration/deployment guidance and generated documentation after removal scope is settled.

## Reusable sandbox acceptance

- [ ] Apply migration 040, publish the matching runtime image with the control service and current parser dependencies, then deploy API/worker together. Configure Render owner/key, immutable registry image, plan, explicit compute price and enablement; ensure maintenance runs continuously. Do not treat adapter tests as hosted enablement.
- [ ] Verify bounded Render create, same-server follow-up, asynchronous suspend confirmation, resume/rehydration, destroy/new-disk behavior, process restart fencing and provider invoice reconciliation. Verify no persistent disk, no platform credentials in agent processes, and reviewed network access. Repeat Vercel reuse/expiry recovery on a plan supporting the configured lifetime. See [sandbox acceptance](../features/execution/sandboxes/verification.md).
- [ ] Exercise provider outage and maintenance backlog; confirm active servers do not starve idle cleanup, uncertain deletion retains reservations, and separate compute holds reconcile. Reusable servers currently stop without a provider disk-recovery snapshot when capture fails; accept this limitation before offering that route for valuable uncheckpointed work.

## Execution tracing acceptance

- [ ] Configure private Langfuse project keys and the matching HTTPS region URL on the deployed web application and every worker; set environment/release labels and restart them. Verify real native model requests and conversation continuation, post-stream `after()` flushing, Workflow step export, and graceful worker drain. Local live Jev/API readback does not establish hosted lifecycle behavior.
- [ ] Accept backend access/retention and the separate external deletion policy. Exercise exporter outage/overload without affecting execution or settlement; verify costs once per billable observation and customer/worktree metadata on all children. See [tracing verification](../features/observability/verification.md).

## Startup latency acceptance

- [ ] Accept immediate phase advancement and batched hydration on deployed Workflow and Linux AMD64 compute. Exercise a fresh run and conversation continuation with many small files and multi-chunk files; verify exact restored bytes/session history, one native launch, checkpoint publication and released reservations. Local tests use PostgreSQL 14 and provider fixtures; repeat the configured PostgreSQL 17 CI checks. Docker was unavailable during this change's local verification.
- [ ] Compare queue-to-claim time, internal [phase timings](../features/execution/runtime.md#startup-latency-and-measurement), orchestration gaps, first model response and browser delivery on representative workloads. Check upload/control API counts and failure retries as well as latency. No deployed speedup is established by local fixture timings. Compare the separate [warm sandbox implementation](../features/execution/sandboxes.md) using the same measurements.

## Multimedia release acceptance

- [ ] Build and publish the updated native runtime image (including document-worker and pinned parser dependencies), then deploy the matching API/worker version. Run the [media acceptance commands](../features/media/verification.md) against the release image.
- [ ] Verify a bounded real image/document run and private artifact download on staging for each enabled image combination. Local protocol fixtures do not establish model entitlement, Vercel isolation, deployed PDF playback or actual invoice reconciliation. Exercise a cumulative native image/history request above 4 MiB through encrypted object staging on the hosted gateway; verify the 8 MiB complete-request ceiling, configured storage egress and cleanup. Keep OCR, audio/video analysis and built-in generation deferred as documented.

## Public repository and distribution

- [ ] Resolve the four-field first-run API: harness, provider, model, and prompt. Define workspace creation and funding defaults before changing admission, OpenAPI, generated SDKs, and examples together. Current examples accurately retain the required workspace and billing mode; provider selection comes from the catalog.

- [ ] Enable GitHub private vulnerability reporting. The public repository API currently reports it disabled. Verify the private report flow, then update SECURITY.md with its working direct link.
- [ ] Publish a monitored maintainer contact and community reporting route; update security and conduct policies together. Do not publish a personal email without its owner's approval.
- [ ] Run the required GitHub Actions checks on the release revision and configure repository rulesets. Local passes are not evidence of hosted CI completion.
- [ ] Connect Codecov, enable approved public uploads, and verify TypeScript/Python flags. Add live badges only after real default-branch reports exist.
- [ ] Activate the SDK default origin `https://app.macrofold.ai` in DNS and hosting, then verify authenticated requests and SSE with a synthetic account. Production configuration identifies this canonical origin; its DNS was still pointed at parking during SDK acceptance. See [resource SDK verification](../engineering/testing/sdk-resources.md).
- [ ] Publish versioned CLI/SDK packages and immutable Linux AMD64 runtime artifacts with checksums/provenance. The public guides currently document installation from source. Reserve and verify `macrofold` on npm, PyPI, and crates.io, `dev.macrofold:macrofold` on Maven Central, and version the Go submodule. Verify clean consumer installs and real hosted endpoints for all five SDKs before registry publication.
- [ ] Accept Windows CLI installation, ACL, and terminal behavior before advertising Windows support. Current documented targets are macOS and Linux.

## Development modes and complete agent acceptance

- [x] Verify the rebuilt-image Claude Haiku file-writing retest: the operator confirmed `hello.txt` and its contents after refresh, and supplied a final successful API result with verified persistence and a checkpoint ID. Network-disabled context, capture, restore and permission tests also pass. See [harness acceptance](../engineering/testing/harnesses.md).
- [x] Observe local live continuation updating the existing file and retaining both lines after refresh. Verify local CLI device login, workspace listing and doctor (`ok: true`, zero inference requests). The operator also supplied dashboard evidence of zero reserved funds and aggregate usage charges; see [harness acceptance](../engineering/testing/harnesses.md).
- [ ] Reconcile exact per-run settled cost for the local Haiku tests with provider usage; the dashboard's period aggregate does not identify the cost of an individual run.

- [ ] Accept the pinned Hermes, DeepSeek and Pi adapters on Linux AMD64/Vercel and live managed/BYOK routes under a new approved budget. Verify image startup, long conversations/compaction, external MCP revocation and interruption recovery. See [harness acceptance](../engineering/testing/harnesses.md).

Follow the [implementation brief](../engineering/development-modes.md) and keep the [developer guides](../getting-started/local-development.md) aligned with actual capability.

- [x] Connect local Docker through the existing provider port, SQL worker, gateway and checkpoint lifecycle, with explicit shared profile, budgeted inference and synthetic local compute accounting.
- [x] Pass all six complete API-triggered Docker journeys locally on Linux ARM64 with scripted models, internal-network relay, worker recovery, stream replay, file verification, replacement-container continuation and released reservations.
- [ ] Repeat the complete matrix on Linux AMD64 CI and accept each reviewed live Docker/cloud harness/model route with `pnpm test:journey:live` under separately approved inference/infrastructure budgets. Confirm deployed dashboard freshness, Workflow handoff, checkpoint recovery and sandbox cleanup; see [exact evidence and commands](../engineering/testing/development-modes.md).

## Automated staging and production releases

The staging workflow and release coordinator are implemented with exact-SHA verification, serialization, image scanning, migrations, candidate readiness and promotion gates. [Configure and activate it](../operations/staging-releases.md) only when staging resumes. Production release automation remains deferred; the launch guide is still the production procedure.

- [ ] Configure separate GitHub deployment environments with explicit Vercel team/project identities, environment-scoped secrets, and administrative migration credentials unavailable to the application. Keep deployment credentials out of fork and untrusted pull-request jobs.
- [x] Implement exact-SHA staging release gating, serialization and stale-main checks; failure-path unit tests pass. Hosted activation and acceptance are still required.
- [ ] Rehearse and apply staging migrations, publish the matching native runtime image, deploy staging, then run deployed API/browser acceptance using synthetic accounts. Keep paid native/provider checks explicitly budgeted and distinguish them from free fixtures and metadata checks.
- [ ] Apply only backward-compatible production migrations and prepare that same source revision with production settings and a ready immutable runtime digest. Verify image availability in the production project's registry; do not assume a staging image reference grants cross-project access.
- [ ] Prepare the production deployment with `--prod --skip-domain`, run non-mutating readiness checks against its deployment URL, and promote that exact deployment only after success. This candidate already uses production resources. Keep destructive tests in isolated staging. See [Vercel promotion](https://vercel.com/docs/deployments/promoting-a-deployment).
- [ ] Make promotion automatic after all gates pass, with an optional GitHub environment approval for operators who want it. Configure Vercel Git deployment/domain assignment so it cannot bypass those gates. Separate-project staging acceptance promotes a source revision; it does not move the staging deployment or test credentials into production.
- [ ] Preserve running Workflow/native execution, historical replay, reservations and retained runtime images during release and rollback. Check deployed Workflow/Cron behavior around promotion and supported recovery paths. A domain switch does not roll back schema changes.
- [ ] Test failed verification, failed deployment, failed readiness, interrupted release, overlapping releases and compatible rollback. Record commit, image digest, deployment IDs, target environment and results without secrets. Add an ordered one-time pipeline setup guide and update the launch walkthrough only after the workflow exists and hosted acceptance passes.

## Hosted application

- [ ] Accept the redesigned dashboard on deployed Cloud and self-hosted origins in Safari, Firefox, and physical mobile devices. Verify theme persistence, editor drafts, nested account-menu keyboard/screen-reader navigation, reduced-motion/forced-color focus, hidden-scrollbar scrolling, waiting sheen, clipboard feedback, and copied documentation URLs. Keep the account assistant labeled as a UI preview until a separately reviewed hosted implementation exists; see [dashboard improvements](../product/improvements.md#dashboard).

- [x] Reconcile production auth/vault/cron keys against stored encrypted OAuth credentials. Retained verifier decryption and authenticated introspection pass; the dedicated app project receives only restricted runtime credentials, with migration-owner access retained separately.
- [ ] Complete production account/provider acceptance at `app.macrofold.ai`. Dedicated app deployment, canonical health/login/docs/schema, authenticated maintenance, login-first routing, migrations through 034, scoped R2 write/read/delete and staging-denial checks, CORS/expiry, and production registry publication pass. The production operator is registered with verified email and enabled two-factor authentication; authenticated dashboard and Operations checks pass. A separate production Anthropic workspace has an operator-approved $100 monthly limit and a scoped key deployed; Haiku metadata discovery and application catalog refresh pass without inference. Stripe live onboarding is complete; live Pro/Scale prices and the default Customer Portal are configured. Runtime key creation, the version-pinned production webhook, capability checks, payment settlement and funded production execution remain pending. Registration is enabled at the operator’s request; admission and inference remain disabled. The separate marketing project is preserved.
- [x] Activate the approved Neon Launch plan, set production history to seven days and protect its root branch. Reapplied fixed 0.25-CU limits to existing computes and project defaults after the upgrade raised them. Staging remains paused with cron disabled and compute idle; spending notifications are enabled at a $20 threshold. The $25/month target is not a provider-enforced hard cap.
- [ ] Rotate the production Anthropic runtime key before its October 17, 2026 expiration and verify the replacement before revoking the old key.
- [ ] Rehearse isolated Neon PITR and paired object/key recovery; configured retention and branch protection do not establish a successful recovery. Follow [database safeguards](../operations/neon.md#production-recovery-safeguards).
- [ ] Complete staging acceptance after the healthy redeployment. Isolated database migrations, scoped storage access, verified sender, immutable runtime publication and canonical health now pass. The Stripe test destination is enabled at the canonical origin after signature/reachability probes; the default test Portal is saved and API-verified. Application-created sandbox top-up, actual signed delivery, exact ledger credit and Portal entry now pass; subscription changes and reversal cases remain pending. Follow [project selection](../operations/launch-environment.md#staging-and-vercel-project-selection) and [billing activation](../operations/launch-integrations.md#activate-and-test-staging-billing).
- [ ] Verify deployed Workflow/native execution and supported provider quotas. The accepted staging source and Ready Linux AMD64 runtime are deployed in `iad1`; the enabled minutely Cron has returned HTTP 200 and direct maintenance reports no component failures. Managed Claude Code / Haiku now passes file creation and continuation in separate sandboxes, preserving native history and file contents, verifying checkpoints, settling complete usage and releasing reservations. Both sandboxes were removed. Broader harness, quota, recovery and sustained-capacity checks remain; see [hosted evidence](../engineering/testing/harnesses.md#hosted-claude-acceptance).
- [ ] Complete password-reset email delivery. The staging sender is verified and domain-scoped; operator signup verification and MFA now pass. Production sender acceptance remains separate.
- [ ] Verify independent object/database/key recovery. Staging R2 access/CORS/lifecycle checks, a 5 MiB dashboard upload/download with matching bytes, and application checkpoint restoration now pass. The restore retained the previous state as a recovery point. Independent disaster recovery and production storage acceptance remain pending.
- [ ] Complete hosted password recovery, invitation, positive OAuth refresh/rotation, API-key revocation, organization switching and ownership changes. Verified operator/MFA, CLI device login, identity/workspace/doctor access and server-side logout revocation pass. The CLI empty-response reporting fix passes focused and built-subprocess checks; see [identity acceptance](../engineering/testing/sdk-resources.md#hosted-cli-identity-acceptance).
- [ ] Rehearse backup recovery and document measured RPO/RTO in the private release record. Publish deployment support, privacy, terms, and retention policies.

## Execution, integrations, and money

- [ ] Deploy migration 034 and accept the [Customer agents integration path](../features/customer-agents/implementation.md) with two synthetic app customers and two real accounts of one toolkit. Verify the workspace's registered HTTPS callback, cross-site cookies, authenticated app return, exact account reconnect, permission revocation during consent, provider-subject execution and uncertain-account reconciliation. Local fixtures are not live OAuth acceptance. Migrate the preview only when restarting the intended preview revision.

- [ ] Obtain Anthropic approval for the exact hosted native subscription arrangement, then implement the isolated authentication/controller boundary, generation-fenced credential persistence, quota preflight, budgeted API fallback, continuation and separate usage accounting. Named configurations are implemented; these execution capabilities are not. The previous four-task live authorization is exhausted. See [design and acceptance requirements](../engineering/testing/named-connections.md).
- [ ] Accept two real Composio accounts of the same toolkit through HTTPS consent, pinned execution, rename/reconnect, and upstream revocation. Fixtures verify SDK account-selection shapes but do not establish actual provider account identity or revocation.

- [ ] Accept [model catalog refresh](../features/execution/models.md) in deployed maintenance after migration 029. Verify account entitlements, fresh/stale cache behavior across instances, OpenRouter routing price ceilings and vendor invoice reconciliation with separately approved inference budgets. Free metadata checks do not establish native execution acceptance.
- [ ] Run a bounded native cloud task and continuation for each supported harness/model route. Managed Claude Code / Haiku passes the short staging file and native-session continuation journey. Other native routes remain pending; managed/BYOK gateway protocol tests alone do not establish their Sandbox execution.
- [ ] Complete deployed Composio callback acceptance, a narrowly granted action through the run broker, and live revocation rejection. Local GitHub consent, verified callback activation and one authenticated profile read with a provider log ID pass; see [live acceptance](../engineering/testing/live-integrations.md#github-callback-acceptance).
- [ ] Complete authenticated search-provider, remote/stdio MCP, and GitHub App synchronization/revocation tests using synthetic data and explicit budgets.
- [ ] Complete Stripe subscription Checkout, Portal plan changes/cancellation, recurring invoice, duplicate/out-of-order event, refund/dispute, and reconciliation acceptance before enabling live money flows. Staging top-up settlement and Portal entry pass. Keep the sandbox Managed Payments default disabled for the current standard Checkout integration.
- [ ] Rotate the expiring staging Anthropic key before October 16, 2026; retain workspace isolation and the configured $1 monthly cap. Metadata access and the short managed Claude staging journey pass; broader route and vendor-invoice acceptance remains separate.
- [ ] Verify deployed Workflow handoff, ambiguous launch recovery, maximum persistence workloads, cancellation, and queue expiry without duplicate execution or lost reservations.
- [ ] Verify dashboard SSE flushing, server timeout/reconnect, permission revocation, cross-instance behavior, and connection costs through the deployed edge.
- [ ] Validate sustained fairness and capacity on the deployed topology before increasing limits. The local 11-case suite passes eight/50-slot workloads on a quiet host; it does not validate 50 live sandboxes or deployed provider quotas.

## Marketing publication

- [ ] Set a real public `SUPPORT_EMAIL` for Business/Enterprise sales links. A missing or placeholder address currently yields a working billing-guide link rather than an invented contact. Confirm the Business $1,000/month offer’s concurrency, runtime, storage, retention, credits, and support terms before activation; add reviewed entitlements and Stripe prices before offering self-serve checkout. Enterprise remains individually quoted.

- [x] Build and publish the reviewed marketing release source. [Site verification](../product/marketing/site/verification.md) records browser, calculator, TypeScript, and remaining device/background-tab acceptance.

- [ ] Confirm the hosted API origin and publish SDK packages before replacing source-installation guidance. Journey examples use the SDK’s actual `app.macrofold.ai` default.

- [ ] Check the selected page on the deployed hostname, in Safari/Firefox and on physical mobile devices; local Chromium/accessibility checks do not establish conversion or usability.
- [ ] Review [Swarm Myriad](../product/marketing/swarm-myriad/README.md), the preserved [Swarm Efflorescence](../product/marketing/swarm-efflorescence/README.md), the preserved [Swarm Confluence](../product/marketing/swarm-confluence/README.md), the preserved [Swarm Continuum](../product/marketing/swarm-continuum/README.md), the preserved [Swarm Metamorphosis](../product/marketing/swarm-metamorphosis/README.md), the preserved [Swarm Resonance](../product/marketing/swarm-resonance/README.md), the preserved [Swarm Emergence](../product/marketing/swarm-emergence/README.md), the preserved [organic and polygonal volumes](../product/marketing/swarm-volumes/README.md), the [manifold iteration](../product/marketing/swarm-manifolds/README.md), and the preserved Crossed planes and Compressed folds favorites and earlier [Swarm particle collection](../product/marketing/swarm-motion.md), and select one for the [final site](../product/marketing/site/README.md). Myriad has a compressed H.264 website delivery; verify its loading, frame pacing, encoding quality, pause, and reduced-motion behavior on the deployed hostname and representative phones/Safari. Lossless and editing exports are deferred. Evaluate alpha-video support only if a transparent-video integration is selected.

## Documentation publication

- [x] Complete isolated optimized builds and all six documentation browser/API journeys with dashboard regression. September 11 acceptance verifies mobile/accessibility, clipboard recovery, Python/cURL quickstarts and sequential preset handoff. See [customer-agent foundation evidence](../engineering/testing/customer-agents.md). Hosted/remote onboarding remains below.
- [ ] Exercise the [AI setup prompt](../getting-started/agents.md) from an actual customer application against accessible Cloud and self-hosted documentation. Verify first result, file read, recovery, and handoff; keep secrets outside chat. Consider a distributed skill or docs MCP only if this reveals retrieval friction.

- [ ] Set the intended public `APP_ORIGIN` and `PRODUCT_NAME` at build time, rebuild, and verify canonical URLs, sitemap, raw Markdown, and social metadata on the real hostname.
- [ ] Verify deployment access controls and robots headers on previews. Submit the public sitemap in Search Console after verifying domain ownership; monitor indexing rather than claiming an SEO/AEO guarantee.
- [ ] Review any remaining uncommitted work before release. Publish the code and docs from the same reviewed revision.

## Review follow-ups

- [ ] Complete the third full repository review pass. The recorded work contains one full inventory review and one focused follow-up; acceptance tests do not replace another complete review.

- [ ] Complete draft protection for browser Back/Forward and programmatic navigation, then consider session-local draft recovery. Two-second autosave reduces the unsaved window; current protection covers normal links, unloading, workspace changes, and refresh conflicts, but a Back action before the debounce still needs explicit recovery.

## Ongoing quality

- [x] Patch the DeepSeek/Cordis `js-yaml` advisory and devalue advisory, update runtime OS/npm/Python vulnerable dependencies, and gate complete-image scans in verification. Current production dependency audit and fixable high/critical image scan are clean; native replay fixtures pass. Publish/accept the matching hosted runtime before claiming deployment remediation.

The [coverage gap audit](../engineering/testing/gaps.md) and [mutation record](../engineering/testing/mutation.md) own detailed test debt. Remaining targets include authentication recovery branches, persistence failures, cloud execution policy, and surviving meaningful mutants. No exclusions or superficial assertions should replace those checks.

Live provider quotas/invoices, enterprise SSO/SCIM, arbitrary custom runtime images, a raw remote desktop/PTY, cross-harness conversation migration, and autonomous infrastructure mutation are outside the current product scope. They are not represented as working features in public guides.

Use the [release checklist](../operations/pre-deployment.md) to record each acceptance result with its revision, environment, expected/observed behavior, cost, and evidence location.

## Trigger release acceptance

Complete the [live Slack and cloud scheduling checks](../engineering/testing/triggers.md#remaining-live-acceptance). Measure callback latency, maintenance throughput and retained receipt growth before offering a delivery or start-time SLA.

## Agent permission acceptance

- [ ] Validate guarded file tools for all six harnesses in the live runtime before enabling granular file policies in production. Exercise excluded hydration, native tool denial, checkpoint rejection, and reconnect under the same frozen session policy. Disposable tests do not establish live acceptance.

## Connector access release acceptance

- [ ] Rehearse migration 032 with drained admission and matching API/worker deployment in isolated staging. Verify current delegated write revocation, exact provider account binding, cross-instance access edits, and dispatch ordering on the deployed transport. Run any external connector invocation only with synthetic data and an explicit budget. Local fixtures and browser acceptance do not establish live cloud/provider acceptance. See [activation and verification](../engineering/testing/connection-access.md).

## Customer-agent foundations release acceptance

- [ ] Rehearse migration 033 and operator setup on the intended staging database. Verify persisted toolkit/version/Auth Config selection, custom-auth choice, managed-creation recovery, HTTPS customer consent, an explicitly granted pinned action and revocation. Configure each deployment deliberately; the removed environment maps are not read by runtime. Local preview migration preserved one existing GitHub setup without provider calls. See [connector setup](../features/identity-integrations/composio.md).
- [ ] Accept newly admitted OpenRouter routes on the intended native harnesses under an approved budget, including tool protocol, context limits, price ceilings and final usage/invoice reconciliation. Discovery does not establish account entitlement or all model/harness combinations. Smaller or unknown context/output limits remain excluded until the runtime receives per-model configuration; see [model policy](../features/execution/models.md).
- [ ] Before adopting the reference app for real customers, replace demo identity and single-process storage/locking as appropriate, configure customer spending/retention controls, and verify two-customer isolation against hosted Supabase/Pinecone/MCP resources. Keep real provider actions separately authorized and budgeted. The [reference app and data-recipe record](../engineering/testing/customer-agents.md) distinguishes runnable local evidence from these deployment decisions.

## Marketing media activation

- [x] Connect the dedicated marketing-media bucket to its production custom domain, verify CDN caching and byte ranges, configure the dedicated marketing homepage and deploy. The [playlist setup guide](../product/marketing/site/swarm-playlist.md) contains the reusable procedure. Private workspace bucket access is unchanged.
- [x] Deploy the dedicated application and enable production registration at the operator’s request. The signed-out app homepage opens login; the marketing site remains separate. Production account verification and customer execution acceptance remain tracked above.
- Verify 1.3× playlist transitions, autoplay, clear loading/failure backgrounds, offscreen suspension and sustained playback on physical iPhone Safari and Android Chrome with constrained bandwidth. Local desktop playback does not establish these device results.

## Reliability acceptance

- [ ] Rehearse the shared encrypted database/object/key archive against isolated hosted Neon/R2 targets. Local recovery passes integrity checks, file reads and conversation continuation; it does not establish a production RPO/RTO. Pause every writer and retain the independent keyring as required by [recovery operations](../operations/recovery.md).
- [x] Complete production customer MCP OAuth sign-in/consent and verify tool discovery/read calls in Codex. The desktop session discovers the deployed tools and completes an authenticated `listProjects` call with HTTP 200; global configuration reports OAuth authentication. Canonical readiness, metadata and unauthorized rejection also pass. Production mutations and native paid run execution remain subject to the production execution gates above.

## Explicit-context decision release

Local implementation is capability gated. Complete the [decision release acceptance](../features/decisions/verification.md#remaining-release-gates) before enabling it: compatible migration/restore and worker fencing, hosted and direct-provider acceptance, hosted latency/capacity, independent evidence GC/restore, and provisional-charge reconciliation. Local real OpenRouter Jev managed choice/BYOK score passed; direct TypeSafe/Anthropic decisions, provider-side revocation and real ambiguous completion remain unverified. No production enablement was performed by this change.

### Itemized billing and background traces

Apply additive migration 039 before deploying the itemized billing API; indexes preserve all existing financial facts. Verify hosted filtered/paginated usage, BYOK zero-charge handling and final run reconciliation. Exercise a slow/unavailable Langfuse endpoint and verify Workflow steps continue while `waitUntil` owns bounded exports; request/stream routes retain `after`. Local tests do not establish hosted lifecycle retention.

## Workspace terminology and resident harness release

- Coordinate migration 041 with the matching API, SDK, CLI, dashboard and runtime image. Drain old writers; back up database/object storage; do not run mixed contracts. See [terminology rollout](../architecture/resource-terminology.md). Local disposable migration and regression checks pass. The inactive local development database was backed up and migrated through 041; hosted databases still require coordinated rollout. The matching local Docker image has been built.
- Publish the new runtime image and verify same-session live reuse, cancellation, idle expiry and a cold checkpoint miss on hosted Vercel/Render. Offline Docker acceptance covers all six pinned harnesses with current run credentials and connector calls; it does not establish hosted acceptance or zero model-response latency.

## Local compute and BYOK funding follow-up

- [ ] Add and run billing regression tests for zero-balance local Docker sandbox create/resume, temporary and long-running lifecycle, zero-rate idle behavior, native BYOK runs, and direct/bounded BYOK inference. Verify model budgets still stop overspending, cancellation/settlement reconcile zero reservations, and concurrent/duplicate paid connector calls reserve credits before dispatch. Managed models and hosted compute must retain funding requirements; BYOK credential failures must not fall back to platform keys. Tests were explicitly deferred for this change.
- [ ] Update billing and local Docker/sandbox guides: local Docker compute is always zero-rated; BYOK model usage consumes the request budget without reserving platform model credits; billable tools still require credits at dispatch. Explain that budget ceilings and prepaid reservations differ, restart API/worker processes for deployment, and document hosted funding behavior. Regenerate/check published documentation after updating these guides. Documentation updates were explicitly deferred.

## OpenRouter model parameters and Muse inference

- [ ] Add and run API/gateway/inference regressions for `model_parameters.reasoning.effort` (`none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) and `provider.require_parameters`: strict unknown-field/value rejection, unsupported provider/Jev rejection, explicit Muse Contributor rejection of `none` and `max`, conflicting session overrides, omission inheritance, changed-body idempotency conflicts, persisted queue/recovery parameters, and enforcement on every native call and warm/cold continuation. Tests were not written or run at the user's request.
- [ ] Verify exact Muse Contributor BYOK chat routing and structured JSON output, refusal/malformed/truncated responses, model mismatch, missing usage, 2,048/16,384 output ceilings including reasoning, frozen price ceilings and budget exhaustion. Preserve Jev Decisions routing and prove no model or platform-credential fallback. Live provider acceptance remains unverified; Meta currently documents `max` as unavailable on Contributor tiers (https://dev.meta.ai/docs/reasoning). Admission rejects `none` and `max` for this exact Contributor slug; verify `xhigh` as its highest supported effort and never substitute effort/model silently.
- [x] Regenerate all five SDKs using the existing generator and the local JDK 21 toolchain. Generation and TypeScript checking pass; SDK execution suites remain deferred as requested.
- [ ] Update API, model, decision and continuation guides for supported parameters, exact `meta/muse-spark-1.3-contributor` selection, BYOK connection requirements, strict provider support, session parameter immutability and the 16,384 inference output-token ceiling. Update the generated method reference and published documentation, then run documentation checks. Guide updates and documentation checks were explicitly deferred.

## Direct inference latency follow-up

Implemented the synchronous single-call API path; tests and feature documentation were explicitly deferred by the operator. TypeScript checking is not runtime or performance acceptance.

- [ ] Add and run API/provider regression tests for direct Jev and generative LLM calls without a worker: HTTP 200 with result, explicit `Prefer: respond-async` / HTTP 202, capacity rejection without durable admission or charges, the 240-second direct timeout limit, and bounded agents remaining queued.
- [ ] Verify simultaneous idempotency replays make exactly one upstream request; retained run/result access obeys current authorization; API process loss and ambiguous provider responses recover without automatic replay. Exercise cancellation, timeout, crash before/after dispatch, response persistence failure, ledger settlement failure, and worker/Workflow fencing until the direct recovery deadline.
- [ ] Measure p50/p95 request latency and SQL/lock time with inline Jev and LLM fixtures, concurrency, slow maintenance, and slow/unavailable tracing. Verify background request accounting and optional timing writes cannot delay the response, while financial reservations, provider evidence and settlement remain durable. Native model gateways already call providers directly and retain their existing accounting.
- [ ] Update public/internal inference guides and examples for synchronous default, `result.inference`, async preference, 429 capacity handling, 202 in-flight replay/recovery, retained run URLs and the 240-second limit. Explain that request-summary analytics now complete after the HTTP response; optional response-persistence timing may be absent from the immediate receipt.
- [ ] Run regenerated five-language SDK acceptance and MCP integration against the new 200/202 response contract, including caller timeouts and preserved mutation identities. Deploy the matching API/SDK version and verify the request-host background hooks; no latency SLA or hosted acceptance has been established.

## Provider-native inference follow-up

- [ ] Add and run formal API/SDK/provider regressions for `definition.question: { kind: "provider" }`: `input` is the native request body and `result.inference.value` retains the complete provider response. Cover multiple named Jev choice/score/noul questions, all answer metadata, plain-text and tool-call LLM outputs, multiple completions, native parameters/JSON schemas, and enabled OpenRouter models beyond Muse. Tests are deferred at the operator's request; ad hoc execution of the adapter paths with synthetic upstream responses passed, without paid calls.
- [ ] Exercise admission, recovery and billing end to end for native requests: current authorization, model binding, preserved parameters, aggregate output allowance across `n`, media bounds, Anthropic cache-write liability, missing usage, cancellation and ambiguous dispatch. Run all five regenerated SDK suites. Static checking and adapter execution do not establish full API or hosted acceptance.
- [ ] Update internal/public inference guides and copyable examples for provider-native mode versus optional typed decisions; explain that native input is passed without injecting the definition prompt/context, and provider response fields are retained. Regenerate published docs afterward. Documentation work is deferred at the operator's request.
- [ ] Extend separately metered capabilities before removing their financial/transport guards: native inference streaming/background delivery, provider-hosted paid tools, non-default service tiers, unpriced models/fallbacks and broader media. These remain explicit unsupported capabilities, not a one-question or JSON-only restriction. The existing catalog, byte/context/response limits and spending boundaries still apply; do not describe this as unrestricted parity with every provider endpoint.

### Default native inference request

- [ ] Add/run API and regenerated SDK regression coverage for the simplified default `POST /v1/inferences` body: only `model_binding`, native `input`, and `limits` are required. `definition`, `context`, and `question.kind` are no longer required for ordinary inference. Verify optional typed definitions still require their context, bounded agents still require definitions, missing limits fail before admission, and both synchronous/async paths retain billing and idempotency. Ad hoc execution through the actual request validator, internal normalization and provider adapter passed with a synthetic multi-question Jev response; TypeScript checking passed. Formal suites remain deferred by request.
- [ ] Update the public/internal guides and calling-agent examples to make the simplified body the primary interface. Present definitions/context only as optional higher-level decision features. The server creates its executor envelope internally; callers need no provider-mode flag. Regenerate published docs after this deferred documentation update.
- [ ] Add a Jev pass-through regression asserting caller state, arbitrary named questions, extra endpoint parameters and routing preferences survive serialization unchanged. Keep chat-only tool/output/service-tier validation off the Decisions path. Only the bound model and Macrofold routing/spending controls are platform-owned. Ad hoc adapter execution verified the OpenRouter Decisions URL, forwarded parameters and complete returned answers; formal tests/documentation remain deferred.
