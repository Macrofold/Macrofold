# Release TODO

This is the central list of unresolved release work. It is not part of the published documentation site's navigation, search index, or Markdown export. A checked-in adapter or a local simulation pass does not close a live deployment check.

Product and architecture proposals are tracked separately in [ranked improvements](../product/improvements.md). The Workflow/Temporal evaluation is conditional on product needs and is not a launch blocker or an approved migration.

## Public repository and distribution

- [ ] Resolve the four-field first-run API: harness, provider, model, and prompt. Define workspace creation and funding defaults before changing admission, OpenAPI, generated SDKs, and examples together. Current examples accurately retain the required project and billing mode; provider selection comes from the catalog.

- [ ] Enable GitHub private vulnerability reporting. The public repository API currently reports it disabled. Verify the private report flow, then update SECURITY.md with its working direct link.
- [ ] Publish a monitored maintainer contact and community reporting route; update security and conduct policies together. Do not publish a personal email without its owner's approval.
- [ ] Run the required GitHub Actions checks on the release revision and configure repository rulesets. Local passes are not evidence of hosted CI completion.
- [ ] Connect Codecov, enable approved public uploads, and verify TypeScript/Python flags. Add live badges only after real default-branch reports exist.
- [ ] Activate the SDK default origin `https://app.macrofold.ai` in DNS and hosting, then verify authenticated requests and SSE with a synthetic account. Production configuration identifies this canonical origin; its DNS was still pointed at parking during SDK acceptance. See [resource SDK verification](../engineering/testing/sdk-resources.md).
- [ ] Publish versioned CLI/SDK packages and immutable Linux AMD64 runtime artifacts with checksums/provenance. The public guides currently document installation from source. Reserve and verify `macrofold` on npm, PyPI, and crates.io, `dev.macrofold:macrofold` on Maven Central, and version the Go submodule. Verify clean consumer installs and real hosted endpoints for all five SDKs before registry publication.
- [ ] Accept Windows CLI installation, ACL, and terminal behavior before advertising Windows support. Current documented targets are macOS and Linux.

## Development modes and complete agent acceptance

- [x] Verify the rebuilt-image Claude Haiku file-writing retest: the operator confirmed `hello.txt` and its contents after refresh, and supplied a final successful API result with verified persistence and a checkpoint ID. Network-disabled context, capture, restore and permission tests also pass. See [harness acceptance](../engineering/testing/harnesses.md).
- [x] Observe local live continuation updating the existing file and retaining both lines after refresh. Verify local CLI device login, project listing and doctor (`ok: true`, zero inference requests). The operator also supplied dashboard evidence of zero reserved funds and aggregate usage charges; see [harness acceptance](../engineering/testing/harnesses.md).
- [ ] Reconcile exact per-run settled cost for the local Haiku tests with provider usage; the dashboard's period aggregate does not identify the cost of an individual run.

- [ ] Accept the pinned Hermes, DeepSeek and Pi adapters on Linux AMD64/Vercel and live managed/BYOK routes under a new approved budget. Verify image startup, long conversations/compaction, external MCP revocation and interruption recovery. See [harness acceptance](../engineering/testing/harnesses.md).

Follow the [implementation brief](../engineering/development-modes.md) and keep the [developer guides](../getting-started/local-development.md) aligned with actual capability.

- [x] Connect local Docker through the existing provider port, SQL worker, gateway and checkpoint lifecycle, with explicit shared profile, budgeted inference and synthetic local compute accounting.
- [x] Pass all six complete API-triggered Docker journeys locally on Linux ARM64 with scripted models, internal-network relay, worker recovery, stream replay, file verification, replacement-container continuation and released reservations.
- [ ] Repeat the complete matrix on Linux AMD64 CI and accept each reviewed live Docker/cloud harness/model route with `pnpm test:journey:live` under separately approved inference/infrastructure budgets. Confirm deployed dashboard freshness, Workflow handoff, checkpoint recovery and sandbox cleanup; see [exact evidence and commands](../engineering/testing/development-modes.md).

## Automated staging and production releases

The current launch guide is an explicit deployment walkthrough. Implement and accept a separate release workflow before documenting automatic deployment as available. Reuse the existing verification jobs; this work does not replace the isolated staging and production environments.

- [ ] Configure separate GitHub deployment environments with explicit Vercel team/project identities, environment-scoped secrets, and administrative migration credentials unavailable to the application. Keep deployment credentials out of fork and untrusted pull-request jobs.
- [ ] Trigger a release from a reviewed immutable commit after every required verification job for that commit passes. Serialize releases and prevent a delayed older run from promoting over a newer release; do not cancel a migration or partially completed release blindly.
- [ ] Rehearse and apply staging migrations, publish the matching native runtime image, deploy staging, then run deployed API/browser acceptance using synthetic accounts. Keep paid native/provider checks explicitly budgeted and distinguish them from free fixtures and metadata checks.
- [ ] Apply only backward-compatible production migrations and prepare that same source revision with production settings and a ready immutable runtime digest. Verify image availability in the production project's registry; do not assume a staging image reference grants cross-project access.
- [ ] Prepare the production deployment with `--prod --skip-domain`, run non-mutating readiness checks against its deployment URL, and promote that exact deployment only after success. This candidate already uses production resources. Keep destructive tests in isolated staging. See [Vercel promotion](https://vercel.com/docs/deployments/promoting-a-deployment).
- [ ] Make promotion automatic after all gates pass, with an optional GitHub environment approval for operators who want it. Configure Vercel Git deployment/domain assignment so it cannot bypass those gates. Separate-project staging acceptance promotes a source revision; it does not move the staging deployment or test credentials into production.
- [ ] Preserve running Workflow/native execution, historical replay, reservations and retained runtime images during release and rollback. Check deployed Workflow/Cron behavior around promotion and supported recovery paths. A domain switch does not roll back schema changes.
- [ ] Test failed verification, failed deployment, failed readiness, interrupted release, overlapping releases and compatible rollback. Record commit, image digest, deployment IDs, target environment and results without secrets. Add an ordered one-time pipeline setup guide and update the launch walkthrough only after the workflow exists and hosted acceptance passes.

## Hosted application

- [ ] Accept the redesigned dashboard on deployed Cloud and self-hosted origins in Safari, Firefox, and physical mobile devices. Verify theme persistence, editor drafts, nested account-menu keyboard/screen-reader navigation, reduced-motion/forced-color focus, hidden-scrollbar scrolling, waiting sheen, clipboard feedback, and copied documentation URLs. Keep the account assistant labeled as a UI preview until a separately reviewed hosted implementation exists; see [dashboard improvements](../product/improvements.md#dashboard).

- [ ] Reconcile existing production auth/vault/cron key sets with stored encrypted credentials in the private operator record. Import only restricted runtime credentials; retain migration-owner access separately.
- [ ] Verify the production Neon history window and protection flag, configure the recommended seven-day history on a supporting paid plan, enable branch protection, and rehearse isolated PITR. The supplied setup handoff reports six-hour history and protection disabled; this documentation review did not re-query account metadata. Follow [database safeguards](../operations/neon.md#production-recovery-safeguards).
- [ ] Complete staging acceptance after the healthy redeployment. Isolated database migrations, scoped storage access, verified sender, immutable runtime publication and canonical health now pass. The Stripe test destination is enabled at the canonical origin after signature/reachability probes; the default test Portal is saved and API-verified. Application-created sandbox top-up, actual signed delivery, exact ledger credit and Portal entry now pass; subscription changes and reversal cases remain pending. Follow [project selection](../operations/launch-environment.md#staging-and-vercel-project-selection) and [billing activation](../operations/launch-integrations.md#activate-and-test-staging-billing).
- [ ] Verify deployed Workflow/native execution and supported provider quotas. The accepted staging source and Ready Linux AMD64 runtime are deployed in `iad1`; the enabled minutely Cron has returned HTTP 200 and direct maintenance reports no component failures. The first native run failed before model dispatch because Vercel rejected IPv6 CIDRs. Bounded probes confirmed the cause and a VM-level IPv6-disable repair; deploy the tested adapter and repeat native/persistence acceptance. These checks do not establish successful agent execution.
- [ ] Complete password-reset email delivery. The staging sender is verified and domain-scoped; operator signup verification and MFA now pass. Production sender acceptance remains separate.
- [ ] Verify staged transfers, checkpoint restoration, and object/database/key recovery. Staging R2 write/read/delete, private access, exact-origin CORS, temporary-prefix lifecycle and denial of production access now pass; this does not establish application-level recovery or production storage acceptance.
- [ ] Verify authentication, MFA, invitation, CLI device/OAuth refresh/revocation, organization switching, and ownership changes on the hosted deployment.
- [ ] Rehearse backup recovery and document measured RPO/RTO in the private release record. Publish deployment support, privacy, terms, and retention policies.

## Execution, integrations, and money

- [ ] Deploy migration 034 and accept the [Customer agents integration path](../features/customer-agents/implementation.md) with two synthetic app customers and two real accounts of one toolkit. Verify the project's registered HTTPS callback, cross-site cookies, authenticated app return, exact account reconnect, permission revocation during consent, provider-subject execution and uncertain-account reconciliation. Local fixtures are not live OAuth acceptance. Migrate the preview only when restarting the intended preview revision.

- [ ] Obtain Anthropic approval for the exact hosted native subscription arrangement, then implement the isolated authentication/controller boundary, generation-fenced credential persistence, quota preflight, budgeted API fallback, continuation and separate usage accounting. Named configurations are implemented; these execution capabilities are not. The previous four-task live authorization is exhausted. See [design and acceptance requirements](../engineering/testing/named-connections.md).
- [ ] Accept two real Composio accounts of the same toolkit through HTTPS consent, pinned execution, rename/reconnect, and upstream revocation. Fixtures verify SDK account-selection shapes but do not establish actual provider account identity or revocation.

- [ ] Accept [model catalog refresh](../features/execution/models.md) in deployed maintenance after migration 029. Verify account entitlements, fresh/stale cache behavior across instances, OpenRouter routing price ceilings and vendor invoice reconciliation with separately approved inference budgets. Free metadata checks do not establish native execution acceptance.
- [ ] Run a bounded native cloud task and continuation for each supported harness/model route. Managed/BYOK gateway protocol tests passed for OpenAI, Anthropic, and OpenRouter; they do not establish native Sandbox execution.
- [ ] Complete deployed Composio callback acceptance, a narrowly granted action through the run broker, and live revocation rejection. Local GitHub consent, verified callback activation and one authenticated profile read with a provider log ID pass; see [live acceptance](../engineering/testing/live-integrations.md#github-callback-acceptance).
- [ ] Complete authenticated search-provider, remote/stdio MCP, and GitHub App synchronization/revocation tests using synthetic data and explicit budgets.
- [ ] Complete Stripe subscription Checkout, Portal plan changes/cancellation, recurring invoice, duplicate/out-of-order event, refund/dispute, and reconciliation acceptance before enabling live money flows. Staging top-up settlement and Portal entry pass. Keep the sandbox Managed Payments default disabled for the current standard Checkout integration.
- [ ] Rotate the expiring staging Anthropic key before October 16, 2026; retain workspace isolation and the configured $1 monthly cap. Metadata access passes; native run acceptance remains separate.
- [ ] Verify deployed Workflow handoff, ambiguous launch recovery, maximum persistence workloads, cancellation, and queue expiry without duplicate execution or lost reservations.
- [ ] Verify dashboard SSE flushing, server timeout/reconnect, permission revocation, cross-instance behavior, and connection costs through the deployed edge.
- [ ] Validate sustained fairness and capacity on the deployed topology before increasing limits. The local 11-case suite passes eight/50-slot workloads on a quiet host; it does not validate 50 live sandboxes or deployed provider quotas.

## Marketing publication

- [ ] Set a real public `SUPPORT_EMAIL` for Business/Enterprise sales links. A missing or placeholder address currently yields a working billing-guide link rather than an invented contact. Confirm the Business $1,000/month offer’s concurrency, runtime, storage, retention, credits, and support terms before activation; add reviewed entitlements and Stripe prices before offering self-serve checkout. Enterprise remains individually quoted.

- [ ] Build the reviewed marketing release source before publication. [Site verification](../product/marketing/site/verification.md) records browser, calculator, TypeScript, and remaining device/background-tab acceptance.

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

- [ ] Update and accept the DeepSeek runtime dependency chain for the `js-yaml` empty-merge CPU advisory (patched in 4.3.2). The September 10 production audit reports one high finding through `@deepseek-ai/cordis-plugin-include`; none belongs to the new Tiptap editor dependencies.

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

- Connect the dedicated marketing-media bucket to its production custom domain, verify CDN caching and byte ranges, set `MARKETING_MEDIA_BASE_URL` and redeploy. The [playlist setup guide](../product/marketing/site/swarm-playlist.md) contains complete commands. Preserve private workspace bucket access.
- Verify 1.3× playlist transitions, autoplay, clear loading/failure backgrounds, offscreen suspension and sustained playback on physical iPhone Safari and Android Chrome with constrained bandwidth. Local desktop playback does not establish these device results.
