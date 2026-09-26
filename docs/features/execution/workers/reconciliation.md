# Worker and streaming reconciliation

September 25–26, 2026. This record separates history consolidation, semantic integration, and executed acceptance. It does not enable a hosted offering or represent production deployment. Current behavior is owned by [Worker implementation](implementation.md) and [streaming implementation](../../api/streaming-implementation.md); their broader release gates remain in [follow-up](TODO.md) and [maintainer TODO](../../../maintainers/TODO.md).

## History and source preservation

The reviewed Worker source was `3337c16e6c82569ddfebce1e1eddffce2731bfb4`, based on `19865a2f45885e228deb6b7ea443e33982257d21`. Its 172 development commits were first consolidated into two logical commits on that original base. `integration/worker-redesign-squashed` at `47b3225237590bea99c28d6b3ef3f06c222bc66c` has a final tree exactly equal to the reviewed source tree `f0acd7ad30b2e4b3d10a7b2b5f695108cd0b4d5d`.

The series was then replayed onto main's streaming commit `ea0c17cecae715f4def2c17d4cbe4e32d1ae8ae9`, preserving its ancestry rather than replacing its tree. The rebased series is on `integration/worker-redesign-rebased`, PR 8. Two subsequent logical repair commits carry SDK/runtime and acceptance fixes discovered by running the combined source. The first commit contains independent economic/lifecycle/capacity policies; the second keeps SQL, runtime, API, generated clients and UX together to avoid an intermediate broken cutover.

Original histories remain reachable through `archive/worker-economics-autoscaling-pre-squash-2026-09-25` and `archive/worker-redesign-before-reconciliation-2026-09-25`. The original feature branch is not force-replaced. Scratch reconciliation/export workflows are excluded from the final series. All Git mutations use the connected GitHub tools; local source comparison and execution do not replace the authoritative remote refs.

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

## Remaining deployment boundaries

OpenLegend's native caller must migrate from per-lane Sandbox ownership to application/world-owned Workers before its coordinated deployment; its direct inference path remains independent. Hosted isolation, provider creation/stop ambiguity, live SSE proxy/lifetime behavior, configured rates/capabilities, and operator resolution of unknown or unfunded final usage require their existing separate acceptance. Consolidating or merging Git history is not proof of those deployment properties. Hermes cold-start profiling and OpenCode capacity-benchmark resource alignment also remain distinct follow-ups.
