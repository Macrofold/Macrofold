from pathlib import Path
import json, re, subprocess

edits = {}
def put(path, text): edits[path] = text.strip() + '\n'

put('docs/features/execution/workers.md', r'''
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
''')

put('docs/features/execution/workers/operations.md', r'''
# Worker operations

This is the maintainer deployment guide. Public behavior is in [Workers](../workers.md); ownership and invariants are in the [architecture](../../../architecture/worker-execution.md).

## Enable an offering deliberately

Run all forward database migrations before starting the matching API and dispatcher. Keep the API, runtime controller image, contracts, and dispatcher at the same release. Applied migration files and immutable financial history are not edited to remove old terminology.

Local simulation is explicitly free and does not start real native agents. Local Docker uses the pinned runtime image and actual Host controller. Hosted sandbox execution uses the configured Vercel integration. Hosted server-backed execution requires `RENDER_WORKER_ENABLED`, the Render API credentials/owner, a supported service plan and region, and an immutable runtime image reference. Provider driver configuration is private and never returned through offering discovery.

`packages/core/src/worker-catalog.ts` owns deployment catalog loading and validation. Publish only combinations supported by the backend: CPU/memory shape, concurrency, runtime, region, isolation, maximum Host lifetime, price revision, and meter type. Real deployments must use reviewed rates; fixture rates are zero and are not commercial defaults. Unsupported resource-metered offers fail closed when the backend cannot produce the required counters.

The accepted quote on each Worker and Host survives later catalog changes. A catalog edit must not retroactively reprice existing liabilities. Changing the Worker's compute/security contract requires a fully paused target and a newly accepted configuration.

## Run the control loops

The existing dispatcher calls Worker reconciliation alongside normal maintenance. Reconciliation is bounded and leased in SQL. It uses queued resource demand, current allocations, min/max capacity, credit, and accepted hourly exposure; it does not forecast tomorrow's traffic. Provisioning capacity counts as expected supply. At most four new allocations are planned in one Worker pass, and provider operations execute outside database transactions with bounded concurrency.

Every Host has a stable provider identity and immutable accepted allocation. Persist that receipt before controller startup. A failed health/configuration call must not turn an already-billable machine into an unknown resource. Controller boot identity and assignment identity fence every state-changing native operation.

Host health carries rotation requests. Draining stops admissions but lets owned work finish. Provider hard lifetime, customer expiration, manual pause, lost funding, and resource pressure are distinct reasons; none changes durable Worktree or Session ownership. A new provider allocation does not extend an explicitly expired Worker.

## Finalize usage before releasing liability

Dedicated allocation charging uses the accepted shape/rate and confirmed running interval. Resource-metered charging uses cumulative allocated-memory/CPU receipts. Sampling frequency must not change the total charge. Duplicate observations and duplicate shutdown acknowledgements must not duplicate settlement.

For a metered Host, stop admissions, finish assignments, evict retained processes, and request `quiesce`. The controller seals a final cumulative receipt and cannot admit new work afterward. Persist and settle that receipt before provider deallocation. `usage_finalized_at` distinguishes an acknowledged final meter from a missing usage tail. If the acknowledgement or controller generation is uncertain, retain funds and reconcile rather than assume zero.

A provider deletion request alone does not prove shutdown. Release remaining funds only after stopped/deleted state is confirmed. Keep starting and draining obligations in the hourly ceiling until that boundary. A Host with uncertain shutdown must not be replaced repeatedly without including the old obligation.

## Runtime requirements

The protected controller runs separately from unprivileged native harness handles. Each handle has its own process identity, state paths, and scoped termination. Per-turn capabilities are refreshed and removed when no Run is active. Worktree and Session files are captured only at a quiescent boundary; known authentication files are excluded while hidden Git and conversation files remain eligible.

Trusted shared execution is not cross-customer hostile-code isolation. Do not advertise stronger capabilities than the runtime and provider enforce. A non-dedicated price does not require unsafe colocation: the platform may absorb idle capacity until a verified shared allocator is available. Custom runtime offerings must preserve the trusted controller boundary.

## Operational verification

Build with `pnpm check` and `pnpm build:runtime`. `pnpm run setup` creates the local disposable infrastructure. The bounded [performance workload](../../../../scripts/workers/stress.ts) runs actual loopback HTTP, generated SDK, scheduler, PostgreSQL, persistence, and ledger while stubbing external model/compute calls. The native load workflow builds the actual pinned runtime, runs concurrent native processes against loopback model responses, and checks a fresh-container continuation boundary. Neither is a production-capacity claim.

See [verification](verification.md) for exact commit-scoped evidence and [maintainer TODO](../../../maintainers/TODO.md) for deferred regression coverage and deployment-specific acceptance. Do not infer that missing API keys prove a backend works; mark live-provider checks unrun until exercised within an authorized spending limit.
''')

put('docs/features/execution/workers/implementation.md', r'''
# Worker implementation

The branch's public contract is Workers; the controller and provider allocation are internal Hosts. This document maps code ownership and verified execution boundaries. It does not imply that an unmerged branch has been deployed to Macrofold Cloud.

## Owners

| Concern | Owner |
| --- | --- |
| Public schemas, endpoint names, SDK/MCP generation | `docs/api/openapi.json`, repository generators |
| Worker CRUD, permissions, revision fencing, public observations | `packages/core/src/workers.ts` |
| Settings and lifecycle policy | `worker-policy.ts`, `worker-types.ts` |
| Accepted deployment quotes and capability validation | `worker-catalog.ts`, `worker-pricing.ts` |
| Placement and bounded queued-demand scaling | `worker-placement.ts`, `worker-scaling.ts` |
| Transactional resource claims, materialization hints, financial cursors | `host-allocations.ts`, forward database migrations |
| Lifecycle reconciliation and provider receipts | `worker-reconciler.ts` |
| Provider lifecycle and exact machine I/O | `packages/providers/src/hosts.ts`, Docker/Vercel adapters |
| Automatic execution and explicit Worker execution adapters | `automatic-machines.ts`, `host-machines.ts` |
| Multi-Run controller and cumulative meters | `packages/runtime/src/host-control.ts`, `host-meter.ts` |
| Native process ownership, capture and adapter continuation | runtime supervisor, process helpers, snapshot code and harness adapters |
| Existing execution and persistence orchestration | `engine.ts`, `cloud-engine.ts` |
| CLI and dashboard | CLI Worker handlers/flags, web Workers components |

## Implemented flow

Worker creation accepts a capability-compatible economic contract and finite limits. A Run independently selects its authorized execution context and optional Worker. The scheduler considers placement eligibility before choosing a fair candidate; Worktree writer exclusion continues through HostRun cleanup.

Reconciliation reads bounded queued requirements, projects consumption of existing/provisioning capacity, and authorizes additional Hosts within credit, instance, concurrency, and hourly ceilings. Physical provider identity is persisted before controller startup. Native operations carry boot and assignment fences. The controller keeps live harness handles separate from per-turn execution ownership and independently decides filesystem reuse versus process reuse.

Publication verifies durable Worktree and native continuation state. Only then may a local materialization become a clean cache hit. Cancellation, failed publication, and uncertain cleanup do not authorize replay of a potentially executed prompt. Dedicated compute is accounted once per Host; metered offers use monotonic cumulative receipts and a sealed final usage boundary.

Background Run admission uses nonblocking SQL advisory claims when another claimant owns the organization, Worktree, or global boundary. It defers durable work rather than occupying every connection while active Runs need to persist and heartbeat. Direct inference retains its in-transaction admission semantics.

## Verification and remaining scope

Build/run evidence belongs in [verification](verification.md). Public docs describe real contracts and supported combinations; deployment-specific provider availability is read from offering discovery. Formal test additions are intentionally listed in [maintainer TODO](../../../maintainers/TODO.md), not reported as executed.

Cross-customer physical packing is an optional backend optimization, not permission to bypass tenant isolation. A resource-priced offering can use unshared physical capacity and charge its advertised usage meter while the platform absorbs overhead. Additional runtimes, regions, sizes, and pricing revisions must pass catalog validation and provider capability checks.

Pre-change resources and decisions are recorded only in the [architecture history](../../../architecture/changelog/workers.md); forward migrations retain deployment and accounting history by design.
''')

put('docs/features/execution/workers/verification.md', r'''
# Worker execution evidence

Evidence is commit-specific. A green build is not native recovery or paid-provider evidence, and simulated external boundaries are not actual cloud resource measurements.

## Bounded API/database workload

GitHub Actions run **35963569941**, source **6532654b65d0a681185a19026577c098abcc545c**, Node **24.13.0** completed the loopback HTTP/SDK workload with the repository's pinned dependencies:

| Measurement | Observed |
| --- | ---: |
| Accepted/completed Runs | 128 / 128 |
| Peak concurrent synthetic executions | 8 |
| Peak backing Host records | 3 |
| Resource ownership violations | 0 |
| Admission p95 | 196.41 ms |
| Listing p95 across 21 Workers | 45.79 ms |
| Event-loop p99 | 21.04 ms |
| Elapsed workload | 144,556 ms |
| Paid API calls | 0 |

The workload exercised real admission, fair scheduling, PostgreSQL claims, filesystem publication, ledger, listing, pause, and destroy. Native model execution and external compute provisioning were explicit simulator boundaries. It deliberately offered many competing claims; 34,147 deferrals show that this is not a throughput benchmark for a production dispatcher using candidate hints.

The preceding run at `77aa30f0a271861af0644be85a6a94785e1d1c66` exposed database connection starvation. Nonblocking background advisory claims removed that observed failure without increasing the five-connection domain pool. Further contention and I/O work should preserve this result rather than enlarge the pool to conceal it.

The same successful action compiled the application and native runtime, regenerated all SDKs, and validated 64 generated public pages plus local documentation targets. No unit/integration suite was run during this continuation at the user's request.

## Native and hosted boundaries

The native performance workflow runs the pinned image without external network access, loopback protocol responses, concurrent harness processes, and continuation in a new container. Its latest result must be recorded separately before making native performance/recovery claims. Live Render, Vercel, model, and hosted-storage checks require explicit configuration and spending authorization; no success is inferred from their stubs.

The current deferred regression inventory is in [maintainer TODO](../../../maintainers/TODO.md). Historical acceptance counts for the retired execution resource are not evidence for the Worker cutover.
''')

put('docs/features/execution/workers/TODO.md', r'''
# Worker follow-up

The public API, durable Worker/Host/HostRun ownership, scaling, pricing, runtime-control, CLI, and dashboard have implementation owners listed in [implementation](implementation.md). Do not retain obsolete tasks to import an uncommitted bundle or introduce an API that is already present.

Formal test cases and release acceptance are centralized in [maintainer TODO](../../../maintainers/TODO.md). Current measured execution evidence is in [verification](verification.md).

Optional extensions, not alternative public primitives:

- Add safe cross-customer physical packing only after the provider/controller supplies a verified tenant boundary. Preserve published resource prices independently from machine placement.
- Add runtime/region/shape offerings through the validated catalog, not a parallel scheduler. Benchmark a real mixed-harness workload before changing safe defaults.
- Consider an explicit native no-retained-conversation mode independently from filesystem retention. Current native admission creates or continues a Macrofold Session; omission is not a stateless promise.
- Revisit richer cache-affinity scoring and quota fairness only when measured queue, restore, or memory data justifies the extra coordination.
''')

# Keep a single current user guide and operational owner. Rewrite destinations only,
# not the word "sandbox" in vendor integrations or unrelated historical research.
paths = subprocess.check_output(['git','ls-files'], text=True).splitlines()
for name in paths:
    if not name.endswith('.md') or not Path(name).is_file(): continue
    text = edits.get(name, Path(name).read_text())
    updated = text.replace('sandboxes/operations.md', 'workers/operations.md').replace('sandboxes/verification.md', 'workers/verification.md').replace('sandboxes.md', 'workers.md')
    if updated != text: edits[name] = updated
nav = Path('docs/navigation.json')
value = json.loads(nav.read_text())
def walk(node):
    if isinstance(node, dict):
        if node.get('slug') == 'sandboxes':
            node['slug'] = 'workers'; node['title'] = 'Workers'; node['source'] = 'docs/features/execution/workers.md'
        for key, child in list(node.items()):
            if isinstance(child, str):
                node[key] = child.replace('sandboxes/operations.md','workers/operations.md').replace('sandboxes/verification.md','workers/verification.md').replace('execution/sandboxes.md','execution/workers.md')
            else: walk(child)
    elif isinstance(node, list):
        for child in node: walk(child)
walk(value)
edits[str(nav)] = json.dumps(value, indent=2) + '\n'

for name, text in edits.items():
    Path(name).parent.mkdir(parents=True, exist_ok=True)
    Path(name).write_text(text)
for name in ['docs/features/execution/sandboxes.md', 'docs/features/execution/sandboxes/operations.md', 'docs/features/execution/sandboxes/verification.md']:
    Path(name).unlink(missing_ok=True)
print('DOCUMENTATION_FILES_UPDATED', ', '.join(edits))
