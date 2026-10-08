# Agent integration library — technical design

| Status | Current progress | Last updated |
| --- | --- | --- |
| Not started | The design maps optional capability packs to current owners and defines installation, memory lifecycle and qualification; runtime implementation has not begun. | 2026-10-07 |

## Scope and architecture decision

Implement the [feature specification](agent-integration-library-feature-spec.md) as a small declarative library plus an application-owned installation lifecycle. A pack composes approved connections, instructions/skills, optional capture/retrieval behavior and supported storage. The underlying memory provider remains replaceable, but its meaningful semantics are not concealed.

Do not implement a new agent harness, global memory database, independent scheduling framework, universal customer identity or arbitrary plugin execution engine. The existing [architecture](../architecture/README.md), [codebase map](../architecture/codebase.md), [UHI](../features/execution/unified-harness-interface.md) and [connection-access rules](../features/identity-integrations/connection-access.md) remain controlling. All mechanisms described below are proposed extensions, not existing API claims.

Separate three responsibilities:

| Responsibility | Authority |
| --- | --- |
| Application and execution facts | Existing customer binding, authorization, run, task, file, receipt and financial owners. A memory summary cannot mutate these facts. |
| User-controlled memory and permitted source material | Existing files or an explicitly selected collection with its own retention/correction policy. Do not make retained transcripts a mandatory hidden second store. |
| Derived memory | Provider observations, summaries, embeddings, graphs and cached retrieval. Preserve lineage and uncertainty; the provider owns its representation behind the adapter. |

A common installation contract is valuable because the concrete initial consumers differ: file memory needs conditional initialization and file reads; Hindsight needs remote retain/recall and possibly reflect; Claude-mem may need an isolated service plus capture and worker-specific search. Standardize their lifecycle and evidence envelope, not an imaginary identical algorithm.

## Ownership and existing seams

| Layer | Proposed responsibility and existing anchor |
| --- | --- |
| `packages/core` | Pack eligibility, installation state, resource binding, grant resolution, job admission, memory policy, usage attribution and domain-owned provider ports. Reuse current connection, run, file, scheduling and financial services. |
| `packages/db` | Tenant-scoped installation/binding records, revision fencing, operation receipts and durable jobs. Reuse PostgreSQL transactions, RLS, outbox and lease conventions. |
| `packages/providers` | Reviewed vendor provisioning, memory operations, polling, capability translation and deletion/export adapters. Provider IDs and SDK types do not define application authority. |
| `packages/runtime` | Apply the admitted pack configuration to the native harness, report supported lifecycle events and include approved durable plugin resources in capture/restore. No untrusted code on the API process. |
| `apps/web` | Library, preview/consent, setup status, memory inspection and management, invoking the same core operations as other clients. |
| OpenAPI, contracts, CLI and five SDKs | Shared typed install and management operations, asynchronous status and error semantics. Generate public contracts together when implemented. |

The [optional customer-agent path](../features/customer-agents/README.md) supplies verified application/customer/resource binding where used. Direct workspace users remain supported without adopting that path. Native harness configuration and memory installation identity are separate.

Current UHI is a reviewed repository extension interface, not a dynamically installed universal plugin runtime. Add only the lifecycle and persistence mappings required by each supported pack/harness pair; do not advertise native-hook parity from an MCP-compatible badge.

## Pack definitions, releases and portable packaging

Start with a checked-in curated catalog, compiled/validated into an immutable release manifest. Installation stores the accepted manifest digest and configuration revision. A new external package URL is a submission or explicitly reviewed private integration, not executable authority.

A release describes the following fields; exact schema names belong to implementation, not duplicated public contracts in this proposal:

| Field group | Required meaning |
| --- | --- |
| Identity and provenance | Stable pack ID, release version, artifact digest, maintainer, source revision, license/dependency evidence, support/deprecation status. |
| Outcome | Category, description, appropriate workloads, limitations and recommended defaults. |
| Compatibility | Exact supported harness/runtime/deployment combinations and separate evidence for tools, automatic capture, context injection and persistence. |
| Components | Skills/instruction fragments, existing connector requirements, reviewed lifecycle adapter IDs and optional isolated service requirements. |
| Capabilities | Read/write memory operations, source inspection, reflection, correction, delete, export, asynchronous status and provider idempotency support. Distinguish unsupported from unknown or unqualified. |
| Resource policy | Memory namespace binding, durable paths or service storage, region/data destination, source retention, network destinations and dependencies. |
| Capture/retrieval policy | Eligible source types, exclusions, deduplication, context preparation, freshness behavior, maintenance triggers and dependency policy. |
| Funding and bounds | Funding route, billable dimensions, liability estimation/limits, job/context envelopes, and which provider costs are external. |
| Lifecycle | Prepare, verify, activate, pause, update, detach and delete behavior, including ambiguous outcomes and cleanup ownership. |
| Configuration | Validated safe settings, defaults, required consent, advanced controls and allowed overrides; no secret values. |

Use [Agent Plugins](https://agent-plugins.org/) and Agent Skills for portable Skills/MCP components where their actual version supports the needed structure. Keep Macrofold's installation, permission, funding and persistence metadata in a separate namespaced extension or catalog envelope; do not claim a custom universal packaging standard. Imported packages are normalized and reviewed before activation. Bundled scripts still require execution review and appropriate isolated runtime support.

Pin transitive dependencies and artifacts in an installation lock record. New permissions, capture sources, outbound destinations, recurring work or spend require a new consented revision. Do not auto-upgrade from a mutable Git branch or an unpinned package-manager install inside a run. Freeze the accepted release/configuration for each run; emergency revocation can narrow or disable it independently.

## Installation and binding model

Keep catalog definitions immutable and configuration/data mutable under distinct owners. Proposed persisted entities are an installation, its resource bindings and its operation receipts/jobs; reuse existing tables/services when they already express a required responsibility.

An installation carries organization, owning principal, verified workspace/customer context, target preset/worktree bindings, release digest, configuration revision, status, funding reference and consent record. A collection binding maps an application-owned identifier to an exact provider account/namespace and records sharing, retention and deletion generation. No provider bank ID, path, name or request field grants authority.

A preset stores a pack requirement/default configuration reference, not a live customer's collection or credential. At admission, resolve an exact authorized installation for the real workspace and application-customer binding. Copying/exporting a preset strips instance bindings and secrets. A recipient completes their own installation/consent. Shared collections use separate explicit grants, not accidental reuse of an installation through a common preset.

Use an installation revision for configuration changes and a monotonically advancing generation for revocation/deletion fencing. Accepted work records the relevant revisions and may publish only while its permissions and generation remain valid. Concurrent install, update and delete requests use existing conditional mutation and idempotency conventions.

## Preview, provision and activation flow

**Preview is side-effect-free.** Resolve the proposed release, actual harness/deployment, requested resources, source scope, existing installation conflicts, grants, funding and estimated liability. Return a plan digest and resource revisions together with missing prerequisites and a readable consent summary. A preview does not reserve funds, create a default worktree or contact providers for paid work.

**Enable revalidates the preview.** Bind the idempotency key to the actor, organization, target and accepted configuration. In a short transaction, authorize, validate revisions, reserve only the approved bounded liability, create an installation operation and persist its dispatch intent. A stale preview or expanded consent requirement returns a reviewable conflict before external effects.

**Provision outside the transaction.** Use the existing SQL outbox and Workflow/poller execution path. Allocate a unique namespace or bind an explicitly selected existing one, set up the reviewed provider connection, prepare conditional files/configuration and perform the disclosed readiness checks. Each external step has a durable operation identity and stores returned resource IDs before moving on. Poll asynchronous provisioning without resubmitting paid generation.

**Activate only after required preparation succeeds.** Publish the complete configuration revision and scoped capability bindings atomically at a safe run boundary. Unready dependencies cannot leak into partial tool discovery or context injection. A file-memory initializer never overwrites customer content; it previews conflicts and publishes through the existing file owner only when the worktree is safe to edit.

**Recover conservatively.** A timeout after a possible remote create becomes outcome-unknown, not a reason to create a second collection. Reconcile by the provider's supported idempotency key or recorded identity; otherwise surface the unresolved operation. Compensating cleanup removes only installation-owned, exclusively used resources and never deletes an existing customer bank or shared connection automatically.

Configuration lifecycle states are draft, awaiting-consent, provisioning, verifying, active, paused, disabling, disabled, deleting, deleted and needs-attention. Operation outcomes separately identify pending, succeeded, failed, cancelled and unknown external effects. This distinction avoids using an installation status to erase an uncertain billable operation.

Ready is based on admitted configuration, a successful bounded readiness probe and compatible release evidence. Synthetic probe data is labeled non-customer evidence and cleaned up or kept in an isolated diagnostic scope. A healthy API response alone does not qualify automatic capture, worker replacement or retrieval quality.

## Automatic memory lifecycle

### Capture from the authoritative execution flow

Capture begins with permitted committed messages, completed tool outcomes, approved source files or explicit user memory edits. Do not use the SSE transport, Langfuse export or a UI transcript scraper as the capture source of truth. Streaming fragments and observability retries must not produce repeated memories.

Attach an opt-in capture intent to the same committed execution transition or to a durable cursor over that owner. Retain only the admitted fields and source references. Where normalized native events do not expose enough permitted evidence, add a reviewed native adapter mapping; do not silently claim the missing capture coverage.

A capture envelope contains installation/collection identity, source/run identity, source revision, actor/speaker role, event and ingestion times, permitted content, origin type and evidence links. Coding sources can include repository and commit/branch provenance. Keep credentials, private reasoning and excluded documents out of the envelope before queues, logs or provider dispatch. No automatic blanket capture of all tool output.

Use a uniqueness key based on collection, source identity/revision and transformation version. Mark memory-tool results and injected memories as derived recall so they are not reingested as independent evidence. Group noisy tool activity when appropriate and retain the actual source lineage. An assistant saying “I sent the invoice” is not equivalent to a verified send result.

### Transform under bounded admission

A memory job records its source watermark, installation generation, exact provider/model route, input envelope and funding reservation. Extraction, embeddings, consolidation and reflection are separate supported operations with separate usage. Background maintenance may continue after a run ends only under an explicitly authorized installation budget; it cannot borrow an expired run capability or reuse a settled reservation.

Reuse the existing scheduler, leases and fairness controls. Coalesce work, prefer useful deltas and avoid one paid transformation per stream token or routine simulation-like tick. Advance a processed watermark only after the corresponding receipt is durable; cancelled or failed work remains explicitly incomplete. No automatic paid retries or provider-funded fallback after an ambiguous dispatch.

Provider-internal autonomous work is part of the integration, not invisible free implementation detail. Disable it, route it through the admitted budget or qualify an enforceable external allowance. A managed pack is not safe merely because its initial API call was metered.

### Retrieve at meaningful boundaries

Before a supported new run or turn, prepare bounded relevant memory using the current task and authorized sources. Include high-value confirmed preferences or required records through direct lookup where available; perform optional relevance search only when useful. A known source can be read directly. Do not force search → timeline → detail for every greeting.

The common result envelope reports permitted evidence handles, useful text/title, source time and revision, derived-versus-source status, uncertainty, freshness/coverage, continuation and attributed usage. Different providers retain their native detail: Hindsight synthesis is not a raw fact; Claude-mem's full observation is not necessarily an exact original tool result. Source inspection must not promise evidence the provider did not retain.

Apply scope before ranking, snippets, counts, graph/temporal expansion and cache lookup. Recheck on every detail call and before context injection. Do not place disjoint security populations in one provider bank unless every relevant retrieval and derived-operation path enforces their scopes; use separate banks by default. Filtering an already synthesized answer cannot repair a reflection that consumed another customer's secrets.

Scope cached results by collection/source revisions, credential/permission revision, provider/model compatibility and forgetting generation. Pending indexing means incomplete recall, not an empty history. Continuation tokens and pagination share the same total record, context, wall-time, tool-call and spending envelope.

Compose pack instructions and untrusted memory as distinct inputs within the existing harness configuration. Respect explicit run restrictions, including No tools and file/connector limits; an automatic prelude must not become a hidden way to bypass them. Record preparation costs and the provenance of injected material without exposing private contents in general analytics. Default Claude-mem source-read interception remains off, as recommended in the research; enabling memory must not stop mandatory source inspection.

## Provider mappings and qualification

### Simple file memory

Use the existing [helper and convention](../features/customer-agents/memory.md), conditional file writes, persistent worktree and file UI. Pack setup creates only missing files. The instructions cover selective reads, provenance, confirmed preferences and corrections. The platform does not suddenly execute a task JSON file, guarantee model obedience or erase retained history. Qualify this as the simple instruction-based architecture, not an automatic observation/semantic-index service.

### Hindsight

Bind an exact bank behind the authorized application adapter. Use retain for admitted source ingestion, recall for evidence discovery, and reflect only when the recipe calls for separately admitted synthesis. Preserve document/source IDs, timestamps, tags and returned provenance where supported. Generated observations or mental models remain derived; fuzzy entity resolution does not establish application identity.

The official [API integration guide](https://docs.hindsight.vectorize.io/api-integration/) and [MCP guide](https://docs.hindsight.vectorize.io/mcp/) provide the transport starting points. Do not expose unrestricted bank creation/selection merely because the upstream MCP includes it. Translate an application collection to the bound bank server-side. Verify source-specific corrections, deletion propagation, asynchronous indexing, export and internal-model funding for the selected deployment before claiming those guarantees.

The [portable plugin guide](https://hindsight.vectorize.io/sdks/integrations/agent-plugin) distinguishes Skills/MCP from automatic lifecycle hooks and documents client-specific limitations. Use the existing Macrofold broker/runtime integration where needed rather than assuming an upstream installer works unchanged in every native harness. A vendor integration badge is not a passed Macrofold compatibility row.

### Claude-mem

Maintain separate capability profiles for its local worker and hosted-server deployment. The local recipe may use search, timeline and batched observation expansion; the hosted beta documents different read operations. Map only the selected version's supported surface. Follow the source-backed [research](../architecture/claude-mem-research.md), [search documentation](https://docs.claude-mem.ai/usage/search-tools) and [hosted-server documentation](https://docs.claude-mem.ai/hosted-server).

For an isolated local service, capture its reviewed database, required sidecars/index and pending work through an explicit durable resource profile. Quiesce/checkpoint correctly; never share an uncoordinated SQLite file among independent hosts. Stable application identity outlives a worker directory. For a remote service, persist the namespace binding and credentials in their existing owners rather than backing up the remote database in every worktree.

Qualify the observer's model path and quotas. The hosted documentation's fail-open guards cannot enforce Macrofold's financial contract. Local project aliases cannot authorize multi-tenant access or prove that code on an unmerged branch is present in the current checkout. Keep the reference's coding assumptions out of unrelated customer-agent prompts.

### Capability adapters rather than lowest-common-denominator memory

Standardize lifecycle operations such as capability discovery, binding/provisioning, health, detach and supported delete/export. Memory-specific adapters then expose the operations they actually support, with normalized outcome/evidence/usage envelopes and validated provider-specific settings.

Do not pretend every provider implements exact inspection, mutable facts, reflection, instant deletion or portable internal state. A missing required capability blocks a full recipe. A useful limited integration can remain a separately labeled offering. New providers should require a manifest, a narrow adapter when needed and evidence—not a new settings page or executor for each one.

## Security, credentials and execution

Use existing named connections and consent. A pack's requested permissions intersect current user, workspace, preset, installation and run permissions; they never union into a broader grant. The connection owner must approve any expansion under the current access contract. Separate credential ownership from authority to install a pack or use its data.

Keep provider credentials in the control plane and invoke through the authorized broker or short-lived installation-scoped service capabilities. Do not place long-lived vendor keys in shared presets, exported packs, memory files, prompt text or native checkpoints. Use existing outbound network restrictions; approved local development exceptions stay local.

A pack's instructions, model output and recalled text are not authorization. Review the installed instruction contribution independently from captured third-party content. Restricted native tools must remain restricted. Provider-created schedules, autonomous model calls or executable hooks require explicit declared capability and spending treatment.

First-party/curated packs can invoke only reviewed implementation IDs. Third-party executable components, when eventually supported, run in an appropriate isolated worker with declared network and storage, never in the API/control-plane process. Artifact digests, provenance and license review supplement—not replace—runtime permission enforcement. Operator management MCP remains read-only.

## Persistence, forgetting and provider replacement

Memory collections are not owned by transient Hosts or native session IDs. Remote collections survive worker replacement through their exact binding; local pack storage needs an explicit approved persistence profile and fresh-container acceptance. Existing [native-home persistence](native-home-persistence.md) does not automatically preserve arbitrary plugin directories.

For corrections, retain the owning source revision and explicit supersession. Do not use last-generated-text-wins. For forgetting, first advance the collection's deletion generation and block use of the affected material. Invalidate derived records, vectors, caches, pending capture and previously prepared context. In-flight completions from an older generation cannot publish or enter new context.

Remote deletion is not one SQL transaction. Keep it as a durable idempotent operation with outcome-unknown handling and verifiable completion where supported. When a provider cannot remove the derived consequences selectively, quarantine the affected collection and offer an explicitly approved purge/rebuild from still-authorized source material, with a new cost preview. Do not silently regenerate a deleted bank on the next capture.

Retain a minimal non-content deletion fence sufficient to prevent an old checkpoint/import from resurrecting forgotten data. Historical transcripts, backups, external provider copies and already-dispatched context have separate retention and revocation limitations. The UI and API must not claim these disappear when only current retrieval is blocked. Restoring a worktree cannot roll back active installation revocation or deletion fences.

Export non-secret configuration, user-owned notes and retained source/provenance at their available precision. Do not promise portable embeddings, entity graphs or identical behavior across providers. Provider replacement requires an explicit import scope and budget, a stable source watermark, destination verification and an atomic binding cutover. Keep one active automatic writer; fence/drain the old pipeline before switching and reconcile the remaining authorized delta. Failure before cutover leaves the old installation intact. Post-cutover rollback must account for intervening writes and forgetting; swapping an old snapshot is not a safe rollback.

Disable, uninstall and data deletion are distinct. Detach pack-owned references and instructions without deleting user overrides, shared services or customer-owned banks. External subscriptions may continue to charge until the account owner cancels them; surface that fact and never report financial cancellation without provider evidence.

## Money and service levels

Reuse bigint micro-USD, reservations, usage receipts and uncertain-liability handling. Attribute operation cost to organization, installation, collection and originating run when one exists. Installation maintenance has its own authorized allocation; a run and a background memory job cannot both charge the same reservation. Price changes affect future admission, not previously accepted terms.

Managed routes must be able to bound all paid work, including service-internal generation and idle compute. Exact customer credentials remain exact: no silent managed fallback or replacement account. An external service account can have a distinct budget, but the UI must not imply that the native run cap controls that provider's internal spending. Do not enable automatic work with unbounded, unapproved liability. Each qualified deployment declares how its bound is enforced; capability support alone is insufficient.

Every operation, including reads, is evaluated for its actual billing behavior. A failed response with missing usage is not free. Stop optional capture/transform work on exhaustion and keep already-authorized affordable reads only when their funding permits. For Required memory, fail or wait before dependent execution. For Optional memory, record the unavailable preparation and continue without fabricating equivalent recall or moving data elsewhere.

Avoid a mandatory observer/container per idle agent. Prefer a qualified shared service with isolated collections or reuse admitted worker capacity when the chosen local architecture needs it. Measure database/index growth, capture lag, context overhead, extra model turns, restore time and idle resources. No scale, latency or savings numbers are assumed by this design.

## Proposed API, CLI, SDK and UI surfaces

Names below express proposed responsibilities, not implemented endpoints:

| Operation | Contract |
| --- | --- |
| Catalog list/detail | Outcome, immutable release, compatibility, support status, defaults, capabilities, prerequisites and cost model; no secret metadata. |
| Preview installation/change | Side-effect-free resolved plan with consent/funding requirements, target revisions, conflicts and plan digest. |
| Enable/update | Idempotent, revision-checked operation returning installation and asynchronous operation identities. |
| Inspect status/usage | Safe lifecycle, capture/index watermarks, readiness evidence, current configuration and attributable costs. |
| Memory read/recall/inspect | Same principal/resource checks for application UI and agent tools; source-aware bounded results. |
| Correct/forget/export | Explicit authorized scope, durable operation, revisions, progress, limits and provider-supported outcome. |
| Pause/disable/remove | Defined active-run, pending-job, retained-data, dependency and external-charge behavior. |

Add the operations to the current OpenAPI/HTTP service owner and generate TypeScript, Python, Go, Rust and Java clients. CLI commands are clients of the same operations, including machine-readable pending/unknown outcomes. Reuse dashboard connection consent, conditional file editing, shared query/cache handling and status patterns. Do not build a plugin-specific credential editor or privileged browser provisioning path.

Agent tools receive short scoped handles and bounded memory capabilities, not administrative installation, arbitrary namespace selection or access-grant operations. Setup/management UI uses owner-authorized APIs. Any customer MCP exposure follows existing API authorization; operator MCP does not gain writes.

## Implementation sequence and verification

The feature specification owns stage outcomes; this section identifies the technical exit evidence, not a second task-status list. Reconcile PRD-06, EX-03 and INT-05 with maintainer TODO when implementation is authorized.

**Shared vertical slice:** catalog definition validation, conditional preview, idempotent installation journal, exact resource binding and file-memory activation. Verify preservation of existing files/instructions and the no-pack path. Run an actual new-session recall/correction journey through the public interface; a schema-only test does not qualify behavior.

**Richer service pilot:** add Hindsight through a reviewed adapter, automatic capture and context preparation, budget accounting, asynchronous receipts and usable memory controls. Verify native-turn boundaries, fresh worker/harness behavior, service loss, refused permissions and forgetting races. Pin the tested provider/server/runtime configuration.

**Second architecture and reusable packs:** add Claude-mem with distinct deployment capability rows, then qualify a simple non-memory Skills/MCP pack against the same installer. Exercise dependency conflicts, duplicate capture, preset sharing, version update, rollback limits and external-funded behavior. Do not rebuild a generic pipeline whose abstractions have no consumer.

Required adversarial cases include duplicate enable after a lost response; a remote namespace created before timeout; permission revocation between search and detail; tenant ID/bank guessing; capture of a failed external action; malicious recalled instructions; capture of recall itself; correction/deletion during indexing; callback after uninstall; restore after forgetting; conflicting file writes; provider budget failure; an unmetered observer; and invalidated warm native context.

Use existing isolated database/native/API/browser/client test infrastructure under [TESTING.md](../../TESTING.md). Default CI uses no paid providers or customer data. Live provider qualification uses separately authorized test identities, a declared shared budget and synthetic data. Record total settled and uncertain costs across all calls, including readiness and cleanup. Apply existing docs/contracts/SDK generation and review gates to implementation; fixtures alone cannot prove live quality, privacy or hosted operation.

Qualification is a matrix of pack release, provider/deployment configuration, harness/runtime version and operating mode. Record separately: transport available, capture available, automatic injection, scoped retrieval, durable continuity, correction/deletion limits, cost enforcement and live acceptance. Unsupported rows stay disabled or explicitly tools-only; no blanket six-harness claim.

## Decisions, dependencies and evidence limits

The recommended architecture is deliberately optional and provider-neutral at the lifecycle boundary. It preserves the simple file baseline, uses a curated declarative catalog, separates presets from data-bearing installations and keeps one automatic memory owner per collection unless a reviewed composition deliberately differs. These choices avoid accidental sharing, duplicate spend and an unbounded plugin execution surface while allowing future providers.

Managed Hindsight/Claude-mem availability, region, data terms, exact provider API versions, internal-model funding and commercial pricing remain per-offering qualification decisions. This proposal does not select a vendor account or commit to hosting either service. Full customer-agent execution, billing and recovery release gates remain open where currently tracked; the library cannot declare those solved.

Repository baseline and research date are recorded in the [feature specification](agent-integration-library-feature-spec.md#evidence-boundary). Provider documentation and repository contracts informed the design, but no plugin was installed or integration tested. Exact performance, deletion propagation, update portability and provider cost enforcement require the scoped evidence above before public enablement.
