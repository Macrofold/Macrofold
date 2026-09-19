# Extensibility and permission verification

The [codebase map](../../architecture/codebase.md#typed-policy-and-preparation-boundaries) identifies the implemented boundaries; [agent permissions](../../features/execution/permissions.md) defines supported semantics and harness limits.

## Local acceptance

Verified September 10, 2026 with Node 24.13, disposable PostgreSQL fixtures, and the existing Linux ARM64 runtime image. The developer preview's data was preserved. Migration 031 was applied to its local database after the isolated persistence tests passed. A disk-space interruption required recovering Docker and clearing obsolete test-build caches; the existing database was preserved and the preview recovered. The permission follow-up rebuilt the runtime image successfully after that recovery.

- The full unit, integration and Git suite passed **811 tests across 98 files**. Focused follow-ups passed **42 permission, broker, file-mutation and HTTP-contract tests**, including six new cross-harness broker cases, plus four dashboard-data tests covering the browser-fetch receiver and uncertain-mutation retries.
- Mutation tests verify unchanged content reuse, concurrent revision conflicts, idempotent replay, authorization rechecks, preparation expiry and garbage-collection protection. Unchanged file payloads are reused; Git metadata still needs processing.
- Permission tests verify include/exclude intersection, dotfile patterns, symlink/traversal rejection, session policy freezing, denied hydration and checkpoint publication, and admission before reservation. All six broker cases verify denied discovery and direct dispatch without invocation records or charges.
- Network-disabled native fixtures now cover all six harnesses with denied reads/writes, traversal and symlink attempts, multiple intersecting policies, allowed edits and attempted native-tool bypasses. They use actual pinned binaries with scripted model responses and restore the same conversation in a fresh runtime directory. All six passed the expanded matrix both with source mounts and against the freshly built `platform-runtime:permissions-acceptance` image with no source mounts. Each calls an authorized connector under restrictions and uses the checked file tool again after restoration. The same packaged image passed unrestricted file/shell execution and continuation for the four newly mapped adapters (Codex, OpenCode, Hermes and DeepSeek). The local preview runtime image was updated after these checks; its previous image remains tagged for rollback.
- All five SDK suites pass their local API/simulator journeys, transport checks and supported type checks. Generated clients include the permission models. The final browser transport follow-up is also covered by actual editor file reads.
- The final isolated optimized build passed **34 browser tests**, **five packaged CLI tests**, the real PTY journey, and Python HTTP/SSE persistence and session continuation. Browser coverage includes light/dark motion, reduced motion, forced colors, copy feedback, sidebar resizing, workspace layouts, persisted permission settings, file conflicts, drag and drop, and rich/source Markdown editing. The standalone worker started successfully with shared domain fingerprinting independent of the HTTP validator.
- The permission adapter follow-up passed **46 focused tests across six files**, covering all-harness admission and frozen policies, broker dispatch, authenticated file MCP isolation and cleanup, OpenCode startup, and exclusion of transient Codex permission configuration from checkpoint capture and restore.
- TypeScript checking, documentation generation/link checks, and `git diff --check` passed. Searches confirmed consistent `worktree` spelling throughout UI, code, tests, docs and SDKs.

## Reproduction

```sh
pnpm test:domain tests/unit tests/integration tests/git.test.ts tests/git-sync.test.ts
pnpm test:domain tests/integration/tool-broker.test.ts tests/unit/dashboard-data.test.ts
DOCKER_RUNTIME_IMAGE=platform-runtime:harness-acceptance pnpm test:native --permissions
# Verify the production image build and its packaged files:
docker build -f infra/runtime.Dockerfile -t platform-runtime:permissions-acceptance .
DOCKER_RUNTIME_IMAGE=platform-runtime:permissions-acceptance pnpm test:native --permissions --image-only
pnpm sdk:generate:all
pnpm test:sdks
pnpm test:dashboard:isolated tests/browser/worktree-files.spec.ts tests/browser/dashboard-motion.spec.ts tests/browser/dashboard-interactions.spec.ts tests/browser/workspace-layout.spec.ts tests/browser/sidebar-layout.spec.ts tests/browser/copy-feedback.spec.ts --workers=1
pnpm check
pnpm docs:check
```

Use installed JDK 21, Python, Go, Rust and Maven for SDK verification. The isolated dashboard runner builds a separate optimized app and starts its own database, HTTP server and worker; it also exercises CLI subprocesses, a PTY journey and Python HTTP/SSE continuation.

## Practical limits

No paid inference, remote connector actions or cloud sandbox execution was performed. Hosted latency, cloud persistence and live native permission acceptance remain in the [maintainer checklist](../../maintainers/TODO.md#agent-permission-acceptance). File restrictions disable shell across all adapters; native controls gate alternate execution paths while the shared evaluator enforces file patterns. This pass does not establish a new aggregate coverage or mutation score.
