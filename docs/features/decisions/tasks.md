# Bounded agents and decision tasks

Start with [one inference](README.md). Add a bounded agent when the model needs to inspect granted evidence; add a task when your application needs several runs separated by waits and review.

## A finite evidence investigation

Use `client.inferences.createBoundedAgentRun` with the inference envelope and a definition whose `question` is `{ kind: 'json' }`. Add:

```ts
bounded_agent: {
  max_model_calls: 3,
  max_tool_calls: 1,
  context_artifacts: [reference],
}
```

The selected generative model can invoke `read_context` for one of those exact immutable snapshot references or finish with a value matching your output schema. Every reference must share the initial audience. The broker rechecks current access before reading, commits its evidence receipt, and rechecks access before later provider calls. A tool result cannot add grants or choose a URL. Read evidence must satisfy the definition's completeness/snapshot policy and not conflict with existing dependency tokens.

Model/tool call counts, aggregate output tokens, wall time and total spend are finite. Completed steps survive worker restart. An uncertain model call stops the run without automatic replay. There is no shell, evaluated JavaScript, native SDK, shared customer directory, remote MCP or arbitrary connector execution in this bounded executor. Use native isolated agents for those operations. Adding a brokered tool requires a trusted implementation and explicit authorization mapping; a remote server's “read-only” label is insufficient.

## One sequential task recipe

Tasks compose existing runs; they do not reserve wallet funds twice. Create a task with a pinned inline decision step, optional investigation, an exact condition value, a cumulative ceiling, a run-count bound, and a bounded evidence horizon:

```ts
const task = await client.tasks.createDecision({
  workspace_id: workspaceId,
  objective: 'Review customer exceptions and propose repairs',
  decide: { definition: decisionDefinition, model_binding },
  investigate: { definition: investigationDefinition, model_binding },
  investigate_when: 'investigate',
  max_cost_micro_usd: '100000',
  max_runs: 4,
  evidence_horizon_seconds: 3600,
});
const active = await client.tasks.wakeDecision(task.id, {
  event_id: 'case-42:revision-7',
  input,
  context,
});
```

The task starts waiting. An application observation wakes one decision run. If its validated value exactly matches `investigate_when`, the coordinator admits one bounded investigation. Otherwise the decision itself becomes the proposal. The investigation receives the original evidence plus a provenance-labelled decision record. These are explicit sequential branches, not a DAG language or arbitrary durable function.

Supply stable event IDs and the same body on duplicate delivery. Repeated events return the existing lineage, even after their original evidence expires or is released; changed evidence with the same event ID conflicts. Only the creating workspace-bound application key can wake the task or report domain outcomes. Each child rechecks current authority and admission constraints. Expired tasks require a new task with fresh evidence.

## Review the proposal

`tasks.getDecision(task.id)` returns status, next step, child run IDs, committed cost, outstanding allocations, and `proposal_artifact_id`. Inspect child results with `runs.getResult`; download the published proposal through `artifacts.download`. The dashboard's run view shows decision receipts, task lineage, spending totals and recorded application outcomes.

A proposal is structurally validated and independently retained. It does not claim that a repair was applied or a business outcome was verified. Your application performs its own atomic dependency checks and authorized action, then reports a separate receipt:

```ts
await client.tasks.recordOutcome(task.id, {
  event_id: 'case-42:review-7',
  wake_id: active.latest_wake_id!,
  outcome: 'rejected', // accepted | rejected | unknown
  evidence: { reason: 'Case changed after observation', current_revision: '8' },
});
```

Use the current wake ID from the proposed cycle. An outcome returns the task to waiting, releases cycle evidence, and leaves provider receipts unchanged. Recipe evidence remains pinned until closure or expiry. The published proposal remains independently owned until explicitly released. “Accepted” is the application's assertion, not Macrofold verification of an external effect.

## Budgets, waits and closure

Before each child is admitted, committed cost plus outstanding child allocations plus the new ceiling must fit the task ceiling. Committed amounts use each run's consumed budget, including provisional liability and BYOK cost estimates; inspect run/customer usage for actual Macrofold charges. Unknown usage continues to consume allowance. Cancellation alone does not release a financial allocation: the coordinator waits for committed run settlement.

Waiting and review use no run capacity. Existing maintenance wakes the coordinator; no low-latency scheduling guarantee is implied. Native and lightweight jobs share organization/global caps. Operators can reserve a bounded number of organization slots for lightweight work and set a separate global lightweight ceiling, without increasing plan limits or preempting native runs.

`tasks.closeDecision(task.id)` requests closure, cancels active children, waits for settlement, then releases evidence pins. The evidence horizon closes unfinished tasks through the same path. Task run/receipt identifiers remain for accounting and audit; workspace purge removes detailed content. There is no automatic fallback model, repeated uncertain child, external effect, or unlimited background loop.
