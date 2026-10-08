# Agent integration library — feature specification

| Status | Current progress | Last updated |
| --- | --- | --- |
| Not started | The requested design is written; the optional library, managed provisioning and provider packs are not implemented or qualified. | 2026-10-07 |

## Outcome and product direction

A builder opens an agent's **Add capabilities** panel, chooses **Memory**, selects a recommended architecture, and enables it. Macrofold prepares the storage, scoped connection, instructions, capture and retrieval behavior, maintenance, controls and verification needed to make that architecture work. The builder should not need to wire lifecycle hooks, design retrieval prompts, manage a vector database or learn a provider's terminology.

**Sell a working capability, not a list of endpoints.** A memory pack is a complete, optional recipe with a supported operating lifecycle. A connector merely makes an external tool available. Installing an MCP server and hoping an agent remembers to call it is not the same product.

The library extends to reusable skills, research/knowledge packs and other reviewed tool integrations. Memory is the first substantial family, with Hindsight and Claude-mem as distinct candidate architectures rather than one mandatory platform memory engine. Keep ordinary Macrofold runs available with no pack. Preserve the existing [file-memory starter](../features/customer-agents/memory.md) as the simplest optional approach.

This records the owner's request for a library and this document's recommended design. It does not authorize runtime implementation, paid provisioning, customer-data transfer, installation of third-party code or a new commercial agreement. The paired [technical design](agent-integration-library-tech-design.md) describes proposed mechanisms and delivery gates. Current behavior remains in the existing feature guides.

## Why this belongs in Macrofold

Macrofold already coordinates persistent work, multiple native harnesses, scoped connections, execution and spending. Its [current architecture](../architecture/README.md) and [codebase map](../architecture/codebase.md) describe those owners. The library should compose them into reusable setups, not create a second scheduler, credential vault, agent loop or customer-identity system.

The value to builders is not exclusivity over memory technology. It is avoiding repeated integration work: consistent installation, safe customer separation, useful defaults, continuity after replacing a worker, an understandable bill, and correction or removal that actually stops future use. This is a product hypothesis to validate through activation and successful customer tasks, not a measured competitive advantage.

## Product vocabulary

| Concept | Meaning |
| --- | --- |
| Integration | A connection to a service, such as a memory provider or document source. Connection alone does not grant an agent access. |
| Pack | A reviewed, versioned recipe combining integrations, optional skills, lifecycle behavior, storage and operating policy to deliver an outcome. |
| Installation | One owner's configured instance of a pack, bound to permitted resources and funding. |
| Memory collection | A separately controlled body of memory. A provider may call it a bank, project or namespace. |
| Agent preset | Reusable agent configuration that can declare pack requirements; it contains no customer memory or credentials. |

Use **Memory**, **Knowledge**, **Tools** and **Skills** in the main library. Keep manifests, provider operations and storage details in the advanced view. Do not add a second top-level agent concept solely for plugins.

## Initial library and recommendation model

The first complete release should make these recipes usable through the same install and management experience. Provider/deployment combinations graduate separately; none is currently certified by this design.

| Recipe | Builder-facing promise | Proposed packaging | Important distinction |
| --- | --- | --- | --- |
| Simple editable memory | Remember preferences, notes and ongoing context that people can inspect and correct. | Existing file convention, safe initialization, bounded retrieval instructions and current file editor. | No external memory service; instruction-based recall is not guaranteed semantic recall or erasure of historical checkpoints. |
| Learning memory — Hindsight | Connect experiences across conversations and retrieve relevant past information. | Scoped bank, capture policy, retrieval, provenance and supported lifecycle controls; optional deeper reflection. | Retain, recall and reflect are different operations, not interchangeable free lookups. |
| Engineering history — Claude-mem | Recover useful discoveries, failed approaches and decisions from prior engineering work. | Capture and observation generation, compact discovery, available detail expansion, scoped persistence and correction controls. | Local worker and hosted-server deployments have different capabilities and must have separate compatibility records. |

Hindsight's official [retain](https://hindsight.vectorize.io/developer/retain), [recall](https://docs.hindsight.vectorize.io/recall/) and [reflect](https://hindsight.vectorize.io/developer/reflect) documentation establishes the provider operations. Our [Claude-mem research](../architecture/claude-mem-research.md) distinguishes local progressive retrieval from the hosted beta. These sources establish candidate behavior, not Macrofold acceptance.

Recommend by task and constraints, not popularity: simple editable memory for a small inspectable notebook; a qualified richer pack for long-running cross-conversation learning; engineering-history memory for coding investigations. Label recommendations with the use case and evidence. Avoid an unexplained universal “best memory” badge.

Provide **Use recommended setup** and retain an explicit provider picker. Advanced builders can choose capture policy, retrieval depth, model/funding route, retention and deployment where supported. Unsupported choices are explained, not silently ignored. Do not make ordinary builders choose embedding dimensions, chunking algorithms or worker topology.

Later recipes can bundle private knowledge search, browser research or draft-first communication with existing connectors and skills. A custom memory service remains possible through an advanced adapter path. These are extension examples, not additional launch requirements or promises that arbitrary packages work.

## What enabling a full memory architecture includes

A qualified full pack supplies all applicable parts below as one reviewed configuration:

- Provision or bind an isolated collection, resolve credentials securely and grant only the required access.
- Select permitted sources; capture useful committed activity; define provenance, corrections and exclusions.
- Perform any admitted extraction, summarization, indexing or consolidation outside the interactive path when possible.
- Retrieve useful context at supported run/turn boundaries and offer scoped on-demand recall where useful.
- Compose the pack's instructions without replacing the builder's instructions, repository guidance or native authority controls.
- Preserve required data across fresh runs and worker replacement; expose freshness, health, usage, inspect/correct/forget, export and disable controls.

A **tools-only integration** can be useful and may be listed separately. It must not be labeled the full architecture when capture, automatic context preparation, persistence or required controls are absent. Similarly, a skill describes behavior but cannot itself enforce privacy, quotas or reliable capture.

## Enablement journey

### New builder with a managed offering

Open **Agent → Add capabilities → Memory**. A card describes the outcome, provider, data destination, funding and what will run automatically. Select **Enable**. With an already approved funding envelope and compatible deployment, the single action creates an installation, allocates a private collection, attaches the pack to the intended preset/workspace context, prepares its instructions and runs the disclosed readiness check.

Show **Preparing**, followed by **Ready**, **Needs setup** or **Needs attention** with the exact reason. Ready means the configuration is admitted and the selected route's readiness checks passed; it is not a claim of perfect future recall. Do not block ordinary application navigation while provisioning runs.

The successful screen shows what will be remembered, the first eligible future run, a link to inspect memory, and how to turn it off. A synthetic readiness marker must not become a user preference or remain in customer memory after the check.

### Builder bringing an existing service

When a required account is not connected, the action is **Connect and enable**. Use the existing connection/consent experience, never a request to paste credentials into an agent prompt. Ask for an endpoint or key only when the provider cannot supply a supported authorization flow. Resume the same installation after consent; do not start over or create a second bank after a callback retry.

Display the difference between Macrofold-managed billing and charges in the builder's provider account. A local or self-hosted endpoint must pass the deployment's network rules. Do not silently turn a loopback development exception into hosted network access.

“One click” means we automate the wiring after prerequisites and consent. It does not mean we can create someone else's account, accept new fees or data-transfer terms on their behalf, or hide an unsupported deployment behind an Enable button.

### Existing agent and past history

Enablement applies to future eligible work by default. **Include past conversations or files** is a separate previewed import with source scope, volume, estimated cost, retention and a cancellable job. No implicit full-history backfill, and no ingestion of provider-exposed reasoning merely because it appears in a run stream.

An agent with custom instructions or memory files receives a conflict preview. Preserve user content and overrides. Do not overwrite an existing profile or install a second writer into the same files without an explicit resolution. Active runs finish under their admitted configuration unless access is revoked; ordinary configuration updates apply at a subsequent safe boundary.

## Complete builder scenarios

| Scenario | Expected result |
| --- | --- |
| A support assistant resumes tomorrow in a fresh conversation. | The same authorized collection supplies useful prior context without loading the entire transcript. The source and age remain inspectable. |
| A coding agent moves to another supported harness or a replacement worker. | Pack memory remains available; native conversation formats are not promised to migrate between harness families. Engineering memories retain repository/commit provenance. |
| A builder creates many customer assistants from one preset. | Each installation resolves the application's verified customer/resource binding. No shared preset implies a shared memory bank. |
| Two specialist agents deliberately collaborate. | The owner explicitly grants a shared collection, with separate read/write permissions where supported. Their private collections stay private. |
| A user corrects a remembered preference. | The correction is visible and reflected in later retrieval; superseded observations are not silently treated as current truth. |
| A user asks the application to forget something. | New use is blocked, related derived data is invalidated or quarantined, and completion/limitations are reported honestly. Historical transcripts and provider backups have separately stated policies. |
| A memory service fails or its budget is exhausted. | The run follows the chosen dependency policy; it never fabricates “no memories” or silently sends the data to another provider. |
| A builder copies or shares an agent preset. | The recipient gets pinned setup requirements and safe defaults, not credentials, memory, bank IDs or inherited grants. |

## Scope and combination rules

Default to a private collection for the actual application customer and agent responsibility within the authorized workspace. Customer identity comes from existing server-verified bindings, not a model-supplied customer string, a checkout directory name or a shared process HOME.

A preset may declare memory requirements, but activation binds those requirements to an authorized installation at run admission. The library must work for builders using direct workspaces as well as the optional customer-agent composition path.

Use one primary automatic memory pipeline per collection as the simple default. Multiple packs can coexist when their roles and sources are intentionally different—for example, personal preferences and a separate read-only knowledge library. Detect duplicate capture, overlapping writable files, incompatible instruction policies and two providers competing to be the primary memory source. Never merge multiple systems into one unlabeled truth store.

Sharing is explicit at the collection boundary. Search, timeline, graph traversal, reflection, caches and returned counts must all respect the same permissions. A model-selected bank name or an upstream project filter is not sufficient isolation.

## Controls and understandable guarantees

The installation page should expose **Inspect**, **Correct**, **Forget**, **Export**, **Pause**, **Disable**, **Update** and **Remove**, with operations shown only at their actual support level.

| Action | Meaning |
| --- | --- |
| Pause learning | Stop new capture and background transformations; existing authorized recall can continue. Already-dispatched work may incur cost and must be fenced before publication. |
| Disable | Stop new capture, retrieval and context injection from this installation. Retain memory unless deletion is separately selected. |
| Remove installation | Detach the pack and its owned configuration; preview retained data, exclusive resources, shared dependencies and continuing external charges. |
| Forget or delete | Separately authorize deletion scope, fence pending work and show progress. Never imply disabling a pack erases historical runs or cancels an external subscription. |
| Update | Preview changed instructions, capabilities, data destinations, retention, resource requirements and cost. Preserve customer overrides and require fresh consent for expanded authority. |

Disabling cannot make an already-running model unsee injected information. Where forgetting requires a clean conversation, explain that fact and require an explicit new-session path; do not silently resume a supposedly cleaned old native conversation. A provider that cannot enforce the required deletion semantics must be labeled limited, or its affected collection must be blocked pending verified rebuild/deletion. No falsely successful erase-everywhere claim.

Show capture freshness and indexing lag separately from availability. Distinguish a healthy service with an empty collection from a stale index, denied access, uncertain write or failed generation. A memory saying an action succeeded is not the application's execution receipt.

## Funding and service dependency

Memory costs can include generation, embeddings, queries, retrieval context, storage, compute and idle maintenance. The setup summary must distinguish costs included in Macrofold's admitted budget from separately billed provider operations. No “free memory” label merely because a query returns quickly.

Reuse existing financial admission and exact credential selection. Do not bypass an exhausted budget with a platform key or unapproved provider. A full automatic route must have bounded, authorized liability; upstream fail-open quotas are not a substitute. Externally funded services must disclose their separate budget enforcement and cannot be advertised as strictly capped by a Macrofold Run limit.

Offer **Optional** and **Required** dependency policies. Optional is the default for additive assistance: continue without unavailable optional memory while clearly recording the omission. Required is for workflows that must not proceed without it: pause or reject before the dependent work. Required context still has to fit the allowed context budget; it cannot silently displace higher-priority instructions or protected evidence. Do not require repeated provider calls for tasks that do not need history.

## Library beyond memory

Use the same installation shell for a skill pack, a supported MCP/tool pack or a compound workflow recipe. Keep provider-specific capabilities visible rather than flattening every integration into a generic remember/search API. The owner can attach a complete pack to an agent preset, reuse it, customize safe settings and export its non-secret definition.

Start with a curated first-party catalog and reviewed contributions. Do not launch an unrestricted marketplace, publisher payouts or arbitrary executable package installation on the control-plane host. A contributor supplies provenance, license information, capabilities, defaults, lifecycle behavior and acceptance evidence. Portable Agent Skills/MCP packaging is a useful import/export boundary, not automatic trust or a promise that all lifecycle behavior is portable.

The [Agent Plugins standard](https://agent-plugins.org/) defines a shared Skills/MCP core while leaving permissions and client-specific behavior to implementers. Hindsight's [plugin guide](https://hindsight.vectorize.io/sdks/integrations/agent-plugin) separately documents lifecycle-hook integration. The library should reuse those formats where appropriate and add only the operating metadata Macrofold actually needs.

## Delivery stages and acceptance

**Stage 1 — a complete install vertical slice.** Build the shared catalog/preview/install/manage path around simple file memory and one richer provider pilot, preferably Hindsight. Include permissions, consent, persistence, usage, correction/deletion boundaries and fresh-session acceptance. A file-only catalog or a connected MCP endpoint is not completion of the requested multi-architecture library.

**Stage 2 — provider diversity.** Qualify the Claude-mem recipe independently, exposing worker/server differences. All three initial recipes use the same installation contract. Prove that a simple skill/tool pack also fits without inventing another installer. Customer-specific managed and external modes are enabled only where qualified.

**Stage 3 — reusable ecosystem.** Add reviewed contribution/import/export, version updates and controlled provider replacement. Expand the catalog based on real use. A paid open marketplace remains outside this design.

Release acceptance must demonstrate:

1. A builder enables a complete supported memory recipe without writing code or lifecycle configuration; consent and funding are explicit and setup is resumable/idempotent.
2. A useful fact captured during actual agent work is available in a fresh session and after worker replacement through the intended supported harness route. Configuration success alone is insufficient.
3. Two customers with similar names and a shared preset remain isolated, including guessed IDs, cached results, semantic neighbors, reflection and revoked grants.
4. Corrections, forgetting during indexing, disable during execution and reinstall do not resurrect prohibited memory or overwrite unrelated work. Limits involving old conversations/backups are accurately presented.
5. Usage includes all controlled work, uncertain outcomes stay visible, and duplicated events or setup retries do not duplicate storage charges or paid generation silently.
6. UI, CLI and all five SDKs use the same authorized operations. Unsupported pack/harness/deployment combinations fail before side effects rather than degrading without notice.

Measure enablement completion, setup failures, time to first verified cross-session use, supported task outcomes, stale/unsupported-memory answers, privacy failures, extra latency and total cost per useful outcome. Compare richer packs against the current file starter on the same tasks and budgets, not an artificially expensive full-history baseline. Publication as Recommended requires workload-specific evidence; benchmark scores from vendors are not product acceptance.

## Maintained records, decisions and limits

This pair develops the existing [PRD-06 optional memory proposal](../product/improvements.md#prd-06-offer-managed-memory-as-an-optional-service), with [EX-03 reusable skills](../product/improvements.md#ex-03-version-and-expand-reusable-agent-examples-and-skills) and [INT-05 shared services](../product/improvements.md#int-05-expose-shared-services-to-both-agents-and-applications). Their current proposal statuses and existing release gates are not closed or reprioritized by writing this design. On implementation approval, reconcile those owners and add the actual staged work to [maintainer TODO](../maintainers/TODO.md), rather than maintaining a second implementation checklist here.

Recommended design choices are optional packs, outcome-led defaults, scoped instances separate from shared presets, complete lifecycle integration, reviewed releases and explicit provider capabilities. The tradeoff is that a smaller qualified catalog is preferable to a large collection of unreliable one-click claims.

Before enabling managed commercial offerings, the operator must select supported deployment/region, permitted data handling, enforceable funding, retention and service terms for each route. Before labeling a richer pack recommended, qualify its actual workload, harness and cost. These are release decisions and evidence gates, not reasons to require every builder to design an architecture. The documents introduce no new production pricing, numerical quota or enabled provider.

## Evidence boundary

Repository baseline: `Macrofold/Macrofold` at `5f048cebb00fe651944478f4ba4108c7c89fc729`, on `research/claude-mem-2026-10-07`, based on `main` at `8c6797decca2e9b71ab376594b59e35a2e67a55f`. Existing instructions, architecture, project guidance, memory research, customer memory, UHI and connector-access contracts informed this design. Official provider and packaging documentation was checked October 7, 2026. No integration was installed, no model/provider test was run, and no readiness, cost, portability or erasure guarantee was newly verified.
