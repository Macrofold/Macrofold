# Saturation calibration

Follow-up to the [initial calibration](README.md), collected October 13–14, 2026. The [scaling guide](../../operations/scaling.md#resource-capacity-settings) owns effective defaults; this document records why they are reasonable and where the measurements stop.

The [machine-readable evidence](upper-bound-evidence.json) includes all measured cases, overloads, transitional diagnostics and setup failures.

## What the tests measure

A total of 10,000 completed requests does not establish capacity for 10,000 simultaneous requests. We now vary arrival rate, active requests, connection pools, payload size and retained history separately. Fixed-rate HTTP latency includes time waiting in the load generator. A generator falling ten seconds behind stops admitting more work and reports overload; already-started requests drain. Errors and overloads remain in the evidence.

Each case uses a fresh Node 24.13.0 process and disposable migrated database. HTTP cases use the actual REST handler, authorization, idempotency, SQL and response serialization. Model cases use real admission, provider HTTP, persistence and financial settlement, with a loopback provider returning after one or three seconds. They verify one provider call and one usage record per successful Run, with no leftover reservation. These are control-plane measurements, not vendor inference throughput or model-quality tests.

The dedicated local PostgreSQL 17 container has four CPUs, 2 GiB memory and 600 allowed connections. The shared Docker VM and host still serve the developer preview; timing variance remains. A separate Neon PostgreSQL 18 branch, fixed at two CU with five-minute autosuspend and three-hour expiry, checks hosted connection behavior using new empty fixture databases. Its client is on the developer machine, **not colocated with Neon**: those numbers include WAN round trips and cannot establish production regional throughput.

The separate live R2 probe uses synthetic encrypted 128 KiB objects under a unique prefix. It reads, decrypts and hashes real responses, writes new keys and removes only its own objects. No model, native agent, email, connector or webhook destination receives paid/live application traffic.

## Bottlenecks corrected

- **Schema compilation:** repeated construction of Ajv inside transactions consumed CPU for identical definitions. A bounded 128-entry immutable-schema cache keeps the same finite-schema validation and authority checks. On the matched 512-Run fixture, admission fell from 9.53 seconds to approximately 2–4 seconds; dispatch latency is reported separately.
- **Admission locking:** unrelated requests into one workspace took an exclusive deletion lock. Admissions now share that lock; deletion still excludes and drains them. Wallet and global scheduler locks remain exclusive.
- **Polling amplification:** a slow cancellation/heartbeat query allowed later interval callbacks to queue behind it. Each Run now has at most one outstanding check and drains that check when stopping. This bounds query amplification without weakening cancellation, authorization or deadlines.
- **Financial history scans:** reconciliation scanned the fleet's ledger while holding one organization's billing lock. Explicit tenant predicates and migration 053's covering index restrict work to that organization's journals. RLS and immutable accounting remain authoritative.
- **Pooled database connection failure:** the live Neon pooler rejected startup timeout options. Server deadlines now belong to the restricted runtime role in its migrated database; clients retain bounded acquisition/query waits and identity retains its direct connection.
- **Webhook sweep ceiling:** 100 candidates followed by fifteen seconds between sweeps limited even fast delivery to fewer than seven per second per poller. A larger candidate page permits the existing bounded workers to use their capacity; the twenty-second admission window and ten-second destination deadline still apply.

## Measured operating ranges

All values below describe the stated fixture, not a promise for arbitrary requests. Rates are completed operations/second. A “knee” is where more parallel work stops helping or sharply increases waiting; a hard ceiling depends on payload, deployment and competing work.

| Workload | Escalation and observed result | Default decision |
| --- | --- | --- |
| 1,024 queued model calls, one-second loopback provider, eight organizations | Active advances 128 / 256 / 512 / 1,024: 12.2 / **20.0** / 13.1 / 15.9 completions/s. Execution p95: 9.1 / 10.6 / 38.9 / 45.9 seconds | Keep **256**; doubling it reduced throughput and more than tripled tail latency |
| 512 calls, three-second provider, 64 KiB context | 128 / 256 / 512 advances: 11.6 / **12.5** / 7.7 completions/s | Same decision; paid-provider latency is simulated, durable accounting is real |
| 256 calls, three-second provider, 128 KiB context | 64 / 128 / 256 advances: 6.5 / **10.1** / 9.8 completions/s; peak process RSS 496 / 517 / 559 MiB | Larger payloads saturate earlier. 256 is an upper process budget, not a target every deployment must fill |
| HTTP read arrivals, one credential | 200/s passed; 400/s produced 825 ms p95; 800/s fell over ten seconds behind. Confirmation: **18,000 actual reads over 90 seconds**, 200/s, 309 ms p95, no errors | Read allowance **6,000 → 12,000/minute**; the rate counter is separate from processing concurrency |
| Async admission and cancellation, one credential | Separate 90-second confirmations each completed **1,800 requests at 20/s**. Admission p95 249 ms; distinct-Run cancellation 180 ms | Keep writes **1,200/minute**; control **600 → 1,200/minute**, independent from other traffic |
| Synchronous inference HTTP, one credential, one-second provider | Offered 10/s completed with 1.8 s p95; 20/s accumulated 8.7 s p95. At 40/s and 80/s, the generator stopped on backlog | Do not advertise 20 synchronous inferences/s on one process. The write allowance covers cheaper operations too; scale execution separately |
| Application DB pools, 4,096 reads, 128 callers | Pools 20 / 40 / 80 / 160: 501 / **540** / 514 / 459 requests/s; p95 506 / **406** / 437 / 607 ms | Hosted pooled comparison supports **40 → 80**; the local-only optimum is not the production default |
| Identity DB pools, 4,096 uncached session checks | Pools 5 / 10 / 20 / 40: 466 / **586** / 429 / 327 checks/s | Increase **five → 20**, leaving headroom below the hosted 80-connection knee |
| Credential DB pools, 4,096 nested commits, independent caller pool | Pools 4 / 8 / 16 / 32: 918 / 1,263 / **1,834** / 1,732 commits/s; p95 220 / 196 / **139** / 262 ms | Increase **four → 32** for independent commits; no external token server was exercised |
| Restoration, 128 steps × 4 MiB, hashing/decryption and 50 ms upload | Active steps 2 / 4 / 8 / 16 / 32: 16.7 / 18.1 / 18.1 / 15.0 / 16.3 steps/s. RSS rose from 754 MiB at eight to 1,102 MiB at 32 | Keep **eight steps**, each at most 32 objects / 4 MiB and eight object reads |
| Live R2, 128 reads of an encrypted 128 KiB object per case | Parallel reads 4 / 8 / 16 / 32 / 64 took 5,629 / 2,714 / 1,455 / 820 / 609 ms. Read p95 rose from 260 to 360 ms at 64. Batches of 32 unique writes stopped improving above 16 | Keep bounded per-step fan-out. Eight transfer steps already permit up to 64 simultaneous reads; do not multiply every independently measured maximum |
| Storage maintenance, 32 organizations, 1,000 fresh inventory entries each, 50 ms listing | Parallel organizations 2 / 4 / 8 / 16 / 32: 11.5 / **24.1** / 22.1 / 28.1 / 23.5 checks/s; p95 271 / **229** / 602 / 980 / 1,980 ms | Increase **two → four**; larger settings mainly increase waiting while holding tenant GC locks |
| Finance, 32 organizations × 10,000 balanced journals (640,000 ledger rows) | At two checks in parallel, the query fix improved 8.3 → **35.6 checks/s** and p95 362 → 99 ms. After the fix, 4 / 8 / 16 / 32 gave 70 / 23 / 54 / 126 checks/s, with noisy contention | Keep **two** to reserve database capacity for customer work; 100 hourly candidates already finish comfortably within the twenty-second window |
| Dashboard snapshot reads, 256 subscription entries per organization | Two queries in parallel produced **187 snapshots/s**, p95 21 ms. Higher fan-out was noisy: 143 / 334 / 322 / 261 at 4 / 8 / 16 / 32 | Keep **two**; 64 organization snapshots are comfortably within a two-second refresh. Entries reference a real session repeatedly, not 256 distinct people |
| Webhooks, SQL + 50 ms loopback destination | Initial two/four/eight deliveries produced 28/59/110 deliveries/s. Larger final cases with actual dispatch rows handled 356/441/558 at 32/64/128 callers; the 40-connection pool bounds actual SQL concurrency | Increase **four → eight** and page **100 → 1,000**. Reserve most SQL connections for customer work; receiver-specific limits remain independent |

Successful final inference cohorts settled exactly one usage record per Run and released all reservations. The 128 KiB cases are representative payload tests, **not** a certification that 256 maximum-size provider requests fit in every host. Restoration repeatedly reads one encrypted chunk key (warm local filesystem cache); R2 reads reuse one key, while writes use distinct keys. Snapshot cases exercise bounded authorization joins, not browser/SSE rendering or network fan-out.

The ledger query plan now uses `ledger_tenant_journal` for one organization's 20,002 rows. It no longer scans all 640,000 fixture ledger rows to filter another tenant's history. Migration 053 is additive and retains financial facts and RLS. A higher-throughput finance-only benchmark does not justify letting hourly maintenance consume the entire database pool.

## Hosted database comparison

The first direct-endpoint ramp completed 1,024 operations per case with 128 callers. Application pools 20/40/80/160 completed 51/108/219/308 requests/s; identity pools 5/10/20/40 completed 59/117/233/377 uncached checks/s; independent credential pools 4/8/16/32 completed 39/76/139/265 commits/s. These were genuine remote PostgreSQL operations, not network-delay mocks.

Switching domain/credential traffic to the intended transaction pooler initially failed before any workload: the provider rejected `statement_timeout` in startup options. After moving deadlines to runtime-role/database settings, fresh pooled/direct connections reported the expected server settings. With 256 callers and 2,048 operations, application pools 40/80/160/320 completed 126/258/243/461 requests/s; direct identity 10/40/80/160 completed 128/465/631/707 checks/s; pooled credential 16/32/64/128 completed 161/258/255/678 commits/s. Some intermediate results were noisy, so they are not treated as a smooth universal curve.

The extended pooled HTTP ramp used **768 callers and 4,096 operations per case**:

| Pool | Completed requests/s | p95 request latency | Peak client process RSS |
| ---: | ---: | ---: | ---: |
| 80 | 178 | 6,605 ms | 383 MiB |
| 160 | 399 | 2,837 ms | 418 MiB |
| 320 | **503** | **2,566 ms** | 521 MiB |
| 640 | 424 | 3,342 ms | 525 MiB |

This establishes a measured knee near 320 for this **remote, eight-tenant read workload**. It does not establish that a production replica should claim 320 connections. The default is **80 application / 20 identity / 32 credential connections** (formerly 40/5/4): below the larger tested configurations, with room for overlapping deployments and mixed customer/background work. Per-process pool potential is 132 clients; direct identity connections and pooled backend budgets must be counted separately across replicas. A local SSE process using a direct loopback PostgreSQL URL additionally opens at most one shared session listener while subscribed, for a maximum local potential of 133 clients. Its content-free commit hints use one-second repair while connected and shared 100-ms repair on failure, with five-second reconnect attempts. Hosted/transaction-pooled deployments do not open this listener and retain shared 100-ms repair. Neither path holds a SQL connection per reader; see [live output ownership](../../features/execution/implementation.md#streaming-and-interaction). Larger pools are available through existing settings when a colocated deployment's measurements and total database budget justify them.

For low-latency local SQL, excessive concurrency adds CPU/lock work; for remote SQL, more connections hide round-trip time until another resource saturates. Neither result justifies a universal 10,000-connection default. The benchmark measured client RSS and SQL pool waits, not Neon CPU history; the actual hosted service topology still needs colocated multi-replica acceptance.

## Confirmation with the final pool profile

After selecting 80 application / 20 identity / 32 credential connections, a separate matrix reran real HTTP and accounting paths. Earlier tables retain their measured pool sizes; they are not silently relabeled as the new profile. The new evidence includes `configured_pools` explicitly. Earlier non-target identity/credential pools were five/four unless the scenario selected them.

| Final-profile workload | Result |
| --- | --- |
| 18,000 actual GET requests, one credential, 200/s for 90 seconds | All succeeded; p50 13 ms, p95 1,646 ms, p99 2,255 ms. The earlier 40-connection run had lower tail latency; capacity success does not imply constant response time |
| 1,800 asynchronous Run submissions, one credential, 20/s for 90 seconds | All succeeded; p95 71 ms, no pool waiters |
| 1,800 cancellations of distinct queued Runs, 20/s for 90 seconds | All succeeded; p95 136 ms, no pool waiters |
| 1,024 webhook deliveries, eight active destinations, 50 ms receiver | All delivered; 91.9/s, p95 177 ms, eight busy SQL connections, no pool waiters |
| 1,024 one-second model calls, 256 advances, matched domain pool 40 → 80 | Throughput 15.5 → 18.4/s; total completion p95 64.5 → 55.3 seconds, including queue time |
| 512 three-second calls with 128 KiB context, domain pool 40 → 80 | Throughput 10.1 → 5.3/s; execution p95 18.1 → 61.9 seconds. Both completed and settled exactly once; the slower result is retained alongside the reverse-order repeat below |

The reverse-order repeat completed 9.0 calls/s at 80 connections versus 7.9 at 40, with execution p95 21.1 versus 22.7 seconds. The earlier 61.9-second tail did not repeat. Both results remain published: two runs demonstrate workload/environment variance, not a stable universal optimum. Retain 80 as the hosted-informed starting point; measure large-context execution and regional SQL latency for each deployment role.

Every inference cohort released all reservations and recorded exactly one usage row and one provider invocation per successful Run. No paid provider was contacted. These findings reinforce the need to choose deployment-role overrides from the actual workload instead of multiplying every independent concurrency setting.

## Interpretation and limit ownership

Process limits reserve shared CPU, memory, database and outbound-I/O capacity. Select them below saturation, then budget their sum across replicas and overlapping deployments. Increasing every independently measured maximum simultaneously is unsafe. Per-credential HTTP limits are abuse/fairness policy, not a guarantee that every credential can sustain its full rate on one server.

The following boundaries have different owners and cannot all be established by increasing concurrent requests:

| Limit family | How to establish a reasonable value |
| --- | --- |
| Application, identity and credential SQL pools | Matched pool ramps; throughput, tail latency and waiting, plus the database's total connection budget |
| Inference advances | Matched Run cohorts and payloads, including persistence and settlement; retain capacity for cancellation and recovery |
| Restore/checkpoint fan-out | Verified bytes, hashing, memory and real object-storage latency; multiply within-step reads by simultaneous transfer steps |
| Dashboard snapshots | Bounded session batches and tenant queries must complete comfortably inside the refresh interval; sockets do not each own a SQL connection |
| Financial/storage maintenance | Retained histories and object inventories, query plans, lock duration and shared database headroom |
| Webhook/trigger/task/Git/revocation work | SQL and local protocol tests establish internal behavior; the receiving provider controls its own rate and timeout envelope |
| Worker provisioning/control and Workflow starts | Actual hosting-account quotas, SDK behavior and deployment topology; loopback tests establish recovery and independence, not vendor capacity |
| Fleet and plan concurrency | Explicit deployment budget and account entitlements; independent from one process's active step count |
| Session/upload queues and candidate pages | Bounded backlog and fairness per pass; a page does not cap total resources and a queued item is not an active process |
| Body, context, file, checkpoint and stream buffers | Memory and supported transport/model envelopes, correctness and integrity; do not enlarge them as a substitute for chunking/pagination |
| Acquisition, statement, execution and recovery deadlines | Tolerated waiting and failure recovery; longer waiting cannot increase sustainable throughput |
| Budgets, one Worktree writer, permission and ambiguous-effect fences | Domain correctness and customer authority; never remove them to improve benchmark numbers |

## Remaining bounds and their disposition

These are all the other limit families in the audit. Retaining a setting is a conscious disposition, not a claim that its largest possible value was measured.

| Current bound | Evidence and decision |
| --- | --- |
| Provision 16 / control 64 advances per process | Existing held-phase/refill tests show independent progress and shutdown. Retain pending live hosting-account allocation/control tests; increasing these blindly can amplify provider throttling |
| Worker reconciliation eight Workers × four Host operations; candidate page 100 | Duplicate-controller, placement, funding and independent-maintenance tests preserve authority. Retain; at most 32 parallel Host operations before other paths. Live cloud ceiling remains unmeasured |
| Worker demand page 1,000 / new Host plans 16 | Planner exercised at 1,000 and 10,000 queued demands, including override 64. Retain bounded refill; these bound one sweep, not total demand |
| Workflow page 100 / start acknowledgements 16 | Delayed-start and ordered SQL admission regressions. Retain; actual account creation quotas and function lifespan govern the external ceiling |
| Fleet native 200 / lightweight 2,000 / total 2,200 | Real SQL boundary and competing-dispatcher tests; retain as deployment budgets. They do not mean one process runs 2,200 providers simultaneously |
| Plan concurrency 20 / 100 / 500; Worker instance/spend policy | Product and customer-authorized allowances. Keep explicit lower customer limits and spending checks; these are not hardware benchmarks |
| Session backlog 100 / active upload plans 100 | Actual fill, overflow and released-slot tests. Retain; queued records are not active model calls or uploads |
| API pages 100, portable one-shot sweep 64, pending hints at least 100 | Cursor/refill and fairness regressions. Retain; callers/workers continue to the next page. These do not limit total resources |
| Git sync 16/2 and connector cleanup 16/2 (page/concurrency) | Existing recovery/refill tests. Retain to protect conditional Git writes and credential revocation; remote services' ceilings were not measured |
| Decision tasks, notifications and triggers 100/4 | Existing ordering/idempotency/refill tests. Retain; external receiver delays and per-task serialization remain. No evidence these currently constrain successful customer throughput |
| Finance page 100 / two organizations; storage page 16 / four organizations | Retained-history/inventory experiments above. Keep hourly cadence and twenty-second admission window; drain started effects and release unstarted claims |
| Checkpoint chunk reads four / manifest reads eight | Integrity/failure tests and real R2 curve. Retain to bound bytes/hash work across eight simultaneous transfer steps; not a separately measured end-to-end native snapshot ceiling |
| Dashboard 256 subscriptions / 64 organizations / two queries | Snapshot comparison above plus existing authorization/overflow tests. Retain pending actual hosted SSE fan-out; socket count is not SQL connection count |
| SQL acquire 30 seconds / statement 60 / wire wait 65 / idle transaction 120 | Exhaustion, shorter statement timeout, rollback/reset and effective-setting checks. Retain bounded recovery windows; longer waits do not improve throughput |
| Maintenance windows 20 seconds; refresh cadence 2/15 seconds | Existing nonoverlap, independent failure and drain tests. Retain; a sweep ends admissions, not ongoing external effects |
| Inline upload 4 MiB / staged 25 MiB / transfers 250 MiB and 1,000 entries | Hosting/protocol envelopes and chunking contracts. Retain; increasing inline payloads would bypass the supported transport design |
| Checkpoints 10 GiB / 100,000 entries; native-home/SQL snapshot bounds | Integrity, memory and persistence ownership. Retain; this pass does not certify every maximum-size checkpoint against every native provider |
| Model context, output, tool results, schemas and stream buffers | Finite model/protocol and memory envelopes, not adjustable fleet throughput. Preserve explicit validation and model-specific budgets |
| One Worktree writer, reservations, leases, permissions and ambiguous-effect retry bounds | Correctness and customer authority. Preserve; neither increased traffic nor synthetic success permits removing them |

The remaining uncertainty is concentrated in real multi-replica deployment and external-provider capacity. To establish those ceilings, use the deployed runtime image and actual OIDC/account quotas, colocated API/database compute, mixed native/inference traffic, slow destinations, and the largest supported payloads. That acceptance is tracked explicitly; the low-cost fixtures cannot substitute for it.

## Reproduce and interpret failures

Use the isolated database setup in the [initial report](README.md#reproduce), increasing the fixture container to `--cpus=4 --memory=2g --shm-size=512m` and `max_connections=600`. Do not benchmark the serving database.

```sh
# Independent read-arrival ramp. No Idempotency-Key on these GET requests.
export CAPACITY_CASES='[
  {"mode":"http","traffic":"read","pool":40,"tenants":1,"concurrency":256,"rate":200,"count":4000},
  {"mode":"http","traffic":"read","pool":40,"tenants":1,"concurrency":256,"rate":400,"count":8000},
  {"mode":"http","traffic":"read","pool":40,"tenants":1,"concurrency":256,"rate":800,"count":16000}
]'
pnpm exec tsx scripts/capacity.ts
```

`CAPACITY_CASES` also accepts `auth`, `credential`, `inference`, `webhook`, `finance`, `storage`, `snapshot` and `restore` modes. `traffic` selects read, workspace creation (`write`), asynchronous inference admission (`admission`), synchronous inference (`direct`) or cancellation of distinct queued Runs (`control`). `domainPool` isolates credential/auth pool ramps from an unrelated application-pool bottleneck. `payloadBytes` selects context bytes for inference, journals per organization for finance, inventory entries for storage, or sessions per snapshot. `rate` sets HTTP arrivals/second; omission produces a closed-loop concurrency test. `count` is total work, never a claim of that many simultaneous operations. `CAPACITY_OUTPUT` selects private JSONL output. Each case has a four-minute process deadline.

For paid storage acceptance, explicitly authorize a budget first. With the normal local R2 credentials configured, use `LIVE_API_TESTS=1 CAPACITY_R2_BUDGET_USD=5 pnpm exec tsx scripts/live/capacity-r2.ts`. It reserves $5 in an exclusive local budget record before making at most 641 reads, 129 writes, one listing and cleanup of its 129 keys. Reusing an output directory refuses another budget reservation. Ordinary CI never runs this probe.

The initial diagnostic matrices include GETs carrying unnecessary idempotency keys, repeated cancellation of the same already-cancelled Run, and code changes between cases. Those are labeled separately and excluded from default selection. The confirmation matrix uses the final implementation for each affected path, fresh databases and correct endpoint behavior. Unrelated paths changed between some cases; transitional inference/finance cases are not used for default selection. A failure or generator stop is a useful saturation result, not a passing capacity claim.

## Verification

The final implementation passed 165 targeted tests in 13 files: schema-cache isolation/eviction, nonoverlapping checks, shared admission/deletion fencing, tenant reconciliation, webhook continuation, storage, inference/accounting, decision scheduling, portable dispatch, exhausted pools/server deadlines, cloud state transitions, platform permissions and OAuth. Three isolated load files passed another 17 tests, including two competing dispatchers, real rate boundaries, queue/fleet accounting, SQL fairness and restoration failures.

On the isolated Neon branch, the database-capacity suite passed both cases against pooled domain/credential and direct identity connections. A subsequent targeted check added a fresh raw client with no startup settings and passed too; its skipped exhaustion case had already passed in the preceding run. Server deadlines, shorter transaction-local timeouts, rollback/reset, and independent credential/auth access while the application pool is exhausted were verified.

Migration 053 was also applied to an isolated database containing **640,000 pre-existing ledger rows**. Index creation completed in 798 ms; a deterministic digest of every row was unchanged and the index was valid.

`pnpm check` passed, including the TypeScript SDK build. `pnpm docs:check` passed for 66 public pages, 252 Markdown files and 54 requirement-evidence mappings; its existing native-loader-precedence guidance warning remains. Synthetic account creation could not reach the local fixture SMTP sink. Accounts were verified directly by the fixture; these results do not establish email delivery. Full application/browser/SDK acceptance remains CI work; the public API schema and native runtime image did not change.

## Deployment boundary

Run `pnpm db:migrate` through the direct owner connection to apply migration 053 and install runtime-role database timeouts; deploy the code/configuration, then reconnect database backends and restart the relevant API and standalone worker processes. No runtime-image or API-schema change is required. The serving preview and its worker are preserved during these measurements. The new index can remain during a code rollback; no financial facts are rewritten.

Hosted native/Workflow limits cannot be certified from this experiment. The current Sandbox adapter requires Vercel OIDC; the local fixture is not that serving environment. A real staging rollout must measure the actual account's allocation/control quotas, slow or failing providers, mixed replicas and worst-supported native files. Preserve that acceptance in [maintainer work](../../maintainers/TODO.md#resource-capacity-and-progress). Numeric configuration ceilings are validation bounds, not advertised safe production capacities.

## Cost record

The temporary Neon branch, all 129 R2 objects and the dedicated Docker benchmark container were removed and cleanup verified. The shared developer database remained healthy and the preview returned HTTP 200.

Authorized budget: $25. No paid model calls. The R2 probe reserves $5, covering full rounded Standard Class A/B billing units plus temporary storage; this is an upper allowance, not a claim about the account's invoice or free-tier balance. Neon compute is bounded by two CU for at most three hours, approximately $0.636 at Launch list pricing, plus temporary storage/network. Resource identities and commands stay in `.data/capacity-upper/`; temporary cloud connection files were removed after use. Public evidence contains no credentials or caller content. Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Neon pricing](https://neon.com/pricing).
