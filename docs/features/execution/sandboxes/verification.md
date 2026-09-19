# Sandbox lifecycle acceptance

The [public guide](../sandboxes.md) describes the implemented API. This record distinguishes local verification from provider deployment acceptance.

## Local evidence

- Disposable PostgreSQL 14 fixtures exercise authenticated REST creation/read/list, foreign-tenant denial, active ownership, concurrent maintenance, paused/resumed generations, permanent retirement, checkpoint preservation, idle expiry and compute reservations/settlement. Finance reconciliation includes retained compute; itemized usage attributes server charges separately from runs.
- Transport tests inspect the Render HTTP payload, management-key destination, disposable-disk configuration, ambiguous lookup behavior, asynchronous suspension and service resume/delete mappings. These are fixtures, not live Render requests.
- The network-disabled Linux ARM64 native fixture runs the actual pinned Codex twice on one control-process boot. It verifies file capture, chunk/manifest restoration, native conversation continuation, duplicate prepare/launch fencing, late-run rejection, authenticated control and quiescent release.
- TypeScript checking, public contract checks, and all five SDK acceptance suites pass. The broader lifecycle/accounting/scheduling regression run passed 131 tests in 14 files; subsequent focused edge checks are recorded separately. Python passed 200 HTTP/transport/application tests, alongside TypeScript, Go, Rust and Java journeys. These are local results, not production acceptance.

Earlier local acceptance used runtime overlays and caught a stale-image dependency. The resident-session acceptance below now passes against the rebuilt image without runtime overlays. Cloud acceptance still requires publishing that exact release image.

## Local long-running parity

Provider-selection and lifecycle regression checks pass 17 disposable-database cases plus 15 Docker/Render transport cases. They cover local creation without Render enablement, hosted provider selection, no lifetime expiry for local long-running workers, bounded temporary sandboxes, explicit stop overrides and pause/resume/destroy. A real Docker adapter smoke check created both container modes, verified their actual lifetime commands, reused each identity, removed it, recreated fresh compute and cleaned up all test containers. This smoke check makes no model calls; native harness acceptance remains the separately scoped evidence above.

## Repeat locally

Use the repository's disposable database harness and a current runtime image. No real provider credentials or paid inference are needed:

```sh
pnpm test:domain tests/integration/sandboxes.test.ts tests/unit/render-sandboxes.test.ts tests/unit/docker-machines.test.ts tests/integration/cloud.test.ts tests/integration/billing-usage.test.ts tests/unit/customer-mcp-catalog.test.ts tests/integration/customer-mcp.test.ts
pnpm test:native --sandboxes
pnpm sdk:generate:all
pnpm test:sdks
pnpm exec tsc --noEmit
pnpm docs:generate
pnpm docs:check
```

`test:native` overlays current scripts by default; `--image-only --sandboxes` validates the built image itself. The SDK suite needs the documented Java, Go, Rust and Python contributor toolchains. Follow [testing policy](../../../../TESTING.md) for local database isolation.

## Remaining acceptance

Live Render service creation, image pull, suspension convergence, resource size, root control permissions, egress behavior and actual provider invoices are unverified. Deployed Vercel warm reuse, lifetime rotation and cleanup are also unverified. Test bounded synthetic work against the exact release image and deployment, including provider restart during a run and maintenance outage. The central [release TODO](../../../maintainers/TODO.md#reusable-sandbox-acceptance) owns these remaining tasks.

## Resident native verification

`pnpm test:native --sandboxes --warm` executes two real native turns for each of the six installed harnesses inside network-disabled Docker containers. Loopback fixtures verify retained conversation state, refreshed upstream capabilities, verified file capture, duplicate launch fencing and rejection of old-run control. This is native protocol acceptance, not paid inference or hosted Render/Vercel acceptance.

Warm acceptance also exercises connector calls through the per-turn credential relay and an externally changed checkpoint that forces cold restoration. Transport tests reject idle requests and abort an in-flight request without retrying it under the next run.

The final `pnpm test:native --sandboxes --warm --tools --image-only` run passes for Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness and Pi against the rebuilt Docker image, without source overlays. Each harness completes two compatible turns, cold-restores after a checkpoint change, then cancels an in-flight warm turn. The fixture verifies that cancellation leaves no live agent-user processes.

The terminology change also passes 1,148 unit/integration tests in 136 files, all five generated SDK acceptance suites, 23 targeted optimized-build browser journeys, six CLI integration tests, real PTY interaction, and the Python SDK's local streaming/continuation journey. Migration tests preserve stable IDs, file content, resource references and stored authorization scopes. These checks use disposable local databases and simulated model responses; they do not establish hosted acceptance.
