# Development-mode acceptance

[Development modes](../../getting-started/local-development.md) owns contributor commands; [implementation](../development-modes.md) owns the architecture. This record distinguishes application tests from complete native and hosted acceptance.

## Current evidence

Verified locally on September 7, 2026, with Node 24.13, PostgreSQL 17.11 and disposable databases/files:

| Check                                           | Result                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:coverage`                            | 516 unit/integration/Git tests pass across 71 files; existing global/module gates pass                                                  |
| In-process TypeScript coverage                  | 50.43% lines, 40.76% branches across 209 application files; untouched files remain included                                             |
| `pnpm check`, `pnpm build:runtime`              | Strict TypeScript and native runtime bundles pass                                                                                       |
| Isolated optimized application build            | Passes with its own output directory, database, object files and loopback port                                                          |
| Isolated dashboard and freshness suites         | All six browser journeys pass, including external API runs, reconnects, organization switching, persistent files and historical streams |
| Customer clients against the isolated simulator | Four CLI subprocess cases, real PTY interaction, and Python HTTP/SSE session continuation pass                                          |
| Documentation checks                            | 31 public pages, 119 Markdown files and 54 requirement evidence mappings pass                                                           |

The 17 added tests cover Docker identity/transport uncertainty, ownership and gateway constraints, profile precedence, paid-run guards, native admission under a leftover simulator, managed/BYOK gateway accounting and revocation, cancellation/publication, and live-runner approval accounting. Docker adapter transport tests use a command fixture, and domain lifecycle tests use the existing fault machine; neither launches Docker. The test relay is exercised through actual loopback HTTP, including streaming and rejected non-runtime paths.

Coverage artifacts are in `coverage/development-modes-domain-final` and `coverage/development-modes-browser-final`. Browser/server/CLI observations were collected separately; combined coverage, Python coverage and mutation scores were not recomputed. An initial browser attempt failed before launch because Chromium was absent; installing the pinned Playwright browser resolved it. PostgreSQL ran in an isolated native local cluster because Docker was unavailable. Mailpit delivery was not tested; seed verification-mail delivery logged a local connection refusal, and synthetic account verification still completed.

The Docker daemon in the implementation environment did not answer bounded version/image probes. `pnpm test:journey:docker` failed after its 30-second transport deadline, before provisioning any database, container, or model call. Opening Docker Desktop also timed out; Docker was not restarted because unrelated preview infrastructure must be preserved. Neither a native-image rerun nor complete Docker acceptance is claimed.

No live model, cloud sandbox, provider provisioning, or staging deployment was invoked. Earlier native fixture and live gateway results remain separate evidence, not results of this change.

## What the complete runner asserts

The shared `scripts/agent-journey.ts` uses only the customer API through the TypeScript SDK. It requires an idle synthetic account, creates an owned project, starts a bounded run, deliberately detaches/reconnects SSE, reads terminal results and exact file bytes, replays the persisted transcript, and continues the native session. The continuation copies the restored `hello.txt` into `continued.txt`; both turns must produce native identity, tool, output and checkpoint events. Terminal run/account reservations must be zero. Owned projects are archived and known unfinished runs receive cancellation on failure; history remains inspectable.

The deterministic Docker wrapper supplies actual SQL workers and a gateway-facing local model transport. All three upstream keys are fake; unexpected endpoint/credential combinations fail. Containers use a unique internal network with a test-only, fixed-destination runtime relay. The wrapper kills its own worker after observing native execution, starts a replacement, and verifies distinct container IDs plus zero model reservations and nonzero metered fixture usage through restricted tenant SQL. Existing cloud/gateway/storage suites retain the more detailed failure matrix; paid tests do not duplicate it.

The live runner records each full run ceiling and idempotency key before admission. Retries reuse that identity. Uncertain attempts remain charged against the local approval journal, including continuations; a process death leaves an explicit lock for operator reconciliation. A run budget bounds the application rate policy, not every upstream or infrastructure invoice. Approved catalog rates, provider limits and separate infrastructure allowances are prerequisites.

## Remaining acceptance

| Command / environment                                         | Prerequisite                                                                                                                   | Expected evidence                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:journey:docker` on macOS                           | Responsive Docker Desktop, matching image, local PostgreSQL                                                                    | All three actual API/native journeys and fresh-container continuations pass; internal-network relay and host-gateway reachability |
| Same command in the native GitHub Actions job                 | Linux Docker, image built from the same revision, disposable database                                                          | Linux host-gateway, capabilities, process limits, cleanup, and complete journeys; no production secrets                           |
| `pnpm test:native --image-only` plus question/stdio variants  | Matching built image and responsive Docker                                                                                     | Existing native tools, restore and question/stdio behavior remains intact after fixture extraction                                |
| `pnpm dev:docker`, `pnpm worker:docker`, `pnpm doctor:docker` | Configured local overlay and daemon                                                                                            | Dashboard displays Local Docker, all API/runtime routes reach the host, UI updates from external runs                             |
| `pnpm test:journey:live` with `docker`                        | Explicit approved inference budget, compatible model/key, idle synthetic account                                               | Real reasoning for each reviewed harness/model route, managed and BYOK; no Vercel account                                         |
| Same live command with `staging`                              | Isolated deployed API/Workflow, immutable image, private storage, compatible routes, approved model and infrastructure budgets | API-to-Workflow-to-Sandbox-to-model-to-checkpoint continuation, followed by dashboard and hosted recovery inspection              |

Use the [live invocation guide](../../getting-started/local-development/cloud.md#test-a-real-agent-journey). Retain sanitized revision, route, run IDs, outcome and actual provider billing observations. Verify hosted Workflow handoff, image access, R2 writes, SSE flushing, cancellation latency, and sandbox cleanup on the deployed revision. The customer API cannot independently attest every internal hosting setting; operator deployment evidence is still required.
