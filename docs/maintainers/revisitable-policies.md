# Policies to revisit

This register tracks accepted decisions likely to change, not unresolved choices or implementation tasks. The linked policy owns current requirements; summaries here are navigation. A review trigger does not expire a rule, increase permissions or authorize its replacement. Read relevant entries when changing the related policy or approaching its trigger, not on every development task.

## RP01 — Pre-launch compatibility

**Current policy:** [Root pre-launch instructions](../../AGENTS.md#temporary-notes-pre-launch). Avoid hypothetical customer compatibility layers while preserving developer work and durable state.

**Why revisit:** [Status](../status/README.md#remaining-launch-work) already records hosted deployment and operator acceptance, while the root still describes a never-deployed product. Hosting alone does not establish real customer runs; this discrepancy must not be resolved by guessing that fixtures may be discarded or that customer compatibility is required.

**Review trigger:** Before admitting real customer execution or promising cross-release API/data compatibility, reconcile the root wording with actual deployed usage and the support window. Keep existing preservation and security rules while that decision remains unresolved.

**Decision authority:** Maintainer/operator with deployment and customer-usage knowledge. Track the reconciliation in [central TODO](TODO.md#agent-guidance-acceptance).

## RP02 — Live-test authorization

**Current policy:** [Root spending boundary](../../AGENTS.md#non-negotiable-boundaries), [testing](../../TESTING.md) and [live acceptance](../engineering/testing/live-integrations.md). The existing per-test standing authorization remains; other paid work needs its explicit authorization and budget.

**Why revisit:** Provider pricing, repeated calls, uncertain commitments and compute lifetime can change a test's actual exposure.

**Review trigger:** A test no longer has a credible bound within its authorization, the account owner changes the allowance, or an intended multi-call workflow needs a separate aggregate budget. Do not split one experiment into nominal tests to manufacture spending authority.

**Decision authority:** Account owner. An installed credential, new turn, delegate or application spending cap creates no new allowance.

## RP03 — Reusable compute architecture

**Current policy:** [Implemented cost-controlled Workers](../architecture/decisions.md#cost-controlled-reusable-compute) and their [architecture](../architecture/worker-execution.md).

**Why revisit:** Public Workers are separate from internal Hosts and Worktree persistence. Hosted provider acceptance, cross-customer physical packing and the OpenLegend caller migration remain separate gates.

**Review trigger:** Any change to compute/run identity, scheduling, reservations or recovery, or to those remaining gates. Follow the existing acceptance work; do not reintroduce Worktree-owned compute or assume unaccepted hosted behavior.

**Decision authority:** Maintainer through the agreed architecture/migration scope. Current authorization, durable state and money safeguards survive the transition.

## Maintaining this register

Keep stable IDs, a canonical policy link, the reason to revisit, a concrete trigger and decision authority. Add only known revisitable decisions, not every constant or hypothetical concern. When a trigger is relevant, raise it in the task/PR; put resulting work or unresolved choices in their existing owners. An accepted change updates the policy, affected summaries and this entry together; significant decisions go in the owning document's bottom Changelog. Retire superseded entries with a link to their replacement or recorded decision, not another copy of the contract.
