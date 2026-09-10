# Future architecture improvements

This document records options for future product capabilities. It does not change the [accepted architecture](decisions.md), commit to a migration, or establish deployed acceptance. The current [architecture overview](README.md) and [release TODO](../maintainers/TODO.md) remain authoritative for implemented behavior and launch work.

## Durable orchestration: Vercel Workflow and Temporal

Vercel Workflow and Temporal both provide durable execution through recorded history, replay, retries, timers, and external events. Workflow SDK is an independent implementation with a simpler TypeScript authoring surface, not a Temporal wrapper. Temporal supplies a broader set of coordination and operating primitives. The useful comparison for Macrofold is how much orchestration the platform owns versus how much application code must supply.

### Current ownership

Macrofold uses Workflow SDK 4.8.5 on Vercel, with an alternative standalone PostgreSQL poller. PostgreSQL owns accepted runs, queue admission, execution phases, pending input, leases, financial reservations, and customer history. Workflow entrypoints advance bounded domain steps; native harnesses execute in separate sandboxes. R2 holds independent encrypted file checkpoints. See [portability](portability.md) and [execution scheduling](../features/execution/scheduling.md).

The current implementation already addresses workflow-history growth: after 128 phase advances it hands off through the SQL outbox, preserving the same product run, execution identity, and reservation. Generation fencing prevents an obsolete invocation from advancing a successor's execution. This is a meaningful maintenance cost when comparing the complete systems, even though the Workflow SDK interface is small. The [history design](../features/execution/workflow-history.md) owns the bounds and verification evidence.

### Likely product needs

The distinctions below separate missing native primitives from product features that remain possible with application code. A more capable engine does not automatically deliver the corresponding Macrofold feature.

| Future Macrofold capability | Vercel Workflow | Temporal | Decision significance |
| --- | --- | --- | --- |
| Wait days for human approval, then resume | Durable sleeps and hooks support external approval events. | Timers and workflow messages support the same outcome. | Both are capable. Macrofold currently counts input waits against the execution window and active slot; releasing compute and resuming later needs explicit lifecycle, checkpoint, grant, and budget policy with either engine. |
| Coordinate a team of agents | Workflows can start other workflows; group ownership, result aggregation, and cancellation behavior need explicit design. | Child workflows provide parent-close policies and lifecycle tracking, including a child's continuation chain. | A strong reason to evaluate Temporal before building substantial custom delegation and coordinated recovery. Simple parallel runs alone are insufficient justification. |
| Steer a persistent agent while it runs | Hooks deliver messages; application APIs and stored state can provide acknowledgements and results. Manual webhook responses also support request/response flows. | Signals, Queries, and Updates distinguish asynchronous commands, state reads, and tracked commands returning a result or error. | Temporal gives more structure to “change this plan and tell me whether the change was accepted.” Vercel can implement the product behavior with more application protocol. |
| Keep a busy coordinator alive indefinitely | Chain bounded runs and transfer state; Macrofold currently uses its SQL outbox for this. | Continue-As-New retains the Workflow ID with a fresh Run ID and history. | Temporal could replace some orchestration handoff machinery. Neither engine offers unlimited history in one execution. |
| Offer richer recurring agents | Cron or durable sleeps initiate work; overlap, catch-up, and backfill policy require application design. | Schedules include overlap policies, catch-up windows, backfills, and pause-on-failure. | Useful for hourly agents that keep one pending invocation or intentionally recover missed periods. Every start still needs Macrofold authorization and budget admission. |
| Deploy fixes while coordinators span many releases | Hosted runs remain attached to their original deployment. Explicit new-run boundaries can pick up new code. | Worker versioning supports pinning, controlled upgrades, and gradual rollout; upgraded workflows must remain replay-safe. | Vercel's default is straightforward; Temporal offers more control over a long-lived workflow fleet. |

These capabilities are described in the [Vercel approval guide](https://vercel.com/kb/guide/human-in-the-loop-with-chat-sdk-and-workflow-sdk), [Workflow migration patterns](https://github.com/vercel/workflow/blob/main/skills/migrating-to-workflow-sdk/references/shared-patterns.md), [Temporal child workflows](https://docs.temporal.io/child-workflows), [message passing](https://docs.temporal.io/encyclopedia/workflow-message-passing), [Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new), [Schedules](https://docs.temporal.io/schedule), [Vercel deployment versioning](https://workflow-sdk.dev/worlds/vercel), and [Temporal worker versioning](https://docs.temporal.io/worker-versioning).

### Execution constraints and operating tradeoffs

**Individual operations.** Hosted Vercel steps inherit Function runtime limits. Temporal activities execute on application workers and can use heartbeats for failure detection and progress checkpoints, allowing long transfers or specialized processing outside a Function's lifetime. Macrofold already runs native agents outside Functions; replacing the scheduler would not itself lengthen sandbox lifetime or preserve live process memory. See [Vercel limits](https://vercel.com/docs/workflows/pricing) and [Temporal activity failure detection](https://docs.temporal.io/encyclopedia/detecting-activity-failures).

**History and payloads.** Vercel documents 25,000 events and 10,000 steps per run, with slower replay above 2,000 events, and a 50 MB payload limit. Temporal Cloud documents a 51,200-event or 50 MB history ceiling and a 2 MB request payload limit. Its continuation primitive is more significant than the larger event allowance; event accounting differs between engines. Vercel's larger payload allowance helps some multimodal workloads, but Macrofold should continue passing references to independently stored artifacts. These are provider limits, not Macrofold product limits. See [Vercel limits](https://vercel.com/docs/workflows/pricing) and [Temporal Cloud limits](https://docs.temporal.io/cloud/limits).

**Infrastructure and cost.** Vercel integrates execution, queues, identity, deployment pinning, and observability with the existing application deployment. A conventional Temporal Cloud setup still requires operating application workers; self-hosting adds the Temporal service. Compare total cost across orchestration events/actions, storage, compute, queue traffic, database polling, and operational work. Macrofold's frequent phase polling makes a workload measurement more useful than comparing headline prices. No cost or latency benchmark between the engines has been performed. See [Vercel pricing](https://vercel.com/docs/workflows/pricing) and [Temporal worker operations](https://github.com/temporalio/documentation/blob/main/docs/best-practices/worker.mdx).

**Portability and placement.** Workflow SDK has a self-hosted PostgreSQL backend, while Macrofold already has its separate SQL poller. Portability alone does not require Temporal. The installed Workflow 4.x line uses Vercel's `iad1` backend; the documented regional capabilities in 5.x require an upgrade and acceptance before being treated as available here. Recheck region, residency, and worker-placement requirements when enterprise needs become concrete. See [PostgreSQL World](https://workflow-sdk.dev/worlds/postgres), [Vercel World](https://workflow-sdk.dev/worlds/vercel), and [Macrofold portability](portability.md).

### Safeguards that remain application responsibilities

Neither engine makes arbitrary external side effects exactly-once or resumes a crashed native agent at its last machine instruction. Temporal activities can execute again after a lost acknowledgement or worker failure. Preserve stable native launch identity, ambiguous-outcome recovery, sandbox isolation, verified file checkpoints, tenant authorization, credential selection, and financial reservations regardless of scheduler. See [Temporal activity execution](https://docs.temporal.io/activity-execution) and [Macrofold runtime](../features/execution/runtime.md).

Temporal could take ownership of more orchestration state, but replacing the current Workflow loop alone would retain most of the SQL coordinator and add another system. Any later design must identify exactly which state and recovery mechanisms move, while retaining one authoritative owner for each fact. Customer history, billing policy, and durable workspace contents must not become accidental dependencies on workflow-history retention.

### Recommendation and evaluation triggers

Retain Vercel Workflow for the current product: run a native agent, preserve its workspace, and schedule follow-up work. Evaluate Temporal before committing to a substantial coordinator for persistent agent teams, particularly when several of these become near-term requirements:

- Delegation trees need coordinated cancellation, partial-failure recovery, and durable result aggregation.
- Agents remain addressable across days of approvals and incoming instructions, spanning many releases.
- Customer schedules need explicit backfill, overlap, and outage-recovery controls.
- Long transfers or specialized worker placement make bounded Function steps an operational constraint.
- Maintaining SQL orchestration continuations and recovery costs more than operating a dedicated workflow platform.

A bounded evaluation should compare the existing design with a Temporal coordinator using disposable fixtures: fan out work, lose a launch acknowledgement, interrupt persistence, cancel a parent, resume an approval after replacing compute, and deploy a new coordinator version. Measure duplicate-side-effect prevention, reservation settlement, persisted-file integrity, recovery latency, history growth, and total operating cost. Paid cloud execution requires a separate approved budget. Record an accepted architecture decision only after that evidence; this proposal authorizes no implementation or migration.

## Source currency

The comparison uses official vendor documentation consulted on 2026-09-09 and the repository's pinned Workflow 4.8.5 design. Vendor capabilities, limits, pricing, and release maturity can change. Recheck them before evaluation; newer SDK documentation does not establish support in the installed version. No Temporal prototype or comparative live acceptance is included.
