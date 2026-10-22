# Engineering TODO

## Resource capacity and progress

- [x] Audit dispatch, admission, Worker scaling, maintenance, transfers, database pools and HTTP limits. Separate resource ownership, remove shared batch barriers and hard clamps, raise configurable defaults, and document retained safety/transport bounds. See [implementation and verification](../projects/resource-capacity.md).
- [x] Calibrate dispatcher and database defaults with disposable HTTP/provider workloads; cover queue/rate/fleet boundaries and competing dispatchers. Fix fair-admission starvation and isolate test capacity from developer overrides. See [measurements and limit disposition](../engineering/capacity/README.md); external-provider throughput remains part of hosted acceptance below.
- [ ] Apply migrations 051/053, migrated runtime-role/database timeouts, backend reconnection and aligned capacity settings to hosted API/Workflow/poller deployments. Measure mixed native/inference bursts with slow transfer/provider/maintenance boundaries, queue-age fairness, database pool waits, provider throttles and memory. Establish sustainable throughput and replica/connection budgets before raising advertised commitments. Local fixtures and a production build do not certify thousands of active customers.

- [x] Complete the [saturation calibration](../engineering/capacity/upper-bounds.md): sustained final-default checks, deadline/ledger/permission regressions, populated-ledger migration and cloud/local cleanup pass. Every limit has a recorded disposition. Live native quotas and colocated multi-replica certification remain in hosted acceptance above.

## Bounded operations and recovery

- [x] Audit authored retry/poll/pagination/traversal paths, bound failed dispatch and native/Host recovery, and preserve checkpoints, execution identity and unresolved holds on exhaustion. Database/object/model I/O and SDK waits have finite deadlines; clients stop on the recovery notice. See [implementation plan](../projects/bounded-work.md) and [local evidence](../features/execution/workers/verification.md#bounded-work-and-recovery).
- [x] Replace vague recovery labels with the failed processing step, safe cause, consecutive retry count, checkpoint confirmation and operator guidance. Add shared event diagnostics and prevent blocked queued Runs from taking scheduler turns without releasing uncertain active ownership. Migration 050 is applied locally; targeted fixtures and browser acceptance are recorded in Worker verification.
- [x] Complete full SDK verification for actionable event diagnostics. All five SDK checks pass with the configured toolchains on the resource-capacity working tree; see [current verification](../projects/resource-capacity.md#decisions-and-verification).
- [ ] Accept migrations 048–050 and the rebuilt runtime in the hosted environment. Verify restricted reporting access, pooled PostgreSQL timeout options, provider provisioning/stop outages, retained obligations, blocked-queue fairness and raw SSE closure with actionable diagnostics after recovery exhaustion. Local fixtures do not establish hosted provider recovery or the caller's complete draft/approval journey.

## Native reasoning streams

- [x] Expose readable native reasoning through shared lifecycle/delta events, generated API/SDK models and grouped dashboard disclosures. Manual local live execution verified all five supported adapters; public/internal docs describe model-dependent visibility and remaining hosted acceptance.
- [x] Fix review findings: drain OpenCode through session-idle, close Pi thinking according to the assistant outcome, and render thinking separately in CLI output. Manual local protocol/subprocess verification is recorded in the streaming implementation guide.

- [ ] Add adapter regressions for Codex summary sections, Claude indexed thinking/signature/redaction blocks, OpenCode reasoning/text part routing and snapshot deduplication, Hermes callback boundaries and Pi thinking/redacted events. Verify distinct block IDs across multi-call and warm turns.
- [ ] Add worker/HTTP/UI checks for bounded fragment batching, first delta delivery, interrupted completion, hard-loss/truncation indicators, replay deduplication, content retention, answer-only helpers and expandable grouped thinking. Verify no extra model call, generation observation or billing settlement is introduced.
- [ ] Add regression coverage for OpenCode HTTP-first/idle-first ordering, multi-call reasoning tails and early stream loss; Pi premature EOF/cancellation after thinking deltas; CLI thinking labels, stderr/stdout separation, JSON/JSONL preservation and interactive answer boundaries.
- [ ] Verify reasoning with hosted release images, warm multi-turn sessions and cancellation; local manual acceptance does not establish these paths. Direct/bounded reasoning events are a separate extension.

## Delta streaming implementation

- [x] Implement [delta streaming](../features/api/streaming-implementation.md): direct transient SSE, provider/harness capability rejection, bounded-agent deltas, completed-response persistence/accounting, typed helpers in all five SDKs, and public/internal documentation. Local live Anthropic direct/bounded delivery, active/completed idempotent replay, disconnect without cancellation, final usage and Langfuse API readback are verified. Builds/type checks pass; no automated tests were written or run by operator request.
- [ ] Add provider parser regression tests: split UTF-8/SSE, multi-line frames, heartbeats, multiple choices/content blocks/tools, refusals, final usage after text, malformed frames, size limits, premature EOF and cancellation. Assert no successful completion on a missing vendor terminal marker.
- [ ] Add admission/HTTP coverage across direct, native, bounded, preset/session and customer-agent paths: resolved capabilities, Jev/DeepSeek rejection before side effects, read/write scopes and tenant isolation, nested option contradictions, unsupported transports, deadlines and immediate-capacity rollback.
- [ ] Add a native model-gateway cancellation regression: close the downstream reader after aborting upstream; a rejected `reader.cancel()` must not become an unhandled rejection, crash the host, duplicate settlement or lose trace finalization. A live Codex journey exposed this cleanup failure; the five-harness matrix passed after the fix.
- [ ] Add lifecycle/accounting coverage: early delta before held completion, active/completed concurrent idempotency, disconnect, slow reader, explicit cancellation, revoked authority, purge racing late fragments, uncertain dispatch, failed response persistence/settlement and recovery without a second model call. Compare deterministic streamed/non-streamed usage and charge; require one generation per invocation and no direct per-chunk SQL writes. Verify bounded-agent identities and tool execution only after complete validated arguments.
- [ ] Add all-five-SDK direct-stream coverage for typed events, terminal failures, partial transport errors retaining identity, EOF, reader cleanup, no POST reconnect after output, and local rejection of `create(stream=true)`. Preserve durable replay/reconnect coverage. Add non-blocking exporter/outage and complete assembled tracing assertions, including original provider text when typed JSON validation fails.
- [x] Complete successful OpenRouter direct streaming acceptance after account credit was added: real SDK/HTTP deltas, saved successful result, complete token accounting and one Langfuse generation with matching input/output and cost. Fresh Anthropic direct and OpenAI gateway-only streaming also pass; this does not certify full native sessions or hosted delivery.
- [x] Verify real native streaming through local SDK/HTTP/SQL-worker/Docker for Codex, Claude Code, OpenCode, Hermes and Pi: public deltas, successful terminal results, complete model accounting and verified checkpoints. DeepSeek rejects streaming with HTTP 400 before provider dispatch. Detailed scope and timings are in the streaming implementation guide.
- [ ] Verify hosted flushing, 300-second serving configuration, immediate admission, reader-detach lifetime and finalization with the real deployment proxy. Run supported native harness two-turn/cancellation image journeys, a multi-call bounded investigation, and non-TypeScript SDK real-HTTP journeys. Local Anthropic acceptance and compilation do not establish these paths or hosted acceptance.

## Worker cutover regression obligations

- [x] Fix disabled-execution shutdown gates, Vercel region propagation, stale allocation errors, and editing a Worker backed by stronger isolation. Focused provider/database regressions and dashboard acceptance are recorded in [Worker verification](../features/execution/workers/verification.md); live hosted acceptance remains open.

- [ ] Cover Worker creation with an otherwise administrative Worker-restricted key, immutable expired targets, explicit pooled instance settings on PATCH, and baseline affordability after raising `min_instances`. Default resolution must honor requested runtime/size before choosing region and rates. Cover `size: null` and CLI `--auto-size` returning to automatic sizing without weakening revision or pause requirements.

- [ ] Cover native continuation databases with absolute paths: Session-scoped HOME stays stable across different handle IDs and fresh Hosts; permission changes, handle eviction and failed preparation remove only the owning continuation directory. Preserve credential exclusions and the separate per-handle temporary directory.

- [ ] Cover release failures during process discard, filesystem cleanup and final resource metering: keep Worktree and capacity ownership until cleanup succeeds, retry idempotently, and never advertise an unpublished cache. A transient health-meter failure must not skip releasing an already-metered assignment.
- [ ] Cover a pending supervisor timer at the native result boundary and ensure it cannot cancel a later turn reusing the same UID. Cover bounded idle-cache maintenance without subsequent traffic and no unhandled supervisor-cleanup rejection.

- [ ] Cover aggregate queued-demand scaling, existing provisioning as projected supply, mixed resource sizes, configurable allocation expansion, Worker caps, financial reservation rechecks, and no repeated provisioning for the same pending pressure.

- [ ] Cover restore-marker-before-process-exit handoff: launch waits for the restore child, without touching another Run or spuriously failing an acknowledged restoration.
- [ ] Cover warm harness incompatibility when model parameters or harness prompt mode change; old scoped runtime-control operations must not remain discoverable.

- [ ] Cover dashboard Worker lifecycle confirmation, revision-conflict preservation, exact USD conversion, paginated selectors, disabled unsupported offerings, and placement on both new and continuing Runs. A Run's budget label must not imply it pays for the entire explicit Worker.

- [ ] Cover automatic native execution on the Host protocol, encrypted control-secret recovery, pre-launch allocation cleanup without a received binding, and Session continuation when switching between automatic and explicit Worker placement.
- [ ] Cover a Worktree advancing via Git/editor publication before Host cleanup: local cache metadata must name the Run's own verified checkpoint, never the newer Worktree checkpoint.

- [ ] Cover the forward-only cutover with closed historical charges and refusal when old compute or reserved funds remain. Verify the financial archive retains itemized journal attribution without credentials or operational state.
- [ ] Cover Worker-filtered Run/usage pagination and ensure individual Worktree/Session filters do not attribute the full shared allocation to a single Run.

- [ ] Cover a live provider allocation whose container/session/controller generation changes: stop confirmed compute before releasing the hold, recover old Run claims without replay, and retain unknown metering tails for reconciliation.
- [ ] Cover isolated allocation retirement after one Run, restore acknowledgement loss, staging after restore starts, and warm ownership handoff without recursive filesystem traversal.

No unit or integration suites are written or run for this continuation, as requested. Runtime execution and bounded performance exercises are recorded separately.

- [ ] Cover Worker response projection (`worker_id` on accepted and retrieved Runs), independent Worker/Workspace restrictions, non-escalating child keys, and the actual `/v1/api-keys` route.
- [ ] Cover CLI create/update/pause/resume/destroy, human USD conversion, mutually exclusive flags, name-versus-ID permissions, resource overrides, and both chat modes. Session creation must not acquire or inherit compute implicitly.
- [ ] Cover batched Worker observations with multiple tenants, pagination, active-versus-cleaning assignments, empty lists, historical charges, and no observation-query growth proportional to page length.
- [x] Cover cold native continuation and hidden Git/session files while excluding credentials; real native fixtures recover from a fresh physical container. See [native home persistence](#native-home-persistence).
- [ ] Cover spending ceilings during provisioning and draining, same-Worker concurrent writers, late generation callbacks, graceful pause, and pool/instance resource exhaustion.

## Native startup failure diagnostics

- Local manual acceptance: the activated diagnostic image and restarted Docker poller export `runtime.failed` through the event API and as an ERROR observation in Langfuse. Fresh OpenCode/OpenRouter requests succeed. A fresh warm session successfully recalls a synthetic marker on its second turn with `reused: true`. These checks used `meta/muse-spark-1.3-contributor`, BYOK, no tools and a $0.24 cap per run. No automated tests were written or run.
- Historical failure: a previous dot-path filter discarded native conversation storage, leaving a native ID without saved home state. The current Worker runtime preserves hidden worktree and native history files. The earlier three pre-ready failures remain unexplained; their discarded exceptions cannot be recovered.
- [x] Preserve hidden worktree/native history files independently of authentication and explicit native-state declarations. The [home persistence fix](../projects/native-home-persistence.md) verifies OpenCode history recall on a fresh physical container and warm reuse against offline native fixtures. It never silently substitutes a fresh conversation for missing history.
- Local capacity: eight inactive logical sandboxes were configured `long_running: true` with no idle expiry; seven physical containers consumed approximately 3.3 GiB of a 3.8 GiB Docker VM. With operator authorization, all eight were paused through the public API after verifying worktree checkpoints. Physical containers were removed and about 3 GiB became available. These were always-on workers, not failed idle cleanup. Separately, a 60-second idle sandbox automatically paused. The web preview and Docker daemon were not restarted.
- Local activation used a code-only native-worker overlay on installed dependencies, tagged `platform-runtime:0.1.0`; `platform-runtime:before-opencode-diagnostic` retains the previous image. This is not a full release-image acceptance result. The full Dockerfile build was stopped under measured memory pressure; no timeout or blind prompt retry was added. Resource contention during investigation does not prove the original failure's cause.
- [ ] Add automated coverage for safe diagnostic classification, per-turn stage reset, OpenCode startup/session/stream failures, cancellation after server shutdown, event ingestion and ERROR-level Langfuse export. Include cold history restoration, warm history recall and idle cleanup. Deferred at the operator's request.
- [ ] Publish a complete runtime image and verify the same paths on intended hosted providers. Local successful calls and trace readback do not establish hosted acceptance.

## Native harness tool permissions

- [x] Add native question allowance/denial through the layered API permission model, including OpenCode tool omission and defensive runtime/control-plane enforcement. Add the durable `stop_on_model_error` spending safeguard with preserved checkpoint/accounting. [Plan and verification](../projects/native-run-controls.md), [public controls](../features/execution/README.md#stop-after-a-model-failure).
- [ ] Extend selection to other native harness tools when needed. Preserve connector/file restrictions and use supported native configuration, not prompt-only restrictions. Document mappings that cannot hide tool schemas (Codex questions already use native execution denial plus the RPC guard); do not promise arbitrary native-tool parity.

## Harness prompt mode follow-up

- [ ] Test OpenCode default empty replacement and explicit `harness_prompt_mode: extend`, preserving configured instructions, permissions, tools and warm-session mode changes. Verify outgoing provider messages contain no default coding persona in replacement mode. OpenCode requires a nonempty blank agent prompt to bypass its truthiness fallback. Tests deferred by request.
- [ ] Document the per-run `harness_prompt_mode` API option (replace by default, extend opt-in), its current OpenCode-only support, and remaining harness context/tool/repository messages. Other harness adapters still need individually verified replacement mappings. Update generated public docs and SDK references; documentation deferred by request.

## Shared local environment follow-up

- [ ] Test shared `.env` loading for API, worker and Docker command aliases, including exported-variable precedence and unchanged paid-execution opt-in. Local Docker overrides were merged into `.env`; `.env.docker` and its example were retired. No tests were run at the operator's request.
- [ ] Update local setup/development guides and remove `.env.docker` references. Explain switching `EXECUTION_PROVIDER` in one file, `ORCHESTRATION_BACKEND=poller` for Docker, and restarting both API and worker after configuration changes. Review the simulator-only setup guard for an already-configured Docker developer.
- [x] Separate native and lightweight fleet admission so retained checkpoints do not occupy the only inference budget. Explicit total/account ceilings still apply; see [resource capacity](../projects/resource-capacity.md). Local compute overrides remain separate from production defaults and spending authorization.

## Native home persistence

Implementation and verification: [plan](../projects/native-home-persistence.md); authoritative behavior: [runtime policy](../features/execution/runtime.md#native-home-persistence).

- [x] Replace the initial cache denylist with explicit per-harness durable-state declarations, shared by capture, transfer/indexing and restore. Unknown home paths require no cache rule; worktree files remain durable.
- [x] Add path/capture/restore and database-backed lifecycle regressions; preserve hash/size/unsafe-path/authentication checks. Verify all six actual harnesses on warm reuse and fresh-container continuation, including declared resources and discarded runtime state, without paid APIs.
- [ ] Verify the original caller's complete tool journey through draft/approval after local activation; local scripted native success does not prove application-level completion or live end-to-end latency.
- [ ] Publish the rebuilt runtime image to intended hosted providers and verify the same continuation/persistence path there. Local Docker activation does not update hosted images or already-running Hosts.

## Worker stall diagnostics follow-up

- [x] Fix guarded failed-publication nontermination and classify local Docker setup failures without exposing raw stderr. Verify terminal cancellation, unchanged durable files/Session state, single settlement, transport bounds and actual OpenCode Docker/API continuation. Local affected Runs were finalized and their verified checkpoints restored without prompt replay; [verification](../features/execution/workers/verification.md#native-publication-and-local-docker-recovery) records the scope. Hosted acceptance and the caller's full draft/approval flow remain in [native home persistence](#native-home-persistence).

- [x] Reconcile dot-path checkpoint exclusion with native history restoration; see [native home persistence](#native-home-persistence). Capture, control-plane indexing and restore use the same native-state policy; authentication exclusions remain separate. Existing checkpoint bytes are unchanged.

- [ ] Verify bounded parallel checkpoint upload (four chunks / eight manifests): successful items remain durable, hash/size verification remains enforced, failures drain all in-flight work before lease release, and recovery resumes only unfinished objects. Dedicated concurrent-failure coverage remains deferred. The separate [native-state investigation](../projects/native-home-persistence.md) now verifies exclusions and native conversation restoration.

- [ ] Test `WORKER_DIAGNOSTICS=1`: correlated start/wait/complete/failure events, five-second pending progress, timer cleanup, disabled mode, unchanged results/errors, and no secret/content disclosure. Local enabled execution and typechecking now pass with [poller progress](../projects/poller-progress.md#verification); dedicated diagnostic assertions remain open.
- [x] Remove batch-wide and maintenance waits from the standalone poller, keeping bounded independent steps, SQL leases/capacity and checkpoint guarantees. A barrier-based PostgreSQL regression completes queued inference while native checkpoint upload remains blocked. See [poller progress](../projects/poller-progress.md).
- [ ] Diagnose the observed cancelled native run remaining in checkpoint `upload`: use `worker.checkpoint_read.*` versus `worker.checkpoint_store.*` to separate sandbox chunk retrieval from encrypted content storage. The two affected inference runs had no `started_at`, confirming cancellation before provider execution; the exact reason for the upload stall remains unverified. Do not discard recoverable checkpoints or blindly replay provider requests.
- [x] Document [local queued-request triage](../getting-started/local-development/docker.md#diagnose-a-queued-request): separate diagnostic poller output, Run wait/start fields, provider-dispatch evidence and safe restarts without replay.
- [ ] Verify independent poller progress in the hosted poller deployment and the caller's complete game scenario. Local fixtures and a tiny live inference do not establish hosted scheduling latency or complete game acceptance; [scope and evidence](../projects/poller-progress.md).

This is the central list of unfinished implementation, testing, documentation, and deployment work. Add follow-ups here under the relevant feature instead of creating separate TODO documents. It is not part of the published documentation site's navigation, search index, or Markdown export. A checked-in adapter or a local simulation pass does not close a live deployment check.

Product and architecture proposals are tracked separately in [ranked improvements](../product/improvements.md). The Workflow/Temporal evaluation is conditional on product needs and is not a launch blocker or an approved migration.

## Stateless inference simplification

- [ ] Reconcile three inference/protocol test expectations observed during the [context-window correction](../features/decisions/verification.md#context-window-correction): successful `decision.response` trace-event presence, explicit async submission before generated-client cancellation, and the unsupported OpenRouter model error assertion. The focused token-limit regressions pass; the broader two-file run remains 66/69.

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
- [ ] Verify bounded Render create, same-server follow-up, asynchronous suspend confirmation, resume/rehydration, destroy/new-disk behavior, process restart fencing and provider invoice reconciliation. Verify no persistent disk, no platform credentials in agent processes, and reviewed network access. Repeat Vercel reuse/expiry recovery on a plan supporting the configured lifetime. See [sandbox acceptance](../features/execution/workers/verification.md).
- [ ] Exercise provider outage and maintenance backlog; confirm active servers do not starve idle cleanup, uncertain deletion retains reservations, and separate compute holds reconcile. Reusable servers currently stop without a provider disk-recovery snapshot when capture fails; accept this limitation before offering that route for valuable uncheckpointed work.

## Execution tracing acceptance

- [ ] Add focused tracing regressions proving queued/provisioning/terminal lifecycle events remain in Macrofold's replay stream but are not separate Langfuse observations; terminal events should produce exactly one canonical `run.<kind>` root.
- [ ] Add gateway and decision regressions proving model billing appears once on `model.generate` or `decision.generate`, successful decisions omit `decision.response`, and normalization failures retain one error-level raw-response diagnostic.
- [ ] Update the observability implementation, verification record, and operator guidance to describe the reduced trace tree and remove `billing.model` plus successful `decision.response` from documented stable observation names. Run generated-document checks afterward.
- [ ] Configure private Langfuse project keys and the matching HTTPS region URL on the deployed web application and every worker; set environment/release labels and restart them. Verify real native model requests and conversation continuation, post-stream `after()` flushing, Workflow step export, and graceful worker drain. Local live Jev/API readback does not establish hosted lifecycle behavior.
- [ ] Accept backend access/retention and the separate external deletion policy. Exercise exporter outage/overload without affecting execution or settlement; verify costs once per billable observation and customer/worktree metadata on all children. See [tracing verification](../features/observability/verification.md).

## Startup latency acceptance

- [ ] Accept immediate phase advancement and batched hydration on deployed Workflow and Linux AMD64 compute. Exercise a fresh run and conversation continuation with many small files and multi-chunk files; verify exact restored bytes/session history, one native launch, checkpoint publication and released reservations. Local tests use PostgreSQL 14 and provider fixtures; repeat the configured PostgreSQL 17 CI checks. Docker was unavailable during this change's local verification.
- [ ] Compare queue-to-claim time, internal [phase timings](../features/execution/runtime.md#startup-latency-and-measurement), orchestration gaps, first model response and browser delivery on representative workloads. Check upload/control API counts and failure retries as well as latency. No deployed speedup is established by local fixture timings. Compare the separate [warm sandbox implementation](../features/execution/workers.md) using the same measurements.

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

- [x] Repair expired OpenRouter pricing before direct/bounded inference admission without depending on worker maintenance. Reuse refresh claims/backoff and preserve stale-price rejection and frozen rates. Focused catalog regressions and one local synthetic Muse BYOK call pass; see [catalog recovery verification](../engineering/testing/model-catalog.md#direct-inference-recovery).
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

Immediate inference and the shared [execution-efficiency redesign](#execution-efficiency-redesign) are implemented locally, with final refinement/qualification still active. The source now uses request-owned A/provider/F execution, shared accounting, typed recovery, batched current-authority observation and single-attempt SDK transports. The [verification record](../projects/execution-efficiency-verification.md) distinguishes local passes and missed targets from hosted throughput/lifetime acceptance; no production latency claim follows from source or local tests.

- [x] Complete the immediate-inference design review and incorporate the agreed clarifications: exact receipt/error/SDK semantics, separate clock budgets, restricted batched observation, transition/race rules, shared-capacity tradeoff and reproducible acceptance. See the [feature specification](../projects/immediate-inference-feature-spec.md) and [technical design/checklist](../projects/immediate-inference-tech-design.md#implementation-checklist). This is documentation completion, not application or scale acceptance.
- [x] Implement request-owned admission/evidence/completion, shared accounting, complete receipts, single-attempt transports in all five SDKs, restricted observer view and provider-completion timestamp migration. Shared capacity without per-mode reservations is implemented; [RP04](revisitable-policies.md#rp04--immediate-and-queued-capacity) records its review trigger. Keep calibration and acceptance below open until their actual evidence passes.

- [x] Verify the no-worker API/provider contract: HTTP 200 terminal receipts, async-header rejection, exceptional HTTP 202 recovery, capacity/admission refusal, ambiguous admission identity recovery, execution/host window rejection and bounded agents remaining queued. Corrected catalog/HTTP checks and the final financial/fault cohort pass; see [verification](../features/decisions/verification.md#immediate-inference).
- [x] Verify same-key duplicate suppression, lost A/B/C commit acknowledgments, cancellation, authority ordering, retention tombstones, saved-response recovery, timely completion with delayed settlement, JSON reader disconnection and actual API process death after dispatch/response persistence. No recovery path replays a provider request; financial fixtures verify one settlement and reservation release.
- [ ] Complete the remaining failure/stream acceptance matrix in the [project checklist](../projects/immediate-inference-tech-design.md#i5--verification-and-production-scale-evidence), including graceful drain, large/slow readers and mixed-mode saturation. Existing focused passes do not establish the complete load or hosted envelope.
- [ ] Measure p50/p95 request latency and SQL/lock time with inline Jev and LLM fixtures, concurrency, slow maintenance, and slow/unavailable tracing. Verify background request accounting and optional timing writes cannot delay the response, while financial reservations, provider evidence and settlement remain durable. Native model gateways already call providers directly and retain their existing accounting.
- [x] Profile near-full-context overhead and remove repeated immutable-content transfers under the [focused optimization plan](../projects/immediate-inference-tech-design.md#profiling-and-reducing-request-overhead). SQL return traffic fell from 16.96 MB to 10.19 KB per call; 20 uninstrumented synthetic-provider calls averaged 178 ms overhead, versus a 1,110 ms instrumented baseline. Phase/SQL/CPU evidence and controlled storage experiments are recorded in [verification](../features/decisions/verification.md#near-full-context-profiling). Host load varied; this is not a hosted speedup or SLA.
- [x] Verify the below-100-ms near-full-context server-overhead target on the declared co-located Linux topology/load with tracing enabled and disabled: 100 calls per protocol/cohort, 1.494 MB context, five requests/second; server p95 tracing on/off is Jev 84.697/80.785 ms, Anthropic 60.031/60.875 ms and OpenRouter chat 65.784/63.471 ms. Preserve the macOS misses and traced Jev caller-overhead p95 112.678 ms. This is local protocol-fixture acceptance, not a hosted SLA or sustained capacity claim. See [current evidence](../projects/execution-efficiency-verification.md#co-located-linux-hundred-call-cohorts).
- [x] Remove mandatory large immediate input/request writes from the shared capacity-lock section, reusing compact accepted terms and preserving queued executable input. Mixed native/inference, expiry, rollback, generation and spending fixtures pass. The old two inserts consumed about 57 ms in the [earlier profile](../features/decisions/verification.md#near-full-context-profiling); measured lock budgets and sustainable competing-admission throughput remain part of the open execution-efficiency qualification.
- [x] Update public/internal inference guides and examples: immediate-only submission, `result.inference` usage/billing, removed async preference, typed 429/503 handling, 202 recovery reasons, retention tombstones, single-attempt SDK behavior and the 240-second execution limit. Completion budgets and best-effort background request analytics are documented separately; receipts contain only observed timings.
- [x] Regenerate all five SDKs, verify their transport/error/deadline contracts, run each language against the actual immediate JSON/replay/SSE API and verify customer MCP integration. Complete ordinary SDK workflows also pass with paid execution disabled.
- [ ] Finish coordinated activation: local migrations through 055 are applied with no active Runs at migration time; the preview/default runtime image are preserved. Replace older pollers/controller images only with matching qualified code and drain affected Hosts. Deploy matching API/SDK/recovery versions to hosting, coordinate external callers, and verify hosted lifetime/background hooks. No latency SLA or hosted acceptance has been established.

## Execution efficiency redesign

The shared application changes, capture/runtime refinement and local activation are implemented. Co-located Linux immediate and local native latency targets pass; the SQL budget, full CI/combined coverage and hosted qualification remain open. The [feature specification](../projects/execution-efficiency-feature-spec.md) and [technical design](../projects/execution-efficiency-tech-design.md) own the agreed scope and durability tradeoff; the [verification record](../projects/execution-efficiency-verification.md) owns actual measurements and checks. Completed module adoption below does not close the performance, complete CI or hosted gates.

- [x] Trace immediate, queued/native, bounded, model/tool, restore/checkpoint, warm placement, event and background paths; document the 82-command/repeated-payload cause, implemented narrow-read improvement and proposed replacement. Add the shared critical-path guidance without weakening money, authority or file guarantees.
- [x] Review the design's modularity; specify shared module contracts, distinct lifecycle/policy boundaries, guarded verification lifetime and background admission before payload retention. Application adoption and measured regression gates remain part of E0–E6 below.
- [x] E0–E2 application: Separate hot summaries/control from input/output ownership, cache immutable terms, batch/pipeline SQL, and implement compact A/F with exceptional evidence fallback. Real restricted PostgreSQL, ambiguous commits, actual process kills, tenant/current-authority, spending and result replay fixtures pass. Final per-path lock/latency and mixed-load qualification stays open below.
- [x] E3 owners: Add bounded full capture, compact billing observations, request analytics and staging cleanup; preserve promised durable jobs. Public/internal docs and regenerated five-language SDKs describe input-history availability and the response-loss window; final billing/result reads use canonical facts.
- [x] E3 final correctness: Complete the purge-after-commit/capture-retention and recovery-export review, verify compact observations under full-capture refusal, and retake matched tracing-on/off profiles. The final capture/catalog/database slice passes 67 cases; current capture semantics are included in both the macOS and co-located Linux six-cohort reports.
- [x] E4 application: Adopt shared accounting/controls for native gateway and bounded ready steps; optimize native admission, selected-tool catalogs and staged cleanup; add durable Task-child wakes and independent trigger pools. Actual database/protocol checks verify current grants, exact credentials, model-error fencing, bounded budgets, displaced-owner publication, unknown effects and prompt-free tool control reads.
- [x] E5 data/delivery owners: Batch hydration/checkpoint metadata and event publication, reuse guarded verified content, expose bounded warm hints and share repair observation. Six actual Docker harnesses and the API/OpenCode process-restart journey pass cold/warm/fresh-container continuation and file preservation in private derivative images.
- [x] E5 local transport qualification: Replace per-probe Docker/Node subprocesses with the existing authenticated Host HTTP endpoint on an inspected loopback-only port. Final image/controller auth, strict origins, bounded transfers/deadlines and complete OpenCode API/SDK continuation pass; 80 source-timed markers measure native-to-SDK p95 **37 ms**, meeting the 250-ms objective. The superseded stdin cohort missed at 344 ms. The dedicated-bridge journey retains synthetic/rejecting provider guards but does not claim kernel network isolation; earlier all-six image-only checks remain network-disabled.
- [ ] E5 deployment qualification: Verify actual hosted first-output, warm hit rate, restoration/checkpoint costs and replay on the deployed topology. No all-six final HTTP-image matrix or hosted latency pass is inferred from the common-controller/OpenCode local qualification.
- [x] E6 local checks: Final static and optimized app builds, regenerated documentation, all five SDKs, affected integration checks and matched tracing-on/off protocol profiles pass. Migration 055 and the matching qualified runtime image are activated locally after confirming no active Runs/Hosts. Bounded two-replica/eight-tenant probes verify one dispatch, released holds and cross-replica revocation.
- [ ] E6 remaining qualification: Full CI/combined coverage and sustained mixed-load/hosted qualification remain open. The design's 12 sequential foreground DB-group budget remains unmet (current source graph 20 for Jev/Anthropic and 23 for OpenRouter with catalog preparation, down from 35/39; final compiled-HTTP profiling confirms 20 groups and 53 statements for the qualified Jev path); record the owning breakdown/fix, not just p95 latency. The renewed complete domain gate passes 1,805 tests in 183 files with unchanged coverage floors; [the current verification record](../projects/execution-efficiency/optimization-verification.md#coverage-and-application-acceptance) supersedes earlier full-domain failures without claiming combined/native CI acceptance. Coordinate migration/API/recovery/controller activation while preserving developer state. Hosted pooler/lifetime and multi-replica acceptance remain release gates, not claims established locally.

## Execution-efficiency optimization proposals

- [x] Implement and qualify the measured [cold HTTP fixes](../projects/execution-efficiency/cold-http-verification.md): defer unrelated Composio/S3 SDKs and unused Workflow code, demand-load compiled pages, initialize shared API code/trusted validators before self-hosted readiness, reuse canonical collation and add validation/response/trace stages. The initial three actual Next clean-host cohorts retain every first call, exact accounting and full traces. That stage measured warm HTTP overhead at 34.05-ms mean / 74.76-ms p95; the final follow-through is recorded below; focused regressions, optimized builds, typechecking and docs pass. Older contaminated/noisy local measurements remain labeled, not discarded.
- [x] Admission/finalization follow-through implementation: compose new Run/reservation/invocation/events through a transaction-owned insertion plan; compose terminal events with settlement observations and pipeline credit allocation/debt with journal/release/expiry. Source groups fall A9→7 and F10→7, including a single-use fresh control snapshot after metering. Targeted real-PostgreSQL cases cover rollback, debt, idempotency, recovery, gateway, cancellation/current clock and webhook behavior. Shared REST readiness preserves Next lifecycle/deadlines, including health method routing; eleven focused readiness cases pass. Six final compiled-HTTP cohorts confirm 20 groups/53 statements and exact accounting/full traces; cold acceptance remains below.
- [x] Qualify the first-call HTTP target under the [follow-up plan](../projects/execution-efficiency/remaining-optimizations.md#cold-http-and-caller-latency-follow-up) on a declared clean serving topology: all six final first requests after readiness on c8g.xlarge measure 72.95–91.67 ms overhead, with full tracing and profiling on/off. The final 240-call comparison across two hosts passes exact accounting, zero residual holds and 480 full-content spans. Single-owner profiling produces one capture per enabled process and none when disabled; nineteen focused readiness/lifecycle cases pass. Preserve all readiness/module-instance/source proofs and cold samples, including the c7g misses below. No fake model warmups, forced GC or weaker authority/durability are used.
- [ ] Broader cold HTTP acceptance: the identical final build on c7g.xlarge measures 95.38–153.50 ms, so that topology does not qualify. Hosted lifecycle, internet-provider/database network topology, larger payloads and sustained multi-tenant load remain separate gates. The overloaded local host remains unsuitable for tail qualification. The final small-pair observed warm profiler increment is 0.52 ms on c8g but 2.45 ms on c7g, above the two-millisecond mean budget there; broader observer acceptance remains open. Do not extrapolate the bounded c8g synthetic-upstream pass into a universal SLA.
- [ ] OpenLegend owner follow-up: adopt the separately prepared terminal-receipt/timing patch and update that caller's normal tests/docs. The operator explicitly requested leaving it as a patch for that project's agent; no external checkout was changed. This removes redundant Run/billing GETs while retaining its required journal and HTTP 202 recovery, and labels actual adapter time instead of Run elapsed time.

The shared implementation is complete locally. Correlated SQL, payload and diagnostic behavior is verified; clean primary server-latency and full-sampling mean-overhead budgets pass under the [verification record](../projects/execution-efficiency/optimization-verification.md#clean-linux-primary-qualification). Remaining observer budgets, full CI/combined coverage and hosted acceptance stay open. The existing [execution specification](../projects/execution-efficiency-feature-spec.md) and [detailed optimization annex](../projects/execution-efficiency/remaining-optimizations.md) own O0–O5; the [profiling specification](../projects/performance-profiling-feature-spec.md) and [technical design](../projects/performance-profiling-tech-design.md) own P0–P6. Do not close the preceding SQL/CI/hosted gates by completing documentation.

- [x] Specify remaining SQL/payload/diagnostic opportunities and assess current profiling hooks; record exact proposed owners, stages, defaults, tradeoffs and verification.
- [ ] P0–P6: P0–P4/P6 implementation is complete, including default-off startup, concurrent/background attribution and bounded output. The 1,805-case full domain pass precedes the final sampling correction; 25 focused profiler and nine database-diagnostics cases pass afterward. Clean primary qualification passes the +2-ms full-sampling mean budget (increments 0.565–1.109 ms, upper confidence bounds below 2 ms). Independent 48-cohort CPU qualification passes the <2% budget at 1% sampling: increments 0.114–0.730%, upper confidence bounds below 1%, 24,000 measured requests plus 960 warmups, all successful. P5 remains partial because the incremental +5-ms full-sampling p95 budget is inconclusive. Required operational timers and execution tracing remain independent.
- [x] O0–O2 implementation: establish same-observer baseline/current source snapshots; reduce foreground groups 35→25 and 39→28 and duplicate canonical preparation. Payload-only CPU falls 13.4–21.6% with exact bytes/digests preserved. Authority, financial identity, replay and queued/native persistence remain protected; the original twelve-group criterion stays open.
- [x] O3 implementation: apply the existing trace-content choice at producer boundaries, defaulting to full capture. Metadata mode skips optional content jobs/retention/encoding while preserving costs, usage and first-output metadata; off/full/metadata behavior passes focused tests and the official exporter fixture.
- [x] O4 implementation: add independent default-on HTTP request/product-observation controls, scalar retained callbacks and truthful report/UX limitations. Durable domain events, security audits, actor activity and financial facts remain; all five SDK suites pass. Statistical sampling remains deferred.
- [x] Complete the [post-qualification implementation review](../projects/execution-efficiency/optimization-verification.md#post-qualification-implementation-review): repair composed settlement's protected-credit expiry, profiler error/detach accounting, deterministic fixture defaults and explicit report policies. Focused database/unit and profiler smoke checks pass; these later fixes do not close the remaining clean observer, CI or hosted gates.
- [ ] O5 acceptance: clean primary qualification passes all 48 cohorts and 9,600 measured requests plus 960 warmups, with exact financial reconciliation and every cohort below 100-ms server-overhead p95 (pooled 54.98–60.57 ms). Protocol/trace/payload/load and privacy/lifecycle evidence retains exact artifacts/source identities, including earlier noisy misses. Finish the remaining P5 observer budgets and full CI/combined coverage. Hosted lifecycle/capacity and the original SQL criterion remain separate open gates.

## Hugging Face model deployments

Design owners: [feature specification](../projects/hugging-face-model-deployments-feature-spec.md), [technical design](../projects/hugging-face-model-deployments-tech-design.md), [shared contract](../projects/hugging-face-model-deployments-contract.md) and [hosting research](../projects/hugging-face-model-deployments-research.md). The primary deliverable is reusable production model serving for OpenLegend and other applications. Optional experiments consume that capability; documentation alone implements no runtime or live acceptance.

- [x] **MD01 — Complete the design.** Specify persistent production serving, immutable model/runtime revisions, stable deployment selection with optional pins, current owner-delegated credentials, compatible external endpoints, RunPod lifecycle, bounded capacity/rate policy and existing inference/receipt integration. The shared contract owns wire fields; the technical design owns lifecycle and acceptance.
- [ ] **MD02 — Contract, tenant storage and grants.** Implement current API schemas and exclusive `InferenceBinding`, deployment scopes, immutable revisions, service state/policy and resource-scoped connection-owner delegation. Current grants apply without a service restart. Keep native `DecisionBinding`/scoring separate. Generate all five clients and verify tenant/workspace/key isolation. Depends on MD01.
- [ ] **MD03 — Production inference integration.** Use compatible external endpoints through ordinary inference without an experiment profile. Resolve idempotent Runs before selecting the serving revision, preserve accepted snapshots and existing cancellation/streaming/recovery/accounting. Implement stable selectors, optional pins, supported native output modes and separate infrastructure attribution. No per-turn provider management calls or blind inference replay. Verify real HTTP/SDK and OpenLegend serialization. Depends on MD02.
- [ ] **MD04 — Managed service and operations.** Implement HF/RunPod adapters, persistent running/stopped intent, explicit min/max capacity and hourly rate policy, optional stop time, known-resource recovery, ambiguous-create reconciliation, revision drain/recreate/rollback and cleanup. Same-revision worker replacement and secret rotation recover within current authorization. Preserve unknown costs without adding a quote/certificate/monthly-budget subsystem. Depends on MD02; use REST v2 evidence in research.
- [ ] **MD05 — Production serving runtime.** Pin vLLM/source/template settings; use maintained loading/context/schema behavior and add only necessary authentication/route protection. Verify startup, supported streaming/output modes, bounded limits and same-revision restart/replacement. Compatible operator-managed endpoints need no custom manifest wrapper. No boot-identity rejection of valid results. Depends on MD02/MD04; MD03 can use external transport first.
- [ ] **MD06 — User surfaces and coordinated release.** Implement API/CLI/dashboard inspect/create/revision/service/status/stop, safe connections/grants, cost/health visibility and normal OpenLegend configuration. Regenerate public clients/docs; record actual tested server/client/runtime versions. Externally stopped use must not imply external hosting shutdown. Depends on MD03–MD05.
- [ ] **MD07 — Production acceptance.** Complete the technical design's contract, lifecycle, isolation, cost, image, SDK and UI/CLI matrix plus authorized live provider checks. Cover ordinary concurrent service, worker recovery, revision rollout with valid old completions, idempotent replay after rollout, stop/revocation and uncertain cleanup. Measure cold/warm latency and capacity on a declared workload. Optional model comparisons do not block the provider capability. Depends on MD03–MD06; no paid execution or production enablement is implied by this tracker.

The reviewed scoring-model discovery work below remains open. Deployment serving does not broaden Jev protocols, implement the native-harness catalogue or complete the wider shared-services proposal.

## Provider-native inference follow-up

- [x] Implement and verify [OpenRouter Decision 1 routing](../projects/decision-model-routing.md) through the shared reviewed decision registry. Native/typed requests, credentials, accounting and unsupported capabilities pass 84 protocol/API tests; two real managed/BYOK requests pass locally. Public guidance is updated. Hosted release remains under existing decision acceptance work.
- [ ] Future, not a prerequisite for immediate inference: expose reviewed scoring models through existing catalogue discovery with explicit execution capabilities, separate availability/credential entitlement and no accidental native-harness eligibility. Follow [capability discovery](../projects/decision-model-routing.md#future-capability-discovery); update affected schemas/clients and verify mode filtering when implemented.

- [ ] Add and run formal API/SDK/provider regressions for `definition.question: { kind: "provider" }`: `input` is the native request body and `result.inference.value` retains the complete provider response. Cover multiple named Jev choice/score/noul questions, all answer metadata, plain-text and tool-call LLM outputs, multiple completions, native parameters/JSON schemas, and enabled OpenRouter models beyond Muse. Tests are deferred at the operator's request; ad hoc execution of the adapter paths with synthetic upstream responses passed, without paid calls.
- [ ] Exercise admission, recovery and billing end to end for native requests: current authorization, model binding, preserved parameters, aggregate output allowance across `n`, media bounds, Anthropic cache-write liability, missing usage, cancellation and ambiguous dispatch. Run all five regenerated SDK suites. Static checking and adapter execution do not establish full API or hosted acceptance.
- [ ] Update internal/public inference guides and copyable examples for provider-native mode versus optional typed decisions; explain that native input is passed without injecting the definition prompt/context, and provider response fields are retained. Regenerate published docs afterward. Documentation work is deferred at the operator's request.
- [ ] Extend separately metered capabilities before removing their financial/transport guards: native inference streaming/background delivery, provider-hosted paid tools, non-default service tiers, unpriced models/fallbacks and broader media. These remain explicit unsupported capabilities, not a one-question or JSON-only restriction. The existing catalog, byte/context/response limits and spending boundaries still apply; do not describe this as unrestricted parity with every provider endpoint.

### Default native inference request

- [ ] Add/run API and regenerated SDK regression coverage for the simplified default `POST /v1/inferences` body: only `model_binding`, native `input`, and `limits` are required. `definition`, `context`, and `question.kind` are no longer required for ordinary inference. Verify optional typed definitions still require their context, bounded agents still require definitions, missing limits fail before admission, and both synchronous/async paths retain billing and idempotency. Ad hoc execution through the actual request validator, internal normalization and provider adapter passed with a synthetic multi-question Jev response; TypeScript checking passed. Formal suites remain deferred by request.
- [ ] Update the public/internal guides and calling-agent examples to make the simplified body the primary interface. Present definitions/context only as optional higher-level decision features. The server creates its executor envelope internally; callers need no provider-mode flag. Regenerate published docs after this deferred documentation update.
- [ ] Add a Jev pass-through regression asserting caller state, arbitrary named questions, extra endpoint parameters and routing preferences survive serialization unchanged. Keep chat-only tool/output/service-tier validation off the Decisions path. Only the bound model and Macrofold routing/spending controls are platform-owned. Ad hoc adapter execution verified the OpenRouter Decisions URL, forwarded parameters and complete returned answers; formal tests/documentation remain deferred.

### Worker allocation receipt and metering regressions

Formal test additions remain deferred at the user's request; runtime/load checks are separate.

- [ ] Verify controller startup failure after physical provisioning retains the accepted provider identity/start time and permits idempotent cleanup without double provisioning or released liability.
- [ ] Cover runtime-requested rotation, provider-observation pacing, idle and manually paused Workers, and capacity handoff while old Hosts drain.
- [ ] Cover metered graceful shutdown with a lost quiesce acknowledgement, crash after the final receipt but before provider deletion, duplicate finalization, and confirmation of the same controller generation. No missing usage tail may silently settle as zero.
- [ ] Cover one-query queued-demand hydration and authorized materialization grouping at the configured Worker/Host limits.

- [ ] Replace the removed legacy reusable-control chunk test with Host assignment/boot-scoped transport coverage for a full 4 MiB decoded checkpoint chunk, bounded encoded envelope, and stopped/replaced-generation rejection. The old method no longer exists; new tests remain deferred by request.

- [ ] Exercise nonblocking background organization/worktree/global admission under a pool smaller than the queued burst. Verify that contended work defers without losing durable jobs, deadline cleanup still progresses, active persistence/heartbeats retain database access, and direct inference preserves its transaction boundary.

- [ ] Cover Run publication read/prepare/commit: large object and Git work holds no database connection, GC guard expiry prevents commit, a changed Worktree revision or execution-step/lease fence cannot publish, and duplicate terminal publication is idempotent. Exercise simulator and native cold paths and retain Worktree/Session atomicity.

- [ ] Add candidate-hint regressions for full global/account capacity: return only actionable free-slot starts while cancellation/expiry/deletion cleanup remains discoverable. Prove successive capacity release refills fairly across organizations and that stale hints still cannot exceed SQL-authoritative caps.

- [ ] Exercise financial reconciliation after the Worker-only cutover: expected reservations are active Run budgets plus live Host holds, without querying retired compute tables; confirmed stop and repeated settlement preserve exact wallet/journal totals.
- [ ] Cover storage maintenance while a publicly terminal Run still owns an unreleased HostRun: no Workspace/Session purge, history pruning, or object collection until cleanup releases its writer. Resume normal collection after release, including failed/uncertain cleanup.

## Agent guidance acceptance

- [ ] Verify native routing in fresh installed Codex, Claude Code, OpenCode and Cursor sessions using the [read-only cases](../engineering/agent-guidance/verification.md). Record versions, relevant settings, injected context and actual file reads; structural checks do not prove dispatch or compliance. Repeat only changed cases after routing changes.
- [ ] Reconcile [pre-launch policy](../../AGENTS.md#temporary-notes-pre-launch) with the hosted deployment recorded in [status](../status/README.md#remaining-launch-work) before real customer execution/support commitments. Confirm actual customer usage with the operator; do not infer it from deployment or remove developer-state preservation. See [RP01](revisitable-policies.md#rp01--pre-launch-compatibility).

- [x] Recheck the guidance adoption documentation failures on the merged checkout. `pnpm docs:check` passes without placeholder artifacts or relaxed checks; see [merge verification](../engineering/agent-guidance/verification.md#merge-verification).
- [x] Recheck the guidance adoption TypeScript diagnostics on the merged checkout. `pnpm check` passes after installing the declared dependency from the frozen lockfile, without changing compiler settings; see the same [verification record](../engineering/agent-guidance/verification.md#merge-verification).

## Local MCP development

- [x] Implement and verify the [local MCP plan](../projects/local-mcp.md), preserving public-only policy for unrelated requests. Exact-origin/local-mode rejection, authenticated loopback discovery/invocation, OAuth policy, and existing broker/webhook regression checks pass.

## Verification speed and main health

Worker reconciliation spent most of its time rediscovering failures that were already latent on `main`, one CI gate at a time, and repeating 25–30 minute local acceptance runs. Guidance now requires [a targeted verification loop](../../TESTING.md#keep-the-verification-loop-fast); the [verification speed plan](../projects/verification-speed.md) records the implementation.

- [x] Require `acceptance`, `Native runtime image`, `Combined coverage gates`, `Critical policy mutation tests` and `Generated SDK contracts and transports` on `main` (ruleset `Main requires verification`; repository administrators can bypass).
- [x] Report every acceptance surface in one CI run: acceptance steps run after earlier failures, application acceptance is a separate job, and the local full command attempts every surface before failing.
- [x] Run browser journeys on parallel workers, each with its own seeded account; shared-state files run afterwards and serially.
- [x] Run application acceptance on pull requests only when an application surface changes; pushes, the merge queue, schedules and manual runs always run it. `Combined coverage gates` fails when any verification job failed.
- [x] Run domain test files in parallel with one cloned database per worker.
- [ ] Split the remaining shared-state browser files so they can run in the parallel project with their own accounts or deployment fixtures.

## Native turn reliability

- [x] Implement and locally verify the approved [native turn reliability plan](../projects/native-turn-reliability.md): async OpenCode turns, all-harness permission mappings, separate reported cost metadata and copied SQLite checkpoints. Native fixtures, isolated accounting tests and real synthetic Langfuse readback pass; verified image activated locally.
- [ ] Roll out the rebuilt runtime and application to hosted environments, then repeat a budgeted native run/continuation and verify cost metadata. Original caller draft/approval acceptance remains tracked under [native home persistence](#native-home-persistence).
