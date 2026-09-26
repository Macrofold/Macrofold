# Improvements

This is the authoritative internal tracker for proposed product, integration, architecture, documentation, example, dashboard and marketing improvements. It consolidates the HarnessRouter research, dashboard opportunities and architecture proposals. A proposal is not a shipped capability or an instruction to implement it. [Current behavior](../status/README.md), [accepted architecture](../architecture/README.md) and [release acceptance](../maintainers/TODO.md) remain separate.

## Strategic direction

The preferred product messages are:

> A customer’s information can remain the stable resource while different agents, conversations and scheduled tasks work on it over time.

> Give every customer a persistent agent—with its own worktree, memory, tools and ongoing work.

The first message maps directly to independent persisted worktrees and separate sessions. The second is the desired packaged experience, not a claim that HarnessRouter cannot provide persistent agents or that Macrofold already manages universal memory. HarnessRouter can serve basic named personal assistants. The opportunity is to make continuity around customer information substantially easier. Target builders of customer-agent products; a direct-to-consumer assistant is a separate business choice. See the competitive comparison (`../../output/competitor-research/harnessrouter-comparison.md`, local historical evidence not included in this repository) and [September strategy research](strategy-2026-09.md).

The recommended near-term focus is a recurring customer investigation that produces a verifiable result, aimed at SaaS builders who already have a useful manual agent routine. Validate that buyer and workflow through BIZ-03 before broadening the platform. Prioritize activation, ongoing tasks, reviewable actions, outcome evidence and operating costs over media breadth, extra harnesses and speculative performance work. Native harness choice and persisted files remain foundations; neither is an exclusive competitive claim. The proposed outcome-led marketing in MKT-03 has not replaced the selected site copy.

Hosted native execution, customer/account separation, billing and recovery acceptance remain ahead of feature expansion for the advertised pilot surface. Those checks stay in [release TODO](../maintainers/TODO.md), separate from this ranking.

## How to maintain this tracker

- IDs are stable; rank changes when evidence, dependencies or effort change. Lower rank means earlier recommended work across all categories, not separate competing priority lists.
- Impact is 1–5 for the intended customer-agent market. Difficulty is 0–10: 0 documentation/configuration only, 1–3 small/local, 4–6 several layers or product decisions, 7–8 lifecycle/security/operations work, 9–10 foundational uncertainty. Estimates describe the proposed scope, not elapsed days or promises.
- Rank favors customer impact and lower effort, adjusted for prerequisites and demand. Foundational examples precede a new core agent resource; optional managed memory follows simpler templates; Temporal evaluation does not block ordinary independent runs. Low-impact easy polish can rank below a hard core capability.
- Status values: Proposed, Planned, In progress, Blocked, Staging implemented (with any remaining activation/acceptance qualifier), Done, Deferred, Dropped. Planned means scope was accepted; In progress requires active implementation. Record a blocker or reason for Deferred/Dropped. Link the implementing change and update current-state/completion notes when marking Done.
- Each entry records its added date; original entries retain **2026-09-10** and new strategy proposals use **2026-09-18**. These dates do not claim when an idea originated. Owner is **Unassigned** unless stated otherwise. Supporting source dates remain in the source record. Proposed entries are not a release checklist.
- Preserve release prerequisites and acceptance in maintainer TODO; do not move unfinished deployment checks here or turn speculative product work into launch blockers. Detailed research informs entries but does not own a second status/ranking list.

## Routine implementation choices

This field identifies work that can progress without new product direction, experience design, communication choices or consequential architecture decisions from the owner. It is independent of strategic priority and difficulty.

- **Yes:** The scoped implementation can use existing contracts, examples and ordinary engineering judgment.
- **Partial:** Only the technical portion named in the entry is routine; completing it does not complete the broader proposal.
- **No:** The proposal includes meaningful product, UX, communication, policy or architecture definition. This is not a blanket permission gate: use decisions already made, draft concrete options independently, and surface only unresolved consequential choices.
- **—:** Completed work; no new implementation is classified.

The next low-involvement batch is **EX-04's baseline evaluation runner, BIZ-02's internal cost analysis, and EX-03's versioning/validation portion**, in that order. Product priority remains in the single ranking below; later-ranked routine work can proceed while higher-ranked experience choices are being resolved. DOC-02 can be drafted independently, but remains communication work. These labels do not authorize deployment, customer contact, pricing changes or spending beyond existing session/repository authorization.

## Recommended build order

Ranks 1–10 were implemented September 11, 2026. [Implementation boundaries, verification and deliberate limits](../engineering/testing/customer-agents.md) distinguish completed local functionality from remaining live-service acceptance. Remaining work follows the customer-workflow strategy, with internal economics separated from customer-facing pricing and new action/outcome proposals made explicit. BIZ-03 validation and small DOC-02/MKT-03 deliverables can accompany the first recipe; rank does not turn them into prerequisites for unrelated routine groundwork. Existing Done and Staging implemented progress is preserved; remaining proposals keep their Proposed or Deferred status. Later-ranked completed entries retain their rank for traceability, with remaining acceptance distinguished from implementation.

| Rank | ID | Improvement | Impact | Difficulty | Routine implementation choices | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [DOC-01](#doc-01-explain-customer-state-and-agent-identity) | Explain customer state and agent identity | 5/5 | 1/10 | — | Done |
| 2 | [INT-01](#int-01-make-connector-enablement-automatic-or-operator-guided) | Make connector enablement automatic or operator-guided | 5/5 | 4/10 | — | Done |
| 3 | [MKT-01](#mkt-01-present-customer-information-as-the-lasting-resource) | Present customer information as the lasting resource | 5/5 | 2/10 | — | Done |
| 4 | [PRD-01](#prd-01-make-trigger-quotas-configurable) | Make trigger quotas configurable | 4/5 | 2/10 | — | Done |
| 5 | [PRD-02](#prd-02-offer-an-optional-file-based-memory-template) | Offer an optional file-based memory template | 5/5 | 3/10 | — | Done |
| 6 | [EX-01](#ex-01-build-a-complete-named-personal-agent-application) | Build a complete named personal-agent application | 5/5 | 4/10 | — | Done |
| 7 | [INT-02](#int-02-expand-model-coverage-through-capability-based-catalog-policy) | Expand model coverage through capability-based catalog policy | 5/5 | 4/10 | — | Done |
| 8 | [UX-01](#ux-01-connect-templates-to-scheduled-work) | Connect templates to scheduled work | 4/5 | 2/10 | — | Done |
| 9 | [EX-02](#ex-02-add-database-and-integration-recipes) | Add database and integration recipes | 4/5 | 3/10 | — | Done |
| 10 | [PRD-03](#prd-03-package-customer-agent-identity-and-sdk-setup-helpers) | Package customer-agent identity and SDK setup helpers | 5/5 | 5/10 | — | Done |
| 11 | [UX-02](#ux-02-make-onboarding-resumable-and-show-integration-success) | Make onboarding resumable and show integration success | 4/5 | 3/10 | Partial | Proposed |
| 12 | [EX-03](#ex-03-version-and-expand-reusable-agent-examples-and-skills) | Version and expand reusable agent examples and skills | 4/5 | 4/10 | Partial | Proposed |
| 13 | [BIZ-02](#biz-02-measure-internal-serving-costs-and-contribution-margin) | Measure internal serving costs and contribution margin | 5/5 | 4/10 | Yes | Proposed |
| 14 | [BIZ-01](#biz-01-model-pricing-and-improve-cost-explanation) | Model pricing and improve cost explanation | 5/5 | 4/10 | No | Proposed |
| 15 | [BIZ-03](#biz-03-validate-the-recurring-customer-workflow-with-paid-pilots) | Validate the recurring customer workflow with paid pilots | 5/5 | 4/10 | No | Proposed |
| 16 | [MKT-03](#mkt-03-lead-the-launch-story-with-a-demonstrated-customer-workflow) | Lead the launch story with a demonstrated customer workflow | 5/5 | 3/10 | No | Proposed |
| 17 | [PRD-04](#prd-04-represent-ongoing-tasks-across-runs) | Represent ongoing tasks across runs | 5/5 | 6/10 | No | Proposed |
| 18 | [PRD-11](#prd-11-add-reviewable-action-proposals-and-execution-receipts) | Add reviewable action proposals and execution receipts | 5/5 | 7/10 | No | Proposed |
| 19 | [UX-03](#ux-03-add-a-notification-center) | Add a notification center | 4/5 | 5/10 | No | Proposed |
| 20 | [EX-04](#ex-04-compare-configurations-on-representative-tasks) | Compare configurations on representative tasks | 3/5 | 4/10 | Yes | Proposed |
| 21 | [PRD-13](#prd-13-record-and-verify-customer-task-outcomes) | Record and verify customer-task outcomes | 5/5 | 6/10 | No | Proposed |
| 22 | [PRD-07](#prd-07-unify-agent-lifecycle-controls) | Unify agent lifecycle controls | 4/5 | 6/10 | Partial | Proposed |
| 23 | [PRD-10](#prd-10-extend-recurring-work-and-steering-policies) | Extend recurring-work and steering policies | 3/5 | 6/10 | Partial | Proposed |
| 24 | [DOC-02](#doc-02-create-task-specific-integration-briefs) | Create task-specific integration briefs | 3/5 | 2/10 | No | Proposed |
| 25 | [PRD-06](#prd-06-offer-managed-memory-as-an-optional-service) | Offer managed memory as an optional service | 4/5 | 7/10 | No | Proposed |
| 26 | [PRD-12](#prd-12-detect-meaningful-changes-before-waking-a-full-agent) | Detect meaningful changes before waking a full agent | 4/5 | 5/10 | No | Proposed |
| 27 | [UX-06](#ux-06-improve-privacy-and-data-controls) | Improve privacy and data controls | 3/5 | 5/10 | No | Proposed |
| 28 | [PRD-08](#prd-08-manage-fleets-of-customer-agents) | Manage fleets of customer agents | 4/5 | 7/10 | No | Proposed |
| 29 | [UX-04](#ux-04-improve-api-key-lifecycle-ux) | Improve API-key lifecycle UX | 3/5 | 3/10 | No | Proposed |
| 30 | [OPS-01](#ops-01-automate-staged-releases-and-controlled-promotion) | Automate staged releases and controlled promotion | 3/5 | 7/10 | Partial | Staging implemented; activation pending |
| 31 | [UX-07](#ux-07-add-service-account-administration) | Add service-account administration | 3/5 | 5/10 | No | Proposed |
| 32 | [INT-05](#int-05-expose-shared-services-to-both-agents-and-applications) | Expose shared services to both agents and applications | 5/5 | 6/10 | No | Proposed |
| 33 | [EX-05](#ex-05-publish-reusable-agent-action-and-recovery-fixtures) | Publish reusable agent action and recovery fixtures | 3/5 | 4/10 | Partial | Proposed |
| 34 | [INT-03](#int-03-support-model-vision-inputs) | Support model vision inputs | 5/5 | 5/10 | — | Done |
| 35 | [PRD-05](#prd-05-package-explicit-multi-agent-handoffs) | Package explicit multi-agent handoffs | 4/5 | 6/10 | No | Proposed |
| 36 | [ARC-01](#arc-01-reuse-warm-execution-environments-safely) | Reuse warm execution environments safely | 5/5 | 7/10 | No | Partially implemented |
| 37 | [UX-10](#ux-10-offer-a-contextual-support-handoff) | Offer a contextual support handoff | 2/5 | 4/10 | No | Proposed |
| 38 | [ARC-02](#arc-02-add-a-bounded-responses-compatibility-facade) | Add a bounded Responses compatibility facade | 4/5 | 6/10 | No | Proposed |
| 39 | [UX-08](#ux-08-extend-team-roles-and-groups) | Extend team roles and groups | 3/5 | 6/10 | No | Proposed |
| 40 | [UX-05](#ux-05-add-global-authorized-resource-search) | Add global authorized resource search | 3/5 | 4/10 | No | Proposed |
| 41 | [INT-04](#int-04-offer-image-generation-as-a-shared-tool-service) | Offer image generation as a shared tool service | 4/5 | 5/10 | No | Proposed |
| 42 | [UX-09](#ux-09-build-the-hosted-account-assistant-with-reviewable-actions) | Build the hosted account assistant with reviewable actions | 3/5 | 7/10 | No | Staging implemented |
| 43 | [INT-06](#int-06-expand-media-and-artifact-experiences) | Expand media and artifact experiences | 3/5 | 7/10 | No | Staging implemented |
| 44 | [INT-07](#int-07-add-further-harnesses-only-for-demonstrated-capability-gaps) | Add further harnesses only for demonstrated capability gaps | 2/5 | 5/10 | No | Proposed |
| 45 | [PRD-09](#prd-09-explore-live-artifact-collaboration) | Explore live artifact collaboration | 2/5 | 7/10 | No | Proposed |
| 46 | [ARC-03](#arc-03-evaluate-durable-orchestration-alternatives-when-coordination-requires-them) | Evaluate durable orchestration alternatives when coordination requires them | 3/5 | 8/10 | No | Deferred — conditional evaluation |
| 47 | [MKT-02](#mkt-02-evaluate-exported-motion-or-video-only-when-resumed) | Evaluate exported motion or video only when resumed | 2/5 | 5/10 | No | Deferred — user preference |

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
- **Strategic benefit:** Adds ready-to-use ongoing-agent behavior on top of independent persistent worktrees.
- **Current state:** The [optional memory starter](../features/customer-agents/memory.md) supplies configurable profile, memory directory and versioned task data with provenance, correction and forgetting instructions. The reference app supports conditional edits and deletion across conversations.
- **Completion/dependencies:** Done September 11. Layout/schema rejection, actual simulator persistence and browser correction/deletion pass. Model obedience and erase-everywhere guarantees are explicitly outside this file convention.

### PRD-03 Package customer-agent identity and SDK setup helpers

**Rank:** 10 · **Impact:** 5/5 · **Difficulty:** 5/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Provide a small composition layer linking an external customer reference, named agent, preset/configuration, worktree and sessions. Offer it as an optional use-case integration path over core primitives, retaining direct core composition for custom layouts.
- **Rationale/benefit:** Reduces resource plumbing while leaving ownership explicit.
- **Strategic benefit:** A coherent customer-agent API can make this use case easier than composing HarnessRouter sessions.
- **Current state:** The optional [Customer agents integration path](../features/customer-agents/README.md) now offers atomic bindings, ownership-checked messages/runs/files, generated SDK resources, hosted customer connector consent and optional React permissions controls. It is explicitly a use-case path in the API, docs, developer UI and marketing. The [reference app](../../examples/personal-agent/README.md) remains an alternative that composes core APIs directly.
- **Completion/dependencies:** Done September 11. Fresh conversations reuse the owned worktree and permissions; the platform Agent remains a reusable preset. Single-process SQLite is a deliberate runnable default, with multi-instance locking/store replacement documented together.

### PRD-04 Represent ongoing tasks across runs

**Rank:** 17 · **Impact:** 5/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Task/run boundaries, state transitions, wakeup/approval behavior, cumulative budgets and orchestration ownership need consequential product and architecture definition.

- **Description:** Introduce durable task identity, status, next action, due/wakeup time, linked runs and user decisions. Support pausing for days and resuming on fresh compute rather than holding an execution slot.
- **Rationale/benefit:** Makes “plan my trip” or “maintain this account” persist beyond one prompt execution.
- **Strategic benefit:** Turns continuing work into a product primitive beyond a session transcript.
- **Current state:** Runs, recurring triggers and explicit input requests exist; input waits currently consume the execution window/slot. No customer task ledger spans arbitrary runs.
- **Completion/dependencies:** Complete with task/run separation, checkpoint handoff, reauthorization and fresh budget admission after waiting. Start with simple tasks; PRD-03 helps expose ownership. Evaluate ARC-03 before substantial coordinator machinery.
- **Initial scope/priority:** Prioritize one customer investigation that can pause and resume across days. Include task ownership, evidence references, explicit waiting/blocked/completed states and cumulative budget intent; do not imply arbitrary native-stack resumption. The integrating app still owns customer identity.

### PRD-05 Package explicit multi-agent handoffs

**Rank:** 35 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Handoff boundaries, partial-failure behavior, review and coordination ownership need product/architecture decisions.

- **Description:** Make ordered handoffs and result review easy; associate steps/results, preserve separate conversations and credentials, and surface partial failure/cancellation.
- **Rationale/benefit:** Reduces application code around different agents maintaining one customer’s files.
- **Strategic benefit:** Builds directly on Macrofold’s independent worktree model.
- **Current state:** Sequential same-worktree handoff works through APIs; another session receives worktree_busy during pending work. Parallel branches need explicit merge.
- **Completion/dependencies:** Complete with an initial bounded sequential flow, visible file/persistence outcomes and explicit branch merges. Full delegation trees require ARC-03 evaluation; no concurrent same-folder writer promise.
- **Initial scope/priority:** Require a measured benefit from a bounded sequential handoff before introducing broader coordination.

### PRD-06 Offer managed memory as an optional service

**Rank:** 25 · **Impact:** 4/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Decide memory behavior, provenance/freshness, conflict and correction semantics, scope and the user experience before adding a service.

- **Description:** Define remember/search/update/forget operations, customer scope, provenance, contradiction handling and user correction/deletion. Choose file or database storage independently from the public behavior.
- **Rationale/benefit:** Provides predictable memory semantics across conversations and harnesses.
- **Strategic benefit:** Could differentiate a packaged lifecycle, but HarnessRouter can also use an external memory service.
- **Current state:** No platform-wide semantic memory API. PRD-02 is the lower-cost first step; native Hermes memory follows its session.
- **Completion/dependencies:** Proceed when template users need stronger semantics. Use PRD-02/EX-01 feedback for the initial evidence/correction increment; a reusable application-facing memory service coordinates with INT-05. Do not assume embeddings alone solve memory, or force this on agnostic users. Correction of current context is distinct from historical checkpoint/transcript retention.
- **Initial scope/priority:** Begin with source/time/revision provenance, freshness, corrections and the distinction between observed facts, inferences and instructions. Use existing files and conditional edits where sufficient; preserve the broader optional remember/search/update/forget proposal for demonstrated need.

### PRD-07 Unify agent lifecycle controls

**Rank:** 22 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** Partial — Reuse, tests and diagnostics for existing per-resource controls are routine. A new aggregate API and its pause/resume, deletion and reassignment semantics require lifecycle decisions.

- **Description:** Define pause/resume, configuration/harness change, export, reassignment and deletion of a customer agent across its worktree, conversations, schedules and connections.
- **Rationale/benefit:** Prevents developers implementing inconsistent cleanup and pause behavior.
- **Strategic benefit:** Makes “own an ongoing agent” a coherent product experience.
- **Current state:** Individual resource controls exist; no single aggregate agent lifecycle spans them. Native conversation state cannot be transparently migrated between harness families.
- **Completion/dependencies:** Complete with explicit active-run treatment, future schedule behavior, selective connection revocation and retained accounting. Depends on PRD-03; changing a harness preserves shared files, not interchangeable native history.
- **Initial scope/priority:** Prioritize coherent pause/resume and cleanup for a customer integration. Separate existing per-resource diagnostics from new aggregate semantics; active work, future triggers, connection grants and retained records must have defined behavior.

### PRD-08 Manage fleets of customer agents

**Rank:** 28 · **Impact:** 4/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Cohorts, customer overrides, rollout/rollback semantics, bulk actions and operator experience require product and architecture definition.

- **Description:** Add customer/agent filters, template rollout cohorts, canaries/rollback, bulk pause, attributable spend/limits and health summaries. Preserve customer overrides.
- **Rationale/benefit:** Makes thousands of instances manageable rather than just runnable.
- **Strategic benefit:** A credible fleet-management angle requires these controls; raw concurrency is shared with competitors.
- **Current state:** Organization scheduling, grants, preset versions and reporting exist; customer-agent fleet rollout/management does not.
- **Completion/dependencies:** Complete an initial operator workflow after PRD-03/PRD-07 and real fleet use. Treat preset upgrades separately from workflow-worker versioning.
- **Initial scope/priority:** After actual expansion, start with customer cost/health, bulk pause and a small configuration cohort. Add broader canaries/rollback only with repeatable fleet use; preserve customer overrides.

### PRD-09 Explore live artifact collaboration

**Rank:** 45 · **Impact:** 2/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Concurrent editing, revision/conflict behavior and the collaboration experience are consequential design choices.

- **Description:** Support selected concurrent user/agent editing experiences with explicit conflict and revision semantics, such as a collaborative document surface.
- **Rationale/benefit:** Useful for apps built around editable deliverables.
- **Strategic benefit:** Inspired by HarnessRouter’s session blackboard sidecar and application canvases.
- **Current state:** Macrofold publishes checkpoint revisions and serializes worktree writers; no general live collaborative editing model.
- **Completion/dependencies:** Require a concrete artifact use case. Do not confuse a Yjs document with safe concurrent writes to the whole worktree.
- **Initial scope/priority:** Require a concrete collaborative artifact need before changing concurrency or editing guarantees.

### PRD-10 Extend recurring-work and steering policies

**Rank:** 23 · **Impact:** 3/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** Partial — Fixtures and diagnostics for current coalescing/skip behavior are routine. New overlap/catch-up/backfill, pause-on-failure, notification and steering behavior needs explicit policy decisions.

- **Description:** Add justified overlap/catch-up/backfill/pause-on-failure options and acknowledged commands to ongoing tasks, rather than only a new prompt or cancellation.
- **Rationale/benefit:** Lets customers express recovery and scheduling intent.
- **Strategic benefit:** Supports continuing customer work; native harness scheduling alone is not an equivalent cross-harness service.
- **Current state:** Cron coalesces missed occurrences and skips overlapping work; configuration edits and input APIs exist, but richer policy/command semantics are not packaged.
- **Completion/dependencies:** Depends on PRD-04 for task-level steering. Preserve authorization/budget admission for every start and distinguish schedule policy from queue concurrency.
- **Initial scope/priority:** Use the existing coalescing/overlap behavior first. Improve visibility and fixtures for current semantics before adding new policy choices; distinguish quiet notifications, schedule delivery and task-level steering.

### PRD-11 Add reviewable action proposals and execution receipts

**Rank:** 18 · **Impact:** 5/5 · **Difficulty:** 7/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** No — Approval scope, expiry, stale-resource behavior, supported action types and uncertain-effect recovery must be defined together with the review experience.

- **Description:** Persist a proposed operation with exact target/parameters, evidence, approving principal, relevant resource revision and expiry. Record whether execution was confirmed, failed or uncertain, with supported reconciliation and provider idempotency.
- **Rationale/benefit:** Lets a person understand and approve a specific action, and establishes what actually happened afterward.
- **Strategic benefit:** Packages consequential customer work with PRD-04 and the embeddable attention experience in UX-03.
- **Current state:** Connection grants, run input and tool events exist; no general durable action-proposal/receipt contract is packaged. UX-09's proposed account assistant is a separate consumer of such capabilities.
- **Completion/dependencies:** Start with one or two justified connectors/action types. Recheck current authority and resource state on resume; changed parameters require a fresh decision. Never blindly replay ambiguous side effects or imply exactly-once behavior for arbitrary MCP tools. Define the approval/expiry experience and supported provider guarantees before implementation.

### PRD-12 Detect meaningful changes before waking a full agent

**Rank:** 26 · **Impact:** 4/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** No — Select the workflow decision, acceptable missed-event tradeoff, fallback and suppression behavior first. Once scoped, EX-04 can run the technical comparison without designing a new product surface.

- **Description:** Use cursors, event IDs, hashes and deterministic rules to identify new work; evaluate optional bounded model judgments for grouping related evidence, selecting context or deciding whether an update merits attention. Start at recipe level with a shadow mode.
- **Rationale/benefit:** Reduces unnecessary execution and notifications while measuring important changes that a filter might miss.
- **Strategic benefit:** Makes recurring customer work economical and useful between full harness runs. TypeSafe/Jev is a candidate experiment, not a required platform dependency or another native harness model.
- **Current state:** Schedules admit agent runs; no packaged semantic wakeup policy or measured selective-execution service exists.
- **Completion/dependencies:** Choose one decision and an acceptable error tradeoff; compare rules, a small conventional model, Jev and the full-agent path using EX-04 and a held-out labeled set. Measure false negatives, service failures, tail latency and total retrieval/execution cost. Keep explicit fallback, independent authorization and periodic review of suppressed cases. Do not relax harness catalog requirements to fit a decision model; generalize through INT-05 only after repeated demand.

### PRD-13 Record and verify customer-task outcomes

**Rank:** 21 · **Impact:** 5/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** No — Business completion criteria, verification ownership, unresolved states and customer-visible status need explicit definition; EX-04's fixture runner is separately routine.

- **Description:** Link a task's intended result to its runs, persisted artifacts, external action receipts and a task-specific completion check. Distinguish successful execution, saved files and a confirmed customer outcome; allow an unresolved or human-reviewed result.
- **Rationale/benefit:** Prevents a successful tool response or confident summary from being mistaken for completed work.
- **Strategic benefit:** Makes follow-through inspectable and enables cost per accepted result, rather than only cost per run.
- **Current state:** Execution, persistence and Git outcomes are separate today; business-level outcome contracts and their customer-facing status are not packaged. EX-04 supplies evaluation infrastructure, not this product contract.
- **Completion/dependencies:** Define the acceptance rule with the selected workflow. Use fresh-state checks or independent evidence where possible and explicit human acceptance for subjective work. Reuse PRD-04/PRD-11 as applicable; replay writes only against fixtures or isolated environments. File rollback does not reverse third-party effects. Preserve customer-content and retention boundaries.

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

**Rank:** 34 · **Impact:** 5/5 · **Difficulty:** 5/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** — Completed for the reviewed image combinations; remaining live acceptance is separate.

- **Description:** Carry authorized image/screenshot inputs through the public contract, adapters and model gateway, including capability and billing treatment.
- **Rationale/benefit:** Unlocks image understanding in document, support and design workflows.
- **Strategic benefit:** Closes a material HarnessRouter capability gap.
- **Current state:** Image attachments now pass through the public API, native Codex/Claude adapters and bounded image accounting; PDF/DOCX/text use isolated extraction. See [media implementation and acceptance](../features/media/implementation.md). Live provider/deployed image acceptance remains separate.
- **Completion/dependencies:** Implemented September 17 in [MAC-19](https://linear.app/macrofold/issue/MAC-19/support-multimedia-inputs-and-downloadable-agent-outputs). Native protocol, metering, permission and SDK fixtures pass; reviewed image combinations and remaining live acceptance are recorded in [multimedia verification](../features/media/verification.md).
- **Initial scope/priority:** Preserve the implemented reviewed scope. Extend image/model combinations only for a demonstrated workflow need; remaining hosted/provider acceptance stays in the linked verification and release TODO.

### INT-04 Offer image generation as a shared tool service

**Rank:** 41 · **Impact:** 4/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Provider/service contract, generation experience, billing and uncertain-job behavior require decisions.

- **Description:** Add an image-generation tool backed by appropriate providers/OpenRouter routes, returning durable artifacts with cost and job state. Keep generation separate from the conversation model choice.
- **Rationale/benefit:** Lets existing agents create useful visual deliverables without a new agent loop.
- **Strategic benefit:** Adopts part of HarnessRouter’s media breadth at a smaller scope than a full video editor.
- **Current state:** No built-in media generation plane; external tools can provide specific operations.
- **Completion/dependencies:** Complete with durable output, authorized access and explicit handling of an ambiguous provider submission. Coordinate with INT-05; do not treat vision input as generation.
- **Initial scope/priority:** Retain for a validated visual-deliverable workflow; it is lower priority for recurring operational investigations.

### INT-05 Expose shared services to both agents and applications

**Rank:** 32 · **Impact:** 5/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Selecting a service, public contract, consumer scopes and billing/idempotency behavior is an architecture decision.

- **Description:** Offer selected service operations through MCP and authorized application APIs: database queries, future memory/task operations and media jobs. Share one policy/service owner.
- **Rationale/benefit:** A UI can read memory or refresh a chart without another model turn.
- **Strategic benefit:** Adapts HarnessRouter’s SQL/media application layer and supports richer customer-agent products.
- **Current state:** The central run tool broker exists; no equivalent general application-facing service surface is packaged. HarnessRouter’s SQL service supports Postgres/MySQL and app queries.
- **Completion/dependencies:** Complete first with one concrete service and scoped app credentials. Do not make arbitrary tool execution public or bypass current ownership, cost and idempotency rules.
- **Initial scope/priority:** Start with one repeated decision or evidence operation only after recipe-level use proves the need. Keep the broader database/memory/media possibilities; avoid creating a general services platform in advance of consumers.

### INT-06 Expand media and artifact experiences

**Rank:** 43 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Staging implemented · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Media types, editing/export experiences and provider/job contracts need a chosen use case.

- **Description:** Add requested audio/video/music jobs, previews and reusable application examples after image needs are understood. Keep job status, export and editing separable from agent turns.
- **Rationale/benefit:** Opens additional product categories and richer deliverables.
- **Strategic benefit:** HarnessRouter leads with media services and editable application kits.
- **Current state:** Private image/PDF/audio/video previews and verified downloadable outputs are implemented in [Files and media](../features/media/README.md). Audio/video analysis, generation jobs and a media editor remain deferred; existing external tools can create deliverables.
- **Completion/dependencies:** Depends on INT-04/INT-05 and customer demand. Avoid making a video editor mandatory infrastructure.
- **Initial scope/priority:** Preserve the implemented private previews and downloadable outputs. Rank and design classification apply to the remaining analysis/generation/editor scope, conditional on demonstrated demand.

### INT-07 Add further harnesses only for demonstrated capability gaps

**Rank:** 44 · **Impact:** 2/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Select a demonstrated capability gap and supported harness scope first; adapter work then follows the existing UHI and its acceptance requirements.

- **Description:** Evaluate Oh My Pi, Qwen Code, Gemini CLI, Cline or other runtimes against requested tasks and native capabilities.
- **Rationale/benefit:** Adds useful choices without multiplying low-value maintenance.
- **Strategic benefit:** Can close remaining HarnessRouter breadth gaps; count alone is weak positioning.
- **Current state:** Macrofold already has Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness and Pi. Hermes/Pi are no longer future adapter proposals.
- **Completion/dependencies:** Use EX-04 and current Unified Harness Interface; prefer INT-02 when the actual request is model choice.
- **Initial scope/priority:** Use a paying workflow or demonstrated native capability gap to justify added maintenance; prefer compatible model coverage when that solves the request.

## Examples

### EX-01 Build a complete named personal-agent application

**Rank:** 6 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Create a maintained reference app where Alice creates Milo, connects an account, chats in separate conversations, reviews memory/tasks, schedules work and pauses/deletes the agent. Keep owner mapping in the application initially.
- **Rationale/benefit:** Demonstrates the full lifecycle and reveals which higher-level APIs are actually needed.
- **Strategic benefit:** The strongest near-term proof of the selected value proposition; HarnessRouter can also power a basic assistant.
- **Current state:** The [personal-agent reference app](../../examples/personal-agent/README.md) implements Alice/Milo and Bob/Basil, separate conversations over shared files, a narrowly granted search account, memory/tasks, weekly scheduling, pause/resume and workspace deletion. Durable SDK step records support restart and ambiguous-response recovery.
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

**Routine implementation choices:** Partial — Versioning, validation and automated checks for existing examples/skills are routine. New flagship workflow selection, public packaging, upgrade experience and sample communication need product definition.

- **Description:** Extend curated examples with release notes, account research and incident summaries; include required integrations, real sample artifacts, configuration revisions and contributor review. Add installable multi-file skill/template bundles when needed.
- **Rationale/benefit:** Makes presets reproducible and easier to customize; reduces prompt-only demos.
- **Strategic benefit:** Matches HarnessRouter’s skill/configuration packaging while emphasizing durable customer work.
- **Current state:** Five starters and preset versions exist; illustrative output and planned entries are labeled. There is no dedicated managed skills package/catalog API.
- **Completion/dependencies:** Complete with maintained source definitions, upgrade/diff behavior and explicit grants. Preserve a small curated front page and never overwrite customer instructions silently.
- **Initial scope/priority:** First version and validate existing examples, then choose one flagship recurring investigation with fixtures, real evidence/artifact links and several successive occurrences, including an uneventful check. Retain other example categories for demonstrated demand. This does not require a new catalog API.

### EX-04 Compare configurations on representative tasks

**Rank:** 20 · **Impact:** 3/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** Yes — The initial runner can use existing examples, fixture completion checks and cost/latency reporting with ordinary engineering judgment. New business-quality rubrics, user-facing comparison design and live outcome contracts remain outside that baseline.

- **Description:** Start with a small reproducible task suite comparing harness/model output, cost, latency and artifacts; add a side-by-side UI only if users need it.
- **Rationale/benefit:** Helps developers select configurations and catch meaningful regressions.
- **Strategic benefit:** Adopts HarnessRouter Arena’s selection benefit without making an Arena clone the first priority.
- **Current state:** Harness fixtures and run traces exist; no end-user comparative evaluation product. Hosted Arena is visible in supplied screenshots.
- **Completion/dependencies:** Complete with comparable inputs and transparent task-specific results; no universal winner claim. Keep paid runs explicitly opt-in.
- **Initial scope/priority:** Begin with a technical runner over existing examples and fixtures, comparable inputs and configuration versions, objective completion checks, latency, cost and artifact/regression reports. Keep business-specific rubrics and a comparison UI as later decisions. PRD-13 owns live product outcome records.

### EX-05 Publish reusable agent action and recovery fixtures

**Rank:** 33 · **Impact:** 3/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** Partial — Reusable fixtures for already-defined recovery contracts can extend the existing test infrastructure. Future action semantics and a standalone public package/API require decisions before extraction.

- **Description:** Build on EX-04 with disposable examples for a lost tool response, duplicate trigger, stale approval, revoked connection, stale memory and false completion. Consider an independently usable open-source test kit once the cases and consumers are established.
- **Rationale/benefit:** Gives builders reproducible failure cases that test behavior across supported harnesses.
- **Strategic benefit:** Makes the already Apache-2.0 product useful as a distribution and credibility asset without starting another generic harness SDK or premature standard.
- **Current state:** Existing native/API fixtures cover several recovery boundaries; no standalone public action/recovery kit is packaged.
- **Completion/dependencies:** Reuse current test infrastructure and supported contracts first. Cover future approval/outcome semantics only after PRD-11/PRD-13 define them. Separate internal reusable fixtures from a public package/API commitment; validate independent use across at least two harnesses before extraction. No paid execution or live mutations in default fixtures.

## Docs

### DOC-01 Explain customer state and agent identity

**Rank:** 1 · **Impact:** 5/5 · **Difficulty:** 1/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Add a developer guide mapping customer, preset, workspace/worktree, session, run and ongoing task. Show when to continue a session versus start another over the same files.
- **Rationale/benefit:** Removes ambiguity before developers design their application.
- **Strategic benefit:** Makes the independent worktree benefit concrete without claiming exclusive persistent agents.
- **Current state:** The published [customer-agent guide](../features/customer-agents/README.md) maps application customers, named agents, presets, workspaces/worktrees, sessions, runs and tasks. It includes setup, handoff, ownership, recovery, lifecycle and a copyable AI brief.
- **Completion/dependencies:** Done September 11. Linked to the runnable reference app, optional memory and exact API/SDK contracts; published HTML/Markdown/search and copied onboarding journeys pass.

### DOC-02 Create task-specific integration briefs

**Rank:** 24 · **Impact:** 3/5 · **Difficulty:** 2/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Briefs can be drafted independently from existing guides, but selecting the workflow, expected result and wording is communication work rather than a purely technical implementation.

- **Description:** Derive copyable briefs for embedding a run viewer, streaming tools, recovering a dropped connection, continuing a session and reading files from the canonical API/SDK guides.
- **Rationale/benefit:** Reduces integration errors without requiring another docs service.
- **Strategic benefit:** Adopts HarnessRouter’s AI-assisted onboarding convenience.
- **Current state:** A canonical AI setup prompt, Markdown exports and five SDK guides already exist; avoid duplicating them.
- **Completion/dependencies:** Complete when briefs share current sources and work with ordinary docs too. Consider a distributed skill or docs MCP only if real retrieval friction remains.
- **Initial scope/priority:** Pair the first brief with EX-03 and a verifiable external result. Include current prerequisites and links for ownership, connections, memory limitations, recurring budgets, retention and recovery; keep exact contracts in their authoritative guides.

## Dashboard

### UX-01 Connect templates to scheduled work

**Rank:** 8 · **Impact:** 4/5 · **Difficulty:** 2/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Guide a saved weekly digest or assistant preset into the existing schedule form with workspace, timezone, cadence, connection and budget review.
- **Rationale/benefit:** Makes already-built recurring execution easier to discover and configure.
- **Strategic benefit:** Turns ongoing-work positioning into an immediate usable flow.
- **Current state:** Templates offer **Use and schedule**; saving a preset hands its ID, instructions and explicit per-run budget into [schedule setup](../features/triggers/scheduled-tasks.md). Workspace, cadence, timezone and current tool access are reviewed before enabling; advanced delivery limits stay collapsed.
- **Completion/dependencies:** Done September 11. Browser acceptance verifies the weekly handoff, persisted budget and review, alongside existing create/edit/pause/history flows. Shared stacked/paired forms keep the review readable. Setup itself makes no paid run or implicit tool grant.

### UX-02 Make onboarding resumable and show integration success

**Rank:** 11 · **Impact:** 4/5 · **Difficulty:** 3/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** Partial — Persisting already-defined progress and instrumenting existing completion events are routine. Choosing steps, skip/reset behavior, the guided publishing journey and presentation needs UX definition.

- **Description:** Persist meaningful setup progress, support skip/reset, and correlate a customer application’s first authorized request/result with the onboarding checklist.
- **Rationale/benefit:** Helps users finish setup across devices and distinguish a configured account from a working application integration.
- **Strategic benefit:** Matches HarnessRouter’s short path to an embedded product.
- **Current state:** Home has an API-backed readiness checklist and copyable briefs; dedicated resumable onboarding and correlated external-app completion are not packaged.
- **Completion/dependencies:** Complete with observable completion and no unrelated repository inspection, secret capture or fabricated success; keep a free fixture path.
- **Initial scope/priority:** Start with a verified external result for the chosen recipe. A guided path from a working manual routine can package reviewed instructions/files, required connections, cadence and budget through existing resources; keep credential setup explicit.

### UX-03 Add a notification center

**Rank:** 19 · **Impact:** 4/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Attention priorities, notification preferences, approval interactions and embeddable surfaces need experience design; backend action semantics belong to PRD-11.

- **Description:** Collect required-input, failed-run, expiring-connection, budget and invitation events with preferences and delivery state.
- **Rationale/benefit:** Makes background customer-agent work visible and actionable.
- **Strategic benefit:** Supports ongoing agents that do useful work outside chat.
- **Current state:** Run events, outgoing webhooks and invitation flows exist separately; there is no unified notification center.
- **Completion/dependencies:** Complete with authorized event views, preferences and deduplication; distinguish inbox state from external delivery.
- **Initial scope/priority:** Prioritize an attention queue for customer work, with API access and a small embeddable experience after its interaction contract is defined. Show evidence and proposed actions from PRD-11 alongside failures, connection repair and budget attention; retain invitations and delivery preferences in the broader scope.

### UX-04 Improve API-key lifecycle UX

**Rank:** 29 · **Impact:** 3/5 · **Difficulty:** 3/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — The lifecycle presentation and any new expiry/rotation policy require UX and credential-lifecycle choices.

- **Description:** Add clear scope previews, useful last-used attribution, optional expiry policy and guided rotation where the contract supports it.
- **Rationale/benefit:** Makes machine access easier to understand and revoke.
- **Strategic benefit:** General usability; not a HarnessRouter-specific differentiation.
- **Current state:** Scoped keys exist; a complete guided lifecycle experience is not described by the current dashboard.
- **Completion/dependencies:** Complete after checking existing fields to avoid reimplementing controls; rotating a key must not silently retarget unrelated connections.
- **Initial scope/priority:** Improve rotation, expiry and usage visibility for persistent integrations, retaining the server-side authority model.

### UX-05 Add global authorized resource search

**Rank:** 40 · **Impact:** 3/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Searchable content, results/ranking and command-menu behavior need UX and scope definition.

- **Description:** Search workspaces, runs, presets and connections from the command menu with server-side scope enforcement.
- **Rationale/benefit:** Helps users navigate growing accounts.
- **Strategic benefit:** Supports larger customer fleets; competitors can offer the same convenience.
- **Current state:** Workspace/example/catalog search exists; the command menu is navigation-oriented.
- **Completion/dependencies:** Complete with scoped results and useful deep links; do not expose prompts or customer content through broad search by default.
- **Initial scope/priority:** Wait until resource volume or a real fleet makes navigation a meaningful obstacle.

### UX-06 Improve privacy and data controls

**Rank:** 27 · **Impact:** 3/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Retention/export/deletion choices and their presentation involve product and policy decisions; reuse existing guarantees wherever they already settle the behavior.

- **Description:** Explain and expose supported retention, export and deletion choices with precise scope, previews and consequences.
- **Rationale/benefit:** Makes customer data ownership understandable.
- **Strategic benefit:** Reinforces persistent customer information as a managed resource.
- **Current state:** Checkpoint exports, retention and workspace deletion exist; account closure remains operator-assisted.
- **Completion/dependencies:** Complete with coordinated subscription/ownership/revocation handling where relevant. Do not promise erase-everywhere or delete retained financial records improperly; coordinate with PRD-07.
- **Initial scope/priority:** Prioritize precise customer ownership and lifecycle explanations. Existing minimum privacy/retention and release obligations remain prerequisites regardless of this improvement rank.

### UX-07 Add service-account administration

**Rank:** 31 · **Impact:** 3/5 · **Difficulty:** 5/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Machine identity ownership, roles and revocation semantics require identity/product decisions.

- **Description:** Provide a dedicated machine identity lifecycle, ownership, credentials and revocation UI/API.
- **Rationale/benefit:** Separates durable application integrations from an individual human’s account lifecycle.
- **Strategic benefit:** Useful for enterprise integrations and fleets.
- **Current state:** API keys and existing principal scopes exist; a dedicated service-account administration product is not packaged.
- **Completion/dependencies:** Complete with explicit owner/role semantics and auditable revocation; preserve existing identity boundaries.
- **Initial scope/priority:** Raise priority if a real application cannot operate safely under current ownership; define the non-personal principal lifecycle before implementing administration.

### UX-08 Extend team roles and groups

**Rank:** 39 · **Impact:** 3/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Roles, groups, effective access and enterprise identity requirements are product/security decisions.

- **Description:** Add custom roles/groups and understandable workspace permission summaries; evaluate enterprise SSO/SCIM only with concrete buyer requirements.
- **Rationale/benefit:** Supports larger teams without copying ad hoc grants.
- **Strategic benefit:** Enterprise fit, not proof that HarnessRouter lacks equivalent private features.
- **Current state:** Organization roles, invitations and scoped access already exist; custom roles/groups and enterprise SSO/SCIM are outside current scope.
- **Completion/dependencies:** Complete with reviewed effective-access previews and server enforcement. Avoid adding every enterprise feature before demand.
- **Initial scope/priority:** Tie custom roles and enterprise identity features to actual buyer requirements.

### UX-09 Build the hosted account assistant with reviewable actions

**Rank:** 42 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Staging implemented · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Assistant scope, permitted actions, review and customer communication require product/architecture design.

- **Description:** Replace the labeled local preview with authorized account reads and limited typed actions for presets, grants and schedules. Show proposed consequential changes, cost, progress and history.
- **Rationale/benefit:** Provides contextual help and useful setup assistance.
- **Strategic benefit:** Onboarding convenience; separate from downstream customers’ personal agents.
- **Current state:** Ask Macrofold is deterministic local UI guidance; it performs no account inspection, inference or changes.
- **Completion/dependencies:** Complete using existing runs/broker with current authority, cancellation and appropriate action confirmation. No operator infrastructure mutations through management MCP.
- **Initial scope/priority:** Keep the current preview labeled accurately while the core customer job is validated; a hosted account assistant is a separate experience investment.
- **Acceptance note:** The existing staging-implementation status is retained. The current dashboard guide and description above still document a local preview; reconcile that evidence before advertising a hosted assistant or treating its broader action scope as complete.

### UX-10 Offer a contextual support handoff

**Rank:** 37 · **Impact:** 2/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Consent, diagnostic content, support destination and retention/delivery behavior need experience and operating decisions.

- **Description:** Let users choose a diagnostic report/run reference and explicitly send it to a configured support destination with redaction and delivery state.
- **Rationale/benefit:** Reduces support back-and-forth.
- **Strategic benefit:** General support quality; no unique competitive claim.
- **Current state:** Help links and copied guidance exist; the account assistant does not contact support.
- **Completion/dependencies:** Complete with consent, destination setup, retention and delivery status; never infer authorization to send from opening the assistant.
- **Initial scope/priority:** Founder-led pilot support can precede a dedicated feature; automate only the repeated consented diagnostic handoff.

## Marketing site

### MKT-01 Present customer information as the lasting resource

**Rank:** 3 · **Impact:** 5/5 · **Difficulty:** 2/10 · **Status:** Done · **Added:** 2026-09-10 · **Owner:** Unassigned

- **Description:** Use the selected value propositions with a concrete story: one customer worktree, different conversations and specialist agents, scheduled maintenance, then a visible updated result.
- **Rationale/benefit:** Explains why a buyer wants persistent worktrees rather than another harness list.
- **Strategic benefit:** Directly communicates the preferred market angle; persistent agents alone are not unique.
- **Current state:** The [landing-page story](../../apps/web/components/landing/customer-story.tsx) follows Alice and Milo through saved preferences, a specialist conversation, scheduled follow-up and an updated weekly plan. It identifies optional file conventions and separate native histories.
- **Completion/dependencies:** Done September 11. Existing visual direction is preserved; desktop/mobile review and landing browser regressions pass. The guide and reference app provide the implementation path.

### MKT-02 Evaluate exported motion or video only when resumed

**Rank:** 47 · **Impact:** 2/5 · **Difficulty:** 5/10 · **Status:** Deferred — user preference · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Remains deferred by user preference; resuming involves visual, playback and publication choices.

- **Description:** Compare the selected live visual direction with exported motion for loading, playback, alpha support and reduced motion; preserve existing studies.
- **Rationale/benefit:** May improve presentation if it earns its loading and production cost.
- **Strategic benefit:** Marketing polish, lower priority than a clear product story and working example.
- **Current state:** Many Swarm studies and a final site exist. Video was explicitly deferred by the user.
- **Completion/dependencies:** Remain deferred until requested; device/publication acceptance stays in maintainer TODO.
- **Initial scope/priority:** Preserve the existing user deferral. MKT-03's factual workflow evidence does not reopen abstract motion/video work.

### MKT-03 Lead the launch story with a demonstrated customer workflow

**Rank:** 16 · **Impact:** 5/5 · **Difficulty:** 3/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** No — Buyer, workflow story, claims, copy and CTAs are marketing/product decisions, even when drafts and evidence can be prepared independently.

- **Description:** Test an outcome-led homepage, a real recurring-investigation timeline, a clear example CTA and a concrete workload cost explanation. Retain the existing visual identity and the native-harness execution message on the appropriate developer page. Candidate copy and page structure live in the [strategy proposal](strategy-2026-09.md#marketing-documentation-and-customer-experience).
- **Rationale/benefit:** Helps a builder recognize a useful customer feature and see how to try it.
- **Strategic benefit:** Connects discovery to the working EX-03 recipe and UX-02 integration result. Expand distribution through runnable examples, accurate coding-agent briefs and relevant partners based on BIZ-03 evidence.
- **Current state:** MKT-01's customer-information story is implemented; the selected hero and site design remain current. No new copy, public comparison or launch campaign has been accepted or published by this proposal.
- **Completion/dependencies:** Choose the buyer, demonstrated workflow, copy and CTA; verify every advertised hosted capability. Do not advertise future approval/verified-outcome behavior as shipped or claim competitors lack documented capabilities. Coordinate with BIZ-01/DOC-02; retain MKT-02's separate deferral. Outreach and public posting need their own authorization.

## Architecture

### ARC-01 Reuse warm execution environments safely

**Rank:** 36 · **Impact:** 5/5 · **Difficulty:** 7/10 · **Status:** Partially implemented · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Reuse eligibility, lifecycle, isolation and cost policy require architecture tradeoffs informed by measurements.

- **Description:** Keep eligible idle sandboxes briefly and skip restore only when their contents match the authoritative worktree/session revision. Refresh credentials, runtime capability and permission policy for each run.
- **Rationale/benefit:** Reduces repeated provisioning/hydration latency, especially for large interactive worktrees.
- **Strategic benefit:** Adopts HarnessRouter’s warm checkpoint probe; improves personal-agent responsiveness.
- **Current state:** [Reusable sandboxes](../features/execution/workers.md) now retain Vercel/Docker compute or create long-running Docker workers locally or Render services when hosted, with lifecycle actions, idle expiry, worktree affinity and separate compute accounting. Files/session state and credentials are restored for each run; native process reuse and hydration elision remain deferred. Independent checkpoints remain authoritative. Live deployment acceptance is still required.
- **Completion/dependencies:** Complete with bounded idle lifetime/cost, eviction, revision matching, single-writer ownership and permission-change behavior. A warm machine is a cache, never the only durable copy. Compare benefit to operational complexity before broad rollout.
- **Initial scope/priority:** Measure the implemented machine-reuse path before introducing native process reuse or skipping verified hydration.

### ARC-02 Add a bounded Responses compatibility facade

**Rank:** 38 · **Impact:** 4/5 · **Difficulty:** 6/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Choose the supported compatibility subset and explicit semantic limits for a real client need before implementation.

- **Description:** Translate a documented Responses-compatible subset into existing admission/runs/events, with server-side harness/worktree mapping. Preserve the richer resource API.
- **Rationale/benefit:** Lets existing clients reuse SDK calls, text streaming and response handling.
- **Strategic benefit:** Matches HarnessRouter’s familiar invocation surface; lowers switching effort.
- **Current state:** Macrofold has REST plus five SDKs, but no public Responses-compatible invocation endpoint. Its internal model gateway serves a different audience.
- **Completion/dependencies:** Complete for text, streamed events, continuation, errors, cancellation and supported file semantics with explicit unsupported fields. Reuse policy owners; long jobs need recovery rather than fragile open HTTP requests. See the comparison’s compatibility example.
- **Initial scope/priority:** Proceed for a concrete blocked client integration, not API resemblance alone; preserve truthful native continuation and file semantics.

### ARC-03 Evaluate durable orchestration alternatives when coordination requires them

**Rank:** 46 · **Impact:** 3/5 · **Difficulty:** 8/10 · **Status:** Deferred — conditional evaluation · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — This is an explicitly conditional architecture evaluation, not routine implementation or an approved migration.

- **Description:** Compare current Workflow/SQL ownership with Temporal before building major delegation trees, multi-day approvals, long-lived coordinators or worker-version rollouts. Identify which state actually moves.
- **Rationale/benefit:** Could replace custom coordination machinery when the product needs it.
- **Strategic benefit:** Enables future fleet coordination; migration itself is not a differentiator.
- **Current state:** Workflow 4.8.5 and the SQL poller already support bounded execution/history handoff. No Temporal prototype or migration exists.
- **Completion/dependencies:** Conditional evaluation, not an approved migration. Preserve native execution identity, grants, reservations and independent checkpoints. Read the orchestration comparison; exercise parent cancellation, ambiguous effects, approval resume, history, placement and total cost.
- **Initial scope/priority:** Keep migration deferred. Evaluate fit during PRD-04 design before substantial multi-day coordination machinery; evaluation does not authorize a migration or block ordinary independent runs.

## Business and operations

### BIZ-01 Model pricing and improve cost explanation

**Rank:** 14 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** No — Customer prices, packaging, estimates, spending-limit presentation and billing communication require product/business choices; routine internal analysis is BIZ-02.

- **Description:** Define understandable customer-facing prices, estimates, cost breakdowns, spending limits, customer/workspace/key attribution and date comparisons. Explain elapsed execution versus active work and waiting, cache token treatment, storage and other billable components; review subscription fees versus included credits using BIZ-02's internal analysis.
- **Rationale/benefit:** Makes bills, estimates and plan selection understandable. Internal serving costs and contribution margin belong to BIZ-02; they are not customer-facing product metrics.
- **Strategic benefit:** Responds to HarnessRouter’s included-spend pricing without assuming its internal costs or blindly matching rates.
- **Current state:** Macrofold has reservations, rates, usage and operator reporting; its elapsed-time compute and cache pricing differ from HarnessRouter’s advertised active-work pricing.
- **Completion/dependencies:** Use BIZ-02's representative scenarios and sensitivity analysis to choose a pricing policy and customer communication. No price changes are authorized by this tracker. Invoice/usage exports and comparisons should reuse existing reporting; internal analysis does not complete this customer-facing proposal.

### BIZ-02 Measure internal serving costs and contribution margin

**Rank:** 13 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** Yes — Internal calculations, attribution and sensitivity reports use existing data/contracts and explicit assumptions. This does not choose prices, create customer-facing margin displays or authorize new paid probes.

- **Description:** Build an internal workload cost model and attribution report from existing billing/provider data. Separate customer charges from actual serving costs: inference including cache reads/writes, elapsed/active/waiting compute, idle capacity, storage, orchestration, connectors and support. State assumptions and sensitivity ranges where measurements are unavailable.
- **Rationale/benefit:** Establishes whether existing prices cover operation and support, and which workloads need efficiency improvements.
- **Strategic benefit:** Informs sustainable recurring-agent economics and comparisons without confusing competitor billing units with internal costs.
- **Current state:** Reservations, rates, usage and operator reporting provide inputs; a reconciled workload/contribution-margin analysis is not packaged. This extracts the internal financial-analysis portion of BIZ-01.
- **Completion/dependencies:** Reuse current data/reporting and retain unknown costs as explicit assumptions. Report revenue, serving cost and contribution separately; keep raw customer content and credentials out of general analytics and checked-in fixtures. Internal margin is not a customer-facing feature. Pricing changes, customer dashboards and new provider probes are outside this routine scope; live spending follows existing authorization.

### BIZ-03 Validate the recurring customer workflow with paid pilots

**Rank:** 15 · **Impact:** 5/5 · **Difficulty:** 4/10 · **Status:** Proposed · **Added:** 2026-09-18 · **Owner:** Unassigned

**Routine implementation choices:** No — Choosing pilot customers, offer, outreach, spending and continuation criteria involves business decisions and authorized external communication.

- **Description:** Test a focused SaaS-builder segment and one recurring exception workflow over a six-to-eight-week validation period. Prefer builders with a useful manual native-harness routine; measure external deployment, repeated useful results, payment, customer expansion, review burden and support effort.
- **Rationale/benefit:** Resolves willingness to pay and repeatability before adding more horizontal platform scope.
- **Strategic benefit:** Tests the one-builder-to-many-customers growth path and gives evidence for continuing, narrowing or choosing a vertical application.
- **Current state:** The product is pre-launch with no real production customer population. The [strategy report](strategy-2026-09.md#validation-plan-and-business-model) proposes five deploying organizations, three paying/retained organizations and two expansions as candidate continuation gates, not achieved results or settled commercial commitments.
- **Completion/dependencies:** Choose the buyer/workflow, pilot offer, budget, success criteria and outreach. Complete the relevant hosted release gates before exposing the pilot. Track retention and accepted outcomes rather than impressions; do not promise engineering dates from the validation window. Customer contact and commercial commitments require explicit authorization.

### OPS-01 Automate staged releases and controlled promotion

**Rank:** 30 · **Impact:** 3/5 · **Difficulty:** 7/10 · **Status:** Staging implemented; activation pending · **Added:** 2026-09-10 · **Owner:** Unassigned

**Routine implementation choices:** Partial — Checks and wiring under the documented staging-release contract can use existing decisions. Activation remains pending; new production promotion/rollback behavior requires separate operational definition.

- **Description:** Implement an immutable-source release pipeline with serialized staging acceptance, image publication, compatible migrations, readiness checks, promotion and rollback records.
- **Rationale/benefit:** Reduces repeated operator release work while preserving running executions.
- **Strategic benefit:** Operational benefit; not an exclusive HarnessRouter gap.
- **Current state:** The [staging workflow](../operations/staging-releases.md) implements exact-SHA verification, native/image checks, migrations, readiness, serialized promotion and sanitized receipts. It stays disabled while staging is paused. Production automation is deferred.
- **Completion/dependencies:** Configure environment-scoped credentials and accept the hosted failure/release cases in maintainer TODO before advertising automatic deploys. Production remains the separate reviewed deployment procedure.
- **Initial scope/priority:** Preserve implemented staging automation and its paused state. Complete its documented activation/acceptance work when authorized; production automation remains deferred. Source-matched releases and required hosted acceptance remain release gates.

## Source and implementation references

- [September 2026 strategy research](strategy-2026-09.md): current landscape, workflow and TypeSafe experiments, launch messaging, distribution and validation rationale. This tracker owns the resulting priority, scope and routine-implementation classification.

- HarnessRouter comparison (`../../output/competitor-research/harnessrouter-comparison.md`, local historical evidence not included in this repository): screenshots, public code, pricing, memory, API adoption and resource-model findings. INT-01–INT-07, EX-01/02/04, ARC-01/02 and the customer-agent proposals draw on this research; shared ideas are not claimed as unique.
- [Workflow and Temporal evaluation](../architecture/orchestration-evaluation.md): preserves the September 9 technical comparison, sources and evaluation criteria underlying ARC-03 and PRD-04/05/10.
- [Dashboard guide](../features/dashboard/README.md): current onboarding/templates/assistant-preview behavior; dashboard proposals formerly lived in dashboard-future-features.md. EX-03, DOC-02 and UX-01–UX-10 preserve those suggestions, including reviewable actions and configuration revision views.
- [Connector setup](../features/identity-integrations/composio.md), [catalog behavior](../features/identity-integrations/connectors.md), [model policy](../../packages/core/src/model-policy.ts), [memory adapter](../../packages/runtime/src/hermes-bridge.py), [run admission](../../packages/core/src/runs.ts), [trigger quota](../../packages/core/src/triggers.ts), [runtime](../features/execution/runtime.md), [schedules](../features/triggers/scheduled-tasks.md).
- [Release TODO](../maintainers/TODO.md): OPS-01 implementation gates and existing release/operational work. Broader already-deferred scope such as arbitrary runtime images, multi-region writes and other Git hosts remains in the [product boundary](README.md); it is not newly recommended by this research.

## Completed documentation work

| ID     | Description                                            | Rationale and strategic benefit                                                               | Difficulty | Added      | Status | Result                                                                                                                                                           |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOC-03 | Explain per-toolkit Composio enablement                | Prevents catalog availability being mistaken for ready customer connections; clarifies INT-01 | 1/10       | 2026-09-10 | Done   | [Setup guide](../features/identity-integrations/composio.md) now describes auth-config/version mappings and the enabling sequence. No connectors were enabled.   |
| DOC-04 | Refresh competition research and consolidate proposals | Preserves accurate positioning and one ranked implementation tracker                          | 2/10       | 2026-09-10 | Done   | Updated comparison, migrated proposal lists, retained orchestration research and linked the tracker from parent documents. No product features were implemented. |
