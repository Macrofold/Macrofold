# Release TODO

This is the central list of unresolved release work. It is not part of the published documentation site's navigation, search index, or Markdown export. A checked-in adapter or a local simulation pass does not close a live deployment check.

## Public repository and distribution

- [ ] Enable GitHub private vulnerability reporting. The public repository API currently reports it disabled. Verify the private report flow, then update SECURITY.md with its working direct link.
- [ ] Publish a monitored maintainer contact and community reporting route; update security and conduct policies together. Do not publish a personal email without its owner's approval.
- [ ] Run the required GitHub Actions checks on the release revision and configure repository rulesets. Local passes are not evidence of hosted CI completion.
- [ ] Connect Codecov, enable approved public uploads, and verify TypeScript/Python flags. Add live badges only after real default-branch reports exist.
- [ ] Activate the SDK default origin `https://app.macrofold.ai` in DNS and hosting, then verify authenticated requests and SSE with a synthetic account. Production configuration identifies this canonical origin; its DNS was still pointed at parking during SDK acceptance. See [resource SDK verification](../engineering/testing/sdk-resources.md).
- [ ] Publish versioned CLI/SDK packages and immutable Linux AMD64 runtime artifacts with checksums/provenance. The public guides currently document installation from source. Reserve and verify `macrofold` on npm, PyPI, and crates.io, `dev.macrofold:macrofold` on Maven Central, and version the Go submodule. Verify clean consumer installs and real hosted endpoints for all five SDKs before registry publication.
- [ ] Accept Windows CLI installation, ACL, and terminal behavior before advertising Windows support. Current documented targets are macOS and Linux.

## Development modes and complete agent acceptance

Follow the [implementation brief](../engineering/development-modes.md) and keep the [developer guides](../getting-started/local-development.md) aligned with actual capability.

- [x] Connect local Docker through the existing provider port, SQL worker, gateway and checkpoint lifecycle, with explicit shared profile, budgeted inference and synthetic local compute accounting.
- [ ] Run the implemented `pnpm test:journey:docker` on a responsive Docker daemon and Linux CI; its current attempt stopped at the bounded image probe. Then accept each reviewed live Docker/cloud harness/model route with `pnpm test:journey:live` under separately approved inference/infrastructure budgets. Confirm dashboard freshness, internal network host-gateway reachability, checkpoint recovery and sandbox cleanup; see [exact evidence and commands](../engineering/testing/development-modes.md).

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

- [ ] Reconcile existing production auth/vault/cron key sets with stored encrypted credentials in the private operator record. Import only restricted runtime credentials; retain migration-owner access separately.
- [ ] Verify the production Neon history window and protection flag, configure the recommended seven-day history on a supporting paid plan, enable branch protection, and rehearse isolated PITR. The supplied setup handoff reports six-hour history and protection disabled; this documentation review did not re-query account metadata. Follow [database safeguards](../operations/neon.md#production-recovery-safeguards).
- [ ] Finish the prepared staging deployment in the intended Vercel project: isolated database/bucket/email, migrations, reviewed source, default Stripe Portal, protected webhook reachability, destination activation, and Checkout-to-ledger acceptance. Reverify reported saved credentials and prices; do not recreate the destination merely because it is disabled or infer readiness from the reported variable count. Follow [project selection](../operations/launch-environment.md#staging-and-vercel-project-selection) and [billing activation](../operations/launch-integrations.md#activate-and-test-staging-billing).
- [ ] Complete Vercel domain, environment, Workflow, Cron, immutable runtime-image, and region configuration. Test the actual deployed revision and supported provider quotas.
- [ ] Complete email-domain verification and real verification/reset delivery; a Resend test-recipient request has passed, but production sender acceptance is separate.
- [ ] Verify R2 writes, CORS, lifecycle scope, staged transfers, checkpoint restoration, and object/database/key recovery. Read authentication has passed; write acceptance requires an approved allowance or budget.
- [ ] Verify authentication, MFA, invitation, CLI device/OAuth refresh/revocation, organization switching, and ownership changes on the hosted deployment.
- [ ] Rehearse backup recovery and document measured RPO/RTO in the private release record. Publish deployment support, privacy, terms, and retention policies.

## Execution, integrations, and money

- [ ] Run a bounded native cloud task and continuation for each supported harness/model route. Managed/BYOK gateway protocol tests passed for OpenAI, Anthropic, and OpenRouter; they do not establish native Sandbox execution.
- [ ] Complete deployed Composio callback acceptance, a narrowly granted action through the run broker, and live revocation rejection. Local GitHub consent, verified callback activation and one authenticated profile read with a provider log ID pass; see [live acceptance](../engineering/testing/live-integrations.md#github-callback-acceptance).
- [ ] Complete authenticated search-provider, remote/stdio MCP, and GitHub App synchronization/revocation tests using synthetic data and explicit budgets.
- [ ] Complete Stripe test-ledger Checkout, Portal, recurring invoice, duplicate/out-of-order event, refund/dispute, and reconciliation acceptance before enabling live money flows.
- [ ] Verify deployed Workflow handoff, ambiguous launch recovery, maximum persistence workloads, cancellation, and queue expiry without duplicate execution or lost reservations.
- [ ] Verify dashboard SSE flushing, server timeout/reconnect, permission revocation, cross-instance behavior, and connection costs through the deployed edge.
- [ ] Validate sustained fairness and capacity on the deployed topology before increasing limits. The local 11-case suite passes eight/50-slot workloads on a quiet host; it does not validate 50 live sandboxes or deployed provider quotas.

## Marketing publication

- [ ] Choose a direction from the [ten marketing concepts](../product/marketing/README.md), confirm final brand copy, and promote it to the canonical homepage in a separate reviewed change. The gallery is public but noindexed; it does not run an A/B experiment.
- [ ] Check the selected page on the deployed hostname, in Safari/Firefox and on physical mobile devices; local Chromium/accessibility checks do not establish conversion or usability.
- [ ] Produce and validate the selected hero animation from its [motion study](../product/marketing/README.md). The ten generated posters are concept frames; measure the final media's loading, frame pacing, and reduced-motion behavior before publication.

## Documentation publication

- [ ] Set the intended public `APP_ORIGIN` and `PRODUCT_NAME` at build time, rebuild, and verify canonical URLs, sitemap, raw Markdown, and social metadata on the real hostname.
- [ ] Verify deployment access controls and robots headers on previews. Submit the public sitemap in Search Console after verifying domain ownership; monitor indexing rather than claiming an SEO/AEO guarantee.
- [ ] Review any remaining uncommitted work before release. Publish the code and docs from the same reviewed revision.

## Review follow-ups

- [ ] Complete the third full repository review pass. The recorded work contains one full inventory review and one focused follow-up; acceptance tests do not replace another complete review.

- [ ] Complete draft protection for browser Back/Forward and programmatic navigation, then consider session-local draft recovery. Two-second autosave reduces the unsaved window; current protection covers normal links, unloading, workspace changes, and refresh conflicts, but a Back action before the debounce still needs explicit recovery.

## Ongoing quality

The [coverage gap audit](../engineering/testing/gaps.md) and [mutation record](../engineering/testing/mutation.md) own detailed test debt. Remaining targets include authentication recovery branches, persistence failures, cloud execution policy, and surviving meaningful mutants. No exclusions or superficial assertions should replace those checks.

Live provider quotas/invoices, enterprise SSO/SCIM, arbitrary custom runtime images, a raw remote desktop/PTY, cross-harness conversation migration, and autonomous infrastructure mutation are outside the current product scope. They are not represented as working features in public guides.

Use the [release checklist](../operations/pre-deployment.md) to record each acceptance result with its revision, environment, expected/observed behavior, cost, and evidence location.

## Trigger release acceptance

Restore the unchanged 38% domain function-coverage floor. The final trigger suite passes 571 tests and the other coverage floors, but function coverage is 37.35%. Keep the complete application inventory visible and add meaningful tests; see [trigger evidence](../engineering/testing/triggers.md#full-suite-result-and-coverage-gap). Browser/CLI acceptance passes separately and does not override this domain gate.

Complete the [live Slack and cloud scheduling checks](../engineering/testing/triggers.md#remaining-live-acceptance). Measure callback latency, maintenance throughput and retained receipt growth before offering a delivery or start-time SLA.
