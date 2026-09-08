# Release acceptance checklist

Use this checklist for each hosted release after following the [deployment guide](launch-guide.md). Record unresolved work in [release TODO](../maintainers/TODO.md); keep credentials and account-specific evidence in a private operator record.

Each recorded check should identify the source revision, app deployment, runtime digest, environment, UTC time, expected and observed behavior, cost, and evidence location. Local fixtures verify application behavior; they do not establish hosted provider acceptance.

Verify all five SDKs against the activated hosted origin, including typed requests/results, SSE replay/reconnection, and synthetic credential revocation. [Resource SDK acceptance](../engineering/testing/sdk-resources.md) records local proof and the unactivated canonical-origin boundary.

After native checkpoint publication, verify path-based file reads in all five SDKs, including empty/binary files and foreign-project denial. Verify the `download=true` capability returns a complete file larger than 4 MiB from deployed storage without forwarding the API key. These pass with local encrypted objects; deployed R2/routing acceptance remains required.

Use a saved preset to verify plain-text streaming and `wait()` through deployed execution/checkpoint publication. Confirm that failure/cancellation raises the SDK's typed run error, a wait deadline leaves execution active, and reconnecting never repeats a delivered sequence. These are local-fixture passes; deployed transport and native-agent acceptance remain separate.

## Configuration and identity

- [ ] Staging and production have independent databases, buckets, credentials, callback origins, and financial ledgers.
- [ ] The Vercel team/project/environment is selected explicitly. The dedicated staging project's Production deployment uses staging resources, and Preview deployments cannot access production data.
- [ ] Neon's production history window meets the seven-day recovery target on a supporting plan; production branch protection is enabled. Isolated root-branch PITR is rehearsed, with actual retained history and recovery time recorded.
- [ ] Serving processes use restricted database roles. Owner credentials are available only to administrative commands.
- [ ] All forward SQL and auth migrations and OAuth registration match the release. Existing deadlines, terminal records, and reservations are preserved.
- [ ] Auth/vault/cron keys match existing encrypted records. Retained decrypt keys and recovery copies are available.
- [ ] HTTPS origin, domain, email sender, edge abuse controls, and public signup policy are configured.
- [ ] Signup, verification, reset, MFA/recovery, invitations, session expiry, and OAuth/device refresh/revocation work with synthetic accounts.
- [ ] Cross-organization reads, role/scope/project restrictions, ownership changes, and revoked delegated authority are denied as expected.

## Native execution and persistence

- [ ] The immutable Linux AMD64 runtime image is ready and compatible with the selected model catalog and provider routes.
- [ ] Each supported native harness performs a bounded task, emits usage/output, saves a checkpoint, and continues in a fresh sandbox.
- [ ] Run `pnpm test:journey:docker` against the release image with scripted providers, then `pnpm test:journey:live` against isolated staging for each reviewed harness/model and funding route. Follow the [budgeted live guide](../getting-started/local-development/cloud.md#test-a-real-agent-journey); verify dashboard state, deployed Workflow handoff, storage writes and sandbox cleanup separately. Neither narrow native fixtures nor gateway-only live calls establish this complete journey.
- [ ] Managed and BYOK calls use the intended credentials. Revoked BYOK never falls back to a platform key. Provider usage and application settlement reconcile.
- [ ] Cancellation, input races, execution timeout, unknown launch acknowledgment, fencing, Workflow continuation, and worker recovery preserve one execution identity.
- [ ] Queue expiry uses the accepted deadline, retains history, emits explicit failure, and releases reserved funds exactly once.
- [ ] Maximum supported execution/persistence workloads fit provider lifetime, transfer, memory, and Workflow budgets.
- [ ] R2 permissions, binary uploads/downloads, exact-origin CORS, expired capabilities, missing/corrupt objects, and restore failures behave as specified.
- [ ] Conflicting file writes fail without overwriting newer state. Deletion/undo and delayed object collection preserve retained references.
- [ ] Database + encrypted objects + retained keys restore independently; recovery objectives are measured.

## Integrations and payments

- [ ] GitHub App installation, user repository access, signed webhook reception, clean sync, conflicts, branch protection, and revocation work on a disposable repository.
- [ ] Composio private-account authorization and public HTTPS callback verification bind the returning user, attempt, toolkit, and account. A granted action succeeds and revoked access is rejected.
- [ ] Remote MCP OAuth/credentials and approved stdio tools respect tool grants, destination constraints, cancellation, and unknown-outcome handling.
- [ ] Each enabled search provider performs a bounded authenticated query; quota/error responses and provider billing match the selected funding policy.
- [ ] Stripe test Checkout, Portal, subscription renewal/change/cancellation, duplicate/out-of-order events, refunds/disputes, and interrupted settlement reconcile correctly.
- [ ] Stripe's default Portal is saved for the intended account/mode and prices. The enabled destination uses its own signing secret, all fourteen selected event types, and a compatible snapshot-event API version. Delivery passes Vercel protection and updates the application ledger; a redirect or saved credential alone is not a pass.
- [ ] Resend delivers verification and reset mail from the verified sender to controlled real inboxes.
- [ ] Webhook receivers verify signatures, deduplicate stable event IDs, tolerate ordering differences, and recover through retries/replay.

## Dashboard, API, CLI, and reporting

- [ ] Public docs, API reference, OpenAPI, canonical metadata, sitemap, Markdown, and agent indexes match the deployed build.
- [ ] Dashboard/API/CLI see externally created runs and updated file/Git state. Navigation preserves the shared refresh subscription.
- [ ] The deployed edge flushes SSE, supports bounded durations, reconnects after rotation, and preserves detailed replay. Permission/organization changes prevent leakage.
- [ ] CLI package installation, device login, worktrees, streaming, explicit file transfer, and interrupted-operation recovery work on supported platforms.
- [ ] Customer usage and separate operator REST/MCP reports enforce scope and contact-data restrictions, record observations, and expose missing sources.
- [ ] No prompts, secrets, customer files, or raw tool payloads enter general analytics or public reports.

## Capacity and release controls

- [ ] Required CI, package, native, browser, coverage, and mutation checks pass on the release revision with synthetic fixtures and no production secrets.
- [ ] Quiet-host sustained and burst tests verify limits, workspace ordering, fair opportunities for new accounts, cancellation, expiry, and worker failure.
- [ ] Vendor Sandbox/model quotas, database connection budget, function duration, image access, and region headroom are verified before raising the ceiling.
- [ ] Monitor active executions, eligible backlog, oldest wait, waiting by account, submission-to-start latency, maintenance age, and financial drift.
- [ ] Neon CPU, connections, database/history growth, latency, and billed active compute are monitored. Capacity and cost estimates account for Cron/polling that can prevent suspension.
- [ ] Rollback/drain and incident procedures are rehearsed. A named operator owns support and monitoring.
- [ ] Private vulnerability reporting, maintainer contact, artifact publication, and applicable policy pages are ready before announcing general availability.

## Current evidence

Use [implementation status](../status/README.md), [testing and CI](../engineering/testing.md), [development-mode acceptance](../engineering/testing/development-modes.md), [live integration results](../engineering/testing/live-integrations.md), [Workflow history](../features/execution/workflow-history.md), and [dashboard stream verification](../features/dashboard/live-refresh/verification.md). Record a pass only for the specific environment and behavior actually exercised.

## Slack triggers and scheduled tasks

Apply migration 028 and verify the existing maintenance worker/cron. Use the [Slack setup guide](../features/triggers/slack.md) with a synthetic test workspace and the [trigger acceptance checklist](../engineering/testing/triggers.md#remaining-live-acceptance). Verify the public HTTPS callback, signed challenge, bot/channel permissions, threaded reply and scheduled run before enabling customer automation. Local fixtures do not prove Slack callback timing or Vercel cron delivery. Real model execution requires a separately approved budget.
