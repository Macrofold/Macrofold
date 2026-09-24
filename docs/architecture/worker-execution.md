# Cost-aware Workers and execution infrastructure

**Decision status:** Accepted target.  
**Repository status:** Documentation updated; Worker API/runtime cutover remains unimplemented. The earlier downloadable code bundle is separate, uncommitted work, not code in this branch. See [implementation and evidence](../features/execution/workers/implementation.md).

This document supersedes the earlier one-serving-Host-per-Worker and short-lived/long-lived resource designs. A **Worker is a stable, autoscaling execution target with an explicit economic contract**. The user chooses cost, tenancy, isolation, and availability requirements; Macrofold sizes and places execution within those requirements. It does not predict future traffic or silently change the purchased offering.

[Worker guide](../features/execution/workers.md) owns the intended user experience. [Feature TODO](../features/execution/workers/TODO.md) owns unfinished implementation and deployment gates. Existing [sandbox documentation](../features/execution/workers.md) describes the still-implemented API until the coordinated switchover. Do not publish examples from this target as working endpoints before their handlers, schemas, SDKs, and acceptance tests land.

## 1. Resource model and decisions

| Concept | Visibility | Owns |
| --- | --- | --- |
| Worker | Public, optional | Execution target, economic offering, desired state, scaling and spending limits, access policy |
| Host | Internal | One provider compute generation, actual resources, control channel, accepted quote, lifecycle |
| HostRun | Internal | One placement attempt, generation fence, resource reservation, launch identity, cleanup |
| Worktree | Public | Durable user filesystem identity and verified revisions; not a machine directory |
| Session | Public | Stable conversation identity and harness-specific continuation; not a process |
| Live harness handle | Internal | A reusable process boundary that can accept successive authorized turns |
| Run | Public | One requested invocation, inputs, authority, outcomes, usage, events |
| Materialization cache | Internal | An authorized, clean filesystem view already available on a Host |

A Worker may have zero, one, or several Hosts. Adding Host B for more traffic does not create a new public Worker or require callers to implement routing. A fixed single-machine allocation remains expressible with `max_instances: 1` on a dedicated Worker. A pooled Worker instead acquires resource allocations from a compatible fleet; its users do not own fleet instance counts.

A Worktree and Session never belong to a Worker. Runs may select different Workers over time without changing their durable identities. A Worker does not grant access to resident data. A Host is replaceable, but replacement can interrupt active execution and lose unpublished changes. **Published materializations are caches; unpublished writes are not yet durable copies.**

## 2. User control: economics first, machines second

The ordinary path stays `POST /v1/runs`. Users who want control create a Worker and send the same Run requests with a top-level `worker_id`.

The economic choices are:

| Compute arrangement | Allocation | Billing contract |
| --- | --- | --- |
| Pooled server | Metered resources in an economical server fleet | Published allocated-memory and active-CPU rates; no per-machine occupancy lottery |
| Dedicated server | Whole allocations exclusively backing this Worker | Allocated Host time, including idle capacity, at accepted rates |
| On-demand sandbox | Compatible managed sandbox allocations | The published sandbox resource/allocation meter, explicitly disclosed |

These are supported combinations of the same small settings, not a family of incompatible resource APIs. The deployment advertises only tested offerings. A missing pooled executor, isolation primitive, region, or runtime is an explicit unavailable configuration, not permission to substitute something else.

`compute: "server"` must never silently become `compute: "sandbox"`, even if the latter is available. Host replacement cannot silently change the customer's rates or runtime version. Provider brand is not a public scheduling requirement by default; the economic class, price authorization, region, runtime, and isolation guarantees are.

There is no universal assertion that one provider is cheapest. Reviewed offerings supply actual rates and capabilities. Examples and test prices are not retail prices. Automatic selection means cheapest compatible candidate that fits the present placement decision, not a globally optimal cost forecast.

## 3. Worker API contract

This section defines the **target** request/response contract. The earlier uncommitted policy bundle uses internal types; it does not replace the authoritative OpenAPI schema or add HTTP routes by itself.

### Creation and common controls

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
  "max_concurrency": 64,
  "max_hourly_compute_cost_micro_usd": "1000000"
}
```

The one-dollar amount (`"1000000"` micro-USD) is a **caller-chosen illustrative ceiling**, not an estimate that this workload or baseline fits it. Admission must verify that at least one advertised configuration satisfies the baseline and ceiling. No size is required. Setting `size` opts out of automatic shape choice while retaining scaling across that shape.

| Field | Rule |
| --- | --- |
| `name` | Optional organization-scoped display label; UUID remains identity |
| `compute` | `server` or `sandbox`; omission resolves to the deployment's advertised default sandbox offering |
| `dedicated` | Default false; true buys exclusive Worker capacity, not permanent physical hardware |
| `isolate_runs` | Default true; false explicitly permits the advertised trusted-sharing boundary among this Worker's Runs |
| `size` | Optional supported shape identifier; omission means choose a compatible fitting shape |
| `runtime` | Optional managed runtime version; omission is resolved and pinned at creation |
| `region` | Optional advertised default; resolved region is a hard constraint, never a silent cross-region move |
| `min_instances` | Dedicated only; nonnegative baseline, default zero |
| `max_instances` | Dedicated only; positive, bounded by entitlement; never an unlimited default |
| `max_concurrency` | Worker-wide active execution/cleanup admission ceiling; explicit requests above entitlement fail |
| `idle_timeout_seconds` | Default 300, zero releases removable idle capacity immediately; null retains dedicated idle capacity while funded |
| `expires_at` | Optional valid future UTC timestamp for the Worker itself; omitted/null means no customer expiration |
| `max_hourly_compute_cost_micro_usd` | Nonnegative integer micro-USD string, matching existing budgets; resolved finite default is disclosed |

Do not treat numeric zero as missing. Public money follows the existing integer micro-USD string convention: `"1000000"` means one dollar. UI helpers can format dollars without floating-point arithmetic. Hosted positive-cost capabilities require configured published rates; an unknown rate is not free compute.

`min_instances`/`max_instances` are rejected for pooled Workers, where they have no ownership meaning. Pooled retention must be finite. Baseline capacity remains subject to spending, entitlement, and actual provider availability; it is not an unlimited uptime guarantee.

A read-only `GET /v1/worker-offerings` catalog should expose enabled combinations, shape/resource bounds, runtime versions, accepted meter/rate revisions, and current account limits. It is discovery, not a second mutable product resource. Catalog entries are not evidence of real-time spare capacity.

### Response and observability

Return UUIDv7 IDs consistent with the rest of Macrofold; do not invent `wrk_` IDs that the current validators reject. Include resolved settings, a configuration revision, desired state, observed status, effective limits, allocated/starting instance counts where meaningful, active Runs, occupied slots, queued Runs, accepted rate information, committed hourly exposure, and reason for waiting/degradation.

Separate an execution's terminal result from slot occupancy: completed Runs may still occupy cleanup reservations. Report current cost observations with timestamps and completeness. Worker use authority does not grant access to other Runs' prompts, files, native identifiers, or detailed usage.

### Endpoints and updates

```text
GET    /v1/workers
POST   /v1/workers
GET    /v1/workers/{worker_id}
PATCH  /v1/workers/{worker_id}
POST   /v1/workers/{worker_id}/pause
POST   /v1/workers/{worker_id}/resume
POST   /v1/workers/{worker_id}/destroy
GET    /v1/worker-offerings
```

Use existing idempotency, cursor pagination, request IDs, error envelopes, and asynchronous operation conventions. Lifecycle actions acknowledge intent with HTTP 202; inspect the Worker for current status. Repeated identical intent is idempotent.

PATCH uses the existing optimistic revision convention. Name and bounded scaling policies can change without changing identity. Lowering concurrency drains naturally rather than killing active work. Reject a requested rate ceiling below existing committed exposure with a clear conflict and a pause/drain path; do not promise instantaneous termination of already accepted obligations. Changes to compute economics, tenancy, isolation, region, size, or runtime require paused/no-live-allocation state and explicit acceptance of the new quote. Never mutate an active Run's frozen configuration.

## 4. Lifecycle, sleep, and expiration

Persist desired state separately from observed state:

```text
desired_state: enabled | paused | destroyed
observed: sleeping | starting | ready | draining | paused | destroyed | expired
```

Provider errors or a requested-but-unavailable baseline need an explicit failure/wait reason and observation timestamp, not a fabricated ready status. Status is a projection of durable intent and confirmed allocations, not a second conflicting state machine.

**Create:** enabled by default. Provision the authorized minimum when nonzero; otherwise sleep until work needs capacity. Do not charge merely for an inert Worker record.

**Automatic sleep:** preserve `desired_state=enabled`; release removable idle allocations after the idle policy. New admitted traffic may wake capacity. Host/cache loss does not expire the Worker.

**Manual pause:** atomically set paused intent, stop new admissions, allow already executing Runs to finish within their existing deadlines, finish capture/cleanup, then release allocations. New submissions fail with a specific paused error. Already accepted queued Runs retain queue deadlines and wait for explicit resume or cancellation; they do not wake a manually paused Worker. Reads/polls do not keep capacity alive.

**Resume:** explicitly enable an unexpired, non-destroyed Worker; provision its minimum or wake lazily. Resuming never replays interrupted Runs or implicitly extends a customer's expiration.

**Destroy:** retire the Worker without deleting Worktrees, Sessions, Agent definitions, Run history, or durable financial references. Stop admissions; terminate queued work explicitly; drain accepted active work. A separately authorized force option may cancel active Runs and report lost unpublished state. Force is never the default and cannot reverse upstream side effects.

**Expiration:** bounds this customer's Worker resource, not one provider machine. Stop accepting work that cannot finish its execution and cleanup window before expiration. Drain/stop at the documented deadline; no automatic renewal. A provider Host TTL instead triggers an eligible generation replacement while the Worker remains enabled and funded.

Idle countdown starts only after the last relevant allocation is safely released. `min_instances` retains the paid baseline; excess allocations may still scale down. Idle timers do not terminate active Runs. One Run cannot override a shared Worker's lifetime or shut down its neighbors.

## 5. Run UX, durable state, and authorization

`worker_id` is orthogonal to the current execution-context selectors. Continue a Session without redundantly specifying its Worktree:

```json
{
  "session_id": "019e1700-0000-7000-8000-000000000001",
  "prompt": "Take the next turn.",
  "worker_id": "019e1700-0000-7000-8000-000000000002"
}
```

Existing `workspace_id`, `worktree_id`, and `session_id` context resolution remains convenient and mutually consistent. A different Worker does not change conversation ownership. Explicitly targeted work does not spill onto other Workers or a different offering when full or too expensive. Queue limits and timeouts remain real.

Without `worker_id`, use the advertised automatic offering; do not consume customer-managed Workers unless the customer explicitly configures that selection. The first automatic backend can remain the existing isolated execution path. Future managed pooling must preserve the same advertised security and pricing contract.

Keep files, retained conversation, and execution independent in the internal model. A native harness needs a working directory, not necessarily a durable Worktree. Permit temporary working files for one-shot native work and optional Session retention. Preserve current retained-session defaults; a future explicit `retain_session: false` request must not create a retained conversation or accept an existing `session_id`. Do not interpret omission of `session_id` as proof of statelessness: it currently creates a Session. This extension requires a coordinated Run schema/admission change, not just nullable columns.

Define Worker scopes separately: `workers:use`, `workers:read`, `workers:write`. Execution requires Worker-use permission **and** the existing data/harness/tool/funding permissions. Worker administration does not imply reading every resident customer's data. Workspace-restricted keys can use granted compute without becoming compute administrators. Scope defaults, principal resource restrictions, MCP catalogs, and SDK key interfaces must change together.

All new tenant tables use organization-scoped foreign keys and FORCE RLS under the existing database roles. Platform fleet maintenance uses existing operator/reporting boundaries; never expose provider credentials or shared-fleet metadata through tenant APIs.

## 6. Reactive scaling and placement

No traffic prediction service is required. React to queued runnable work, safe resource allocations, observed memory/CPU pressure, and minimum availability. Do not wait for OOM. No orchestration service, Redis queue, or Kubernetes cluster is required simply to express this policy.

For a dedicated Worker:

1. Authorize the Run, resolve required runtime/resources/state, and identify its eligible economic offering.
2. Exclude draining, expired, wrong-generation, wrong-region, incompatible-runtime or insufficient-isolation Hosts.
3. Check Worker/account/deployment limits, resource headroom, held cleanup slots, and committed cost.
4. Prefer a compatible warm harness, then an exact authorized file materialization, then a cold placement on existing capacity.
5. If none fits, select a compatible fitting Host shape whose accepted aggregate rate is within the ceiling; reserve its cost and identity before the provider call.
6. Queue with a meaningful reason while capacity starts, or when limits prevent scaling. No expensive or insecure fallback.
7. Drain excess idle allocations above the minimum with cooldown to avoid thrashing.

A warm match is a preference, not permission to overload memory, bypass fairness, or wait forever when another compatible Host is available. Single-Run peak resources must fit one allocation; adding more machines does not enlarge a process already running. Auto-sizing starts with conservative runtime/harness defaults and bounded observations, not unvalidated claims about memory needs. Advanced resource overrides remain possible within the offering's bounds.

The proposed pure dedicated-placement helper, prototyped as `chooseDedicatedWorkerPlacement` in the uncommitted bundle, chooses one placement/provisioning hint. It is **not** an autoscaler service or transactional admission grant. Baseline reconciliation, scale-down, provider create recovery, pending demand accounting, and eventual activation still require integration.

### Atomic admission and avoiding head-of-line blocking

Placement feasibility is part of scheduler eligibility before selecting the next organization/run. Do not repeatedly select a Run pinned to a full Worker and prevent a later independent eligible Run from starting. Preserve FIFO and one writer for each Worktree.

Under a documented consistent lock order, claim Worker revision, Host generation, slot/resources, Worktree writer and Session turn, and funding obligations in one short transaction. Release database locks before provider, storage, or model I/O. PostgreSQL ownership remains authoritative across processes and Hosts. Recheck a pure placement hint under locks; stale snapshots are never authority.

Count reserved/provisioning allocations toward the spending ceiling before provider billing starts. Count uncertain or draining allocations until provider-confirmed release. A late/failed provider call cannot erase an authorized financial obligation. Retry provisioning by persisted provider identity/receipt, not by blindly issuing another create.

Keep slots through capture, persistence, quiescence, and cleanup. An active-run-status count alone does not express these obligations. Existing product-tier concurrency limits remain legitimate; expose effective limits and reject unusable requests rather than silently selling capacity above a hidden ceiling.

## 7. Host, HostRun, and live harness ownership

**Host** owns provider binding, unique immutable generation/boot identity, actual resource shape, accepted offering/rate revision, observed lifecycle, control capability, and allocation accounting. Worker owns desired policy, not a copy of runtime state.

A dedicated Host belongs to one Worker. A pooled Host belongs to an internal compatible pool, not one tenant Worker. Its resource allocations reference Workers and Runs. Initial dedicated-only execution does not imply pooled safety. Keep public organization data separate from platform fleet state; supporting pooled Hosts requires real allocation/containment integration, not merely allowing a nullable `worker_id`.

**HostRun** records each placement attempt and its immutable Host generation. Allow multiple historical assignments for a Run, with a partial unique active-Run claim. A transport retry reuses the same assignment. Replacement after confirmed pre-launch failure creates a new fenced assignment. Ambiguous native execution is never automatically replayed.

**Live harness handle** owns a retained process containment boundary across turns. A HostRun temporarily acquires it and supplies the current Run credentials, deadline, tools, and tracing. Between turns it has no valid Run authority. Release may leave a quiesced handle cached, but the previous HostRun has no residual right to send commands. Use assignment and turn fences on late control messages.

The handle may initially live in Host-controller memory with advisory generation-keyed cache metadata. A controller restart that cannot safely adopt the existing process population must fence or terminate it; loss of metadata does not make orphan writers harmless. Do not add a public resident-session resource or a second durable execution scheduler.

## 8. Isolation and containment

`dedicated=true` reserves capacity exclusively for one Worker. It does not promise immutable physical hardware. `isolate_runs=false` allows the documented trusted-sharing boundary **within that Worker**, not access to other organizations or other untrusted customer applications.

A single organization may represent many mutually untrusted customers. Organization membership alone is not sufficient evidence that arbitrary sibling processes may share credentials, writable folders, or introspect one another.

Per-Run/handle process ownership must cover descendants and daemonized tools. Cgroups/resource controls, process groups, UID/user namespaces, mount boundaries, and syscall/provider constraints each solve different parts of the problem. A root PID or shared UID enumeration is insufficient. Root inside a provider container does not prove delegated cgroup/mount support. Probe and acceptance-test the selected backend; refuse unsupported advertised guarantees.

Even trusted shared execution needs scoped cancellation, temp files, control records, gateway credentials, memory/CPU/PID limits, and safe cleanup. Shared failures can still affect a Host; do not promise microVM-equivalent isolation when unavailable.

For pooled cross-customer execution, independent tenant containment and accounting are release gates. Until verified, `dedicated=false` server requests must fail explicitly; never silently allocate dedicated resources at a pooled price or launch multiple tenants under one agent UID.

## 9. Runtime environment and persistence

Pin a managed runtime specification: trusted supervisor version, native harness adapters/formats, base environment, and supported capabilities. Customer dependency customization is separate from privileged supervisor code; do not allow arbitrary customer images to replace the trusted controller. Adding custom environment builds is an extension, not required for the initial managed runtime.

The execution environment is:

```text
versioned runtime
+ authorized Worktree materialization or temporary working directory
+ harness-specific continuation resources
+ temporary Run credentials and scratch files
```

Host-side paths are collision-free and controller assigned. A namespace-isolated Run may see stable mount paths such as `/workspace`; it need not see globally unique absolute paths. Stable paths can simplify continuation. No untrusted arbitrary absolute directory from an API request is accepted.

### Durable continuation

A Session may need a native identifier, local files, or both. A native ID is not proof that an upstream service stores the entire conversation remotely. The adapter owns prepare/resume/export compatibility, authentication exclusions, and whether warm reuse is supported. Generic `run()`/`close()` remains usable for a cold-only adapter; capabilities can be added without forcing every provider to retain a process.

A successful persistence contract means continuation is possible on compatible fresh compute using the last verified state. It is not a guarantee of portable live RAM, arbitrary cross-harness continuation, or exactly-once upstream effects. Local quiescence/snapshot publication and a remote provider's own state mutation cannot be made one distributed atomic transaction; unknown remote outcomes remain explicit.

The existing publication transaction already stores Worktree state and Session continuation together. Keep that coherent boundary. Do not build another public filesystem or SessionCheckpoint product. Preserve ignored/hidden customer files and required native history; **blanket dotfile exclusion is incorrect**. Continue excluding injected credentials and transient runtime configuration, and rejecting those entries on restore. This is a known-auth exclusion, not a generic scanner promising to find every customer secret.

A Run may fail while successfully persisting files, or return model output while persistence fails. Keep execution, persistence, and external Git sync outcomes distinct. Failed capture/persistence quarantines that Run's unpublished state; do not pause all unrelated execution as a normal recovery action. Reuse only the last verified state unless the user explicitly undertakes recovery.

## 10. Caches and correctness

Treat three optimizations independently:

| Cache | Saved work | Identity |
| --- | --- | --- |
| Worktree materialization | Downloading/restoring files | Host generation + Worktree revision + authorized view + compatible runtime |
| Native continuation files | Reload/download of native state | Session continuation revision + adapter compatibility + authorized view |
| Warm harness process | Native initialization and conversation load | Session revision + runtime/harness/config/tools/permissions + expected filesystem view |

Neither cached files nor a suspended process is authoritative. External edits simply advance the durable revision; on prepare, compare the requested revision under the writer claim. No correctness-critical invalidation broadcast is necessary.

Do not present an unrestricted cache to a restricted Run just because the Worktree revision matches. Either cache authorized projections or protect the full cache and build restricted execution views. Namespace/filesystem enforcement, not merely a model prompt, must uphold the actual guarantee.

Record `clean`, `active`, or `recovery_required` state. A dirty cache is never a cache hit. Eviction can remove only idle, durably published content; pinned active materializations and retained handles need coordinated eviction. Replace stale trees atomically or rebuild in an unused path, rather than deleting data beneath another process.

Check warm feasibility before building large restore manifests; on a cache hit do not enumerate/upload every unchanged chunk first. Full verification on initial materialization and publication remains mandatory. Rehashing every byte before every trusted clean-cache hit should not be the default unless integrity cannot otherwise be maintained.

## 11. Metering, prices, and spending controls

### Predictable rates

Pooled pricing uses published resource rates based on fleet economics and margin. Do not charge a quarter-memory customer an entire otherwise empty Host solely because of placement, and do not retroactively change their rate as other tenants leave. Fleet utilization is platform overhead/rate-setting input, not customer placement-based billing.

Dedicated pricing charges the accepted whole-allocation rate while it is billable, including idle time. Model and tool usage remain per Run. No concurrent Run receives the entire shared Host bill again. A subscription buys access/limits; compute and upstream usage are separate disclosed meters. Do not assume pass-through model pricing without checking the existing accepted product rate rules.

Resource meters are allocated memory-time and measured active CPU-time where supported, using **MiB and core-milliseconds** internally. Missing CPU measurements are unknown, not measured zero. A reserved-CPU offering may have a different explicitly advertised meter; do not label it active CPU. Explicitly retained warm memory is either a disclosed allocation charge or platform-paid opportunistic cache; never an unexplained idle bill.

Use immutable price revision and billing epochs, cumulative monotonic counters, integer micro-USD, and durable last-settled samples. Charge the difference between rounded cumulative totals so polling frequency cannot increase the bill. Duplicates produce zero new charge; regressing samples fail and require reconciliation. Provider resets create a new fenced epoch rather than silently resetting counters. Corrections/refunds use existing financial journals.

### Hourly ceiling

`max_hourly_compute_cost_micro_usd` bounds the **aggregate committed compute rate**, not a monthly budget and not LLM/tool spend. At any new allocation, sum accepted obligations across ready, provisioning, draining, and unconfirmed-stop allocations. Reserve the liability atomically before calling the provider. For resource pricing, use the maximum authorized CPU allocation plus memory to compute a conservative peak rate.

A cap does not guarantee that unlimited demand runs immediately. When a compatible new allocation would exceed it, queue with `worker_cost_limit` or fail bounded admission. A single Run too large to fit an affordable allocation cannot be split across Hosts without a separate distributed execution model.

Existing obligations may continue through graceful shutdown; disclose whether provider startup/termination minimums or other charges apply. Do not promise an absolute invoice cap if the meter can impose costs outside it. Capped admission and prepaid funding remain separate checks. Provider price changes, replacements, and rate updates require the defined acceptance policy; no surprise upgrade.

## 12. Internal data model

Follow existing UUIDv7, bigint micro-USD, typed domain ports, short SQL transactions, and encrypted storage conventions. Do not add a second ORM/schema source.

| Relation | Main ownership and constraints |
| --- | --- |
| `workers` | Tenant identity; typed desired-state/config revision; resolved economic/runtime/isolation/scaling settings; expiry; accepted funding policy |
| `hosts` | Provider identity/generation, pool or dedicated Worker association, actual shape, quote epoch, lifetime, lifecycle observation |
| `host_allocations` | Required for pooled resources: Worker/tenant resource/time reservation on a platform Host; dedicated case may use whole allocation |
| `host_runs` | Own ID, Run ID, attempt ordinal, Host/allocation/generation, resource/slot claim, native launch/cleanup; at most one live assignment per Run |
| materialization metadata | Generation, Worktree revision, permission-view identity, clean-state and resource footprint; hint plus local verification |
| usage receipts | Accepted quote/meter epoch, cumulative observation, durable settled cursor and ledger reference; reuse existing ledger/journal mechanisms |

Do not duplicate frozen Run inputs in competing state stores. Use `runs.execution_binding` for its existing durable orchestration phase and reference HostRun assignment identity. Make fields required for indexed admission/fencing relational; keep provider-specific bindings behind typed provider ports.

Runtime handles need not be durable public entities. Historical HostRun retention and billing records follow existing retention controls. Worktree/Session references are nullable only for invocation modes that actually support temporary/omitted state; make admission, presentation, and tests agree before changing schema nullability.

## 13. Implementation and migration order

The repository is prelaunch. Replace old public Sandbox semantics in one coordinated release after implementation is verified, rather than carrying a permanent compatibility API. Preserve real file/session/accounting history. Do not rewrite historical migrations or reinterpret old financial receipts as new billing.

1. **Policy and recovery groundwork:** establish the revised design, deterministic economic/lifecycle/placement/meter functions, and regression coverage for required hidden continuation state. The prior uncommitted implementation bundle covers this limited slice; repository integration is still required.
2. **Durable Worker/Host/HostRun ownership:** forward migration; tenant authorization; unique live claims; desired-state operations; rate/funding receipts and provisioning identity. Apply only to disposable fixtures until accepted.
3. **Provider/runtime containment:** verify backend capabilities; scoped paths/identities; run-indexed controller; stable live-harness boundary; cancel/capture A without affecting B. Keep concurrency one until this is proven.
4. **Scheduler and scaling integration:** placement-aware eligibility; atomic claims; min-capacity reconciliation; incremental provisioning; idle drain; generation replacement; quotas and cost ceilings. No paid calls during default tests.
5. **Authorized file and warm caches:** clean revision/view checks, cold-resume acceptance, bounded memory/count/TTL, per-turn credentials. Avoid a full download/manifest pass on a confirmed hit.
6. **REST/SDK/CLI/MCP/UI cutover:** replace endpoints, update authoritative OpenAPI first, regenerate contracts and all SDKs with the existing tools, use effective limits and async lifecycle UX, update all current public guides/examples. Do not hand-edit generated files.
7. **Pooled offering activation:** implement allocation/metering and tenant containment with explicit acceptance. Publishing a pure metering function does not enable this product. Keep unsupported combinations rejected.
8. **Complete acceptance and clean removal:** real PostgreSQL concurrency/failure tests, native Docker, API journeys, SDKs, browser/CLI, docs generation, and measured scaling. Remove superseded Sandbox code/tests only after replacements protect their useful invariants. Do not delete tests just to hide failures.

Documentation commits do not enable the target endpoints or move uncommitted implementation into the repository. See the implementation record for the code, verification, and publication boundaries. Keep this work on the unmerged feature branch until the coordinated cutover and acceptance are complete.

## 14. Required verification and deferred work

The release evidence must include: duplicate provision/claim races; paused-but-busy lifecycle; late callbacks from old Host/assignment generations; limited-credit and failed-stop accounting; exact price ceilings; cache view revocation; cold resume without original Host; process grandchildren and daemon cleanup; wrong-tenant isolation; no replay on ambiguous launch; capture/persistence failure local to one Run; endpoint/SDK consistency; and sustained queued/concurrent traffic with memory, storage, gateway and database observations.

Keep speculative features out of this refactor: demand prediction, arbitrary cross-harness session conversion, collaborative multiple writers, customer-defined schedulers, public Host/process/cache CRUD, automatic cross-region failover without authorization, and arbitrary image builds that replace the trusted supervisor.

The unresolved deployment work is not evidence that the architectural primitives need reopening. The material decisions still requiring real inputs are the offered regions/runtime/capability matrix, published production rate cards/default spending limits, and the hosted isolation backend. Do not guess them. [TODO](../features/execution/workers/TODO.md) records owners, verification boundaries, and the implementation sequence.


## Changelog

[Worker architecture evolution](changelog/workers.md) preserves the previous sandbox model, the intermediate single-Host proposal, and why the accepted design became a cost-controlled autoscaling target. It is decision history, not release evidence.
