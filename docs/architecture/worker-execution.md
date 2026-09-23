# Workers, compute economics, and autoscaling

This is the accepted implementation target. [Implementation status and remaining work](../features/execution/workers/TODO.md) distinguishes working code from the complete target; this document is not evidence of hosted availability. The existing [sandbox guide](../features/execution/sandboxes.md) remains the released API until the Worker cutover is complete.

## Decisions

A **Worker** is a stable, optionally user-managed execution target with an economic offering, scaling policy, runtime specification, isolation guarantees, and spending controls. It is not an agent, conversation, directory, machine, or single execution slot. A Worker may have zero, one, or many serving **Hosts**. Reactive scaling changes Hosts without creating new Worker IDs.

A **Host** is an internal provisioned compute allocation. A **HostRun** is one historical assignment of a Run to a Host generation. There may be multiple pre-launch assignments but at most one live assignment for a Run; uncertain execution is never silently replayed. A Host-local **harness handle** owns a retained process tree across turns. A HostRun temporarily acquires that handle and supplies the turn's authority, budget, and deadline.

Workspaces, Worktrees, Agents, Sessions, and Runs remain logical resources independent of compute. Worktree files and harness-specific Session continuation state are durable only after verified publication. Clean local materializations and idle harnesses are caches; unpublished active writes may exist only on a Host and are not losslessly disposable.

The two public entry paths remain:

```text
POST /v1/runs                         automatic compute
POST /v1/workers                     optional economic/scaling control
POST /v1/runs { worker_id: ... }      use that Worker
```

Host, HostRun, harness handles, and cache entries are not additional public resources. No public ExecutionLease, ResidentSession, or generic Session filesystem is added. Worker is the external name even where internal pollers are also called workers.

## Economic control without machine management

Callers select the economic arrangement; Macrofold sizes, places, and scales within it. It does not predict tomorrow's traffic or silently substitute an expensive backend in response to load.

| Offering | Allocation and billing | Intended use |
| --- | --- | --- |
| Server, pooled | Published resource rates; customer pays allocated memory-time and measured active CPU-time, not the bill of the particular occupied Host | Short or continuous workloads sharing an economical server fleet |
| Server, dedicated | Exclusive capacity allocated to this Worker; all running capacity, including its unused share, is billable | Sustained trusted concurrent agents or customers requiring exclusive allocation |
| Sandbox | Published sandbox allocation rates and the documented execution boundary | On-demand strongly isolated workloads |

These are product offerings, not claims that any named provider is universally cheaper. A deployment exposes only implemented and accepted combinations. Pooled cross-customer execution requires a proven customer boundary and reliable metering; an unavailable offering fails before reserving funds or provisioning. No placeholder implementation may present pooled or isolated execution as working.

Published, versioned rate cards are authoritative. Freeze the accepted resource shape, billing basis, currency, rates, and rate version before allocating. Infrastructure replacement cannot raise that accepted rate or change offering, region constraints, or isolation without a new authorized configuration. Changes apply prospectively, with old and new allocations separately accounted. Provider invoices inform future prices; they never retroactively determine a customer's per-Host occupancy price.

For pooled compute, idle fleet overhead is reflected in prospective published rates. Do not divide one underoccupied Host's bill among its occupants. Do not make all customers subsidize an unrelated resource class or region. Retrospective at-cost settlement, credits, and a global cost-sharing formula are separate future products, not the default bill. Do not invent commercial prices while implementing infrastructure.

For dedicated compute, bill each allocated Host interval once, not once per concurrent Run. Model/tool usage and subscriptions remain independent. Plan concurrency caps remain legitimate product policy; validate configurations against effective limits and expose the limiting reason rather than selling capacity the plan cannot use.

## Public configuration

Use top-level fields and the repository's existing exact micro-USD decimal-string convention. The UI/SDK may format dollars, but internal arithmetic never uses floating point money. IDs remain the project's opaque UUIDs; the following placeholders are explanatory, not a new ID format.

```json
{
  "name": "openlegend",
  "compute": "server",
  "dedicated": true,
  "isolate_runs": false,
  "min_instances": 1,
  "max_instances": 8,
  "max_hourly_compute_cost_micro_usd": "1000000",
  "idle_timeout_seconds": 300
}
```

This requests server economics, exclusive Worker capacity, trusted sharing among that Worker's Runs, one running baseline Host, bounded horizontal scale, and a one-dollar maximum authorized allocation rate. The amount is illustrative, not a cost estimate. Size is automatic unless an advanced caller selects a supported `size`; runtime and region can likewise have deployment defaults returned in the accepted configuration.

Core fields:

| Field | Semantics |
| --- | --- |
| `compute` | `server` or `sandbox`; an economic and capability constraint, not a hint |
| `dedicated` | Exclusive backing allocation for the Worker, not exclusive physical hardware or one machine per Run |
| `isolate_runs` | Whether sibling Runs require the advertised execution boundary; false permits sharing within an explicitly trusted Worker |
| `min_instances` | Baseline running capacity for dedicated/server allocations; zero permits idle sleep; not meaningful as ownership of a pooled fleet |
| `max_instances` | Advanced finite scale bound where Host counts describe the selected offering |
| `max_hourly_compute_cost_micro_usd` | Exact maximum aggregate authorized compute allocation rate, including provisioning/draining allocations until release is confirmed |
| `idle_timeout_seconds` | Grace period after active assignments release before surplus capacity may stop |
| `size` | Optional explicit catalog resource shape; otherwise automatic sizing from compatible published shapes |
| `runtime` | Versioned managed runtime/environment identifier, resolved to an immutable implementation at allocation |
| `region` | Required placement constraint when explicit; never silently fail over outside it |
| `expires_at` | Optional customer-requested retirement time for the logical Worker, independent of provider machine lifetime |

Do not make `short_lived` versus `long_lived` fundamental types. They can be UX presets for these controls. A stable Worker can scale to zero every night without losing identity. A customer's explicit expiration can retire it; a provider Host timeout cannot.

A cost rate ceiling is not a lifetime budget. It limits ongoing allocation, not tokens, tools, storage, total daily spend, or an instantaneous invoice. Keep finite prepaid reservations and periodic renewal through the existing ledger. If a new allocation or renewal is unaffordable, queue/reject new work and drain safely; do not erase debt, grant free infrastructure, or terminate neighboring Runs casually. Pending provider releases still count. Lowering a ceiling below current running commitments stops growth and drains excess; return current committed rate and a transitional status instead of pretending costs dropped instantly.

For pooled compute, reserve a conservative maximum CPU/memory allocation rate before admitting work even when active CPU is billed afterward. This keeps a strict ceiling meaningful. Required baseline capacity above the ceiling is a validation error. Zero-cost local fixtures are explicit and cannot accidentally select paid providers.

## Public lifecycle and UX

Worker endpoints are `GET/POST /v1/workers`, `GET/PATCH /v1/workers/{id}`, and `POST .../pause`, `.../resume`, `.../destroy`. Use the existing idempotency, pagination, asynchronous operation, and error conventions. Public operations return the accepted configuration, effective limits, desired state, observed state, and useful progress. No separate public drain endpoint is needed.

Separate desired state (`enabled`, `paused`, `destroyed`) from observed progress (`idle`, `provisioning`, `ready`, `scaling`, `draining`, `paused`, `error`, `destroyed`). Idle means enabled without allocated capacity; it may wake on authorized work. Manually paused means disabled by its owner and cannot be woken by traffic. A transient provider failure is not evidence that capacity was released.

Pause acknowledges asynchronously, disables admissions, lets current Runs complete within their deadlines, and then releases compute. Destroy performs the same drain before terminal retirement. An explicit force option requests cancellation of affected active Runs; it does not skip durable cleanup, accounting, or confirmed provider release. Resume enables admissions and starts required baseline capacity or wakes lazily. No operation deletes Worktrees or Sessions.

New submissions to a manually paused/destroyed Worker fail with actionable errors. Previously accepted queued Runs remain subject to their original queue deadline and can be cancelled; pause does not silently spend their reservation or move them elsewhere. Expiration stops admissions early enough for the configured run window, drains, and retires; unavoidable provider interruption is recorded honestly.

Patch uses a revision precondition for competing configuration edits. Names/idle settings can change without replacing processes. Runtime/shape/isolation changes roll to compatible Hosts at safe boundaries. An immutable authorization/rate snapshot remains attached to every active allocation.

UI: most users see an optional Worker selector and a compute estimate/limit, not Host fields. Advanced settings show offering, isolation, baseline/max capacity, shape, region, runtime, and accepted prices. Distinguish queued-for-capacity, paused, unaffordable, unsupported, and provider-starting states. Aggregate Worker read access does not imply visibility into all Run prompts or files.

## Runs and state

`worker_id` is optional and orthogonal to execution context. Preserve convenient context shorthand: a continuing `session_id` resolves its Worktree; callers do not redundantly send both. A Worktree-only native invocation creates a new conversation under current defaults. Do not silently reinterpret omission as stateless.

The domain should permit durable files without retained conversation and temporary files with or without continuation. A native process needing a working directory does not automatically require a public durable Worktree. Introduce explicit stateless/session-retention behavior with matching schemas and tests, rather than accidentally changing existing omission semantics. Direct inference and bounded decisions do not acquire native Host capacity merely because they share the Run observation model.

Explicit Worker selection is a hard target. Full/unavailable Worker capacity does not spill onto another economic offering. An omitted Worker uses a safe automatic offering; later, an explicitly configured default may authorize a particular Worker. Automatic placement never discovers a customer's idle Worker and uses it without that policy.

Queue eligibility includes compatible capacity or permitted provisioning before fair winner selection. A head targeting a full Worker must not block an unrelated eligible head. Preserve Worktree ordering, organization fairness, plan caps, and the current global transaction lock until measurement justifies changing it. Placement ranks warm compatible handles, exact authorized file views, other eligible capacity, then new capacity; cache preference never overrides resource, authority, cost, or isolation constraints.

## Reactive scaling

Use bounded periodic reconciliation through the existing durable dispatcher, not one process or timer per Worker and not a new prediction service. Observe runnable demand, reserved resources, headroom, warm-cache pressure, and serving/provisioning/draining Hosts. Provisioning allocations count toward limits to avoid duplicate scale-out. Resource reservations and scale decisions are claimed transactionally; provider I/O happens outside the transaction under durable operation identity.

Automatically select a compatible catalog size from per-Run resource estimates and observed requirements, then bin-pack within documented headroom. Add Hosts when runnable demand cannot safely fit and funds/limits permit. A new Host helps concurrent Runs; it does not resize a currently running process. An oversized individual Run needs a larger admitted shape or an explicit resource-limit outcome. Never replay it blindly to resize after ambiguous side effects.

Scale-down drains idle excess Hosts after hysteresis/idle grace, preserves `min_instances`, and removes optional warm-process caches before buying capacity solely for cache memory. Handle retention never becomes an unlimited RAM obligation. If retained warmth is explicitly billable, its rate and expiry must be visible; default opportunistic caching is evictable platform overhead on pooled compute.

Dedicated Host capacity is exclusive to its Worker. Pooled Hosts may serve multiple Workers only across supported tenant isolation boundaries. Releasing pooled allocations need not destroy the Host; releasing the last allocations can trigger fleet scale-down. A Worker does not own a pooled Host. Pooled billing is per authorized resource use and independent of accidental Host occupancy.

No autoscaler guarantees immediate capacity, fixed latency, or unlimited throughput at a fixed rate. Expose queue reasons and honor deadlines under load.

## Authorization and isolation

Worker authorization is independent of Workspace ownership: `workers:read`, `workers:use`, and `workers:write` distinguish viewing aggregate compute, using capacity, and controlling lifecycle/spend. A run needs Worker use AND its own context/tool authorization. Organization RLS and resource grants are checked server-side; a Worker UUID is a selector, not permission. Scoped keys must not pause other workloads just because they can run an agent. Worker listing and metrics cannot leak unauthorized run IDs/content.

`dedicated` and `isolate_runs` answer different questions. Dedicated true plus isolate false is the OpenLegend configuration; dedicated true plus isolate true supports mutually untrusted agents on exclusive capacity. Shared tenant identity is not proof of shared trust. False sibling isolation is never permission to expose credentials or files to another organization/Worker trust domain.

Containment capabilities are explicit provider/runtime requirements. A cgroup gives process/resource ownership, not a complete security boundary. Use supported user/mount/PID/network boundaries for the advertised isolation mode. If a provider cannot enforce the requested mode, reject before allocation. Do not enable all Linux privileges merely to claim portable nested containers. Prove cleanup of daemonized descendants on each provider before multi-Run activation.

Runtime roots are controller-generated, never accepted from a caller. Unique protected Host paths may be mounted as stable `/workspace` or harness-specific paths inside isolated executions; the requirement is no shared mutable global roots, not gratuitously different visible paths. Protect supervisor state, provider/control secrets, and sibling process access.

## HostRun, harness handles, and fencing

HostRun has its own ID, `run_id`, assignment generation, Host/boot identity, Worker ID, resource allocation, rate snapshot, resolved input revisions, state, and release timestamps. Keep historical assignments; enforce at most one live assignment per Run. Pre-launch re-placement retires the prior assignment before creating another. Transport retries use the same assignment and non-removable launch marker.

A live harness handle owns a stable contained process tree and compatibility fingerprint, optional local continuation root, memory estimate, and active HostRun reference. It can outlive one HostRun. Ownership handoff revokes the old turn authority, quiesces/cleans tool descendants, publishes state, then permits a new turn. Do not migrate only a root PID and assume descendants moved. Idle handles have no model/tool authorization. Caches may be in memory; authoritative assignments, spending, and writer fences cannot.

HostRun states only describe assignment/cleanup, not a competing public Run state machine. Run completion, persistence, Git sync, Host cleanup, and compute release have distinct outcomes. Hold physical capacity until cleanup. Hold writer authority until all possible old writers are fenced and publication is resolved. Expiring a database lease is not proof that the old process stopped; reject stale publication and tool calls and require positive containment/loss evidence before conflicting writers proceed.

## Filesystem and continuation recovery

A cache key must include Host generation, Worktree revision, authorized view/permission fingerprint, and relevant runtime compatibility. Same revision does not imply equal file visibility. Full protected caches may back restricted views, but an unrestricted prior Run must never broaden a restricted later Run's access.

Local cache states distinguish clean, active, stale, recovery-required, and evicting. Only inactive, verified published state is freely evictable. External edits advance the authoritative revision; validate on acquisition, so invalidation broadcasts are optional. Dirty failed state is quarantined and never advertised as a matching clean cache. Cache reuse is separate from harness reuse.

Session continuation is adapter-specific: native/resume ID, local required files, or both. No universal `/sessions/S` directory or public SessionCheckpoint is required. Adapters declare persistence/restore and warm-reuse capabilities and format/runtime compatibility. Persist required hidden native history while excluding auth/runtime secrets; a blanket dot-path exclusion is not a correct continuation policy. Avoid collecting caches or arbitrary HOME credentials.

The recoverability invariant is: a successfully persisted continuing Run can resume on compatible fresh compute from published state without the old process. Exercise cold restart, not just warm recall. For remote provider-managed state, do not claim a SQL transaction rolls back upstream side effects; record reconciliation/unknown outcomes where needed.

Publish Worktree and Session references coherently with Run persistence. Object bytes are verified before pointers commit. Preserve a previous checkpoint on upload failure. Resuming from a different Worktree revision invalidates a warm handle unless its adapter explicitly handles that change. Credential exclusions and scoped authorization remain mandatory even in trusted sharing mode.

A versioned runtime specification resolves managed binaries, dependencies, harness versions, and configuration separately from data. Initial managed runtime identifiers can reuse immutable image configuration; a user-defined image must not replace the trusted supervisor. Custom images and network environments require their own capability validation, not an arbitrary privileged container command.

## Failure and billing rules

Confirmed absence before launch may permit re-placement; ambiguous launch never silently replays. Host failure interrupts active work, loses uncheckpointed writes, and removes caches; durable logical resources remain. A replacement Host does not duplicate successful Runs or settlements.

One Run's capture failure quarantines its state and leaves independent Runs running. Whole-Host drain is reserved for lost containment, compromised health, exhausted Host funding, explicit owner action, or provider lifecycle limits. An unreachable provider is not proof of release, and a failed health request is not proof of absence.

Metering reports have durable deduplication identities and monotonic intervals. Missing CPU telemetry is unknown, not zero. Dedicated Host billing covers confirmed allocation intervals and uses accepted rates. Pooled memory reservations and CPU usage use their own accepted meter units; do not charge both per-Host and per-Run compute for the same offering. Keep exact integer arithmetic, financial journals, escrow/reservation, refund, and reconciliation in existing accounting owners.

Cost ceilings include in-flight creates and draining instances. A provider operation with an unknown result retains its reservation and identity for reconciliation; retries first inspect that identity. Only confirmed release frees the corresponding committed rate. Worker configuration does not replace finite wallet funding or run model/tool budgets.

## Minimal implementation and migration

Use the existing modular application, PostgreSQL/outbox, provider ports, runtime, SDK generator, and docs generator. Do not introduce Kubernetes, a second queue, prediction, Redis, or a generic fleet framework for this change.

The repository is pre-launch. Do not create hypothetical customer compatibility aliases. Add forward migrations that preserve local developer files/history, coordinate old-writer drain, and replace sandbox routes/types/SDKs atomically when the native path is ready. Historical migration SQL stays historical; current code and published docs should not retain competing Sandbox and Worker resource models after cutover. A work-in-progress branch must identify any not-yet-switched paths honestly.

Implementation order:

1. Freeze this design, public contract, offering/rate shape, and feature TODO; update architecture links.
2. Implement pure validation, exact cost limits, allocation/scaling decisions, and deterministic tests.
3. Add tenant-owned Workers, Hosts, historical HostRuns, runtime snapshots, and safe lifecycle/grant services with real transaction tests.
4. Implement per-Run paths and containment, optional harness continuation, authorization-view caches, and a bounded multi-Run controller; prove two concurrent actual native processes.
5. Integrate placement/capacity with existing scheduler and durable phase engine; use current providers only for capability combinations they actually support.
6. Add dedicated/server autoscaling and lifecycle reconciliation with exact reservation/release; add pooled metering only when its tenant boundary and meters are proven.
7. Switch API/SDK/CLI/dashboard/MCP and published documentation together; remove obsolete tests and update relevant retained tests, not weaken their assertions.
8. Verify code, generated contracts/docs, PostgreSQL migrations/claims/ledger, subprocess cancellation and cold restore, SDK transports, and load behavior. Leave hosted tests explicitly unverified without credentials/authorization.

## Acceptance and open work

[Feature TODO](../features/execution/workers/TODO.md) is the single implementation/triage record. It must track demonstrable incomplete work and consequential decisions, not speculative edge cases. The operator release checklist remains separate from feature implementation.

Required failure tests include cost exact-limit and roundoff, rate changes, duplicate creates/releases/usage, pending creates counted in limits, paused versus idle wake behavior, graceful pause with active and queued Runs, force cancellation, stale assignment/boot/writer fences, different-authority cache reuse, same Worktree across Hosts, warm-process handoff, descendant containment, cold continuation, provider uncertainty, missing meters, insufficient credit, and scale-down with live assignments.

Performance acceptance measures runnable queue delay, memory/CPU reservations, warm-cache footprint, restore/capture/upload throughput, database/lock pressure, and gateway load under hundreds of concurrent characters. Set measured limits; no untested claim that a small Host supports hundreds of native harnesses.

## Changelog

The original target used short/long-lived Worker types, one Host per Worker, and worktree-bound Sandbox compatibility. The accepted revision separates stable Worker identity from Host lifetime, makes Worker a bounded autoscaling target, exposes economic offerings and independent tenancy/sibling isolation, retains predictable resource rates, and removes pre-launch compatibility work. Reactive scaling replaces the earlier fixed-one-Host assumption; it does not introduce traffic forecasting.
