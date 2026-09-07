# Delivery scope and release acceptance

The product is implemented locally; live hosting, model billing and external account acceptance remain operator launch steps. [implementation status](../status/README.md) is the evidence record, [requirements.csv](../requirements.csv) maps implemented requirements, and [launch guide](../operations/launch-guide.md) is the launch procedure.

## Delivered application boundaries

| Area | Implementation / acceptance family |
|---|---|
| Foundation | Strict TypeScript/pnpm workspace, PostgreSQL migrations/RLS, auth/OAuth, contract validation/projection, local setup/doctor |
| Execution | Durable admission/outbox, phase leases, global/tenant capacity, simulation, real native adapters, runtime input/cancel/timeout, SSE/webhooks |
| Persistence | Encrypted chunked files/Git/native home, hash verification, partial recovery, restore, independent workspaces and GitHub sync |
| Tools | Direct MCP OAuth/bearer, Composio identity/grants, reviewed sandbox stdio, budgeted Brave search |
| Commerce | Managed/BYOK separation, integer reservations/ledger, Stripe credit/subscription/refund/dispute facts, debt/expiration/reconciliation |
| Dashboard | Public home/pricing/docs, account/MFA/team, projects/files/uploads/checkpoints, live/history, connections/keys/webhooks, usage/billing/operator |
| Terminal/SDKs | Forty-command oclif/Ink CLI, device login/profiles, worktrees/chat/stream, explicit transfers/local review; Fetch and Python/httpx clients |
| Operations | Request/activity facts, cohorts, usage dimensions, daily snapshots, metadata-only optional PostHog, read-only admin REST/MCP |
| Deployment | Vercel build, standalone web/worker Docker targets, immutable native image recipe, CI, fresh installation/rotation/backup restoration |

The release excludes enterprise SSO/SCIM, multi-region writes, a browser desktop/raw remote terminal, arbitrary customer images, unlimited Git repositories, automatic provider invoice/quota readers and autonomous infrastructure mutations. Account closure is operator-assisted. These decisions keep the core requested product coherent; no placeholder button should imply those excluded features work. macOS/Linux are the initial terminal targets; Windows install/terminal behavior requires a separate CI/pilot verification before advertised support.

## Free release suite

1. `pnpm install --frozen-lockfile` and `pnpm run setup` create only local fixture infrastructure. Use Node 24 and Docker.
2. `pnpm check` and `pnpm test:domain` verify types and use a disposable database/object store. Fault tests own their run transitions independently of the preview worker.
3. `pnpm exec tsx scripts/test-install.ts` creates and removes two disposable databases and object copies, applies all migrations, provisions identity, rotates keys, restores and continues a session.
4. `pnpm build` compiles the optimized Next.js/Workflow/standalone app. `pnpm contracts` regenerates types/client operation maps; compare generated files in CI.
5. Start web/worker; run `pnpm test:e2e`, `pnpm test:cli`, `python3 scripts/test-terminal.py`, `pnpm test:packages` and Python SDK tests. Browser journeys include desktop accessibility and mobile overflow checks.
6. Build the runtime image and run `pnpm test:native --image-only`. Actual pinned native binaries use a loopback protocol fixture inside `--network none`; no inference account is called. OpenCode interactive-question and stdio fixtures have explicit script modes.
7. Build standalone web/worker targets and run `scripts/test-standalone.ts` against the configured local container origin, including `--execute` with its worker.
8. Run `python3 tests/test_costs.py`, dependency audit/license inventory, contract/source hygiene and docs-link checks. Audit output is point-in-time evidence, not a security certification.

`.github/workflows/verify.yml` automates the core local suite without cloud/model secrets. A GitHub execution can consume Actions minutes and has not been claimed as remotely executed. Published package provenance and cloud promotion occur only in the operator's protected release workflow.

## What evidence means

Fixture: actual local database/auth/browser/Git/native process with intercepted upstream HTTP. Live-free: real external nonbillable request, when explicitly recorded. Live-billable-not-run: Vercel execution, real model/search/connector use or paid hosted resources, deliberately excluded here. Live-billable-passed: only after the operator records an actual controlled smoke test.

No simulated text is called a real model answer. A local image build does not prove VCR accepts it for an account. A signature fixture does not prove Stripe live account setup. An R2 SigV4 fixture does not prove the deployed bucket CORS/retention policy. A backup file existing does not prove application recovery; the restore test exercises restored identity, hashes and session continuation.

## Operator release inputs

Own the production domain, source/package namespaces and service accounts. Supply restricted database/object/identity/provider credentials; configure callbacks, prices, cron, egress and spending limits; verify email and payment accounts; publish legal/support/retention policies; build/push the immutable native image; rehearse paired production recovery; run a bounded paid smoke test for each enabled route. Publish only model/harness combinations that pass that account's test. These are concrete external inputs and deployment actions, not unspecified application implementation work.
