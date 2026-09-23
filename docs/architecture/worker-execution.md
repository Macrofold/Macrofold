# Worker and shared-host execution target architecture

**Status:** Accepted target design; not yet implemented.  
**Current behavior:** [Reusable sandboxes](../features/execution/sandboxes.md) remain the implemented contract until the migration in this document lands.  
**Scope:** public compute UX, shared-host concurrency, runtime isolation, cache reuse, scheduling, failure recovery, billing, and migration from worktree-bound sandboxes.

This document defines the intended replacement for the current one-sandbox/one-worktree/one-active-run compute model. It deliberately separates durable agent state from disposable compute while keeping the public API small.

## Decision summary

Macrofold should use these concepts:

| Audience | Concept | Meaning |
| --- | --- | --- |
| Public | Worker | Optional user-controlled reusable compute |
| Public | Run | One execution request |
| Public | Worktree | Durable filesystem/Git identity |
| Public | Session | Durable conversation identity |
| Internal | Host | The currently provisioned machine/container backing compute |
| Internal | HostRun | One Run's temporary claim on a Host, including slot and process ownership |
| Internal | HostWorktreeCache | A Host-local materialization of one Worktree revision |
| Internal | Warm session | A compatible native harness process kept alive between Runs |

The central invariants are:

> A Worker is compute, not agent state.

> A Worktree or Session never belongs to a Worker or Host.

> A Run may optionally target a Worker. If it does not, Macrofold chooses compute automatically.

> A Worker normally has one serving Host generation at a time. Replacing the physical Host does not replace the logical Worker.

> Everything on a Host is disposable unless it has been published to Macrofold's durable state.

> Cache locality improves latency only. Correctness never depends on cache locality.

This is intentionally not a direct rename of Sandbox to Worker.

---

## 1. Why the current sandbox model should change

The implemented reusable-compute model is effectively:

~~~text
Sandbox
  -> one worktree
  -> one active run
  -> one /workspace
  -> one /agent-home
  -> at most one resident native harness
~~~

That is coherent for sequential reuse of one worktree, but it conflicts with the target workloads:

~~~text
one reusable compute allocation
  -> many worktrees
  -> many sessions
  -> many simultaneous runs
  -> many warm harnesses
~~~

The current code encodes the old assumption in several places:

- a sandbox stores one worktree_id;
- a sandbox stores one active_run_id;
- acquireSandbox() enforces one worktree per sandbox;
- sandbox-control maintains one global active run;
- sandbox-control maintains one global resident harness;
- runtime paths are fixed to /workspace and /agent-home;
- process cleanup scopes to every process owned by the shared agent UID;
- control mutations are globally serialized;
- current public documentation correctly states that concurrent agents in one server are not supported.

The correct fix is not to add an array of active_run_ids to Sandbox. The compute resource should stop owning logical state.

---

## 2. Design goals

### 2.1 UX

The common path must remain simple:

~~~text
Most callers:
  POST /v1/runs

Callers who want explicit reusable compute:
  POST /v1/workers
  POST /v1/runs with worker_id
~~~

A caller should not need to understand Hosts, HostRuns, cache records, process groups, generations, or provider bindings.

Existing Run context semantics should remain intact: a native Run selects one execution context such as a workspace, worktree, or session according to the existing API contract. worker_id is orthogonal to that context.

In particular, continuing a Session must not require the caller to redundantly supply its Worktree.

### 2.2 Performance

The architecture should make the fast path cheap:

- avoid machine provisioning when an explicit Worker is already running;
- avoid Worktree restore when the exact required revision is already on the Host;
- avoid harness startup and native session reload when a compatible harness process is warm;
- run unrelated Worktrees concurrently on one Host;
- avoid global controller serialization;
- scale horizontally by adding Workers rather than turning one Worker into an opaque cluster.

### 2.3 Extensibility

Lifecycle, hardware, tenancy, region, and future accelerator choices should be orthogonal.

A GPU Worker, high-memory Worker, dedicated Worker, short-lived Worker, and long-lived Worker should still be the same resource type.

Do not create a different execution architecture for every provider.

### 2.4 Simplicity

Prefer existing durable resources and lifecycle machinery where they already fit:

- keep Run as the execution object;
- keep Session as the public conversation identity;
- keep Worktree as the filesystem identity;
- reuse run lease generation and durable execution state;
- keep provider-native continuation state behind harness adapters;
- avoid introducing a public ExecutionLease or ResidentSession resource;
- avoid a generic session filesystem abstraction.

---

## 3. Public naming and internal naming

### 3.1 Worker is the public term

Externally, the compute resource is a **Worker**.

That is the best developer-facing concept even though the codebase already uses the word worker for pollers, orchestration processes, and native worker processes. Internal naming collisions are implementation concerns; public terminology should optimize for API users.

Examples:

~~~text
Create a Worker.
Send Runs to that Worker.
Pause the Worker when the burst is finished.
Use a long-lived Worker for sustained agent traffic.
~~~

### 3.2 Host is the internal physical resource

A **Host** is the currently provisioned execution environment:

- a local Docker container;
- a Vercel Sandbox or similar time-bounded VM;
- a Render service or other server-backed container;
- a future VM, GPU instance, or other machine provider.

Host is not a normal public API resource.

### 3.3 HostRun is the internal execution claim

A **HostRun** binds one Run to one Host generation until host-side cleanup is complete.

It owns:

- the Worker/Host slot;
- process containment;
- run-scoped paths;
- runtime-control ownership;
- generation fencing;
- release state.

HostRun remains internal.

A separate HostRun lifecycle is useful even though Run is the public execution object because the public Run can become terminal before host cleanup and slot release finish. The Host slot must remain owned until cleanup is actually complete.

---

## 4. Durable logical resources remain authoritative

### 4.1 Worktree

A Worktree remains the durable filesystem/Git identity.

A Worktree is not a directory on a Host.

A Host may have a cached materialization:

~~~text
Host H has Worktree W at revision R
~~~

but the authoritative revision remains in Macrofold's database and object storage.

The existing one-active-writer invariant remains authoritative across every Worker and Host.

### 4.2 Session

A Macrofold Session remains the stable public identity of a continuing conversation.

The Session is not owned by a Worker.

The current architecture already has the right broad representation: a Session can carry a provider/harness-native continuation identifier plus optional state files.

Continuation is harness-specific and may require:

~~~text
native_session_id / resume_id only
local persisted native state only
both
~~~

Do not make a universal /sessions/<id> filesystem layout part of the domain contract.

Do not add a public SessionCheckpoint resource.

The harness adapter should define what continuation state it requires and how to restore it.

### 4.3 Run

Run remains the only public execution object.

A native Run continues to reference or resolve:

- exactly one existing execution context according to current API semantics;
- agent/harness configuration;
- model;
- prompt;
- permissions/connections;
- budget and timeout;
- scheduling metadata;
- optional worker_id.

No caller creates a HostRun.

---

## 5. Worker: public compute resource

A Worker is a logical reusable compute allocation.

It has a stable worker_id and compute/lifecycle configuration.

It does not own:

- workspace_id;
- worktree_id;
- session_id;
- agent_id;
- run_id;
- authoritative files;
- authoritative conversation state.

A Worker can execute unrelated Worktrees and Sessions from its organization concurrently.

Example:

~~~text
Worker W
  Host generation 7

  active:
    Run A -> Worktree A -> Session A
    Run B -> Worktree B -> Session B
    Run C -> Worktree C -> stateless/new session

  cached:
    Worktree D @ revision 91
    warm Session E process
~~~

### 5.1 Worker versus physical machine identity

worker_id identifies the logical compute resource, not an immutable kernel, VM, or container.

Macrofold may replace the backing Host because of:

- provider lifetime limits;
- failure;
- maintenance;
- image upgrades;
- resizing;
- region failover;
- security rotation.

The Worker survives replacement where its lifecycle permits it.

The contract is:

> Runs targeted to this Worker use this reusable compute allocation and benefit from whatever compatible local state remains available.

The contract is not:

> This exact operating-system instance is permanent.

### 5.2 One serving Host per Worker

For conceptual clarity and predictable economics, one Worker should normally map to one serving Host generation at a time.

During graceful replacement there may briefly be an old draining Host and a new provisioning Host, but new placement must have one clear serving generation.

If a customer needs more horizontal capacity, they create additional Workers.

Do not silently turn one Worker into an elastic multi-node cluster in v1.

That keeps these statements intuitive:

- Worker size maps to one compute allocation;
- Worker concurrency describes sharing that allocation;
- Worker cost is understandable;
- cached state has one obvious locality domain.

A future pool/cluster resource can be introduced separately if demand justifies it.

---

## 6. Worker lifecycle

Use lifecycle as a top-level field rather than treating lifecycle as a different resource type.

Suggested API:

~~~json
{
  "lifecycle": "short_lived"
}
~~~

or:

~~~json
{
  "lifecycle": "long_lived"
}
~~~

This leaves size, GPU, region, tenancy, and other resource choices orthogonal.

### 6.1 Short-lived Worker

A short-lived Worker is optimized for bursts.

It:

- provisions a bounded-lifetime Host;
- supports many concurrent Runs;
- is reusable across many Runs;
- remains warm while traffic continues according to idle policy;
- has a provider/deployment maximum lifetime;
- expires when its hard lifetime is reached unless the API later explicitly adds renewal semantics.

Important:

> Short-lived does not mean one-run-only.

The intended workload is:

~~~text
first request
  -> Host starts

20 agents
  -> run concurrently

later requests
  -> reuse the same Worker and caches

idle timeout or hard lifetime
  -> Worker stops/expires
~~~

This supports bursts where the customer wants agents to share one machine but does not want to pay for server-style compute indefinitely.

A provider such as Vercel Sandbox can initially back this lifecycle.

### 6.2 Long-lived Worker

A long-lived Worker is optimized for sustained utilization.

It:

- is backed by server-style compute;
- supports many concurrent Runs;
- may remain available indefinitely while enabled and funded;
- may use idle_timeout_seconds = null;
- can be paused, resumed, or destroyed;
- survives Host replacement as the same logical Worker.

This is the natural mode for workloads such as OpenLegend where continuous high utilization makes repeated ephemeral provisioning economically unattractive.

A provider such as Render can initially back this lifecycle.

### 6.3 Failure replacement

A Host failure does not automatically destroy its Worker.

For a long-lived Worker, Macrofold should provision a replacement Host when policy and funding permit.

For a short-lived Worker, Macrofold may replace a failed Host within the Worker's unexpired lifetime. The replacement does not extend the hard expiration into an indefinite resource.

---

## 7. Dedicated compute

Some users need stronger compute-tenancy guarantees.

Support an optional advanced Worker field:

~~~json
{
  "dedicated": true
}
~~~

Meaning:

> The backing compute allocation is not shared with another customer's Worker.

This does not promise permanent physical-machine identity. Macrofold may replace one dedicated Host with another dedicated Host.

It also does not mean one Host per Run. Many Runs can still share the dedicated Worker.

### 7.1 Initial cross-tenant rule

For simplicity and security, the first shared-host implementation should **not** multiplex different Macrofold organizations inside the same Host.

A Worker belongs to one organization, and its Host executes only that organization's Runs.

This removes a large class of cross-tenant isolation risks while delivering the high-density use case we actually need.

Cross-organization Host packing should require a separate security review and stronger isolation design rather than arriving accidentally as a placement optimization.

---

## 8. Public Worker API

The common API should keep important controls top-level.

### 8.1 Create

~~~http
POST /v1/workers
~~~

Example:

~~~json
{
  "name": "openlegend-world",
  "lifecycle": "long_lived",
  "size": "large",
  "concurrency": 64,
  "idle_timeout_seconds": null,
  "region": "iad",
  "dedicated": false
}
~~~

Minimal:

~~~json
{
  "lifecycle": "short_lived"
}
~~~

Suggested fields:

| Field | Required | Meaning |
| --- | --- | --- |
| name | no | Human-readable unique label |
| lifecycle | yes | short_lived or long_lived |
| size | no | Macrofold compute preset |
| concurrency | no | Maximum simultaneous Runs admitted to this Worker |
| idle_timeout_seconds | no | When idle compute may stop; null only where supported |
| region | no | Preferred/required region |
| dedicated | no | Exclusive backing compute tenancy |

concurrency should have a sensible size-specific default and a validated maximum. It is a limit, not a promise that every harness mix performs well at that level.

Provider selection should normally remain an implementation detail.

### 8.2 Response

Example:

~~~json
{
  "id": "wrk_...",
  "name": "openlegend-world",
  "lifecycle": "long_lived",
  "status": "ready",
  "size": "large",
  "concurrency": 64,
  "active_runs": 17,
  "idle_timeout_seconds": null,
  "region": "iad",
  "dedicated": false,
  "expires_at": null,
  "created_at": "...",
  "updated_at": "..."
}
~~~

For a short-lived Worker, expires_at communicates the hard resource lifetime when known.

Do not expose host_id in normal customer responses.

### 8.3 Lifecycle endpoints

Initial public surface:

~~~text
GET    /v1/workers
POST   /v1/workers
GET    /v1/workers/{worker_id}
PATCH  /v1/workers/{worker_id}

POST   /v1/workers/{worker_id}/pause
POST   /v1/workers/{worker_id}/resume
POST   /v1/workers/{worker_id}/destroy
~~~

Do not add a public drain operation initially unless a real caller needs it.

Draining is still an important internal Host operation for replacement and maintenance.

Pause:

- stops new admissions;
- rejects while active HostRuns still own slots unless an explicit future graceful option is added;
- releases underlying compute;
- preserves the logical Worker;
- does not delete Worktrees or Sessions.

Resume:

- provisions a Host;
- keeps the same worker_id;
- restores Worktree/Session state lazily when Runs arrive.

Destroy:

- retires the Worker;
- releases compute;
- never deletes Worktrees, Sessions, Agents, or checkpoints.

---

## 9. Run API changes

worker_id is optional and top-level.

Do not add a nested execution.placement.worker policy object for the common case.

### 9.1 Existing context behavior stays intact

Examples:

Run against a Worktree:

~~~json
{
  "worktree_id": "wt_...",
  "prompt": "Investigate the failing tests.",
  "worker_id": "wrk_..."
}
~~~

Continue a Session:

~~~json
{
  "session_id": "ses_...",
  "prompt": "Continue from where you left off.",
  "worker_id": "wrk_..."
}
~~~

Do not require both session_id and worktree_id for continuation. The Session already owns its logical Worktree relationship.

The existing workspace-context path should likewise remain valid where supported.

### 9.2 Omitted worker_id

If worker_id is omitted, Macrofold chooses compute automatically.

The system must **not** silently use a customer's explicit Worker unless the caller targeted it.

The initial automatic path may remain today's fresh per-run isolated compute.

Later, Macrofold may optimize automatic placement with platform-managed warm Hosts without changing the Run contract.

### 9.3 Explicit worker_id

If worker_id is present:

- authorize the Worker;
- ensure its lifecycle/status permits new work;
- ensure the Run is compatible with its region/resources/isolation capabilities;
- wait for Worker capacity if full;
- execute only on that Worker.

A full Worker should produce a specific queued reason such as worker_capacity rather than falling back to unrelated compute.

---

## 10. Automatic placement

Automatic placement is an internal optimization problem.

Hard filters come first:

- execution/harness capability;
- region constraints;
- resource requirements;
- required isolation;
- sufficient remaining lifetime;
- available capacity.

Among eligible Hosts, prefer:

1. exact compatible warm Session process;
2. exact required Worktree revision already cached;
3. suitable warm Host with spare capacity;
4. fresh compute.

Conceptually:

~~~text
Run without worker_id
  |
  +-- exact warm Session available? ---- yes --> use it
  |
  +-- Worktree revision cached? -------- yes --> use it
  |
  +-- warm managed Host has capacity? -- yes --> restore there
  |
  +-- otherwise ------------------------------> provision fresh
~~~

This ordering is performance policy, not correctness policy.

The authoritative state always determines what must be restored.

---

## 11. Host: internal compute

Suggested Host responsibilities:

- provider binding;
- Worker association, if any;
- organization association;
- generation;
- lifecycle/health state;
- region and resource shape;
- concurrency capacity;
- hard expiration;
- idle state;
- runtime-control secret;
- billing/runtime observations;
- image revision.

A Host should not contain worktree_id or active_run_id ownership fields.

### 11.1 Generation fencing

Every replacement of a Worker's backing Host increments generation.

Every HostRun records the generation on which it was admitted.

A stale request from an old generation fails closed.

This generalizes the useful generation-fencing behavior already present in the sandbox implementation.

---

## 12. HostRun: internal slot and cleanup ownership

A HostRun exists because the Host slot has a lifecycle that is not identical to the public Run status.

For example, the public Run may publish its terminal result while the runtime still needs to release/finalize the Host. Capacity must not be reused prematurely.

Suggested fields:

~~~text
host_runs
  run_id unique
  host_id
  host_generation
  worker_id nullable
  worktree_id
  session_id
  state
  slot_cost
  containment_id
  workspace_path
  state_path nullable
  temp_path
  control_path
  claimed_at
  released_at
~~~

Possible internal states:

~~~text
claiming
preparing
running
capturing
releasing
released
quarantined
~~~

Do not duplicate the public Run state machine here.

HostRun only owns Host-local execution/cleanup state.

A future implementation may fold some fields into existing execution_binding if that remains queryable and transactionally safe, but capacity ownership and generation fencing must remain explicit and indexable.

---

## 13. HostWorktreeCache

Do not use WorkspaceResidency as the primary name. It suggests ownership.

Use an explicitly cache-oriented concept such as **HostWorktreeCache**.

It means only:

> Host H currently has a local materialization of Worktree W at durable revision R.

Example:

~~~text
authoritative:
  Worktree X @ revision 50

Host A:
  Worktree X @ revision 50

Host B:
  Worktree X @ revision 47
~~~

A Run needing revision 50 may reuse Host A immediately.

Host B must refresh.

The same Worktree may be cached on zero, one, or many Hosts.

### 13.1 Suggested metadata

~~~text
host_worktree_cache
  host_id
  worktree_id
  revision
  checkpoint_id
  state
  size_bytes
  last_used_at
~~~

Possible states:

~~~text
clean
active
stale
recovery_required
evicting
~~~

### 13.2 Prepare

Before reuse verify:

- Worktree identity;
- authoritative revision;
- Host generation;
- cache is clean;
- no failed/unpublished previous writer remains;
- required integrity conditions.

### 13.3 Publication

After a successful writer:

1. stop/freeze only that HostRun's writers;
2. capture its changes;
3. verify objects;
4. publish the authoritative Worktree checkpoint/revision;
5. mark the local cache clean at the new revision;
6. release the writer claim.

If publication fails, the local directory is not authoritative.

Mark it recovery_required or quarantine it and never let a later Run silently build on that state.

### 13.4 External edits

Dashboard/API/Git edits simply advance the authoritative Worktree revision.

No correctness-critical cache invalidation broadcast is required.

The next Run compares cached revision with authoritative revision and refreshes if different.

An invalidation signal may be added later purely as an optimization.

### 13.5 Eviction

Evict only when:

- no HostRun is using the Worktree;
- all relevant changes are durably published;
- eviction will not invalidate a retained warm harness that still requires that exact local Worktree state.

Use bounded disk accounting and an LRU/size-aware policy.

---

## 14. Session continuation and warm sessions

### 14.1 Durable continuation is harness-specific

Do not standardize every Session as a directory.

The current Macrofold representation already supports the important cases:

~~~text
Session
  native_session_id / resume identifier
  optional state_files
~~~

A harness adapter may require:

- only a provider/native ID;
- only local state files;
- both.

These are implementation details behind the stable Macrofold session_id.

### 14.2 Local state paths are optional

When a harness requires local continuation files, the Host controller can bind an adapter-specific state directory.

Conceptually:

~~~text
/worktrees/<worktree-id>/
  cached Worktree materialization

/harness-state/<session-id>/
  optional adapter-local continuation state

/run-tmp/<run-id>/
  temporary files

/platform-control/runs/<run-id>/
  protected control state
~~~

The exact paths are not public contracts.

A harness that needs no local files should not receive a fake permanent session filesystem merely to satisfy the abstraction.

### 14.3 Warm session definition

A **warm session** means:

> a compatible native harness process for a Macrofold Session is still alive on the Host and can accept another turn.

It is not merely cached session files.

The Host controller retains metadata such as:

~~~text
session_id
process containment
compatibility fingerprint
native resume identity
required Worktree revision
memory estimate
last_used_at
~~~

After one Run finishes:

1. descendants that must not persist are terminated;
2. the harness process tree is quiesced/suspended;
3. durable Worktree and Session continuation state is published;
4. the warm process remains as a best-effort cache.

For the next compatible Run:

1. refresh run-scoped credentials;
2. bind the new deadline/budget/tracing identity;
3. resume the process;
4. deliver the new turn.

If the Host disappears, warmth disappears. The Session does not.

### 14.4 Warm cache bounds

Warm processes consume memory even while idle.

Bound them independently from active concurrency by:

- maximum warm process count;
- maximum warm memory;
- per-session idle expiry;
- Host memory-pressure threshold.

Evict warm processes before compromising active Runs.

No public ResidentSession resource is needed.

---

## 15. Runtime path model

Replace the current global /workspace and /agent-home assumptions with controller-assigned paths.

At minimum, the runtime must be able to bind:

- Worktree root;
- optional harness continuation-state root;
- run temporary root;
- protected run control root.

A new Run must not clear another Worktree's directory merely because its harness cannot be reused.

Worktree-file reuse and warm-process reuse are separate decisions.

This separation is essential:

~~~text
files match, warm process absent
  -> reuse files, cold-start harness

files match, warm process compatible
  -> reuse files and harness

files stale
  -> refresh files before execution

warm process incompatible
  -> evict/cold-start without deleting unrelated clean cache
~~~

---

## 16. Process ownership and isolation

This is the prerequisite for shared-host concurrency.

The current UID-wide process cleanup model cannot remain.

Required invariant:

> Cancellation, timeout, checkpointing, and cleanup for Run A must be mechanically unable to signal Run B's processes.

A root PID alone is insufficient because tool processes and daemonized descendants may outlive it.

### 16.1 Containment

Preferred Linux implementation:

- cgroup v2 per HostRun;
- process-group/session ownership;
- resource limits at that boundary;
- scoped freeze/kill/accounting;
- user and mount namespaces where required by the chosen isolation guarantee.

Operations become:

~~~text
freeze HostRun A
kill HostRun A
measure HostRun A
~~~

not:

~~~text
signal every process with UID 10001
~~~

### 16.2 Filesystem isolation

Separate directories are organization, not security.

The first multi-run Worker implementation should document exactly what sibling Runs can access.

Because a Host initially serves one organization only, the immediate threat model is simpler, but run-scoped credentials and accidental cross-character file access still matter.

Use appropriate combinations of:

- distinct OS identities or namespaces;
- directory permissions;
- mount namespaces;
- cgroup resource containment;
- scoped credentials.

Do not claim one-microVM-per-Run security semantics for a shared Worker unless the implementation actually provides them.

---

## 17. Multi-run Host controller

The current singleton controller becomes run-indexed.

Remove the assumptions represented by:

~~~text
one global active run
one global resident harness
one global control mutation queue
~~~

Target shape:

~~~text
runs: Map<run_id, HostRunRuntime>
warmProcesses: bounded Map<session_id, WarmProcess>
worktreeLocks: keyed by worktree_id
sessionLocks: keyed by session_id when required
~~~

### 17.1 Lock scope

Use narrow locks.

Host lifecycle lock:

- drain;
- replacement;
- pause;
- shutdown.

Worktree lock:

- restore/refresh;
- writer prepare;
- capture/publication;
- cache eviction.

Session lock:

- continuation-state restore/update;
- warm process handoff.

Run lock:

- launch marker;
- cancellation;
- input;
- result;
- release.

There should be no global serialization of unrelated Runs.

### 17.2 Responsive control

A slow restore or snapshot for Run A must not prevent:

- cancelling Run B;
- delivering input to Run C;
- probing Run D.

Use bounded concurrency for expensive controller operations.

---

## 18. Scheduling

Preserve the existing scheduling concerns:

- organization concurrency;
- deployment concurrency;
- worktree writer exclusion;
- queue deadlines;
- scheduling class;
- weighted fairness.

Add explicit Worker/Host capacity as a separate dimension.

### 18.1 Explicit Worker admission

A Run targeted to a Worker can start only if:

- Worker is authorized;
- Worker accepts new Runs;
- Worker has a usable Host or can provision one;
- Worker has a free slot;
- Worktree writer ownership is available;
- organization/global limits allow the Run.

Claim these transactionally.

The Worker slot remains owned until HostRun release, not merely until the public Run result is published.

### 18.2 Automatic placement

Runs without worker_id participate in normal global scheduling and then receive suitable managed compute.

Automatic placement may use cache affinity, but must not steal capacity from customer-created Workers.

### 18.3 Worktree serialization remains global

These cannot write concurrently:

~~~text
Run A -> Worktree X -> Worker 1
Run B -> Worktree X -> Worker 2
~~~

The Worktree writer fence is independent from compute placement.

Different Worktrees may execute concurrently on the same Worker.

---

## 19. Capacity and concurrency

Worker concurrency is a configured admission ceiling for one compute allocation.

Example:

~~~json
{
  "size": "large",
  "concurrency": 64
}
~~~

This means at most 64 HostRuns may concurrently own slots.

It is not a claim that 64 arbitrary harnesses will perform well.

Validate concurrency against:

- size;
- plan;
- provider constraints;
- deployment safety limits.

Measure memory and CPU per harness mix.

OpenLegend can scale vertically until a Worker reaches measured safe capacity, then scale horizontally by creating additional Workers.

---

## 20. Failure semantics

### 20.1 Host loss before launch

If loss is conclusively known before the execution marker exists:

- choose/provision another Host according to policy;
- restore durable state;
- launch normally.

### 20.2 Ambiguous launch

Preserve the existing safety rule:

> Never silently replay a prompt when execution may already have started.

### 20.3 Host loss during execution

- active HostRuns fail/interruption is recorded;
- last verified Worktree and Session continuation state remain authoritative;
- uncheckpointed local changes may be lost;
- Worker may receive a replacement Host;
- unrelated durable resources survive.

### 20.4 One Run's persistence failure

A failure to publish Run A must:

- quarantine A's local state as needed;
- leave B and C running;
- avoid pausing/destroying the whole Worker;
- preserve the prior verified durable revision.

### 20.5 Host replacement

Replacement:

1. stop admitting new Runs to the old Host;
2. allow safe active HostRuns to finish where possible;
3. publish verified state;
4. provision the next generation;
5. route new Runs to that generation;
6. retire old compute.

The Worker ID remains stable.

---

## 21. Persistence boundary

### 21.1 Worktree state

Continue to publish verified Worktree checkpoints through existing content-addressed storage.

### 21.2 Session state

Continue to persist harness-specific continuation on the Session:

- native_session_id or equivalent;
- state_files when the adapter requires local persisted state.

Do not introduce a second general-purpose filesystem product.

### 21.3 Run finalization

A successful continuing Run should publish the Worktree and the harness-specific Session continuation coherently enough that a later cold start cannot observe an impossible mixed state.

The current publication transaction already updates Worktree checkpoint state and Session state together. Preserve that useful property while adapting capture to per-run paths.

A local cache becomes reusable only after the required durable publication succeeds.

---

## 22. Credentials and permissions

Every Run receives fresh scoped capabilities.

Never persist run credentials as Session or Worktree state:

- model gateway tokens;
- MCP/tool bearer tokens;
- provider credentials;
- temporary integration credentials;
- runtime-control secrets.

A warm harness must receive refreshed authorization for every turn.

Preserve the existing authentication-path exclusion and restore rejection logic.

---

## 23. Billing

Compute billing and Run usage remain separate.

### 23.1 Explicit Worker compute

Worker/Host compute is charged once according to the Worker product model.

Do not charge the same hour of Worker compute in full to every concurrent Run.

### 23.2 Run usage

Each Run continues to own:

- model usage;
- tool usage;
- connector usage;
- other run-specific metered services.

### 23.3 Idle cost

An explicit Worker may incur compute cost while idle if the backing Host remains active.

This is why the product needs:

- short-lived Workers;
- idle timeouts;
- pause/resume;
- long-lived Workers for high utilization.

### 23.4 Automatic compute

Runs without worker_id retain Macrofold's normal run-compute pricing semantics.

Internal managed Host pooling should not change the caller's request shape.

---

## 24. Observability

### 24.1 Public Worker fields/metrics

Expose useful operational data:

- status;
- active run count;
- queued run count;
- configured concurrency;
- expires_at for bounded Workers;
- CPU/memory metrics where trustworthy;
- uptime;
- compute cost;
- last activity;
- aggregate cache-hit metrics if useful.

Do not expose sensitive process details.

### 24.2 Run metadata

A Run targeted to a Worker may expose worker_id.

Do not expose host_id through normal customer APIs.

Operator diagnostics may expose Host generation, provider binding, cache state, containment identity, and replacement reason.

---

## 25. API design rationale

The public API should follow a few durable rules:

1. Common fields stay top-level.
2. worker_id is optional on Run.
3. Users who do not care about compute never create a Worker.
4. Users who do care can manage one directly.
5. Hosts remain implementation detail.
6. HostRun remains implementation detail.
7. Session continuation remains a single Macrofold Session concept.
8. Worker lifecycle and Run lifecycle are separate.
9. Provider-specific knobs are not required on generic endpoints.
10. Idempotency, explicit lifecycle state, and clear failure semantics remain mandatory.

This matches a useful pattern across contemporary infrastructure APIs:

- common execution parameters are direct rather than deeply nested;
- durable logical state is separable from compute;
- reusable compute is a first-class resource when users need explicit cost/performance control.

The design was cross-checked against current OpenAI Responses, Anthropic Messages, Vercel Sandbox, Render service, and Neon branch/compute API patterns. Macrofold should borrow their clarity, not copy their resource graphs.

---

## 26. Mapping from current implementation

| Current | Target |
| --- | --- |
| Sandbox public resource | Worker |
| Sandbox worktree_id | removed from Worker ownership |
| Sandbox active_run_id | HostRun slot records |
| Sandbox generation | Host generation |
| Sandbox provider binding | Host provider binding |
| keep_warm_seconds on reusable compute | Worker idle_timeout_seconds |
| long_running sandbox mode | Worker lifecycle = long_lived |
| ordinary reusable sandbox | Worker lifecycle = short_lived |
| SandboxMachines | Host-aware machine/runtime provider |
| global sandbox-control active run | run-indexed Host controller |
| one ResidentWorker | bounded warm-process cache |
| fixed /workspace | controller-assigned Worktree root |
| fixed /agent-home | optional harness-specific state root / run home |
| UID-wide cleanup | HostRun-scoped containment |
| global control queue | bounded per-resource concurrency |
| warm process tied to filesystem reuse | independent Worktree cache and warm-process decisions |

---

## 27. Illustrative database shape

Exact migrations should follow repository conventions. These schemas describe ownership, not final SQL.

### 27.1 workers

~~~text
workers
  id
  organization_id
  name
  lifecycle
  size
  concurrency_limit
  idle_timeout_seconds
  region
  dedicated
  status
  expires_at
  created_at
  updated_at
~~~

No worktree_id.

No active_run_id.

### 27.2 hosts

~~~text
hosts
  id
  worker_id nullable
  organization_id
  provider
  provider_binding
  generation
  status
  region
  size
  capacity
  image_revision
  started_at
  expires_at
  idle_expires_at
  drain_reason
  control_secret_ciphertext
  rate / billing metadata
  lifecycle lease fields
  created_at
  updated_at
~~~

### 27.3 host_runs

~~~text
host_runs
  run_id unique
  host_id
  host_generation
  worker_id nullable
  worktree_id
  session_id
  state
  slot_cost
  containment_id
  workspace_path
  state_path nullable
  temp_path
  control_path
  claimed_at
  released_at
~~~

### 27.4 host_worktree_cache

~~~text
host_worktree_cache
  host_id
  worktree_id
  revision
  checkpoint_id
  state
  size_bytes
  last_used_at

  primary key(host_id, worktree_id)
~~~

### 27.5 Warm session metadata

Do not require a durable domain table for correctness.

Host-controller memory is sufficient initially.

If scheduler affinity later needs database visibility, add advisory cache metadata keyed by Host generation. Treat it as a hint that can disappear at any time.

---

## 28. Migration plan

Do not big-bang rewrite execution.

### Phase 0 — terminology and contract freeze

Approve:

- Worker;
- lifecycle values;
- Host;
- HostRun;
- Worker API fields;
- explicit Worker versus automatic compute semantics;
- first-version isolation guarantee.

Keep current sandbox docs authoritative for shipped behavior.

### Phase 1 — introduce Host and HostRun under capacity 1

Goal: change ownership without changing behavior.

- add Hosts;
- add HostRuns;
- move provider binding behind Host;
- map each current Sandbox to one Worker/Host;
- keep Host capacity = 1;
- keep legacy API working.

Acceptance:

- existing tests pass;
- no externally visible scheduling change;
- generation fencing remains safe.

### Phase 2 — remove fixed runtime-path assumptions

- controller assigns Worktree root;
- controller assigns optional harness state root;
- controller assigns run temp/control roots;
- restore, snapshot, documents, stdio, and adapters use the assigned paths.

Acceptance:

- one-run behavior remains correct;
- Session continuation works after cold restore;
- no adapter requires global /workspace or /agent-home.

### Phase 3 — HostRun-scoped process containment

This must land before concurrency.

- cgroup/process containment per HostRun;
- scoped freeze;
- scoped kill;
- scoped resource measurement;
- descendant/daemon coverage.

Acceptance:

- cancel A never affects B;
- timeout A never affects B;
- checkpoint A never affects B;
- daemon descendants cannot escape cleanup;
- local Docker and long-lived hosted provider both pass.

### Phase 4 — multi-run Host controller

Replace singleton active/resident/global-queue state with run-indexed state.

Add:

- independent launch/probe/cancel/input/result;
- keyed Worktree serialization;
- keyed Session serialization where necessary;
- bounded control concurrency.

Acceptance:

- two unrelated Runs execute simultaneously on one Host;
- their events and control files remain isolated;
- slow restore A does not prevent cancel B.

### Phase 5 — HostWorktreeCache

Stop clearing/restoring files merely because the harness process is cold.

Add:

- revision tracking;
- clean/stale/recovery states;
- cache reuse;
- eviction.

Acceptance:

- cold harness reuses matching Worktree files;
- external edit forces refresh;
- failed publication quarantines cache;
- eviction never drops unpublished state.

### Phase 6 — bounded warm-process cache

Generalize the singleton resident harness into a session-indexed cache.

Add:

- compatibility fingerprint;
- memory limit;
- count limit;
- idle expiry;
- independent eviction;
- fresh credentials per turn.

Acceptance:

- Sessions A and B remain warm simultaneously;
- evicting A does not affect B;
- incompatible configuration cold-starts safely.

### Phase 7 — transactional Host capacity and placement

Extend scheduling with:

- Worker capacity;
- Host slot claims;
- worker_capacity waiting reason;
- Host generation claim;
- cache-affinity scoring.

Keep organization/global/worktree fairness intact.

### Phase 8 — Worker public API

Add /v1/workers and top-level worker_id on Run.

SDKs, CLI, dashboard, and MCP may expose Worker management where appropriate.

Do not require Worker management for ordinary Run users.

### Phase 9 — legacy Sandbox compatibility

Temporarily preserve the old API.

Compatibility behavior:

- each legacy Sandbox maps to a concurrency-1 Worker;
- legacy Worktree affinity lives only in the compatibility layer;
- sandbox_id maps internally to worker_id;
- mismatched Worktrees keep the legacy error;
- new Worker API has no Worktree affinity.

Mapping:

~~~text
long_running=true
  -> lifecycle=long_lived

long_running=false
  -> lifecycle=short_lived

keep_warm_seconds
  -> idle_timeout_seconds

sandbox generation
  -> Host generation
~~~

Do not add legacy worktree-bound fields to the new Worker schema.

### Phase 10 — provider/lifecycle hardening

Short-lived:

- bounded provider lifetime;
- idle expiry;
- burst-oriented billing;
- explicit expires_at.

Long-lived:

- server-backed Host;
- pause/resume;
- replacement generations;
- sustained-workload billing.

### Phase 11 — scale validation

Raise Worker concurrency only with measured evidence.

Test OpenLegend-like traffic across multiple Workers and tune:

- harness memory;
- CPU contention;
- checkpoint throughput;
- database contention;
- model/tool gateway load;
- cache hit rate;
- restore latency;
- control responsiveness;
- Worker replacement.

### Phase 12 — deprecate/remove Sandbox API

After a documented migration window:

- remove /v1/sandboxes;
- remove sandbox_id from the new Run contract;
- remove Worktree-bound compute assumptions;
- rename internal sandbox-specific modules where useful.

---

## 29. Required acceptance tests

### Concurrency

- two Runs execute simultaneously on one Host;
- event streams remain independent;
- control state cannot cross Runs.

### Process safety

- cancel A leaves B untouched;
- timeout A leaves B untouched;
- freeze/capture A leaves B untouched;
- daemonized descendants of A are contained.

### Worktree correctness

- same Worktree serializes across Workers;
- different Worktrees run concurrently;
- stale cache is never current;
- direct/external edits cause refresh;
- failed persistence never becomes a reusable clean cache.

### Session correctness

- Session continues on a fresh Host;
- native-ID-only harness works without fake local state;
- local-state harness restores required state_files;
- two Sessions for one Worktree do not overwrite each other's continuation;
- warm A and warm B coexist;
- warm eviction preserves durable Session continuation.

### Host failure

- confirmed pre-launch loss can move safely;
- ambiguous launch never silently replays;
- mid-run loss retains the last verified durable state;
- long-lived Worker can receive a replacement Host generation.

### Worker lifecycle

- short-lived Worker handles repeated bursts;
- each Run can keep it warm according to idle policy;
- hard expiration is enforced;
- pause/resume cold-restores correctly;
- destroy does not delete durable logical state;
- long-lived Worker survives sustained concurrent traffic.

### Billing

- one Worker interval is not charged once per concurrent Run;
- model/tool usage remains per Run;
- idle compute follows Worker policy;
- Host replacement cannot duplicate settlement.

### Scale

Sustained test:

- hundreds of active character Runs across multiple Workers;
- measured memory and CPU per harness;
- queue latency;
- checkpoint throughput;
- gateway/database load;
- process cleanup latency;
- Host replacement under load.

---

## 30. OpenLegend target use case

The intended UX should be this simple:

~~~json
POST /v1/workers

{
  "name": "openlegend-world",
  "lifecycle": "long_lived",
  "size": "large",
  "concurrency": 64,
  "idle_timeout_seconds": null
}
~~~

Then each character turn targets that Worker while preserving normal context semantics.

For a continuing character Session:

~~~json
POST /v1/runs

{
  "session_id": "ses_character_ada",
  "prompt": "Take the next turn.",
  "worker_id": "wrk_openlegend"
}
~~~

For a Run starting from a Worktree instead:

~~~json
POST /v1/runs

{
  "worktree_id": "wt_character_ada",
  "prompt": "Start a new conversation for this character.",
  "worker_id": "wrk_openlegend"
}
~~~

Behavior:

- many characters execute concurrently;
- each Worktree retains authoritative files;
- each Session retains harness-specific continuation;
- exact Worktree revisions can remain cached on the Host;
- compatible harnesses can remain warm;
- overlapping writers to the same Worktree serialize globally;
- the characters do not each require a separate VM;
- Host loss restores from verified durable state;
- additional Workers provide horizontal scale.

---

## 31. Explicitly rejected alternatives

### Keep Sandbox as the central resource

Rejected because its current semantics encode one logical Worktree environment per compute resource.

### Rename Sandbox to Worker without changing ownership

Rejected because one worktree_id plus one active_run_id preserves the architectural problem.

### Bind Worker to Workspace or Worktree

Rejected. Worker is reusable compute.

### Make Worker an elastic multi-Host cluster

Rejected for v1. It damages cost/locality clarity. Horizontal scale uses multiple Workers.

### Make Host public

Rejected for normal callers. Host replacement must remain an implementation detail.

### Make HostRun public

Rejected. Run is already the correct user execution primitive.

### Add ResidentSession

Rejected. Warmth is cache state, not durable user state.

### Standardize every Session as a filesystem directory

Rejected. Harness continuation is adapter-specific and already supports IDs, state files, or both.

### Treat short-lived Worker as one-run-only

Rejected. Burst reuse is a primary requirement.

### Guarantee permanent machine identity for long-lived Worker

Rejected. That blocks safe failure recovery and maintenance without helping the normal contract.

### Hide all compute control

Rejected. Advanced customers have legitimate cost, concurrency, region, and tenancy requirements.

### Force all callers to manage Workers

Rejected. Automatic compute remains the default.

### Multiplex multiple organizations in one Host initially

Rejected. It adds security complexity without being required for the target workload.

---

## 32. Final mental model

For users:

~~~text
I have durable files               -> Worktree
I have reusable agent config       -> Agent
I have a continuing conversation   -> Session
I want something executed          -> Run
I want control over reusable compute -> Worker
~~~

Internally:

~~~text
Run
  -> admission
  -> optional Worker
  -> Host generation
  -> HostRun
  -> optional Worktree cache hit
  -> optional warm Session process
~~~

Full picture:

~~~text
                     DURABLE LOGICAL STATE

        Agent            Worktree            Session
          \                 |                  /
           \                |                 /
            +---------------+----------------+
                            |
                           Run
                            |
                    admission / placement
                            |
              +-------------+-------------+
              |                           |
      automatic compute             explicit Worker
              |                           |
              +-------------+-------------+
                            |
                           Host
                 +----------+----------+
                 |          |          |
              HostRun A  HostRun B  HostRun C

Host-local files/processes = disposable cache
Published Macrofold state  = authority
~~~

---

## 33. Final recommendation

Proceed with the refactor.

The current reusable-sandbox implementation remains valuable foundation:

- provider lifecycle;
- generation fencing;
- verified Worktree persistence;
- durable scheduling;
- non-replay behavior after ambiguous execution;
- per-turn credentials;
- native Session continuation;
- warm harness retention.

The migration should generalize those pieces rather than replace them.

The critical ordering rule is:

> Do not enable shared-host concurrency until runtime paths, process containment, and HostRun-scoped control are genuinely independent.

Once that is true, Worktree caching, multiple warm Sessions, short-lived burst Workers, long-lived cost-efficient Workers, and affinity-aware scheduling become natural optimizations of one model instead of separate special cases.

The intended product surface remains small:

~~~text
Default:
  POST /v1/runs

Explicit compute:
  POST /v1/workers
  POST /v1/runs with worker_id
~~~

Everything below Worker and Run should remain behind the platform boundary unless a concrete customer requirement justifies exposing it.
