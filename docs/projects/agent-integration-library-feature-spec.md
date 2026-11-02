# Agent integration library — feature specification

| Status                                 | Current progress                                                                                                                                              | Last updated |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Implemented; qualification in progress | Optional library, editable files and full bring-your-own Hindsight/hosted Claude-mem turn lifecycle. Managed provisioning/live vendor acceptance remain open. | 2026-11-01   |

## Outcome

A builder adds optional memory to one Worktree from **Agent library**, sees what is captured and who pays, then can inspect, pause, disable, export, detach and forget it. Memory is a usability composition of existing Workspace/Worktree, Session, Run, Connection, file and Worker capabilities. It is not a new identity model or an independent harness.

A working service pack includes automatic capture, recall, persistence, lifecycle recovery and controls. Merely exposing search tools is not completion. Ordinary agents work without any pack. One shared preset must never share customer memory.

## Initial supported recipes

| Recipe          | Experience                                                                                                                                                                                                                | Funding                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Editable memory | Missing starter files, ordinary checkpoint and permission-aware native guidance. Existing file browser is the editor.                                                                                                     | Ordinary existing file/model behavior; no separate indexing service |
| Hindsight       | Dedicated bank; automatic bounded recall, successful conversation-source capture, async processing/polling, inspection and whole-bank cleanup                                                                             | Explicit bring-your-own service account                             |
| Claude-mem      | Existing dedicated hosted PostgreSQL project; engineering narratives including failed/cancelled attempts, bounded committed tool-outcome metadata and verified provenance through its distinct event/job/context protocol | Explicit bring-your-own service account                             |

These are distinct, replaceable protocols behind existing ports. Third-party native hooks/global instructions are not installed. Supported immutable revisions/licensing and actual verification boundaries are in the [technical design](agent-integration-library-tech-design.md).

## Required user flows

1. Discover curated options with progressive setup. Start with editable memory; show remote costs, prerequisites and data transfer before consent.
2. Choose an authorized Workspace and idle Worktree. Preserve existing notes. Service setup uses encrypted owned Connection credentials and an explicitly dedicated namespace.
3. Start a fresh Session. Stable policy is frozen at admission; bounded untrusted recall is prepared once before native compute, without changing the original user source.
4. Capture durably after final publication: Hindsight successful user/assistant notes; Claude-mem engineering narratives also include terminal failed/cancelled attempts, bounded committed tool-outcome metadata and known verified/admission-frozen provenance. Reasoning, raw tool arguments/results/effect claims, arbitrary files and historical import are excluded. Oversize/missing source reports capture failure without failing a completed Run.
5. Inspect/edit current simple files or inspect service capture sources, receipts and separate external cost/unknown values. Manual search is explicit and financially idempotent.
6. Pause learning, disable use or detach. Detached external installations remain owner-manageable, never silently unmanageable private copies.
7. Forget an entire service collection with explicit confirmation. Recall stops immediately; cleanup remains pending/uncertain until verified. The namespace is permanently retired.
8. Correct safely using export → whole-collection purge → fresh dedicated collection/consent → fresh Session → corrected confirmed note. Additive notes do not guarantee replacement of old derived memories.

## Authority, cost and continuity requirements

- Tenant/resource checks are server-side. Effective files permission governs the simple recipe. Remote `memory_recall`/`memory_capture` use existing tool permission intersections; explicit No tools disables both. Required denied recall rejects before compute.
- No automatic Connection grants, credential fallback, account replacement or customer configuration in environment variables.
- Service URL/account/auth changes block old approval. Background writes recheck current authority; old work only polls/cleans its quarantined collection.
- Optional unavailable/denied memory is visible per Run. Empty recall is distinct from failure. Required failures do not silently degrade.
- A changed installation generation requires a fresh Session; a warm agent cannot unsee context. Restoring files does not rewind external memory.
- External queries, extraction, embeddings, hosting and consolidation are funded separately from Run budgets. Macrofold native cost and vendor-reported cost are separate; unknown values are explicit.
- No blind retry of uncertain paid reads/writes. Durable existing Operation/outbox identities precede external I/O, without holding SQL over a request.
- Soft resource deletion stops new outbound memory. Permanent Workspace purge clears local memory byte copies; independently funded service retention/cleanup stays explicit.

## Bounds and honest semantics

Use bounded head/tail query and role projections with omission markers; retain accepted captured source encrypted with provenance. Export captured sources, not a falsely complete vendor index archive. Avoid synchronous response-path extraction, full conversation re-ingestion or repeated paid recall during preparation recovery. Use existing file state, scheduling, billing and tracing owners rather than parallel systems.

Initial Claude-mem engineering history includes terminal narratives, bounded committed tool-outcome metadata and verified/admission-frozen provenance. It does not claim raw tool-effect truth or a complete engineering archive. Broader raw tool/test/build/deployment content, custom skill/plugin packs, selective provider-aware corrections, historical backfill and full vendor-derived archive export remain future scope. Managed service provisioning needs an explicit hosting/funding decision and has not been silently replaced by BYO-only claims.

## Completion evidence

Required: focused pure/protocol tests, real loopback HTTP plus disposable database/API authority/lifecycle cases, generated contract/SDK checks, and a browser journey through installation/edit/state/remove and remote disclosures. Record actual results in the current implementation tracker. Fixtures do not establish a running upstream deployment, recall quality, live costs or managed-host acceptance.

The [customer guide](../features/customer-agents/agent-library.md) is published through `docs/navigation.json` and carries usable REST/CLI steps. The [technical design](agent-integration-library-tech-design.md) names owners, concurrency/recovery behavior and remaining acceptance gaps.
