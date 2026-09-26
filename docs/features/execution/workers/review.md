# Worker branch engineering review

September 25, 2026. Source baseline: `dc890bde1860fbdd1f1f896e18401fcb91133007`; merge base: `19865a2f45885e228deb6b7ea443e33982257d21`. Portable engineering guidance was read in `Macrofold/OpenLegend` at `03105fed9209c126e4e69e9faeb4687f42d1e74a`. This is a source review and executed-change record, not deployment approval. Exact executed revisions and limits belong in [verification](verification.md).

## Review lens and scope

The review applies single semantic ownership, bounded work, explicit unknown outcomes, complete caller paths and maintained source/evidence separation. It does not import OpenLegend's game laws or package architecture. Scope is the authored Worker branch, not only its last idle-retirement commit: policy/catalog/pricing, relational claims and migrations, placement/scheduling, local/portable execution, provider/runtime control, capture/continuation, authorization/API/MCP, CLI/dashboard, public contracts and examples. Generated clients are reviewed through schema/generation and exercised surfaces, not represented as independently hand-audited implementations in every language.

Examples and marketing emphasize persistent customer context, scheduled reviews, selected tools and parallel worktrees. These needs support keeping durable files, Sessions and compute independent. Direct inference must not pay native startup cost. One customer ending a conversation must not manage a shared application's compute. Useful performance work removes unnecessary payload and unbounded ownership waits rather than adding a second queue, cache authority or coordinator.

## Findings and disposition

| Finding | Disposition and owner |
| --- | --- |
| Exhausted funding prevented physical teardown because settlement ran first; stop confirmation could roll back with a failed settlement. | Fixed in `worker-reconciler.ts`: independent final receipt, physical stop and settled cursor; forward migration 047. |
| Funding release trusted its caller to prove physical stop and cleanup completion. | Fixed at `releaseHostFunding`: require `stopped_at` and no unreleased HostRun. |
| A same-pass health sample could be mistaken for final resource usage after an unsealed stop. | Fixed: unknown paid usage remains reserved and explicit. |
| Missing orchestration binding allowed unacknowledged prepare to lose its SQL writer/resource claim. | Fixed in `WorkerMachines.cleanupUnbound` through confirmed controller release; launch ambiguity remains held. |
| Unknown-assignment release did not fence future late prepare; queued commands could run after release. | Fixed with allocation-serialized tombstones and an in-lock released check in `HostController`. |
| Frequent capacity reads transferred full Run/config payloads unnecessarily. | Fixed with a narrow resource/timeout projection; existing bounded eligibility and ownership retained. |
| Destroyed-name history confused CLI lookup; explicit revisions still required an unnecessary read. | Fixed without changing command names, flags, generated schemas or server authority. |
| Dashboard silently preferred trusted sharing; retention/availability copy overstated guarantees. | Fixed isolated preference, explicit sharing selection, dedicated-only indefinite retention, expired-action controls and precise charge/availability copy. |
| Current OpenLegend native caller still uses the removed Sandbox API and owns it per lane. | Caller migration is a release gate, documented below. OpenLegend is unchanged. |

The initial shutdown scenario at `8956c5fb7bf0ea620ed91b1c671f092cdb2a0ef9` (Actions `36196706790`) reproduced the fault in real PostgreSQL: three reconciliation passes left one synthetic provider allocation running, no stop, and `host_funding_exhausted`. Subsequent scenarios verified stop confirmation and retained settlement state for allocation and resource meters. These use synthetic accepted rates/provider boundaries, not retail pricing or paid cloud evidence.

The first CLI edit during review introduced incompatible imports/command shapes. Source comparison caught it; `8fe6784caa9c09b10ac24ddf9b5acb55925f09ac` restores the original command contract with only the intended selector/revision changes. The real built-CLI exercises at `7b6e41acfb907ea2249c5de6b41dad58f31c0d72` verify the corrected source, not an earlier green build.

## Architectural decisions retained

Keep Worker as a stable economic target, Hosts/HostRuns internal, Worktree/Session as durable authorities, PostgreSQL claims authoritative, and provider I/O outside domain locks. Keep runtime caches advisory and optional. Preserve one writer per Worktree and bounded reactive scaling rather than forecasting traffic or globally repacking live processes. A baseline is funded expected capacity, not uninterrupted availability. Exact source changes and mutation owners are in [implementation](implementation.md).

Normal pause remains graceful. Exhausted funding, expired lifetimes and invalid generations are finite physical boundaries, not unlimited graceful drains. A forced physical stop can lose unpublished state or a final meter tail. Keep those obligations visible rather than continuing uncontrolled spend, treating missing usage as zero, automatically charging beyond authorization, or clearing the ledger to obtain a green status. Physically stopped but unresolved allocations may remain `draining` and consume conservative limits until reconciled.

## OpenLegend caller migration

At the pinned OpenLegend revision, `apps/server/src/macrofold.ts` stores `sandbox` on a lane, creates/awaits `/v1/sandboxes`, submits Run `sandbox_id`, checks the returned Sandbox identity, and destroys lane compute in `closeConversation`. Direct judgments/generation use `/v1/inferences`; full native deliberation/reflection is the affected caller. The current native path is not compatible with this branch's coordinated Sandbox removal.

Before integration, move Worker ownership to the intended application/world trust boundary; retain each actor's Worktree/Session. Use `worker_id`, Worker scopes and the resolved accepted offering. Submit to sleeping zero-baseline Workers before waiting for readiness. Closing an actor lane cancels its own Run, not the shared Worker. Preserve exact persisted idempotency inputs and ambiguity recovery. Drain old allocations before the server/caller cutover. The [public migration guide](../workers.md#migrating-a-worktree-bound-sandbox-caller) explains the generic contract.

No permanent Sandbox compatibility adapter is added: the prelaunch product explicitly chose coordinated replacement, and an adapter would preserve the wrong per-Worktree compute ownership. This is a deployment dependency, not evidence that the Worker abstraction needs reopening.

## Measured performance follow-up

Offline native execution succeeded for all six harnesses, including warm reuse and fresh-container continuation. It also exposes a meaningful latency difference: Hermes' fresh-container turn took about 29.1 seconds, while its six warm reused turns took 202–208 ms in the loopback fixture. This is not a live-model latency estimate or proof of the bottleneck. Profile cold initialization and contention before choosing Hermes for latency-sensitive first turns. Do not hide the result by increasing timeouts or claiming a paid baseline guarantees a warm Session.

OpenCode's fixture declares 6 GiB of logical Host capacity while the workflow container is capped at 4 GiB. The successful run demonstrates the exercised continuation/control path, not an accurate 6-GiB capacity or saturation benchmark. Align measured container limits and declared resources before using this fixture to set production density or pricing.

## Remaining release boundaries

Track the concrete follow-ups in [Worker follow-up](TODO.md), with the broader formal acceptance inventory in [maintainer TODO](../../../maintainers/TODO.md). OpenLegend migration, provider stop/create ambiguity, hosted isolation, production rate/capability configuration, and operator handling of unknown/unfunded usage remain open until demonstrated. Local recovery snapshots are best-effort evidence, not durable automatic salvage of arbitrary unpublished files. Broader browser/CLI/SDK/native acceptance is not inferred from the focused exercises.

Main contains independent model-streaming/SDK documentation work at `ea0c17cecae715f4def2c17d4cbe4e32d1ae8ae9`; reconcile its schema, SDK, engine and documentation changes before merging. This review does not merge or overwrite it. Historical status prose about the old Worktree-bound Sandbox and blanket hidden-file exclusion is not current Worker acceptance; use the current implementation and commit-specific verification owners.
