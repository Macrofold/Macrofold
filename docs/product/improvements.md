# Improvements

This is the authoritative internal tracker for proposed product, integration, architecture, documentation, example, dashboard and marketing improvements. It consolidates the HarnessRouter research, dashboard opportunities and architecture proposals. A proposal is not a shipped capability or an instruction to implement it. [Current behavior](../status/README.md), [accepted architecture](../architecture/README.md) and [release acceptance](../maintainers/TODO.md) remain separate.

## Strategic direction

The preferred product messages are:

> A customer’s information can remain the stable resource while different agents, conversations and scheduled tasks work on it over time.

> Give every customer a persistent agent—with its own workspace, memory, tools and ongoing work.

The first message maps directly to independent persisted workspaces and separate sessions. The second is the desired packaged experience, not a claim that HarnessRouter cannot provide persistent agents or that Macrofold already manages universal memory. HarnessRouter can serve basic named personal assistants. The opportunity is to make continuity around customer information substantially easier. Target builders of customer-agent products; a direct-to-consumer assistant is a separate business choice. See the [competitive comparison](../../output/competitor-research/harnessrouter-comparison.md).

## How to maintain this tracker

- IDs are stable; rank changes when evidence, dependencies or effort change. Lower rank means earlier recommended work across all categories, not separate competing priority lists.
- Impact is 1–5 for the intended customer-agent market. Difficulty is 0–10: 0 documentation/configuration only, 1–3 small/local, 4–6 several layers or product decisions, 7–8 lifecycle/security/operations work, 9–10 foundational uncertainty. Estimates describe the proposed scope, not elapsed days or promises.
- Rank favors customer impact and lower effort, adjusted for prerequisites and demand. Foundational examples precede a new core agent resource; optional managed memory follows simpler templates; Temporal evaluation does not block ordinary independent runs. Low-impact easy polish can rank below a hard core capability.
- Status values: Proposed, Planned, In progress, Blocked, Done, Deferred, Dropped. Planned means scope was accepted; In progress requires active implementation. Record a blocker or reason for Deferred/Dropped. Link the implementing change and update current-state/completion notes when marking Done.
- Every entry below was added to this consolidated tracker on **2026-09-10**; this does not claim the idea originated that day. Owner is **Unassigned** unless an entry says otherwise. Supporting source dates remain in the source record. Proposed entries are not a release checklist.
- Preserve release prerequisites and acceptance in maintainer TODO; do not move unfinished deployment checks here or turn speculative product work into launch blockers. Detailed research informs entries but does not own a second status/ranking list.

## Recommended build order

Ranks 1–10 were implemented September 11, 2026. [Implementation boundaries, verification and deliberate limits](../engineering/testing/customer-agents.md) distinguish completed local functionality from remaining live-service acceptance.

| Rank | ID                                                                                            | Improvement                                                                 | Impact | Difficulty | Status                            |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ | ---------- | --------------------------------- |
| 1    | [DOC-01](#doc-01-explain-customer-state-and-agent-identity)                                   | Explain customer state and agent identity                                   | 5/5    | 1/10       | Done                              |
| 2    | [INT-01](#int-01-make-connector-enablement-automatic-or-operator-guided)                      | Make connector enablement automatic or operator-guided                      | 5/5    | 4/10       | Done                              |
| 3    | [MKT-01](#mkt-01-present-customer-information-as-the-lasting-resource)                        | Present customer information as the lasting resource                        | 5/5    | 2/10       | Done                              |
| 4    | [PRD-01](#prd-01-make-trigger-quotas-configurable)                                            | Make trigger quotas configurable                                            | 4/5    | 2/10       | Done                              |
| 5    | [PRD-02](#prd-02-offer-an-optional-file-based-memory-template)                                | Offer an optional file-based memory template                                | 5/5    | 3/10       | Done                              |
| 6    | [EX-01](#ex-01-build-a-complete-named-personal-agent-application)                             | Build a complete named personal-agent application                           | 5/5    | 4/10       | Done                              |
| 7    | [INT-02](#int-02-expand-model-coverage-through-capability-based-catalog-policy)               | Expand model coverage through capability-based catalog policy               | 5/5    | 4/10       | Done                              |
| 8    | [UX-01](#ux-01-connect-templates-to-scheduled-work)                                           | Connect templates to scheduled work                                         | 4/5    | 2/10       | Done                              |
| 9    | [EX-02](#ex-02-add-database-and-integration-recipes)                                          | Add database and integration recipes                                        | 4/5    | 3/10       | Done                              |
| 10   | [PRD-03](#prd-03-package-customer-agent-identity-and-sdk-setup-helpers)                       | Package customer-agent identity and SDK setup helpers                       | 5/5    | 5/10       | Done                              |
| 11   | [UX-02](#ux-02-make-onboarding-resumable-and-show-integration-success)                        | Make onboarding resumable and show integration success                      | 4/5    | 3/10       | Proposed                          |
| 12   | [EX-03](#ex-03-version-and-expand-reusable-agent-examples-and-skills)                         | Version and expand reusable agent examples and skills                       | 4/5    | 4/10       | Proposed                          |
| 13   | [BIZ-01](#biz-01-model-pricing-and-improve-cost-explanation)                                  | Model pricing and improve cost explanation                                  | 5/5    | 4/10       | Proposed                          |
| 14   | [DOC-02](#doc-02-create-task-specific-integration-briefs)                                     | Create task-specific integration briefs                                     | 3/5    | 2/10       | Proposed                          |
| 15   | [INT-03](#int-03-support-model-vision-inputs)                                                 | Support model vision inputs                                                 | 5/5    | 5/10       | Proposed                          |
| 16   | [INT-04](#int-04-offer-image-generation-as-a-shared-tool-service)                             | Offer image generation as a shared tool service                             | 4/5    | 5/10       | Proposed                          |
| 17   | [INT-05](#int-05-expose-shared-services-to-both-agents-and-applications)                      | Expose shared services to both agents and applications                      | 5/5    | 6/10       | Proposed                          |
| 18   | [ARC-01](#arc-01-reuse-warm-execution-environments-safely)                                    | Reuse warm execution environments safely                                    | 5/5    | 7/10       | Proposed                          |
| 19   | [PRD-04](#prd-04-represent-ongoing-tasks-across-runs)                                         | Represent ongoing tasks across runs                                         | 5/5    | 6/10       | Proposed                          |
| 20   | [UX-03](#ux-03-add-a-notification-center)                                                     | Add a notification center                                                   | 4/5    | 5/10       | Proposed                          |
| 21   | [PRD-05](#prd-05-package-explicit-multi-agent-handoffs)                                       | Package explicit multi-agent handoffs                                       | 4/5    | 6/10       | Proposed                          |
| 22   | [PRD-06](#prd-06-offer-managed-memory-as-an-optional-service)                                 | Offer managed memory as an optional service                                 | 4/5    | 7/10       | Proposed                          |
| 23   | [PRD-07](#prd-07-unify-agent-lifecycle-controls)                                              | Unify agent lifecycle controls                                              | 4/5    | 6/10       | Proposed                          |
| 24   | [EX-04](#ex-04-compare-configurations-on-representative-tasks)                                | Compare configurations on representative tasks                              | 3/5    | 4/10       | Proposed                          |
| 25   | [ARC-02](#arc-02-add-a-bounded-responses-compatibility-facade)                                | Add a bounded Responses compatibility facade                                | 4/5    | 6/10       | Proposed                          |
| 26   | [PRD-08](#prd-08-manage-fleets-of-customer-agents)                                            | Manage fleets of customer agents                                            | 4/5    | 7/10       | Proposed                          |
| 27   | [UX-04](#ux-04-improve-api-key-lifecycle-ux)                                                  | Improve API-key lifecycle UX                                                | 3/5    | 3/10       | Proposed                          |
| 28   | [UX-05](#ux-05-add-global-authorized-resource-search)                                         | Add global authorized resource search                                       | 3/5    | 4/10       | Proposed                          |
| 29   | [UX-06](#ux-06-improve-privacy-and-data-controls)                                             | Improve privacy and data controls                                           | 3/5    | 5/10       | Proposed                          |
| 30   | [UX-07](#ux-07-add-service-account-administration)                                            | Add service-account administration                                          | 3/5    | 5/10       | Proposed                          |
| 31   | [UX-08](#ux-08-extend-team-roles-and-groups)                                                  | Extend team roles and groups                                                | 3/5    | 6/10       | Proposed                          |
| 32   | [UX-09](#ux-09-build-the-hosted-account-assistant-with-reviewable-actions)                    | Build the hosted account assistant with reviewable actions                  | 3/5    | 7/10       | Proposed                          |
| 33   | [UX-10](#ux-10-offer-a-contextual-support-handoff)                                            | Offer a contextual support handoff                                          | 2/5    | 4/10       | Proposed                          |
| 34   | [INT-06](#int-06-expand-media-and-artifact-experiences)                                       | Expand media and artifact experiences                                       | 3/5    | 7/10       | Proposed                          |
| 35   | [PRD-10](#prd-10-extend-recurring-work-and-steering-policies)                                 | Extend recurring-work and steering policies                                 | 3/5    | 6/10       | Proposed                          |
| 36   | [PRD-09](#prd-09-explore-live-artifact-collaboration)                                         | Explore live artifact collaboration                                         | 2/5    | 7/10       | Proposed                          |
| 37   | [ARC-03](#arc-03-evaluate-durable-orchestration-alternatives-when-coordination-requires-them) | Evaluate durable orchestration alternatives when coordination requires them | 3/5    | 8/10       | Deferred — conditional evaluation |
| 38   | [OPS-01](#ops-01-automate-staged-releases-and-controlled-promotion)                           | Automate staged releases and controlled promotion                           | 3/5    | 7/10       | Proposed                          |
| 39   | [INT-07](#int-07-add-further-harnesses-only-for-demonstrated-capability-gaps)                 | Add further harnesses only for demonstrated capability gaps                 | 2/5    | 5/10       | Proposed                          |
| 40   | [MKT-02](#mkt-02-evaluate-exported-motion-or-video-only-when-resumed)                         | Evaluate exported motion or video only when resumed                         | 2/5    | 5/10       | Deferred — user preference        |

## Product

### PRD-01 Make trigger quotas configurable

**Rank:** 4 · **Impact:** 4/5 · **Difficulty:** 2/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Replace the fixed 100 non-deleted triggers per organization with a documented product quota and operator/account override. Keep daily delivery, waiting receipt and concurrency limits distinct.
- **Rationale/benefit:** Enables one schedule per customer without an arbitrary low definition ceiling.
- **Strategic benefit:** Supports the many-customer use case; the existing cap is policy, not an architectural maximum.
- **Current state:** [Saved-trigger capacity](../features/triggers/README.md#capacity) has an owner-managed deployment default and nullable organization override. The API and UI show used/limit/remaining across all non-deleted definitions. Creation and account overrides serialize; lowering a limit preserves saved work.
- **Completion/dependencies:** Done September 11. Concurrent last-slot, tenant isolation, paused-definition and lower-limit tests pass; all five SDKs expose the quota. Delivery, concurrency and spending limits remain separate.

### PRD-02 Offer an optional file-based memory template

**Rank:** 5 · **Impact:** 5/5 · **Difficulty:** 3/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Ship a configurable starter layout such as profile.md, memory/ and tasks.json with instructions for retrieval, updates, provenance, contradictions and forgetting. Use normal instructions/skills; do not reserve a universal mandatory filename.
- **Rationale/benefit:** Gives users useful memory behavior while preserving the agnostic runtime.
- **Strategic benefit:** Adds ready-to-use ongoing-agent behavior on top of independent persistent workspaces.
- **Current state:** The [optional memory starter](../features/customer-agents/memory.md) supplies configurable profile, memory directory and versioned task data with provenance, correction and forgetting instructions. The reference app supports conditional edits and deletion across conversations.
- **Completion/dependencies:** Done September 11. Layout/schema rejection, actual simulator persistence and browser correction/deletion pass. Model obedience and erase-everywhere guarantees are explicitly outside this file convention.

### PRD-03 Package customer-agent identity and SDK setup helpers

**Rank:** 10 · **Impact:** 5/5 · **Difficulty:** 5/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Provide a small composition layer linking an external customer reference, named agent, preset/configuration, workspace and sessions. Offer it as an optional use-case integration path over core primitives, retaining direct core composition for custom layouts.
- **Rationale/benefit:** Reduces resource plumbing while leaving ownership explicit.
- **Strategic benefit:** A coherent customer-agent API can make this use case easier than composing HarnessRouter sessions.
- **Current state:** The optional [Customer agents integration path](../features/customer-agents/README.md) now offers atomic bindings, ownership-checked messages/runs/files, generated SDK resources, hosted customer connector consent and optional React permissions controls. It is explicitly a use-case path in the API, docs, developer UI and marketing. The [reference app](../../examples/personal-agent/README.md) remains an alternative that composes core APIs directly.
- **Completion/dependencies:** Done September 11. Fresh conversations reuse the owned worktree and permissions; the platform Agent remains a reusable preset. Single-process SQLite is a deliberate runnable default, with multi-instance locking/store replacement documented together.

### PRD-04 Represent ongoing tasks across runs

**Rank:** 19 · **Impact:** 5/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Introduce durable task identity, status, next action, due/wakeup time, linked runs and user decisions. Support pausing for days and resuming on fresh compute rather than holding an execution slot.
- **Rationale/benefit:** Makes “plan my trip” or “maintain this account” persist beyond one prompt execution.
- **Strategic benefit:** Turns continuing work into a product primitive beyond a session transcript.
- **Current state:** Runs, recurring triggers and explicit input requests exist; input waits currently consume the execution window/slot. No customer task ledger spans arbitrary runs.
- **Completion/dependencies:** Complete with task/run separation, checkpoint handoff, reauthorization and fresh budget admission after waiting. Start with simple tasks; PRD-03 helps expose ownership. Evaluate ARC-03 before substantial coordinator machinery.

### PRD-05 Package explicit multi-agent handoffs

**Rank:** 21 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Make ordered handoffs and result review easy; associate steps/results, preserve separate conversations and credentials, and surface partial failure/cancellation.
- **Rationale/benefit:** Reduces application code around different agents maintaining one customer’s files.
- **Strategic benefit:** Builds directly on Macrofold’s independent workspace model.
- **Current state:** Sequential same-workspace handoff works through APIs; another session receives workspace_busy during pending work. Parallel branches need explicit merge.
- **Completion/dependencies:** Complete with an initial bounded sequential flow, visible file/persistence outcomes and explicit branch merges. Full delegation trees require ARC-03 evaluation; no concurrent same-folder writer promise.

### PRD-06 Offer managed memory as an optional service

**Rank:** 22 · **Impact:** 4/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Define remember/search/update/forget operations, customer scope, provenance, contradiction handling and user correction/deletion. Choose file or database storage independently from the public behavior.
- **Rationale/benefit:** Provides predictable memory semantics across conversations and harnesses.
- **Strategic benefit:** Could differentiate a packaged lifecycle, but HarnessRouter can also use an external memory service.
- **Current state:** No platform-wide semantic memory API. PRD-02 is the lower-cost first step; native Hermes memory follows its session.
- **Completion/dependencies:** Proceed when template users need stronger semantics. Depends on PRD-02/EX-01 feedback and INT-05; do not assume embeddings alone solve memory, or force this on agnostic users.

### PRD-07 Unify agent lifecycle controls

**Rank:** 23 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Define pause/resume, configuration/harness change, export, reassignment and deletion of a customer agent across its workspace, conversations, schedules and connections.
- **Rationale/benefit:** Prevents developers implementing inconsistent cleanup and pause behavior.
- **Strategic benefit:** Makes “own an ongoing agent” a coherent product experience.
- **Current state:** Individual resource controls exist; no single aggregate agent lifecycle spans them. Native conversation state cannot be transparently migrated between harness families.
- **Completion/dependencies:** Complete with explicit active-run treatment, future schedule behavior, selective connection revocation and retained accounting. Depends on PRD-03; changing a harness preserves shared files, not interchangeable native history.

### PRD-08 Manage fleets of customer agents

**Rank:** 26 · **Impact:** 4/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add customer/agent filters, template rollout cohorts, canaries/rollback, bulk pause, attributable spend/limits and health summaries. Preserve customer overrides.
- **Rationale/benefit:** Makes thousands of instances manageable rather than just runnable.
- **Strategic benefit:** A credible fleet-management angle requires these controls; raw concurrency is shared with competitors.
- **Current state:** Organization scheduling, grants, preset versions and reporting exist; customer-agent fleet rollout/management does not.
- **Completion/dependencies:** Complete an initial operator workflow after PRD-03/PRD-07 and real fleet use. Treat preset upgrades separately from workflow-worker versioning.

### PRD-09 Explore live artifact collaboration

**Rank:** 36 · **Impact:** 2/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Support selected concurrent user/agent editing experiences with explicit conflict and revision semantics, such as a collaborative document surface.
- **Rationale/benefit:** Useful for apps built around editable deliverables.
- **Strategic benefit:** Inspired by HarnessRouter’s session blackboard sidecar and application canvases.
- **Current state:** Macrofold publishes checkpoint revisions and serializes workspace writers; no general live collaborative editing model.
- **Completion/dependencies:** Require a concrete artifact use case. Do not confuse a Yjs document with safe concurrent writes to the whole workspace.

### PRD-10 Extend recurring-work and steering policies

**Rank:** 35 · **Impact:** 3/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add justified overlap/catch-up/backfill/pause-on-failure options and acknowledged commands to ongoing tasks, rather than only a new prompt or cancellation.
- **Rationale/benefit:** Lets customers express recovery and scheduling intent.
- **Strategic benefit:** Supports continuing customer work; native harness scheduling alone is not an equivalent cross-harness service.
- **Current state:** Cron coalesces missed occurrences and skips overlapping work; configuration edits and input APIs exist, but richer policy/command semantics are not packaged.
- **Completion/dependencies:** Depends on PRD-04 for task-level steering. Preserve authorization/budget admission for every start and distinguish schedule policy from queue concurrency.

## Integrations

### INT-01 Make connector enablement automatic or operator-guided

**Rank:** 2 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Replace routine per-toolkit environment JSON maintenance with persisted enablement, discovery of existing auth configs, and idempotent managed-auth setup where supported. Retain explicit custom-auth choices and version upgrade policy.
- **Rationale/benefit:** Makes the large connector catalog usable without a deployment edit for each app.
- **Strategic benefit:** Broad app access becomes a practical benefit for customer-owned agents.
- **Current state:** [Operator setup](../features/identity-integrations/composio.md) persists exact toolkit versions and Auth Config choices in migration 033. Discovery reuses existing configs, supports explicit custom choices and journals ambiguous managed creation without blind retry. Runtime reads the persisted setup.
- **Completion/dependencies:** Done September 11. Real SDK transport and PostgreSQL policy/recovery tests pass. Live consent, pinned action and revocation remain [release acceptance](../maintainers/TODO.md#customer-agent-foundations-release-acceptance); toolkit enablement does not grant customer tools.

### INT-02 Expand model coverage through capability-based catalog policy

**Rank:** 7 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Offer a much broader compatible text/tool model catalog, primarily through OpenRouter plus needed direct routes. Separate discovery, harness compatibility, capabilities, prices and account entitlements.
- **Rationale/benefit:** Reduces needless restriction to a handful of model choices without a bespoke adapter per model.
- **Strategic benefit:** Closes an obvious HarnessRouter breadth gap.
- **Current state:** [Model admission](../features/execution/models.md) adds discovered compatible OpenRouter text/tool routes instead of a fixed four-route list. It rejects unknown billing dimensions, routing aliases and insufficient/unknown context/output limits; reviewed native routes retain their protocol boundaries.
- **Completion/dependencies:** Done September 11. Discovery, capability, price and routing-ceiling fixtures pass. Native/runtime settings currently require 128k context and 8,192 output tokens; broader limits and live account/harness acceptance are explicit follow-ups.

### INT-03 Support model vision inputs

**Rank:** 15 · **Impact:** 5/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Carry authorized image/screenshot inputs through the public contract, adapters and model gateway, including capability and billing treatment.
- **Rationale/benefit:** Unlocks image understanding in document, support and design workflows.
- **Strategic benefit:** Closes a material HarnessRouter capability gap.
- **Current state:** Workspace upload and code-based file processing exist; text/tool gateway routes reject media model content.
- **Completion/dependencies:** Complete when supported models actually receive image content, unsupported combinations are clear, and input accounting and content access are preserved.

### INT-04 Offer image generation as a shared tool service

**Rank:** 16 · **Impact:** 4/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add an image-generation tool backed by appropriate providers/OpenRouter routes, returning durable artifacts with cost and job state. Keep generation separate from the conversation model choice.
- **Rationale/benefit:** Lets existing agents create useful visual deliverables without a new agent loop.
- **Strategic benefit:** Adopts part of HarnessRouter’s media breadth at a smaller scope than a full video editor.
- **Current state:** No built-in media generation plane; external tools can provide specific operations.
- **Completion/dependencies:** Complete with durable output, authorized access and explicit handling of an ambiguous provider submission. Coordinate with INT-05; do not treat vision input as generation.

### INT-05 Expose shared services to both agents and applications

**Rank:** 17 · **Impact:** 5/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Offer selected service operations through MCP and authorized application APIs: database queries, future memory/task operations and media jobs. Share one policy/service owner.
- **Rationale/benefit:** A UI can read memory or refresh a chart without another model turn.
- **Strategic benefit:** Adapts HarnessRouter’s SQL/media application layer and supports richer customer-agent products.
- **Current state:** The central run tool broker exists; no equivalent general application-facing service surface is packaged. HarnessRouter’s SQL service supports Postgres/MySQL and app queries.
- **Completion/dependencies:** Complete first with one concrete service and scoped app credentials. Do not make arbitrary tool execution public or bypass current ownership, cost and idempotency rules.

### INT-06 Expand media and artifact experiences

**Rank:** 34 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add requested audio/video/music jobs, previews and reusable application examples after image needs are understood. Keep job status, export and editing separable from agent turns.
- **Rationale/benefit:** Opens additional product categories and richer deliverables.
- **Strategic benefit:** HarnessRouter leads with media services and editable application kits.
- **Current state:** No built-in broad media plane; files/artifacts and external tools provide a base.
- **Completion/dependencies:** Depends on INT-04/INT-05 and customer demand. Avoid making a video editor mandatory infrastructure.

### INT-07 Add further harnesses only for demonstrated capability gaps

**Rank:** 39 · **Impact:** 2/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Evaluate Oh My Pi, Qwen Code, Gemini CLI, Cline or other runtimes against requested tasks and native capabilities.
- **Rationale/benefit:** Adds useful choices without multiplying low-value maintenance.
- **Strategic benefit:** Can close remaining HarnessRouter breadth gaps; count alone is weak positioning.
- **Current state:** Macrofold already has Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness and Pi. Hermes/Pi are no longer future adapter proposals.
- **Completion/dependencies:** Use EX-04 and current Unified Harness Interface; prefer INT-02 when the actual request is model choice.

## Examples

### EX-01 Build a complete named personal-agent application

**Rank:** 6 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Create a maintained reference app where Alice creates Milo, connects an account, chats in separate conversations, reviews memory/tasks, schedules work and pauses/deletes the agent. Keep owner mapping in the application initially.
- **Rationale/benefit:** Demonstrates the full lifecycle and reveals which higher-level APIs are actually needed.
- **Strategic benefit:** The strongest near-term proof of the selected value proposition; HarnessRouter can also power a basic assistant.
- **Current state:** The [personal-agent reference app](../../examples/personal-agent/README.md) implements Alice/Milo and Bob/Basil, separate conversations over shared files, a narrowly granted search account, memory/tasks, weekly scheduling, pause/resume and project deletion. Durable SDK step records support restart and ambiguous-response recovery.
- **Completion/dependencies:** Done September 11. Customer separation, forged conversation rejection, lost committed response plus store reopen, local execution and the complete browser lifecycle pass. Production authentication/multi-instance storage remain documented adoption seams; no new core entity was added.

### EX-02 Add database and integration recipes

**Rank:** 9 · **Impact:** 4/5 · **Difficulty:** 3/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Provide small examples for customer-scoped Supabase/Prisma queries, Pinecone retrieval and custom remote MCP database tools, with explicit credential and grant setup.
- **Rationale/benefit:** Shows how customer information can live in external systems as well as files.
- **Strategic benefit:** Makes tool breadth and storage flexibility tangible; neither is exclusive to Macrofold.
- **Current state:** [Data recipes](../../examples/integrations/README.md) include customer-scoped Supabase RLS, an actual generated Prisma client, Pinecone namespaces and authenticated custom MCP tools, with copyable setup, fixture data, minimal grants and protocol prerequisites.
- **Completion/dependencies:** Done September 11. Local PostgreSQL RLS, real MCP HTTP and provider-wire fixtures pass; the isolated Prisma SQLite query and its dependency audit pass. Hosted Supabase/Pinecone acceptance remains explicit release work.

### EX-03 Version and expand reusable agent examples and skills

**Rank:** 12 · **Impact:** 4/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Extend curated examples with release notes, account research and incident summaries; include required integrations, real sample artifacts, configuration revisions and contributor review. Add installable multi-file skill/template bundles when needed.
- **Rationale/benefit:** Makes presets reproducible and easier to customize; reduces prompt-only demos.
- **Strategic benefit:** Matches HarnessRouter’s skill/configuration packaging while emphasizing durable customer work.
- **Current state:** Five starters and preset versions exist; illustrative output and planned entries are labeled. There is no dedicated managed skills package/catalog API.
- **Completion/dependencies:** Complete with maintained source definitions, upgrade/diff behavior and explicit grants. Preserve a small curated front page and never overwrite customer instructions silently.

### EX-04 Compare configurations on representative tasks

**Rank:** 24 · **Impact:** 3/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Start with a small reproducible task suite comparing harness/model output, cost, latency and artifacts; add a side-by-side UI only if users need it.
- **Rationale/benefit:** Helps developers select configurations and catch meaningful regressions.
- **Strategic benefit:** Adopts HarnessRouter Arena’s selection benefit without making an Arena clone the first priority.
- **Current state:** Harness fixtures and run traces exist; no end-user comparative evaluation product. Hosted Arena is visible in supplied screenshots.
- **Completion/dependencies:** Complete with comparable inputs and transparent task-specific results; no universal winner claim. Keep paid runs explicitly opt-in.

## Docs

### DOC-01 Explain customer state and agent identity

**Rank:** 1 · **Impact:** 5/5 · **Difficulty:** 1/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add a developer guide mapping customer, preset, project/workspace, session, run and ongoing task. Show when to continue a session versus start another over the same files.
- **Rationale/benefit:** Removes ambiguity before developers design their application.
- **Strategic benefit:** Makes the independent workspace benefit concrete without claiming exclusive persistent agents.
- **Current state:** The published [customer-agent guide](../features/customer-agents/README.md) maps application customers, named agents, presets, projects/worktrees, sessions, runs and tasks. It includes setup, handoff, ownership, recovery, lifecycle and a copyable AI brief.
- **Completion/dependencies:** Done September 11. Linked to the runnable reference app, optional memory and exact API/SDK contracts; published HTML/Markdown/search and copied onboarding journeys pass.

### DOC-02 Create task-specific integration briefs

**Rank:** 14 · **Impact:** 3/5 · **Difficulty:** 2/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Derive copyable briefs for embedding a run viewer, streaming tools, recovering a dropped connection, continuing a session and reading files from the canonical API/SDK guides.
- **Rationale/benefit:** Reduces integration errors without requiring another docs service.
- **Strategic benefit:** Adopts HarnessRouter’s AI-assisted onboarding convenience.
- **Current state:** A canonical AI setup prompt, Markdown exports and five SDK guides already exist; avoid duplicating them.
- **Completion/dependencies:** Complete when briefs share current sources and work with ordinary docs too. Consider a distributed skill or docs MCP only if real retrieval friction remains.

## Dashboard

### UX-01 Connect templates to scheduled work

**Rank:** 8 · **Impact:** 4/5 · **Difficulty:** 2/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Guide a saved weekly digest or assistant preset into the existing schedule form with project, timezone, cadence, connection and budget review.
- **Rationale/benefit:** Makes already-built recurring execution easier to discover and configure.
- **Strategic benefit:** Turns ongoing-work positioning into an immediate usable flow.
- **Current state:** Templates offer **Use and schedule**; saving a preset hands its ID, instructions and explicit per-run budget into [schedule setup](../features/triggers/scheduled-tasks.md). Project, cadence, timezone and current tool access are reviewed before enabling; advanced delivery limits stay collapsed.
- **Completion/dependencies:** Done September 11. Browser acceptance verifies the weekly handoff, persisted budget and review, alongside existing create/edit/pause/history flows. Shared stacked/paired forms keep the review readable. Setup itself makes no paid run or implicit tool grant.

### UX-02 Make onboarding resumable and show integration success

**Rank:** 11 · **Impact:** 4/5 · **Difficulty:** 3/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Persist meaningful setup progress, support skip/reset, and correlate a customer application’s first authorized request/result with the onboarding checklist.
- **Rationale/benefit:** Helps users finish setup across devices and distinguish a configured account from a working application integration.
- **Strategic benefit:** Matches HarnessRouter’s short path to an embedded product.
- **Current state:** Home has an API-backed readiness checklist and copyable briefs; dedicated resumable onboarding and correlated external-app completion are not packaged.
- **Completion/dependencies:** Complete with observable completion and no unrelated repository inspection, secret capture or fabricated success; keep a free fixture path.

### UX-03 Add a notification center

**Rank:** 20 · **Impact:** 4/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Collect required-input, failed-run, expiring-connection, budget and invitation events with preferences and delivery state.
- **Rationale/benefit:** Makes background customer-agent work visible and actionable.
- **Strategic benefit:** Supports ongoing agents that do useful work outside chat.
- **Current state:** Run events, outgoing webhooks and invitation flows exist separately; there is no unified notification center.
- **Completion/dependencies:** Complete with authorized event views, preferences and deduplication; distinguish inbox state from external delivery.

### UX-04 Improve API-key lifecycle UX

**Rank:** 27 · **Impact:** 3/5 · **Difficulty:** 3/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add clear scope previews, useful last-used attribution, optional expiry policy and guided rotation where the contract supports it.
- **Rationale/benefit:** Makes machine access easier to understand and revoke.
- **Strategic benefit:** General usability; not a HarnessRouter-specific differentiation.
- **Current state:** Scoped keys exist; a complete guided lifecycle experience is not described by the current dashboard.
- **Completion/dependencies:** Complete after checking existing fields to avoid reimplementing controls; rotating a key must not silently retarget unrelated connections.

### UX-05 Add global authorized resource search

**Rank:** 28 · **Impact:** 3/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Search projects, runs, presets and connections from the command menu with server-side scope enforcement.
- **Rationale/benefit:** Helps users navigate growing accounts.
- **Strategic benefit:** Supports larger customer fleets; competitors can offer the same convenience.
- **Current state:** Project/example/catalog search exists; the command menu is navigation-oriented.
- **Completion/dependencies:** Complete with scoped results and useful deep links; do not expose prompts or customer content through broad search by default.

### UX-06 Improve privacy and data controls

**Rank:** 29 · **Impact:** 3/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Explain and expose supported retention, export and deletion choices with precise scope, previews and consequences.
- **Rationale/benefit:** Makes customer data ownership understandable.
- **Strategic benefit:** Reinforces persistent customer information as a managed resource.
- **Current state:** Checkpoint exports, retention and project deletion exist; account closure remains operator-assisted.
- **Completion/dependencies:** Complete with coordinated subscription/ownership/revocation handling where relevant. Do not promise erase-everywhere or delete retained financial records improperly; coordinate with PRD-07.

### UX-07 Add service-account administration

**Rank:** 30 · **Impact:** 3/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Provide a dedicated machine identity lifecycle, ownership, credentials and revocation UI/API.
- **Rationale/benefit:** Separates durable application integrations from an individual human’s account lifecycle.
- **Strategic benefit:** Useful for enterprise integrations and fleets.
- **Current state:** API keys and existing principal scopes exist; a dedicated service-account administration product is not packaged.
- **Completion/dependencies:** Complete with explicit owner/role semantics and auditable revocation; preserve existing identity boundaries.

### UX-08 Extend team roles and groups

**Rank:** 31 · **Impact:** 3/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add custom roles/groups and understandable project permission summaries; evaluate enterprise SSO/SCIM only with concrete buyer requirements.
- **Rationale/benefit:** Supports larger teams without copying ad hoc grants.
- **Strategic benefit:** Enterprise fit, not proof that HarnessRouter lacks equivalent private features.
- **Current state:** Organization roles, invitations and scoped access already exist; custom roles/groups and enterprise SSO/SCIM are outside current scope.
- **Completion/dependencies:** Complete with reviewed effective-access previews and server enforcement. Avoid adding every enterprise feature before demand.

### UX-09 Build the hosted account assistant with reviewable actions

**Rank:** 32 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Replace the labeled local preview with authorized account reads and limited typed actions for presets, grants and schedules. Show proposed consequential changes, cost, progress and history.
- **Rationale/benefit:** Provides contextual help and useful setup assistance.
- **Strategic benefit:** Onboarding convenience; separate from downstream customers’ personal agents.
- **Current state:** Ask Macrofold is deterministic local UI guidance; it performs no account inspection, inference or changes.
- **Completion/dependencies:** Complete using existing runs/broker with current authority, cancellation and appropriate action confirmation. No operator infrastructure mutations through management MCP.

### UX-10 Offer a contextual support handoff

**Rank:** 33 · **Impact:** 2/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Let users choose a diagnostic report/run reference and explicitly send it to a configured support destination with redaction and delivery state.
- **Rationale/benefit:** Reduces support back-and-forth.
- **Strategic benefit:** General support quality; no unique competitive claim.
- **Current state:** Help links and copied guidance exist; the account assistant does not contact support.
- **Completion/dependencies:** Complete with consent, destination setup, retention and delivery status; never infer authorization to send from opening the assistant.

## Marketing site

### MKT-01 Present customer information as the lasting resource

**Rank:** 3 · **Impact:** 5/5 · **Difficulty:** 2/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Use the selected value propositions with a concrete story: one customer workspace, different conversations and specialist agents, scheduled maintenance, then a visible updated result.
- **Rationale/benefit:** Explains why a buyer wants persistent workspaces rather than another harness list.
- **Strategic benefit:** Directly communicates the preferred market angle; persistent agents alone are not unique.
- **Current state:** The [landing-page story](../../apps/web/components/landing/customer-story.tsx) follows Alice and Milo through saved preferences, a specialist conversation, scheduled follow-up and an updated weekly plan. It identifies optional file conventions and separate native histories.
- **Completion/dependencies:** Done September 11. Existing visual direction is preserved; desktop/mobile review and landing browser regressions pass. The guide and reference app provide the implementation path.

### MKT-02 Evaluate exported motion or video only when resumed

**Rank:** 40 · **Impact:** 2/5 · **Difficulty:** 5/10 · **Status:** Deferred — user preference · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Compare the selected live visual direction with exported motion for loading, playback, alpha support and reduced motion; preserve existing studies.
- **Rationale/benefit:** May improve presentation if it earns its loading and production cost.
- **Strategic benefit:** Marketing polish, lower priority than a clear product story and working example.
- **Current state:** Many Swarm studies and a final site exist. Video was explicitly deferred by the user.
- **Completion/dependencies:** Remain deferred until requested; device/publication acceptance stays in maintainer TODO.

## Architecture

### ARC-01 Reuse warm execution environments safely

**Rank:** 18 · **Impact:** 5/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Keep eligible idle sandboxes briefly and skip restore only when their contents match the authoritative workspace/session revision. Refresh credentials, runtime capability and permission policy for each run.
- **Rationale/benefit:** Reduces repeated provisioning/hydration latency, especially for large interactive workspaces.
- **Strategic benefit:** Adopts HarnessRouter’s warm checkpoint probe; improves personal-agent responsiveness.
- **Current state:** The current engine provisions a machine named for each run and restores published state. Independent checkpoints remain the durable source of truth.
- **Completion/dependencies:** Complete with bounded idle lifetime/cost, eviction, revision matching, single-writer ownership and permission-change behavior. A warm machine is a cache, never the only durable copy. Compare benefit to operational complexity before broad rollout.

### ARC-02 Add a bounded Responses compatibility facade

**Rank:** 25 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Translate a documented Responses-compatible subset into existing admission/runs/events, with server-side harness/workspace mapping. Preserve the richer resource API.
- **Rationale/benefit:** Lets existing clients reuse SDK calls, text streaming and response handling.
- **Strategic benefit:** Matches HarnessRouter’s familiar invocation surface; lowers switching effort.
- **Current state:** Macrofold has REST plus five SDKs, but no public Responses-compatible invocation endpoint. Its internal model gateway serves a different audience.
- **Completion/dependencies:** Complete for text, streamed events, continuation, errors, cancellation and supported file semantics with explicit unsupported fields. Reuse policy owners; long jobs need recovery rather than fragile open HTTP requests. See the comparison’s compatibility example.

### ARC-03 Evaluate durable orchestration alternatives when coordination requires them

**Rank:** 37 · **Impact:** 3/5 · **Difficulty:** 8/10 · **Status:** Deferred — conditional evaluation · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Compare current Workflow/SQL ownership with Temporal before building major delegation trees, multi-day approvals, long-lived coordinators or worker-version rollouts. Identify which state actually moves.
- **Rationale/benefit:** Could replace custom coordination machinery when the product needs it.
- **Strategic benefit:** Enables future fleet coordination; migration itself is not a differentiator.
- **Current state:** Workflow 4.8.5 and the SQL poller already support bounded execution/history handoff. No Temporal prototype or migration exists.
- **Completion/dependencies:** Conditional evaluation, not an approved migration. Preserve native execution identity, grants, reservations and independent checkpoints. Read the orchestration comparison; exercise parent cancellation, ambiguous effects, approval resume, history, placement and total cost.

## Business and operations

### BIZ-01 Model pricing and improve cost explanation

**Rank:** 13 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Compare elapsed execution, active work, waiting, cache read/write tokens, storage, idle capacity, orchestration and connector costs. Review subscription fee versus included credit and add understandable customer/project/key attribution and date comparisons.
- **Rationale/benefit:** Protects margin while making bills and plan selection easier to understand.
- **Strategic benefit:** Responds to HarnessRouter’s included-spend pricing without assuming its internal costs or blindly matching rates.
- **Current state:** Macrofold has reservations, rates, usage and operator reporting; its elapsed-time compute and cache pricing differ from HarnessRouter’s advertised active-work pricing.
- **Completion/dependencies:** Complete with representative workload scenarios, sensitivity analysis and a chosen pricing policy; no price changes are authorized by this tracker. Invoice/usage exports and comparisons should reuse existing reporting.

### OPS-01 Automate staged releases and controlled promotion

**Rank:** 38 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Implement an immutable-source release pipeline with serialized staging acceptance, image publication, compatible migrations, readiness checks, promotion and rollback records.
- **Rationale/benefit:** Reduces repeated operator release work while preserving running executions.
- **Strategic benefit:** Operational benefit; not an exclusive HarnessRouter gap.
- **Current state:** Launch is an explicit walkthrough. Detailed desired release gates remain in maintainer TODO.
- **Completion/dependencies:** Complete against that release contract before advertising automatic deploys; no deployment authorized by this proposal.

## Source and implementation references

- [HarnessRouter comparison](../../output/competitor-research/harnessrouter-comparison.md): screenshots, public code, pricing, memory, API adoption and resource-model findings. INT-01–INT-07, EX-01/02/04, ARC-01/02 and the customer-agent proposals draw on this research; shared ideas are not claimed as unique.
- [Workflow and Temporal evaluation](../architecture/orchestration-evaluation.md): preserves the September 9 technical comparison, sources and evaluation criteria underlying ARC-03 and PRD-04/05/10.
- [Dashboard guide](../features/dashboard/README.md): current onboarding/templates/assistant-preview behavior; dashboard proposals formerly lived in dashboard-future-features.md. EX-03, DOC-02 and UX-01–UX-10 preserve those suggestions, including reviewable actions and configuration revision views.
- [Connector setup](../features/identity-integrations/composio.md), [catalog behavior](../features/identity-integrations/connectors.md), [model policy](../../packages/core/src/model-policy.ts), [memory adapter](../../packages/runtime/src/hermes-bridge.py), [run admission](../../packages/core/src/runs.ts), [trigger quota](../../packages/core/src/triggers.ts), [runtime](../features/execution/runtime.md), [schedules](../features/triggers/scheduled-tasks.md).
- [Release TODO](../maintainers/TODO.md): OPS-01 implementation gates and existing release/operational work. Broader already-deferred scope such as arbitrary runtime images, multi-region writes and other Git hosts remains in the [product boundary](README.md); it is not newly recommended by this research.

## Completed documentation work

| ID     | Description                                            | Rationale and strategic benefit                                                               | Difficulty | Added      | Status | Result                                                                                                                                                           |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOC-03 | Explain per-toolkit Composio enablement                | Prevents catalog availability being mistaken for ready customer connections; clarifies INT-01 | 1/10       | 2026-09-10 | Done   | [Setup guide](../features/identity-integrations/composio.md) now describes auth-config/version mappings and the enabling sequence. No connectors were enabled.   |
| DOC-04 | Refresh competition research and consolidate proposals | Preserves accurate positioning and one ranked implementation tracker                          | 2/10       | 2026-09-10 | Done   | Updated comparison, migrated proposal lists, retained orchestration research and linked the tracker from parent documents. No product features were implemented. |
