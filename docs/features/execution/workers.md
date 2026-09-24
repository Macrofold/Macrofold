# Workers

A Worker is a reusable execution target with its own compute, scaling, isolation, and spending settings. Send independent Worktrees and Sessions to the same Worker; Macrofold places their Runs on available capacity and provisions more within your limits. Files and conversations do not belong to the Worker and survive its shutdown through their verified durable state.

Most applications can omit `worker_id` and use automatic execution. Create a Worker when you want explicit control over compute economics, reuse, concurrency, or baseline availability.

## Start with a Worker

Use your normal authenticated API connection. Inspect the available combinations and rates with `GET /v1/worker-offerings`; each deployment enables only the provider capabilities and prices it supports.

```http
POST /v1/workers
Content-Type: application/json
Idempotency-Key: create-my-worker

{
  "name": "my-worker"
}
```

This uses the deployment's default on-demand sandbox offering, isolated Runs, automatic size selection, and finite effective limits. Read the returned settings and `accepted_offerings` before submitting work. Creating a Worker does not create a Worktree or Session.

Use the returned `id` on a Run:

```http
POST /v1/runs
Content-Type: application/json
Idempotency-Key: first-worker-run

{
  "worktree_id": "YOUR_WORKTREE_ID",
  "worker_id": "YOUR_WORKER_ID",
  "harness": "codex",
  "model": "YOUR_ENABLED_MODEL",
  "billing_mode": "managed",
  "prompt": "Review this project and write a short summary."
}
```

The existing [Run and Session API](../api/README.md) still determines the execution context. To continue a conversation, supply `session_id` instead of repeating its Worktree and harness configuration:

```json
{
  "session_id": "YOUR_SESSION_ID",
  "worker_id": "YOUR_WORKER_ID",
  "prompt": "Now explain the most important finding."
}
```

A Session can continue on another authorized Worker. `session_id` is a Macrofold ID, not a raw upstream conversation ID. Model/provider compatibility rules still apply.

## Choose the economics

`compute` selects an economic offering, not a provider API. `dedicated` controls exclusive capacity; `isolate_runs` separately controls whether your Runs require isolated execution environments.

| Choice | Behavior | Charges |
| --- | --- | --- |
| `compute: "sandbox"` | On-demand execution environments. Idle capacity may be released. | The accepted allocation or resource rate. |
| `compute: "server", dedicated: true` | Exclusive server-backed capacity, shared by your Runs when `isolate_runs: false`. | Allocated server capacity, including idle time while retained. |
| `dedicated: false` | No promise of exclusive server capacity. Exact placement is internal. | The published offering's resource/allocation meter, never an arbitrary share determined by your placement on a nearly empty server. |

Not every deployment offers every combination. Unsupported configurations fail explicitly; Macrofold does not silently switch you to another compute product, region, price, or isolation guarantee. Non-dedicated does not grant other customers access to your files or credentials. It also does not promise that the backend will actually colocate workloads.

### Sustained concurrent traffic

For a game world or continuously busy agent service, keep baseline server capacity and let more capacity be added automatically:

```json
{
  "name": "openlegend",
  "compute": "server",
  "dedicated": true,
  "isolate_runs": false,
  "min_instances": 1,
  "max_instances": 4,
  "max_concurrency": 32,
  "idle_timeout_seconds": 300,
  "max_hourly_compute_cost_micro_usd": "1000000"
}
```

The ceiling above is **an illustrative $1/hour**, not a quoted price or an estimate for this workload. Creation validates that the available rates can fund the requested baseline. Plan limits still apply. `min_instances: 1` retains baseline capacity while enabled; `idle_timeout_seconds` releases excess idle capacity, not the baseline. `null` disables idle shutdown where the selected offering permits it.

For bursts, use `min_instances: 0` with an idle timeout. The Worker remains addressable after its Hosts stop and wakes when new work arrives. A provider's maximum machine lifetime does not change the Worker ID. Use `expires_at` only when you want the Worker itself to expire.

`min_instances` and `max_instances` are dedicated-capacity controls. Non-dedicated callers use resource/concurrency/spending limits without choosing how many machines the pool owns.

## Resource sizing and scaling

Omit `size` to let Macrofold choose among the accepted compatible sizes. Advanced callers can select an advertised `size`, `region`, or `runtime`. A Worker may have several backing Hosts, but callers submit to one `worker_id` and never route to machine IDs.

Native Runs reserve 1,024 MiB and 250 CPU millicores by default. Override top-level `memory_mib` and `cpu_millis` for known heavier or lighter workloads. These are allocation requirements, not a prediction of future memory use. Macrofold packs compatible Runs within Host headroom and capacity, then adds capacity for queued demand. A single oversized Run requires a large enough allocation; another Host does not enlarge an already-running process.

`max_concurrency` limits active assignments. Cleanup can briefly keep a slot occupied after the public Run becomes terminal, so `occupied_slots` may exceed `active_runs`. Worktree writes remain serialized globally, even when two Runs target different Workers. Use separate Worktrees for independent concurrent writers.

When capacity, credit, or cost limits prevent a start, the Run remains queued within its queue deadline and exposes a waiting reason. Explicit Worker targeting never falls back to unrelated compute.

## Spending controls

Money fields are integer micro-USD strings: `"1000000"` means $1. The CLI accepts ordinary dollar amounts and converts them exactly.

The Worker response shows accepted rates, current committed hourly exposure, reserved funds, and settled compute cost. Starting, draining, and not-yet-confirmed-stopped allocations still count toward commitments. This avoids silently exceeding your ceiling during replacement or shutdown.

The hourly ceiling limits **compute rate**, not monthly spend or model/tool usage. Run budgets and account credit controls remain separate. Model, connector, and tool usage stay attributed to the Run; dedicated compute is charged once at the allocation level rather than once per concurrent Run. Filter [usage](../billing/usage.md) by `worker_id` to inspect compute charges.

Resource-metered offerings use their documented allocated-memory time and CPU usage counters. Missing final measurements are not treated as zero; uncertain charges remain reserved pending reconciliation. Opportunistic warm-process retention is evictable platform cache, not a promise of free dedicated uptime.

## Pause, resume, destroy, and update

```text
GET    /v1/workers
POST   /v1/workers
GET    /v1/workers/{worker_id}
PATCH  /v1/workers/{worker_id}
POST   /v1/workers/{worker_id}/pause
POST   /v1/workers/{worker_id}/resume
POST   /v1/workers/{worker_id}/destroy
```

Pause stops admissions, lets active Runs finish, then releases compute. It returns the desired state promptly; poll the Worker until its observed status is `paused`. Queued work keeps its deadline, and a manual pause never wakes merely because new traffic arrives. Resume enables execution again. This differs from automatic idle sleep, which wakes on demand.

Destroy retires the Worker, cancels queued work, and drains active work. An explicit `{"force": true}` on pause or destroy requests active cancellation; cleanup and settlement still wait for confirmation. Worktrees, Sessions, and their published checkpoints are not deleted.

PATCH uses `expected_revision` from the latest Worker response. Spending and concurrency changes are validated against existing obligations. Changes to compute, tenancy, isolation, region, runtime, or size require the Worker to be fully paused and drained. Host-local caches may disappear after any replacement; verified durable state is restored as needed.

## CLI and dashboard

Use `macrofold worker --help` or the individual Worker command help for configuration flags. The CLI provides Worker creation, listing, inspection, updates, and lifecycle actions; Run and chat commands accept `--worker`. The dashboard's Workers page exposes the same target and lifecycle state. API examples are the authoritative field-level reference; advanced settings remain available through the API even when a simplified UI does not expose them.

## Permissions and isolation

`workers:use` permits targeting an authorized Worker. `workers:read` permits inspection. `workers:write` permits compute/lifecycle management and requires organization administrative authority. Worker-ID restrictions on API keys are independent from Workspace restrictions. Permission to use a Worker does not grant access to any resident Worktree, Session, or another Run's tools.

`isolate_runs: true` requires the advertised isolated execution boundary. Current dedicated/shared providers may satisfy this by using one execution environment per active Run, which reduces density. `false` explicitly permits trusted sharing between your Runs; separate directories and process identities are not a promise of hostile-code isolation. Cancellation and cleanup remain Run-scoped in either mode.

Only exact, clean, authorized Worktree revisions may be reused. A warm Session means its compatible harness process is still alive; it is never the sole durable copy of a conversation. Continuation may use a native ID, local harness files, or both. Cache loss causes a cold start, not loss of the last published state. Unpublished changes can still be lost when a machine fails during execution.
