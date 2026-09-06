# Hosted agent platform

[Testing rules for contributors](TESTING.md) · [CI, coverage reports, and badge setup](docs/24-testing-ci.md). Live badges require the final GitHub repository and its first coverage upload.

An API, streaming terminal CLI, and dashboard for invoking real agent harnesses against persistent cloud projects. The launch implementation includes Codex, Claude Code, and OpenCode; configurable MCP tools; optional GitHub synchronization; BYOK and managed credits; and read-only management tools for operator agents.

**Status: implemented dashboard, API, CLI, worker and deployment packages, with local end-to-end acceptance.** Native harnesses have been tested against local model fixtures in isolated Docker containers. Live cloud, paid inference and vendor billing have not been exercised. See [the verification record](docs/16-implementation-status.md) for current evidence and required operator launch checks.

The application is a TypeScript monorepo: `apps/web` contains the Next.js dashboard and HTTP adapters, `packages/core` owns domain services, `packages/providers` contains vendor adapters, `packages/runtime` owns the sandbox supervisor and native harnesses, and `packages/cli` plus `sdk` contain customer clients. API reference is served at `/reference` from the checked-in OpenAPI contract.

## Get it running

Use Node 24, pnpm 10 and Docker. Run `pnpm install --frozen-lockfile`, then `pnpm run setup`. Start `pnpm dev` and `pnpm worker` in separate terminals and open `http://localhost:3210`. The local sign-in form provides the demo account; all local runs are visibly simulated with no model charges. `pnpm run doctor` checks readiness.

For real users, follow [the step-by-step launch guide](docs/18-launch-guide.md) and complete [integration acceptance](docs/21-pre-deployment-checklist.md). It covers owner accounts, domain/DNS, restricted database roles, private R2/CORS, auth/email, runtime image publication, Stripe, GitHub/MCP, models/BYOK, operator agents, backups, package publication and the controlled live smoke test. [Deployment architecture](docs/22-deployment.md) includes the standalone web/worker alternative. No paid provider or public deployment has been created during local verification.

## Read in this order

1. [Product and acceptance criteria](docs/00-product.md)
2. [Architecture and data model](docs/01-architecture.md)
3. [Runtime and harness adapters](docs/02-runtime.md)
4. [Persistent filesystems and Git](docs/03-workspaces.md)
5. [Public API and SDK specification](docs/04-api.md)
6. [Security, identity, and integrations](docs/05-security-integrations.md)
7. [Billing, rate card, and cost model](docs/06-billing-costs.md)
8. [Customer and operator dashboard](docs/07-dashboard.md)
9. [Analytics and management MCP](docs/08-analytics-operations.md)
10. [Hosting, deployment, scaling, and recovery](docs/09-deployment.md)
11. [Implementation sequence and release acceptance](docs/10-delivery.md)
12. [Decisions, research, and evidence limits](docs/11-research.md)
13. [Twenty name candidates](docs/12-names.md)
14. [Vercel-first architecture and provider portability](docs/13-portability.md)
15. [Terminal CLI: commands, streaming, and local/remote workflow](docs/14-cli.md)

The [requirements map](docs/requirements.csv) connects the requested capabilities to their design and verification. The [machine-readable API contract](docs/api/openapi.json) and [management tool catalog](docs/api/admin-mcp.json) drive request validation, response projection and generated SDK routes. The verification record distinguishes implemented behavior from unverified vendor integration. The [cost scenarios](docs/cost-scenarios.csv) contain illustrative operating estimates. See the [validation record](docs/validation.md) for checks performed and their limits.

## Decisions already made

Public SaaS and permissively licensed open source; Vercel-hosted Next.js, Sandbox and Workflow; optional Composio/direct MCP and a metered direct-provider gateway; independent PostgreSQL and R2 persistence; three harnesses at launch; persistent projects; separate agent workspaces and branches; optional automatic clean Git integration; dashboard file editing; streaming remote CLI; BYOK plus managed credits; pay-as-you-go plus subscription; editable low/base/high cost estimates; read-only operator agents.

The Vercel-first decision supersedes the earlier Railway/E2B launch topology. A standalone Node/Docker build preserves application portability; replacing managed providers requires implementing and validating their adapters. Migration happens between runs, with verified file/session exports and possible connector reauthorization. The [CLI contract](docs/api/cli.json) maps terminal commands to the public API; local project linking never uploads files implicitly.

The directory name is a codename. Product display names, domains, sender identities, and published SDK namespaces must be configurable. Domain objects and persistence keys use neutral resource names.

## Development

Use Node 24, pnpm 10 and Docker. The local profile uses PostgreSQL and Mailpit, an encrypted content store, and a simulator that performs no model or cloud-sandbox requests. Run `pnpm run setup` to prepare local services, migrations, authentication and demo data. Start the web application with `pnpm dev` and the worker with `pnpm worker` after local setup. `pnpm run doctor` checks the configuration without invoking a model. Run `pnpm check`, `pnpm test:domain`, and `pnpm test:e2e` for the relevant suites. `pnpm test` and `pnpm test:domain` use a disposable database and object directory, separate from the preview worker. Browser and CLI acceptance have their own commands and require the local web/worker.

No cloud account is created by the local tests. Production configuration, image publication, DNS and an operator-controlled live smoke test remain distinct release steps. The directory name is a codename; configure the display name with `PRODUCT_NAME`.

The latest [code and interface review](docs/23-code-review.md) records architecture standards, bug fixes, the Radix control system, daily usage charts, and validation boundaries.


Execution controls: [plans, fair scheduling and manual scaling](docs/25-scheduling.md). Starter/Pro/Scale support up to 2/10/50 active jobs and 30/60/120-minute execution windows. New queue deadlines default to 24 hours, with per-request shorter waits. Apply migration 024 with this release.
