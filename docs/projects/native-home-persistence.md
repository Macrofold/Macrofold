# Native home persistence

Status: implemented, verified and activated locally. Owner: [runtime persistence](../features/execution/runtime.md).

## Problem and decision

A reported OpenCode continuation restored 3,802 home files, dominated by installed dependencies and npm cache (~152 MB). Saving took 1,002 seconds. The first fix excluded known cache directories; the approved follow-up replaces that denylist with an explicit durable-state contract.

A file's creator cannot reliably be inferred from filesystem metadata. **Location determines durability:** all worktree content stays durable; native home retains only declared conversation stores, associated assets, learned memory and authored resources. Every other home path is disposable, even when a new cache/install location appears. Each pinned harness has a typed profile in one [shared registry](../../packages/runtime/src/persistence-paths.ts). New harness IDs require a profile at compile time. Storage layout changes on upgrades require native acceptance, not an expanding cache list.

Capture prunes undeclared directories before traversing/hashing them. The admitted harness selects the same profile for capture, control-plane input/output indexing and restore; a manifest cannot broaden it. SQLite companions are captured with their database while writers are stopped/suspended. Managed authentication/configuration is rebuilt, and credential exclusions remain a separate rejection boundary. Native resources are preserved without enabling currently disabled harness features.

Keep the checkpoint format, financial settlement, integrity checks, cancellation, publication, execution fencing and warm-process lifetime unchanged. Do not add a configurable ignore language or a generic home backup. Runtime dependencies required for offline operation belong in the pinned image; optional plugins may reinstall on a cold Host. Directories declared durable retain their entire contents, including dependencies deliberately installed inside them. All harnesses receive shared instructions to save deliverables in the worktree. Actual offline acceptance also exposed Hermes attempting to install optional Bedrock dependencies during gateway startup; its supported sealed-environment switch now disables those automatic installs. No dependency or package-manager exclusion was added.

Native database/filesystem capture reuses the existing recovery path; per-vendor export/import conversions would introduce another state representation and still need to preserve memory/assets. The profile approach retains native state with fewer moving parts. Current checkpoint objects are not purged or rewritten. Input filtering avoids fetching undeclared home objects, and the next successful publication references only durable state; ordinary retention handles eventual collection.

## Implementation and acceptance

- [x] Inspect actual pinned harness home output and upstream storage conventions; define explicit profiles for all six adapters.
- [x] Thread the trusted harness through shared capture/restore and control-plane filtering. Update fixtures to use real native paths.
- [x] Verify unknown runtime files are disposable without naming exclusions; declared history/resources and all worktree files round-trip. Preserve corruption, path, authentication, symlink, crash and lifecycle checks.
- [x] Measure a matched synthetic capture containing thousands of unknown runtime-home files.
- [x] Build the full runtime image and verify every harness on warm reuse and separate-container continuation, including declared resources and worktree dependencies, with offline model/tool fixtures.
- [x] Complete public/internal documentation and final checks, inspect the diff, then activate only an idle local worker with rollback available.

The original caller's full draft/approval journey and hosted image rollout remain separate [maintainer acceptance items](../maintainers/TODO.md#native-home-persistence). Local native fixture success does not establish either.

## Local evidence — September 27, 2026

The first Hermes concurrency fixture timed out because it retained only the latest held HTTP request. Diagnostics confirmed two pending requests for the same synthetic agent. The fixture now drains all that agent's held requests while keeping its neighbor blocked. Assertions and timeouts remain unchanged. Separately, process inspection showed upstream `uv pip install --compile-bytecode boto3==1.42.89` during Hermes cold startup, despite using only the custom gateway. The supported lazy-install switch prevents that unneeded network/install attempt in the sealed image.

The focused suite passes **69 cases**: typed path selection and per-harness capture/restore, multi-chunk files/modes/symlinks, corrupt or missing content, process-death recovery and database-backed orchestration. The latter proves unknown input objects are never fetched and unknown output chunks are never uploaded, while conversation state publishes with verified persistence. All PostgreSQL/storage fixtures are disposable; no live model calls are made.

The initial investigation captured each actual pinned native harness's home in a disposable offline container. Profiles retain the observed conversation stores plus documented assets/memory/resource locations; logs, process locks and credentials stay outside them. Reference sources include [Codex's pinned state implementation](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/state/src/lib.rs), [Claude's state-directory reference](https://code.claude.com/docs/en/claude-directory), [OpenCode's data layout](https://opencode.ai/docs/troubleshooting/), and the pinned Hermes/Pi source installed in the runtime image.

### Synthetic capture benchmark

Same machine, same content and unchanged 4 MiB chunk/hash logic; alternate original broad-home capture and explicit-profile capture three times, writing fresh output directories. Setup/cleanup are outside the timer. There are 3,795 distinct generated files under `.unknown-runtime/install-v2`, `cache-v2` and `index-v2`, four declared OpenCode tool-output files, three declared skill-resource files and one worktree file. File counts/byte totals match the earlier cache investigation; path names intentionally do not appear in an exclusion list.

| Capture | Entries/chunks | Bytes | Elapsed samples |
| --- | ---: | ---: | --- |
| Original broad home | 3,803 | 155,320,522 | 5,749 / 6,699 / 5,925 ms |
| Explicit durable roots | 8 | 2,858,999 | 22 / 24 / 124 ms |

This eliminates 3,795 transfers and 98.16% of captured bytes for the fixture. These are local capture measurements, **not** the caller's reported 1,002-second end-to-end save. Build activity overlapped the benchmark; do not infer a general throughput or latency guarantee. Native session growth, hosted object latency, plugin installation and worker scheduling remain separate costs.

Reproduction: `pnpm test:domain tests/unit/persistence-paths.test.ts tests/unit/manifest.test.ts tests/unit/snapshot-failures.test.ts tests/integration/cloud.test.ts` using the isolated simulator profile; build with `docker build -f infra/runtime.Dockerfile -t platform-runtime:explicit-persistence .`, then `DOCKER_RUNTIME_IMAGE=platform-runtime:explicit-persistence pnpm test:workers:native`. The native runner uses the full built artifact directly, with external networking disabled. Public API/SDK contracts are unchanged; keep the application TypeScript SDK build and skip unrelated SDK regeneration/suites.

### Native acceptance and activation

All six actual harnesses (Codex, Claude Code, OpenCode, Hermes, DeepSeek and Pi) pass concurrent execution, scoped cancellation, warm native reuse, export and continuation in a separate fresh container. The fixture additionally preserves a declared resource and a worktree file under `node_modules`, while an unknown runtime-home file does not enter the snapshot or reappear after replacement. Native model requests confirm prior conversation history. Credentials remain excluded; stale assignments remain fenced. Models/tools are loopback protocol fixtures, with external networking disabled and no provider charges.

After the observed optional-install delay was corrected, Hermes passed the complete sequence again on the final full Dockerfile image. Its upstream native agent loop remains unchanged. The fixture's multiple-request release correction changes no production execution behavior and retains the same timeout/assertions.

`pnpm check` (including the app's TypeScript SDK build), `pnpm docs:check` and `git diff --check` pass. Unrelated SDK regeneration/builds were skipped because no public contract changed. Guidance checking retains its existing unrelated loader-precedence warning.

The verified image was promoted to the local runtime default; the previous image remains available for rollback. All local Runs and Run dispatch jobs were confirmed idle, the existing Docker poller exited gracefully, and its replacement was started with the existing configuration. The web preview and Docker daemon stayed running. Runtime image identities and activation commands are kept in the private operator record; no credentials were changed. Hosted rollout and the caller's complete draft/approval journey remain unverified and explicitly tracked above.
