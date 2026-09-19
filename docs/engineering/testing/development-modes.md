# Development-mode acceptance

[Development modes](../../getting-started/local-development.md) owns contributor commands; [implementation](../development-modes.md) owns the architecture. This record distinguishes application tests from complete native and hosted acceptance.

## Current local acceptance

The runtime image builds on Docker Desktop for Linux ARM64 with all six pinned native harnesses. Network-disabled fixtures pass native file tools, checkpoint capture, restored conversation continuation, OpenCode questions and stdio MCP isolation. Hermes, DeepSeek Harness and Pi also pass granted HTTP MCP calls, model-authentication failure and cancellation after file edits. All six complete API-triggered Docker journeys also pass, including worker failure, replay, replacement-container continuation and released reservations. The [harness acceptance record](harnesses.md) owns the full current API/browser/SDK matrix, image identity and remaining release checks.

The runtime-only build worktree shares the repository lockfile, dependency overrides and install policy. It excludes the application and test toolchain from the runtime deployment. Hermes uses its separate frozen upstream Python lock; its dependencies and image costs are covered by [dependency review](../dependencies.md).

The current regression pass uses Node 24.13, PostgreSQL 17 and disposable local fixtures. It passes 695 TypeScript unit/integration/Git tests across 87 files, strict TypeScript, all five SDK suites, four harness dashboard/documentation journeys, five CLI subprocess cases, real terminal interaction and Python HTTP/SSE continuation. The browser wrapper builds its own optimized application, owns its database/files/port and preserves the running preview. Coverage percentages and mutation scores were not recomputed; earlier reports remain separate measurements in [testing and CI](../testing.md).

No live model, cloud sandbox, provider provisioning or staging deployment was invoked. Scripted native model responses validate application integration and runtime behavior, not model quality or real provider billing.

## What the complete runner asserts

The shared `scripts/agent-journey.ts` uses only the customer API through the TypeScript SDK. It requires an idle synthetic account, creates an owned workspace, starts a bounded run, deliberately detaches/reconnects SSE, reads terminal results and exact file bytes, replays the persisted transcript, and continues the native session. The continuation copies the restored `hello.txt` into `continued.txt`; both turns must produce native identity, tool, output and checkpoint events. Terminal run/account reservations must be zero. Owned workspaces are archived and known unfinished runs receive cancellation on failure; history remains inspectable.

The deterministic Docker wrapper supplies actual SQL workers and a gateway-facing local model transport. All three upstream keys are fake; unexpected endpoint/credential combinations fail. Containers use a unique internal network with a test-only, fixed-destination runtime relay. The wrapper kills its own worker after observing native execution, starts a replacement, and verifies distinct container IDs plus zero model reservations and nonzero metered fixture usage through restricted tenant SQL. Existing cloud/gateway/storage suites retain the more detailed failure matrix; paid tests do not duplicate it.

The live runner records each full run ceiling and idempotency key before admission. Retries reuse that identity. Uncertain attempts remain charged against the local approval journal, including continuations; a process death leaves an explicit lock for operator reconciliation. A run budget bounds the application rate policy, not every upstream or infrastructure invoice. Approved catalog rates, provider limits and separate infrastructure allowances are prerequisites.

## Remaining acceptance

| Command / environment                                         | Prerequisite                                                                                                                   | Expected evidence                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:journey:docker` in the native GitHub Actions job                 | Linux Docker, image built from the same revision, disposable database                                                          | Linux host-gateway, capabilities, process limits, cleanup, and complete journeys; no production secrets                           |
| `pnpm dev:docker`, `pnpm worker:docker`, `pnpm doctor:docker` | Configured local overlay and daemon                                                                                            | Dashboard displays Local Docker, all API/runtime routes reach the host, UI updates from external runs                             |
| `pnpm test:journey:live` with `docker`                        | Explicit approved inference budget, compatible model/key, idle synthetic account                                               | Real reasoning for each reviewed harness/model route, managed and BYOK; no Vercel account                                         |
| Same live command with `staging`                              | Isolated deployed API/Workflow, immutable image, private storage, compatible routes, approved model and infrastructure budgets | API-to-Workflow-to-Sandbox-to-model-to-checkpoint continuation, followed by dashboard and hosted recovery inspection              |

Use the [live invocation guide](../../getting-started/local-development/cloud.md#test-a-real-agent-journey). Retain sanitized revision, route, run IDs, outcome and actual provider billing observations. Verify hosted Workflow handoff, image access, R2 writes, SSE flushing, cancellation latency, and sandbox cleanup on the deployed revision. The customer API cannot independently attest every internal hosting setting; operator deployment evidence is still required.

## Changelog

- Complete local execution now uses the same API, SQL phases and checkpoint system for six native harnesses. The initial Docker-daemon limitation was resolved without changing the running preview. Current results are recorded in [harness acceptance](harnesses.md).
- The image build isolates the runtime worktree because filtering the full pnpm worktree still installed unrelated application/test packages. Native dependencies retain the shared frozen lock and approved install policy.
