# Worker and streaming reconciliation

September 25–26, 2026. This record separates history consolidation, semantic integration, and executed acceptance. It does not enable a hosted offering or represent production deployment. Current behavior is owned by [Worker implementation](implementation.md) and [streaming implementation](../../api/streaming-implementation.md); their broader release gates remain in [follow-up](TODO.md) and [maintainer TODO](../../../maintainers/TODO.md).

## History and source preservation

The reviewed Worker source was `3337c16e6c82569ddfebce1e1eddffce2731bfb4`, based on `19865a2f45885e228deb6b7ea443e33982257d21`. Its 172 development commits were first consolidated into two logical commits on that original base. `integration/worker-redesign-squashed` at `47b3225237590bea99c28d6b3ef3f06c222bc66c` has a final tree exactly equal to the reviewed source tree `f0acd7ad30b2e4b3d10a7b2b5f695108cd0b4d5d`.

The series was then replayed onto main's streaming commit `ea0c17cecae715f4def2c17d4cbe4e32d1ae8ae9`, preserving its ancestry rather than replacing its tree. The rebased series is on `integration/worker-redesign-rebased`, PR 8. Subsequent repair commits carried SDK/runtime and acceptance fixes discovered by running the combined source. That intermediate series separated economic/lifecycle/capacity policies from the SQL/runtime/API/client/UX cutover. It is now a single commit, as described below.

Original histories remain reachable through `archive/worker-economics-autoscaling-pre-squash-2026-09-25` and `archive/worker-redesign-before-reconciliation-2026-09-25`. The original feature branch is not force-replaced. Scratch reconciliation/export workflows are excluded from the final series.

After main gained native thinking streams (`b8013ecf8dd9cb13776d062d2a8476466601efdd`), the five-commit series was squashed into one commit with a tree identical to the previous head, then rebased onto that commit. The previous head remains on `archive/worker-redesign-rebased-pre-thinking-rebase-2026-09-26`. The OpenAPI document was merged structurally, per key, rather than line by line: its only difference from the branch schema is main's reasoning event contract. Generated clients were regenerated from it, and only the two conflicted TypeScript declaration files changed. OpenCode keeps main's transport-signal and event-draining changes, and uses the branch's per-handle server URL instead of the fixed port. The public streaming and CLI guides keep both the reasoning and Worker sections. The generated documentation module stays untracked build output. Main's reasoning events use the shared runtime writer and cloud-engine event allowlist, so Worker and automatic execution deliver them identically.

Main then gained documentation, public-story and contributor-guidance changes through `4a71a41ac385253fa857941e25af18ac31aa34fb`, and the single commit was rebased again. Ignore rules, package scripts and maintainer work items kept both sides. Main's new guides and revisitable policy RP03 linked the removed Sandbox guide and described Workers as unshipped; they now link the Worker guide and record Workers as the implemented contract with their remaining hosted and caller gates. `TESTING.md` was unchanged, so the added behavioral tests remain within policy.

## Semantic conflict decisions

An independent three-way comparison of the pinned baseline, Worker source and main source confirms that the combined OpenAPI retains both sets of changes. One-sided authored changes are preserved. The overlapping native Run owner retains Worker/resource selection together with main's resolved-harness incremental-output check and `runs:read` requirement. Conflicting generated clients are regenerated from the combined schema, never resolved by selecting one side or retaining retired Sandbox fields.

Direct inference remains one producer with transient SSE, a saved terminal result, bounded buffering and no automatic POST replay after output. Native and bounded agents retain asynchronous Run receipts and durable event streams. Worker selection changes compute placement, not stream ownership. Reader detach cannot cancel a Run, destroy shared compute, release cleanup reservations or authorize replay of ambiguous effects. Direct inference never acquires a native Worker simply because streaming was requested.

Main's token-window correction, stream assembly/final accounting, SDK transports, dependency updates and release inventory are retained. Worker billing still separates accepted compute commitments, final usage receipts, confirmed physical stops and settled charges. No compatibility adapter, increased database pool, weakened scheduler exclusion, extra provider fallback or invented zero-usage receipt was added to resolve conflicts.

## Integration repairs

| Owner | Repair |
| --- | --- |
| `scripts/sdk/python.ts` and emitted Python parameters | Generate the direct-inference request TypedDict before the streaming facade refers to it; derive its name from the existing schema owner. |
| `sdk/go/macrofold.go` | Infer each durable-stream recovery response locally instead of depending on an unstable generated inline type name; preserve cursor, tenant-header, terminal and error behavior. |
| `packages/runtime/src/supervisor.ts` | Give an isolated harness access to its private scratch parent as well as the temporary leaf; preserve private modes and per-handle ownership. |
| `packages/runtime/src/native-worker.ts`, `opencode.ts` | Enable the pinned SDK-hosted question tool and explicitly permit questions for the custom agent. Its default otherwise differs from OpenCode's built-in primary agent. Existing Run input/reply and guarded permission paths remain authoritative. |
| `scripts/test-native.ts` | Collect completed private coverage artifacts through a restricted disposable helper; build and mount matching source maps for media and every overlaid runtime bundle. No production permission relaxation or coverage exclusion. |
| `docs/api/cli.json` | Publish the implemented Worker command/flag catalog and explicit Worker consent scopes without broadening default login authority. |

The public [streaming guide](../../api/streaming.md#native-streaming-on-reusable-workers) and [CLI guide](../../cli/README.md#select-reusable-compute) describe the combined caller contract, including lazy wake and independent reader/Worker lifecycles.

## Existing fixture corrections

The source reconciliation authored no new unit cases; the later [full-tip acceptance repairs](#full-tip-acceptance-repairs) add behavioral cases required by unchanged coverage gates. Existing assertions were reconciled with accepted behavior, not removed to hide failures:

- Local Docker is free; initial BYOK platform reservation is zero. Managed reservation, actual model usage, exact final charge, no credential fallback, cancellation, publication and once-only launch checks remain. The separate budget-boundary fixture explicitly selects its synthetic billable quote and still rejects 7,999, accepts 8,000 and releases the exact reservation on cancellation.
- Priced tool-broker fixtures receive real ledger credit before dispatch. Per-invocation costs, idempotency, revocation, exhausted budgets and no provider calls after denial remain checked.
- Existing inference tests verify one canonical settled generation with output and costs rather than an obsolete duplicate raw-response event. Queued-cancellation coverage explicitly asks for `Prefer: respond-async`, and unsupported models are checked by stable status/code.
- Worker HTTP coverage uses the actual `/v1/api-keys` route and still denies escalation. Autoscaling may reserve both queued resource demands in one pass; the fixture continues to verify concurrency and held occupancy without demanding a redundant wake.
- Read-only and ordinary read-write key shortcuts include the intended Worker read/use scopes, never Worker administration. Shared local configuration is authoritative; a retired overlay cannot enable paid execution.
- Worker fixture teardown completes its own queued cancellations through `cancelRun`. Merely setting `cancel_requested` left cleanup hints for later global scheduler tests. Weighted scheduling passes in isolation and in the corrected full suite without changing production fairness, admission or hint ordering.

## Execution evidence and limits

Evidence belongs to the exact executed source, not merely a green workflow badge. Some early scratch commands piped output through `tee` without `pipefail`; their raw logs exposed failures despite successful job status. Those runs are not acceptance evidence. Subsequent scratch verification explicitly selects Bash with pipeline-failure propagation, while the final PR uses the repository's unchanged gates. A diagnostic wrapper that could not resolve an import-only SDK export was also rejected as failed setup, not treated as a native success.

| Executed source and run | Evidence |
| --- | --- |
| `10366c4c383ad3792887029a45bb67b56a4721a4`, Actions `36214796945` | All five existing SDK journeys passed after regeneration; Python reported 201 passing tests and clean type checking. This precedes later CLI/native changes. |
| `38dc407685bf10f2683fb7fc627214132fe8e6b9`, Actions `36216307639` | All 8 existing scheduler tests passed in isolation. Native question failure remained separate. |
| `9feb1b596d08bebdfc761cefff64555a46cb805a`, Actions `36216607655`, domain job | All 1,254 existing domain tests across 140 files passed. The executed Worker teardown was exported as Git blob `2352af47d138193aad241676ab21abf001716f9f`, identical to the committed fixture. Scheduler assertions had diagnostic logging only; production scheduler source was unchanged. |
| Same source/run, native job | All six cold/continuation fixtures, Codex/Claude media and all six permission-matrix fixtures passed; OpenCode questions then failed. This is not a full native pass. The explicit custom-agent permission repair follows that result. |

Final merge acceptance must use the checks attached to the exact head of PR 8, including compilation, generated-contract drift, domain/coverage, browser/CLI, all-five-SDK and native image jobs. The preceding partial results do not substitute for that final status. Native fixtures execute actual binaries with loopback model responses; external networking is disabled. SQL and HTTP/SDK journeys use disposable local infrastructure. No paid model/provider calls or production migrations were made.

## Full-tip acceptance repairs

The first full run on PR head `cd88616b9835c29b9ed89551054f0b5cc6315952` (Actions `36217514235`) passed all 1,254 domain tests but failed two unchanged gates:

- **Module coverage floors.** Floors in [the shared policy](../../../../scripts/coverage/policy.ts) failed for run admission, cloud execution, snapshot capture and restore. The combined source had removed Sandbox-era coverage without testing its replacements. The fix adds behavioral cases: explicit session creation and continuation; `runs:read` and incremental-harness checks for native `stream: true` admission; session continuation on a prepared Host that stages only missing `home` state; capture-slot handoff after failures; assigned-root and once-only restore outcomes. No floor, exclusion or assertion was relaxed.
- **Native stdio MCP.** `stdio-call` now validates the complete supervisor configuration, but the stdio fixture still wrote only `runId` and `deadline`, so the first call exited before reaching MCP. The fixture now writes a schema-valid configuration and reports child stderr on failure.

Two small source changes accompany the tests. Restore and stdio share `assignedRoots`, so both protected commands accept only the default roots or the roots assigned to their control directory; previously only restore checked them. The restore command's claim/validate/record step is an exported owner, so its failure paths are testable outside the image. Cloud execution also drops an always-true `workerPrepared` flag: every new execution provisions and prepares before staging input, so the dead alternative phases were removed.

The first run after those repairs (Actions `36219720469`) passed domain coverage and every native harness and stdio fixture, and reached two later gates for the first time:

- **Source inventory guard.** `test:coverage:all` compares the source inventory with the domain coverage report. The inventory counted `.tsx` files under `sdk/typescript/src`, but Vitest only included `.ts` there, so `react.tsx` was missing from one side. Vitest now measures it; nothing was excluded. This mismatch predates the Worker series.
- **Runtime vulnerability scan.** Trivy reported CVE-2026-63374 (critical) in AnyIO 4.12.1 from the pinned Hermes lock. The existing hash-pinned Python security overlay now installs AnyIO 4.14.2: same MIT package and dependency set, validated by `uv pip check` in the image.

Running the complete suite after the rebase also exposed order-dependent scheduler contamination. Admission claims now use try-locks and grant capacity only to the single global fair turn, so any leftover active or claimable Run in the shared disposable database blocks later files. Several existing fixtures promoted Runs to `running` or left accepted Runs queued without retiring them: gateway, tool broker, connection-access migration and actor guard. The capacity test also retried claims with concurrent waves, where every contender can back off. The local dispatcher explicitly avoids that pattern by admitting sequentially. Those fixtures now retire their own Runs through a shared `retireFixtureRuns` helper, and the capacity test's retries mirror sequential dispatch; its concurrent first attempt still proves claims cannot exceed capacity. No production scheduling rule or assertion was relaxed. The standalone cloud poller still advances up to 20 claims concurrently. Under contention a poll cycle can therefore admit nothing and retry after its short backoff: a latency follow-up, not a correctness failure.

Browser and application acceptance then ran on this branch for the first time. Two existing journeys failed because every serial browser journey shares one fixture principal:

- The connector journey's run submission hit the per-principal API limit accumulated by earlier journeys in the same minute. The disposable acceptance server raises that limit; integration tests continue to own rate-limit behavior.
- The template schedule review inherited organization-wide connections created by the connector journey. That journey now deletes its own connections.

The application gate (63% lines) also fell short, because the Worker cutover added untested Host protocol and dashboard code. New behavioral tests cover:

- `WorkerMachines` fencing against a claimed assignment: identity forwarding, prepared state, unsafe staging, stale bindings, replaced generations and idempotent release without Host I/O.
- `HostController` generation fences: unconfigured refusal, isolated-concurrency rejection, the sealed quiesce receipt and release tombstones.
- A Workers dashboard journey: create, pause, resume, composer selection, destroy, accessibility and mobile width.
- A packaged-CLI Worker lifecycle: name resolution, invalid money and resource overrides, not-found exit codes and destroyed-name behavior.

Two further existing fixtures encoded the pre-Worker execution mechanics:

- The deterministic Docker journey scripted native commands with `workdir: /workspace`. Automatic allocations now execute in the Host's per-Worktree root, so the agent's first write landed in the image's unrelated `/workspace` and was denied. The run still verified an unchanged checkpoint. The journey now targets `/host-data/worktrees/<worktree_id>`, as the Worker fixture already did.
- The 24-hour dispatch load test asserted main's claim-then-back-off timestamp. With a full ceiling, the free-slot hint cap now excludes doomed waiting work before any lease or claim. The test asserts that exclusion; held funds, no Workflow start, cancellation and expiry assertions are unchanged.

The acceptance harness also retries removal of its temporary build and coverage trees on `ENOTEMPTY`/`EBUSY`. Late writes from exiting server children intermittently failed an otherwise passing run; a persistent failure still fails it.

The reviewed Worker source also carried six development workflows (`worker-*.yml`) and their trigger markers. Every job was gated to pushes on the retired `feat/worker-economics-autoscaling` branch, so none could run on main; they were removed. The performance scripts they invoked remain available through `pnpm perf:workers` and `pnpm test:workers:native`.

## Main merge verification

The integration branch at `3c3ef6fa695fb4f4bb7ef51e39e3711e30c3e444` already contains main through `4a71a41ac385253fa857941e25af18ac31aa34fb`; the merge needs no source conflict resolution. Actions run `36265934685` passed generated SDKs, native image acceptance and mutation checks, but application acceptance stopped at the existing POSIX terminal journey. Its 172 browser journeys and seven CLI subprocess cases passed; application coverage remained below the unchanged floors after the terminal failure.

A local reproduction with the pinned Ink package shows that `CI=true` produces no frame before process exit, while `CI=false` immediately displays `Ready` on the same PTY. The terminal fixture now sets `CI=false` only for its real-terminal child, following Ink's documented override. Production CLI behavior, timeouts, assertions and coverage policy are unchanged. Actions run `36268007076` passed application acceptance, generated SDKs, native image acceptance and mutation checks with that fix. Its final combined coverage gate remained below the unchanged floors (64.36% lines against 65%, 62.47% statements against 63%). Additional focused tests cover Render/Vercel allocation identity, generation fences, deletion confirmation and control-origin security; automatic Run allocation, credential reuse, isolation, transfers and launch revalidation; and content-free diagnostics with timer cleanup. These use synthetic transports and disposable SQL fixtures. The full local domain suite passed 1,331 tests across 144 files. Combining that canonical report with the prior CI browser/server/worker/CLI/native observations passed the unchanged gates: 65.23% lines and 63.33% statements. The coverage merger verified the production source hashes before combining evidence; the intervening changes contain only tests and this record. Actions run `36270244726` is the fresh full-suite rerun on test commit `405ad1b6f31405f48bc5876c99a0325e3ed29388`; its result must be checked separately rather than inferred from the local pass.

## Remaining deployment boundaries

OpenLegend's native caller must migrate from per-lane Sandbox ownership to application/world-owned Workers before its coordinated deployment; its direct inference path remains independent. Hosted isolation, provider creation/stop ambiguity, live SSE proxy/lifetime behavior, configured rates/capabilities, and operator resolution of unknown or unfunded final usage require their existing separate acceptance. Consolidating or merging Git history is not proof of those deployment properties. Hermes cold-start profiling and OpenCode capacity-benchmark resource alignment also remain distinct follow-ups.
