# Claude-mem: cross-run memory research for Macrofold

| Status | Current progress | Last updated |
| --- | --- | --- |
| Research complete; adoption proposed | Source/document review identifies an optional developer pilot and a scoped application-memory experiment; no integration or benchmark has been run. | 2026-10-07 |

## Recommendation

**Useful directly as an opt-in coding-agent aid; promising as an optional customer-memory integration; not a new mandatory Macrofold subsystem.** A coding agent could recover why an approach failed after switching conversations. A customer agent could recall relevant earlier work after moving to another harness or machine. Neither benefit requires making an automatically generated summary authoritative.

Keep the existing editable file-memory starter as the simple default. Evaluate Claude-mem's service before building equivalent storage, but adopt its progressive retrieval pattern independently of that purchasing/building decision. This is research, not approval to install hooks, enable external capture, add infrastructure or alter existing memory and billing contracts.

Evidence baseline: Macrofold `main` at `8c6797decca2e9b71ab376594b59e35a2e67a55f`; upstream `thedotmack/claude-mem` at `71ddd11735d6dc38a6356fe376921fc216f2aa38` (October 6, 2026; v13.34.2 changelog). Rolling official documentation was checked October 7. Source inspection and published behavior are distinguished from runtime acceptance throughout. Popularity is not an acceptance criterion.

## How Claude-mem works

The local system separates capture, derived observations and later recall. Platform hooks/adapters send activity to a worker; an observer model extracts reusable facts, discoveries and decisions. SQLite stores local memory, with full-text search and optional Chroma semantic indexing. Session summaries and compact startup context help a later conversation resume without including every previous tool result. This is additional model work, not free compression. See the [architecture overview](https://docs.claude-mem.ai/architecture/overview).

Its useful retrieval interaction is:

1. **Search:** return a compact catalogue of potentially useful observations rather than all their prose.
2. **Timeline:** inspect surrounding activity when chronology helps explain a result.
3. **Get observations:** expand selected records, normally together rather than one call per record.
4. **Inspect evidence when needed:** distinguish generated observations from original tool/source evidence; only expose a raw-evidence route when the selected adapter actually supports it.

The [search guide](https://docs.claude-mem.ai/usage/search-tools) documents `search`, `timeline` and `get_observations`. The [progressive-disclosure guide](https://docs.claude-mem.ai/progressive-disclosure) also discusses deeper source inspection. A complete observation is still a derived description, not necessarily a verbatim transcript or proof that an external action succeeded. The transferable idea is **cheap discovery with selective, provenance-preserving expansion**, not mandatory three-call ceremony for every prompt.

The code confirms that runtimes differ. The [MCP implementation](https://github.com/thedotmack/claude-mem/blob/71ddd11735d6dc38a6356fe376921fc216f2aa38/src/servers/mcp-server.ts) routes worker calls separately from server-runtime `observation_*` operations. Its [checkout scope helper](https://github.com/thedotmack/claude-mem/blob/71ddd11735d6dc38a6356fe376921fc216f2aa38/src/servers/checkout-search-scope.ts) expands a matching checkout project to its historical project keys; explicit project lists and unscoped searches pass through. That is useful name continuity, not a tenant authorization mechanism or Git-branch truth check.

### Local plugin versus hosted beta

Do not evaluate an obsolete local-only picture. The [hosted-server documentation](https://docs.claude-mem.ai/hosted-server) describes PostgreSQL, a separate BullMQ generation worker, scoped API keys, deletion endpoints and authenticated read-only HTTP MCP. Its remote recall tools are `search`, `context` and `recent`, not a promise of parity with the local timeline/detail workflow. Onboarding/key bootstrap remains unfinished. Quotas and metering are opt-in, and the documented guards fail open on backing-store errors. Built-in generation providers use worker-environment credentials; a custom provider hook is available.

Consequently, evaluate the exact selected deployment. Do not copy BullMQ into Macrofold merely to imitate the reference: Macrofold's [architecture research](research.md) records the existing PostgreSQL/Workflow direction. A separately operated memory service can own its queue; Macrofold must still own authorization, financial admission and customer-visible outcomes.

## What Macrofold already has

| Existing capability | Evidence and implication |
| --- | --- |
| Editable durable memory | [Customer memory](../features/customer-agents/memory.md) provides profile, topic notes and tasks. It explicitly is not a semantic API or background indexer. |
| Application-owned conventions | [The helper source](../../examples/shared/file-memory.ts) returns files, paths and instructions. It does not perform writes, grant access or run the task list. Preserve that boundary. |
| Persistent execution and native homes | [Implementation status](../status/README.md) records worktree persistence, declared native-home resources and fresh-container continuation evidence, with separate hosted limits. Persistence is not automatic ingestion or cross-harness semantic recall. |
| Existing integration boundary | [Customer-agent identity](../features/customer-agents/README.md) and [integration recipes](../../examples/integrations/README.md) are the starting points for an application-owned service. Do not turn one app's memory policy into a platform requirement. |

The current starter already distinguishes facts, inferences, conflicting preferences and forgotten information. Claude-mem can reduce manual rediscovery and search friction; it does not make these semantics obsolete. A native session continuing correctly also does not prove that an external plugin database was included in its persistence profile.

## Direct developer pilot

Use a pinned, isolated installation for consenting developers working on these repositories. Start with non-sensitive engineering history: attempted fixes, measured failures, useful source locations and decisions. Do not automatically ingest environment files, credentials, customer records or private traces. Existing `AGENTS.md`, current source and accepted documentation remain authoritative; memory is a lead to inspect, not a substitute for reading them.

The current [File Read Gate](https://docs.claude-mem.ai/file-read-gate) can block eligible large whole-code-file reads in Claude Code, while leaving targeted reads available. Begin with `CLAUDE_MEM_FILE_READ_GATE_ENABLED=false` so memory quality and source-reading behavior can be evaluated separately. This is not a claim that the gate blocks Markdown instructions. Later assess whether its extra tool turns improve total cost and correctness for our files.

Verify capture, startup injection and search independently for every chosen harness. Cross-agent support does not imply identical hooks or defaults. Review project naming, checkout aliases, worktree isolation and source commit attribution. Remembering a fix on an unmerged branch must not imply that the checked-out branch contains it. Nothing in this research installs the plugin or modifies developer settings.

## Proposed adaptation for customer agents

### Keep three kinds of information separate

**Authoritative records:** customer identity, permissions, execution receipts, external-action results and current task state remain in their existing owners. **User-controlled memory:** editable confirmed preferences and notes retain their current correction semantics. **Derived recall:** generated observations, summaries, embeddings and discovery indexes are replaceable projections with explicit provenance.

For example, a recalled note saying “the invoice was sent” must link to the actual authorized result before an agent claims success or decides to send again. A previous customer's preference is not available merely because its embedding is similar. Provider-exposed reasoning should not enter long-term memory by default just because it appears in the run stream.

### Reuse the existing execution boundaries

A candidate flow is: authorized completed event → capture-policy filter → durable pending-memory record → admitted summarization/indexing → scoped discovery → selected detail → existing run context. This is a proposed application integration, not a new implemented event contract.

Capture only the permitted, necessary portions of events. Record stable organization/customer/workspace/agent identity, run and source-event identity, source revision and permission scope; include repository and commit information for coding memories. Use existing resource IDs, not directory names, to establish ownership. A customer may deliberately share memories across named agents, but sharing must be explicit rather than an accidental consequence of a common worker home.

Make repeated delivery idempotent on the source identity and transformation version. Commit observations and their source references atomically. Track pending, failed and invalidated generation distinctly: “not indexed yet” is not “nothing happened.” Summaries must not recursively ingest their own injected context as fresh supporting evidence. Coalesce low-value activity and avoid generating a separate paid observation for every token or routine tool step.

### Make discovery bounded and permission-safe

Expose a compact application-owned discovery operation with short handles, useful titles, event time, source kind, uncertainty and estimated expansion size. Resolve handles to permitted records server-side. Recheck authorization on detail and timeline requests; a previously issued handle is not a durable permission grant. Apply scope before ranking, snippets, counts and cache lookup, including any temporal neighbors.

Allow direct expansion of already-known evidence and batch detail requests. Timeline is optional: it helps reconstruct a failed deployment investigation, but is wasteful for a simple confirmed preference. Budget total records, bytes/tokens, tool calls and wall time across the job; pagination and retries must not create a larger effective budget. Start with existing relational/text facilities, adding vector retrieval only when measured paraphrase recall warrants it. Keep indexes rebuildable and embeddings tied to compatible model/source versions.

### Preserve financial and persistence guarantees

Any observation-generation or embedding call must pass through the application's existing authorized provider and reservation path. Do not let upstream fail-open quotas, provider retries or process-global credentials bypass a customer's exact key and budget. A custom generation adapter may be an integration seam, but its execution and uncertain-call accounting require qualification. Read-only recall can remain available when optional new memory generation is denied.

For a local-worker deployment, explicitly qualify capture and restoration of its database, index and pending state. The current native-home policy does not imply arbitrary plugin directories are durable. Do not run concurrent writers against a casually shared SQLite file across hosts. For a separate service, use stable authenticated application identity across fresh workers and test service loss without corrupting normal workspace recovery. No restore should resurrect information that has been explicitly forgotten.

### Correction, forgetting and security

Model prose is untrusted data even when retrieved from our own index. Sanitization should occur before persistence, queues and observer-provider dispatch. Upstream [private tags](https://docs.claude-mem.ai/usage/private-tags) affect memory capture, not what the original live conversation has already disclosed. [Auto-redaction](https://docs.claude-mem.ai/usage/auto-redaction) is opt-in and pattern-based; it is not complete sensitive-data detection. Test representative secret canaries and organization-specific exclusions rather than relying on labels such as “local-first.”

Corrections need source lineage and explicit supersession, not latest-text-wins. A forget operation must invalidate derived summaries, vectors, query caches and pending jobs; an in-flight job must not recreate deleted content. The existing memory guide correctly separates current notes from retained checkpoints and provider copies. Define those retention scopes and recovery behavior before making an erasure promise. Upstream deletion endpoints are useful primitives, not evidence that our entire lifecycle is covered.

## Evaluation and adoption gates

**First compare, then add infrastructure.** Use the same tasks, sources, models and total context budget for the current file starter, a straightforward scoped text/vector retrieval baseline, and progressive disclosure. Include fresh conversations, fresh containers, harness switching, contradictory evidence, failed external actions, branch changes and irrelevant-history-heavy tasks.

Measure task correctness, supported versus unsupported claims, useful-source recall, stale-memory errors, cross-scope leakage, total paid tokens/cost, time to a useful answer, retrieval latency and capture backlog. Include summarization, embeddings, query calls, extra model turns and repeated context reads. Vendor “10x” examples are not measured Macrofold savings. The relevant comparison is not an artificially expensive full-history dump.

Run adversarial lifecycle cases: revoked access between search and detail, guessed handles, retry after uncertain capture, correction during indexing, deletion during generation and recovery after forgetting. Require no disclosure or authority regression. Evaluate quality and latency on interactive tasks separately from long investigations; do not hide a slower greeting behind a cheaper batch average.

Suggested sequence: developer-only pilot; read-only customer-history replay against the baseline; then an explicitly approved opt-in application integration with correction, deletion and spending controls. Only successful evidence should promote this to a reusable product capability. Keep default file memory when its quality is sufficient. Existing [maintainer work](../maintainers/TODO.md) and feature guides remain the delivery owners; this study closes no implementation or acceptance items.

## License and evidence limits

The [pinned upstream license](https://github.com/thedotmack/claude-mem/blob/71ddd11735d6dc38a6356fe376921fc216f2aa38/LICENSE) is Apache-2.0; do not apply obsolete licensing descriptions to this revision. The [IP boundary](https://github.com/thedotmack/claude-mem/blob/71ddd11735d6dc38a6356fe376921fc216f2aa38/docs/ip-boundary.md) distinguishes public components from reserved commercial offerings. Review the chosen distribution and dependencies before shipping; no upstream implementation was copied here.

This review inspected selected upstream source and official docs plus Macrofold's current memory helper and owning documentation. It did not install either Claude-mem runtime, execute providers, benchmark retrieval, audit all security paths, test hosted isolation or qualify backup/erasure behavior. Those are adoption gates, not completed results. Related OpenLegend research belongs in that repository's research section; shared transport does not entitle Macrofold to inspect character-private memories.
