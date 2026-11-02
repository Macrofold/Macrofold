# Agent integration library — technical design

| Status                                 | Current progress                                                                                                                                                | Last updated |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Implemented; qualification in progress | Common library, editable files and full bring-your-own-service capture/recall/control pipeline. Managed hosting and live upstream acceptance are not completed. | 2026-11-01   |

The [feature specification](agent-integration-library-feature-spec.md) defines the product; the [public guide](../features/customer-agents/agent-library.md) defines customer-visible setup and limits. This design supersedes the October 7 proposal’s Project/Sandbox ownership assumptions. Workspace owns files, Worktree selects an isolated checkout, Session owns continuity, Worker/Allocation owns compute. Packs are optional compositions, not new platform primitives.

## Owners and boundaries

| Owner                                                                            | Responsibility                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/integration-packs.ts`                                        | Three curated recipes and factual capability/funding copy; no executable third-party plugin loader                                              |
| `packages/contracts/file-memory.ts`                                              | Shared starter files, schemas and permission-aware policy used by the library and example apps                                                  |
| `packages/core/src/agent-integrations.ts`                                        | Tenant/Workspace/Worktree installation, stable binding snapshot, file checkpoint preparation, state, export and resource-deletion fence         |
| `packages/core/src/integration-memory-source.ts`                                 | Background-only bounded conversation/engineering source selection, narrow committed tool metadata and accepted provenance                       |
| `packages/core/src/integration-memory.ts`                                        | Approved service identity, frozen recall, private manual-search receipt, background source/outbox state, cleanup/recovery and trace composition |
| `packages/core/src/integration-authority.ts`                                     | Content-free active resource and current owner-membership checks                                                                                |
| `packages/providers/src/memory-service.ts`                                       | Exact reviewed Hindsight/hosted PostgreSQL Claude-mem REST protocols, one bounded transport/projection boundary                                 |
| `packages/core/src/agent-integration-handlers.ts`                                | Existing REST preparation/commit/replay-authorizer composition                                                                                  |
| `packages/core/src/runs.ts`, `cloud-engine.ts`                                   | Admission policy/Session fingerprint, preparation and successful terminal capture seam                                                          |
| Existing maintenance dispatcher                                                  | Independent, lease-fenced background processing; no parallel scheduler loop                                                                     |
| Existing Connections/auth, Operations, file/storage, tracing and deletion owners | Credentials, authority, receipts, verified file writes, nonblocking export and retention                                                        |

Dashboard, CLI, SDKs and customer MCP call the same OpenAPI operations. Customer secrets/configuration belong to encrypted Connections and tenant rows, never global environment variables. The local exact-origin transport exception is operator configuration, not a customer integration registry.

## Data model (migration 061)

- `agent_integrations`: organization, Workspace/Worktree, pack, active/paused/disabled state, generation, optimistic revision, private owner/configuration, approved service identity, removed/retired timestamps and safe diagnostic code.
- One non-detached installation per `(organization_id, worktree_id)`. Service identity is canonical endpoint plus dedicated namespace, globally unique even after detachment. Retired collections cannot be silently rebound while old writes may still finish.
- `integration_sources`: encrypted captured source, canonical Run reference, generation, capture/purge kind, state, provider receipt, known byte count, lease token, failures/polls/deadline metadata and optional trace context. `(installation, Run, generation)` deduplicates terminal capture.
- `integration_retrievals`: one `(Run, installation, generation)` query claim and encrypted prepared context, receipt, duration and safe error. An interrupted querying receipt remains uncertain and is not resent.
- Existing `operations`: `memory_search` uses private typed fields for caller/key/query digest/generation/encrypted context/receipt. Public result contains only Workspace/installation IDs. It is not a second billing or scheduling aggregate.
- Existing `dispatch_jobs(kind=integration)` leases capture/purge work. All new customer tables force RLS and organization-scoped foreign keys.

Indexes match real predicates: admission includes explicit organization UUID and `removed_at IS NULL` to use the partial unique Worktree index; listing uses organization/ID; activity uses installation/ID; dispatch uses due integration jobs; revocation of private search receipts uses `(organization_id, data.memory_integration_id)` filtered to `memory_search`. Do not rely on an RLS text cast to make an unrelated index sargable.

## Installation and authority

1. Resolve principal, Workspace and idle Worktree under existing authorization. File setup conditionally requires `files:write`; service setup conditionally requires `connections:write` and current Connection ownership.
2. Reject existing Worktree/namespace binding before external metadata initialization.
3. Prepare missing file content and verified checkpoint outside SQL, or initialize/probe the explicit dedicated external namespace outside SQL.
4. Commit rechecks resource writer/storage guard, permissions and current Connection revision/URL/credential fingerprint, then creates one installation. Unique constraints close concurrent installation races. Failed publication can leave only the explicitly dedicated, known metadata namespace; retries reuse it rather than inventing random banks.
5. Remote consent explicitly acknowledges external funding and dedication. Required recall defaults false. No service is activated by catalog discovery or mere key possession.

Every service construction, including cached recall, queued captures and destructive cleanup, compares a server-owned fingerprint of provider, kind, canonical URL, owner, auth method and encrypted credential/headers. Changes block use; credentials never fall back. Ordinary use also checks live Worktree/Workspace and active owner membership. Cleanup-only authority permits an owner to erase a detached/deleted resource’s old dedicated service collection, while never permitting recall, new capture or reactivation.

A `memory_service` Connection is not a generic tool connection. It cannot bypass MCP tool review or advertise arbitrary service routes as agent tools.

## Native execution and warm continuity

- Admission does one indexed optional binding lookup. No installation means no provider access, source preparation or memory job.
- Stable policy includes installation ID/generation and is composed once into the accepted instructions. Existing domain/provider/runtime warm compatibility keys all receive the same policy. Dynamic retrieved evidence is never part of the compatibility key.
- Session’s private fingerprint freezes `{id,generation}` or the no-pack sentinel on first use. An unchanged continuation adds no Session rewrite. A changed binding rejects `409 session_memory_changed`, requiring a fresh Session; warm process reuse cannot erase previously seen context.
- File policy respects effective readable/writable paths. No-file Runs do not receive instructions to read/write memory. Paused or read-only notes receive reading-only guidance.
- Remote access freezes intersections of canonical `toolAllowed(CONNECTION_ID/memory_recall|memory_capture)` and explicit effective No tools. Required denied recall refuses admission. Positive MCP grants do not implicitly grant or deny this separately consented installed-memory service.
- Preparation verifies current binding and approved service identity before provisioning. Recall claims a durable receipt before external I/O, then encrypts confirmed bounded evidence plus usage. Recovery reuses it; unknown receipts do not trigger duplicate possibly billed reads. Current generation/authority is rechecked before publishing evidence.
- Native prompt receives bounded untrusted evidence; `Run.config.prompt` remains the original source. File contents and memory output cannot grant authority.
- Optional denial/failure produces deduplicated `memory.omitted` / `memory.capture_omitted` events and safe WARNING trace metadata. Empty successful retrieval is distinct from unavailable retrieval.

## Capture, durable processing and bounded work

Hindsight admits only terminal succeeded user/assistant text. Claude-mem engineering history also admits terminal failed/cancelled/timed-out Runs, preserving status/partial labels, available final narrative, narrow committed tool-outcome metadata and accepted immutable provenance. Publication enqueues a canonical Run reference, not copied request bytes, in the same transaction as final Run state. Background processing loads source once, off the response path. It excludes raw tool arguments/results/effect claims, reasoning, injected recall, arbitrary files and historical backfill. `integration-memory-source.ts` selects at most 32 tool outcomes plus one omission sentinel and resolves names using only narrow committed event scalars; it labels effect verification false. The Run accepted verified checkpoint is used, never the latest Worktree checkpoint. Known ready Git commit and admission-frozen repository metadata are preserved; unavailable provenance remains null.

Source text is accepted only when both roles fit 256 KiB combined. Oversize/missing source creates a visible capture failure without failing the already terminal Run. Accepted source is sanitized, bounded to 256 KiB encoded JSON with shared head/tail projections/omission metadata, and encrypted. Private markers/recognized credentials are removed with existing content rules. Receipt polling never reloads source or resurrects erased ciphertext.

Transport has a 15-second request deadline, redirect denial and bounded JSON reader. Recall query is one shared 4,096-character head/tail projection; evidence is at most 10 memories/16 KiB of actual encoded evidence. Native prompts are not split into unbounded word arrays or shortened independently in callers.

Existing maintenance discovers 16 due jobs and runs four concurrently. Each processing attempt is bounded to 24 hours/3,000 polls and finite consecutive poll failures. Explicit check can start a new bounded metadata-check window without resubmitting capture. These limits protect optional external work; no claim is made that fleet throughput has been qualified.

Lock order is installation control fence → dispatch/source row → private Operation/cache rows. External I/O never holds a transaction. A unique lease token fences result publication. Before each new capture, state/generation/resource/Connection authority is rechecked. Old acknowledged writes may only be polled/cleaned in their quarantined namespace. A late callback after permanent local purge cannot repopulate erased bytes.

### Exact upstream compatibility

Hindsight revision `bc5ea195a0fed1346ff171a5780bbb72a38c89c8` (MIT): PUT bank metadata, GET bank stats, async retain with supplied operation UUID, operation poll, recall and DELETE bank. Bare GET bank is not a supported endpoint. Its supplied operation UUID allows missing-ACK reconciliation without a second paid retain. Async usage may be absent.

Claude-mem revision `c239a048a8a07607148f4c1f26b258ccfb28b80d` / 15.8.1 (Apache-2.0): hosted PostgreSQL API only. Readiness verifies an existing project using `GET /v1/projects/{id}/jobs?limit=1`; context alone does not prove existence. POST context returns `observations[].content`, not SQLite `memories`. POST events uses `generate=true&wait=false`; generationJob acknowledgement and GET job supply queued/processing/completed/failed/cancelled status. The accepted event schema has no source-idempotency field, so missing ACK means unknown, never automatic re-ingestion.

Its generation worker prefix-clips payload at 16 KiB. The adapter sends an independently bounded, at most 14 KiB UTF-8 pretty-printed payload with both user/assistant head+tail, provenance, terminal outcome, latest 8 tool metadata records and explicit omissions; the larger accepted captured source remains encrypted in Macrofold. DELETE project memory is verified to remove derived observations, raw events, sessions and jobs. It keeps the project shell. Upstream documentation’s arbitrary project-create route is not implemented in the pinned hosted router: a pre-created dedicated project is a real operator prerequisite.

Recall retains only reviewed, bounded provider-reported linkage/time fields. Hindsight: document/chunk IDs, at most eight source-fact IDs and occurrence/mention timestamps. Claude-mem: project/session/content-session IDs, observation kind and observation creation/update timestamps; source-event identity is absent in this wire and explicitly null. Missing fields remain null, arbitrary metadata is excluded, and available project IDs must match the configured namespace. Hindsight document IDs can point to existing installation-scoped capture-source expansion; vendor references/times never authorize access or prove execution. Whole encoded evidence remains within 16 KiB including these fields.

No third-party native hooks, global CLAUDE.md edits or executable plugin installation are performed. Operator-managed service licensing/dependencies remain their deployment responsibility; pack integration uses maintained upstream APIs.

## Manual search financial identity and replay

POST search remains intuitive synchronous 200. A UUID derived from organization/principal/installation/Idempotency-Key identifies an existing private Operation. Under the installation fence, claim it before service I/O and check the query digest; simultaneous preparations cannot both call the vendor. Confirmed context/receipt are encrypted on the Operation before HTTP response publication. A lost HTTP response/envelope therefore replays the owner receipt without repeating paid I/O. Running/uncertain receipts refuse resubmission; an expired in-progress receipt is marked failed on inspection/retry.

The generic HTTP replay authorizer registry is a composition seam, not duplicated middleware. Only registered content-bearing operations pay its additional authority check. Search’s owner authorizes current principal/Workspace/generation/Connection before cache decryption and again at final preparation commit. Private fields never appear in generic Operation results, exports or logs.

State/detach/forget/deletion invalidate only exact owner-bound search receipts and their organization/principal/route/key cached envelopes. Forget clears encrypted private context; replay returns `410 memory_context_revoked`, not old plaintext. Financial/mutation receipts keep their original semantics.

## Control, correction, export and retention

Pause stops capture, disable stops use, detach preserves an owner-only manageable record, and forget retires the collection before outbound cleanup. No auto-reactivation of a retired namespace. Repeated forget returns its existing cleanup identity. Acknowledged jobs can be checked; explicit cleanup retry only repeats metadata deletion. Unknown writes keep purge unconfirmed, with truthful operator intervention rather than a false erase guarantee.

Confirmed notes are additive evidence only. Initial reliable correction is a coarse composition: export desired sources → forget/purge → verify → new explicitly dedicated collection/consent → fresh Session → corrected confirmed note. No automatic paid rebuild/backfill or authoritative selective replacement is claimed.

Service export is captured source text, not a complete vendor-generated archive. One SQL snapshot bounds 501 candidate rows and aggregate known bytes before returning any ciphertext, avoiding a count/read race. Limit is 500 entries/1 MiB; individual source reads handle larger collections. Publication rechecks the current generation under the installation fence before returning decrypted data.

Worktree/Workspace soft deletion disables and advances generation, cancels queued capture and stops new outbound work. Permanent Workspace purge wipes local source/retrieval/private search copies and fences late callbacks. It does not delete a separately funded external service; detached owner access/external-operator cleanup remains explicit. Ordinary Run-history expiration does not automatically erase independently retained installed memory. Chats/checkpoints/tracing/vendor backups have separate retention.

## Tracing and verification

Use the existing swappable nonblocking trace owner. Native Macrofold cost is zero for externally funded memory. Vendor cost/tokens remain separately reported/unknown, never invented zero. Recall and processing record duration, binding/provider metadata and confirmed receipt. One upserted source-processing observation avoids repeatedly aggregating pending polls or vendor totals. Content obeys global capture/redaction policy.

Focused pure tests, strict real-loopback HTTP vendor fixtures, disposable RLS/SQL/API/domain cases and a maintained browser journey cover the integration boundary. Fixture transport is not a running vendor service or memory-quality qualification. Parent project trackers own final actual check results.

### Recorded qualification (2026-11-01)

| Boundary                                                                                              | Actual result                                                                                                      | Evidence limit                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Pure projection/guidance/file tests                                                                   | 26 passed                                                                                                          | Deterministic inputs; includes Unicode byte bounds, private-content omission and both provider wires                          |
| Generated Client → HTTP → disposable PostgreSQL → loopback vendor fixtures                            | 14 passed                                                                                                          | Authority, paid-read identity/replay, revocation/deletion, recovery and engineering provenance; vendor transport is synthetic |
| Pinned real Hindsight server, async worker and PostgreSQL/vector storage                              | Passed authenticated retain/poll/recall, restart persistence, source provenance and repeated purge                 | Unmodified vendor service; deterministic LLM/embedding transport, so no recall-quality or provider-cost claim                 |
| Macrofold public API → actual OpenCode → real Hindsight → fresh Session/distinct Docker Host → recall | Passed; derived fact absent from first provider request and present in second, then source export/forget confirmed | Real native lifecycle and memory boundary; synthetic model transport, zero paid calls                                         |
| Pinned hosted Claude-mem                                                                              | Separate actual-upstream qualification in progress                                                                 | Focused wire/domain cases do not stand in for this result                                                                     |
| Optimized app/browser and full SDK/CI gates                                                           | Coordinated final qualification in progress                                                                        | Use the project tracker’s final results, not this interim table                                                               |

Private disposable evidence is retained under `.data/native-integration/upstream/QUALIFICATION.md`, `hindsight-result.json` and `hindsight-native-result.json`; Claude-mem native evidence is `.data/claude-mem-native-qualification/native-result.json` / `local-native-02/report.json`; focused logs are `.data/native-integration/memory-unit-final.log` and `memory-domain-final.log`. The Hindsight runner exited successfully and removed its task-owned containers, processes, databases and networks. Its observed service startup 5.58s/restart 3.60s are local smoke intervals, not a matched performance qualification. Unknown vendor costs/tokens remained null.

Remaining acceptance: real-model/provider-funded and hosted-deployment cost/quality, large-fleet job fairness/fanout and a managed hosting/funding contract. Selective correction, raw tool argument/result capture, historical import/backfill and vendor-derived archive export remain explicit future capabilities. Do not call these complete merely because search tools work.
