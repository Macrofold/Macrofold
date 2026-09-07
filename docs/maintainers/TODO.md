# Release TODO

This is the central list of unresolved release work. It is not part of the published documentation site's navigation, search index, or Markdown export. A checked-in adapter or a local simulation pass does not close a live deployment check.

## Public repository and distribution

- [ ] Enable GitHub private vulnerability reporting. The public repository API currently reports it disabled. Verify the private report flow, then update SECURITY.md with its working direct link.
- [ ] Publish a monitored maintainer contact and community reporting route; update security and conduct policies together. Do not publish a personal email without its owner's approval.
- [ ] Run the required GitHub Actions checks on the release revision and configure repository rulesets. Local passes are not evidence of hosted CI completion.
- [ ] Connect Codecov, enable approved public uploads, and verify TypeScript/Python flags. Add live badges only after real default-branch reports exist.
- [ ] Publish versioned CLI/SDK packages and immutable Linux AMD64 runtime artifacts with checksums/provenance. The public guides currently document installation from source.
- [ ] Accept Windows CLI installation, ACL, and terminal behavior before advertising Windows support. Current documented targets are macOS and Linux.

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

## Documentation publication

- [ ] Set the intended public `APP_ORIGIN` and `PRODUCT_NAME` at build time, rebuild, and verify canonical URLs, sitemap, raw Markdown, and social metadata on the real hostname.
- [ ] Verify deployment access controls and robots headers on previews. Submit the public sitemap in Search Console after verifying domain ownership; monitor indexing rather than claiming an SEO/AEO guarantee.
- [ ] Review any remaining uncommitted work before release. Publish the code and docs from the same reviewed revision.

## Review follow-ups

- [ ] Complete the third full repository review pass. The recorded work contains one full inventory review and one focused follow-up; acceptance tests do not replace another complete review.

- [ ] Bound memory for diffs of very large individual files. Diff pagination now avoids reading omitted files; selected files are still read in full to preserve binary detection. Measure a representative large-file workload before introducing a streaming diff path.
- [ ] Complete draft protection for browser Back/Forward and programmatic navigation, then consider session-local draft recovery. Current editor protection covers normal links, unloading, workspace changes, and refresh conflicts.
- [ ] Test interruption during the CLI device-flow polling interval and requests. The current signal is checked between polls; process termination remains the immediate escape.
- [ ] Before changing compute rates on an existing deployment, settle or inspect legacy accepted runs without a frozen compute-rate field. New admissions snapshot the rate; legacy records retain the environment-rate fallback.

## Ongoing quality

The [coverage gap audit](../engineering/testing/gaps.md) and [mutation record](../engineering/testing/mutation.md) own detailed test debt. Remaining targets include authentication recovery branches, persistence failures, cloud execution policy, and surviving meaningful mutants. No exclusions or superficial assertions should replace those checks.

Live provider quotas/invoices, enterprise SSO/SCIM, arbitrary custom runtime images, a raw remote desktop/PTY, cross-harness conversation migration, and autonomous infrastructure mutation are outside the current product scope. They are not represented as working features in public guides.

Use the [release checklist](../operations/pre-deployment.md) to record each acceptance result with its revision, environment, expected/observed behavior, cost, and evidence location.
