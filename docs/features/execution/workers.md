# Workers: choose economics, let Macrofold place the work

> **Target API guide, not yet enabled.** This accompanies the Worker implementation work. The policy code in the earlier download is not committed to this branch and does not add these HTTP endpoints. Until the cutover is complete, [sandboxes](sandboxes.md) remain the implemented interface. [Implementation status](workers/implementation.md) states the exact tested scope.

A Worker is an optional reusable execution target. Set the kind of compute you want, whether capacity is exclusive, how much your Runs must be isolated, and a spending ceiling. Macrofold can choose machine sizes and scale behind the same Worker ID. Your files and conversations remain independent of those machines.

Ordinary Run callers do not need to create a Worker. Explicit Worker selection is useful when cost, sustained traffic, region, or sharing behavior matters.

## Dedicated server capacity for sustained traffic

The intended request is:

```http
POST /v1/workers
```

```json
{
  "name": "openlegend",
  "compute": "server",
  "dedicated": true,
  "isolate_runs": false,
  "min_instances": 1,
  "max_instances": 4,
  "max_hourly_compute_cost_micro_usd": "1000000"
}
```

This asks for server-backed prices, a paid baseline allocation, and automatic expansion within the ceiling. It does not require choosing a machine size. The example cap is not a workload estimate or a price quote. Creation must fail if the advertised baseline cannot fit the cap or your plan.

`dedicated` means your Worker has exclusive capacity. `isolate_runs: false` permits trusted sharing between your Runs; it does not expose your data to other customers. Even trusted Runs retain separate execution ownership and cancellation. Use the stronger offered isolation mode for mutually untrusted agents or customer workloads.

Use `max_instances: 1` to request a fixed one-allocation upper bound. Add `size` only when you want to fix the shape instead of letting Macrofold choose from compatible offerings.

## Pooled compute for usage-based sharing

When the pooled server offering is enabled, select `compute: "server"` with `dedicated: false`. You pay published resource rates, not the entire bill for whichever machine happened to receive your Run. Do not send `min_instances` or `max_instances`; you are not buying fleet machines.

Memory and CPU may be metered differently. Read the offered rate card: allocated memory is billable while reserved even if the model is waiting; measured active CPU is billable only for measured execution under that meter. Missing measurements are not zero usage. Explicit warm-memory retention must have disclosed billing; automatic best-effort platform caching must not create a surprise charge.

If pooling or the chosen isolation is unavailable, the request fails. Macrofold does not silently change the economics to make it run.

## Sandbox compute for the on-demand offering

`compute: "sandbox"` selects the advertised sandbox offering and its meter. It does not promise the least expensive choice for every workload. Review available resource rates, startup behavior, and isolation guarantees before choosing.

Short bursts can reuse capacity until idle release. A provider machine lifetime does not change your Worker ID. Explicit customer expiration is a separate `expires_at` setting.

## Send a Run

Use the same working-context or Session selector as other native Runs and add `worker_id`:

```json
{
  "session_id": "019e1700-0000-7000-8000-000000000001",
  "prompt": "Take the next turn.",
  "worker_id": "019e1700-0000-7000-8000-000000000002"
}
```

A continuing Session already identifies its working context. Do not redundantly supply its Worktree. The IDs shown are illustrative; use the IDs returned by your deployment.

An explicit Worker request never spills to a different Worker, more expensive economic class, different region, or weaker isolation to bypass a capacity limit. It waits with a reason or fails at the requested queue deadline. Without `worker_id`, the advertised automatic execution mode applies; it does not seize your explicit Workers without permission.

## Spending and capacity

`max_hourly_compute_cost_micro_usd` is an aggregate **compute rate ceiling**, not a total job, daily, or model-token budget. Model/tool budgets remain separate. Starting, draining, and unconfirmed-stop allocations still consume committed capacity. Scaling stops when another compatible allocation would cross the ceiling.

Your plan can limit active Runs and resources. The Worker response must show effective limits; a higher requested concurrency is rejected rather than silently clipped. `max_concurrency` is a ceiling for the Worker, not a performance promise for every harness mix.

A resource-hungry individual Run must fit one allocation. Scaling to another machine helps with concurrency, not with moving a live process onto unlimited RAM. Unsafe OOM recovery never silently repeats a prompt with external effects.

## Pause, resume, and remove

```text
POST /v1/workers/{worker_id}/pause
POST /v1/workers/{worker_id}/resume
POST /v1/workers/{worker_id}/destroy
```

Pause accepts graceful intent: stop new admissions, finish current execution and cleanup, then release compute. The response acknowledges the operation; observed state may be `draining` until it finishes. Poll the Worker for completion.

Automatic idle sleep is different from manual pause. Traffic can wake an enabled sleeping Worker, but it cannot override a manual pause. Accepted queued work retains its deadline while paused. Resume is explicit. Destroy retires compute identity, not Worktree or Session data. Forced interruption, when supported, is an explicit operation and can lose unpublished changes.

## What persists

Files persist through verified Worktree checkpoints. Sessions persist through whatever the selected harness needs: a native ID, local history files, or both. A warm session is a live retained harness process, not the durable conversation itself. It can disappear on scale-down without deleting the last verified continuation state.

Installed dependencies not described by the selected versioned runtime or durable state are not promised to survive Host replacement. Do not use machine-local side effects as an undocumented database.

## Advanced usage and availability

The target catalog, `GET /v1/worker-offerings`, supplies supported combinations, runtime versions, resource shapes, rates, and plan bounds. Not every combination is enabled on every deployment. Public Worker access is separately authorized from files, sessions, tools, and lifecycle administration.

[Architecture](../../architecture/worker-execution.md) specifies the final ownership and consistency rules. [Implementation](workers/implementation.md) and [TODO](workers/TODO.md) distinguish local policy tests from the unfinished HTTP, SQL, autoscaler, provider, and SDK work.
