# Native scheduling latency

Status: implemented; local latency qualification passed. This follows the measured
[OpenCode startup gaps](../engineering/testing/harnesses.md#opencode-model-request-diagnostics),
not a claim that their historical SQL/placement cause is fully recoverable.

## Outcome and scope

With an eligible Run and free execution capacity, target under 100 ms p95 from
committed admission to execution claim and between ready phases in different
resource pools. Measure full intervals, including SQL and commits. Cold Host,
model and harness loading, intentional waits and occupied capacity are separate.
Keep public API/SDK behavior, spending, fair organization turns, Worktree order,
native execution identity, checkpoint integrity and recovery unchanged.

## Implementation owners

1. **Commit wakeups:** publish content-free PostgreSQL notifications when queued
   work becomes due or eligibility/capacity changes. The standalone poller owns
   one session connection, reconnects with bounded backoff, coalesces hints and
   retains periodic polling. Notifications grant no authority and need no extra
   queue service. Account plan/cap changes also wake queued work; unchanged
   settings remain silent. Direct inference recovery rows due in the future emit
   no hint.
2. **Immediate handoffs:** `portable-dispatch.ts` owns bounded native quanta and
   per-resource slots. An already-admitted ready Run can exchange its local slot
   for a free next-class slot. No unbounded local waiting queue. A full target,
   real wait or exhausted quantum yields to the existing SQL outbox. Concurrent
   discovery reserves its slots so handoffs cannot oversubscribe them.
3. **Independent discovery:** pool candidate/claim I/O proceeds independently;
   ready running work starts as its own query completes. New admissions remain
   ordered and still call the shared fair SQL scheduler under existing locks.
   Do not await a slow sibling query before starting a completed class.
4. **Prepared native state:** `cloud-engine.ts` accepts an optional in-process
   context per bounded quantum. Reuse only immutable Run configuration and
   identity; every advance freshly claims mutable lifecycle/control facts.
   Never serialize that context into Workflow history. Publish the next phase
   and outbox due time in one fenced transaction. Retaining a local quantum
   keeps its dispatcher backoff, avoiding another poller stealing each ready
   phase; yielding publishes the real next due time. Crash fallback remains
   bounded by the existing dispatcher lease/backoff.

The optional context's synchronous slot-retention callback is the narrow seam
between durable phase publication and local capacity ownership. It cannot skip
phase fencing, cancellation, deadlines, model-error controls or financial policy.
Loss/ambiguity of a commit never permits another native prompt submission.

## Steps and completion criteria

- [x] Retain a frozen pre-change source baseline and matched workload.
- [x] Implement owned wake listener, transactional hints and shutdown/reconnect.
- [x] Implement independent discovery and bounded same/cross-pool advancement.
- [x] Reuse immutable configuration and combine phase/outbox publication.
- [x] Cover capacity saturation, fair admission, duplicate pollers, lost wake,
      cancellation, recovery and graceful shutdown with disposable fixtures.
- [x] Run database/native execution checks, TypeScript SDK/application checking,
      required build/docs checks and existing affected load checks.
- [x] Profile an actual API/standalone-poller/database path and native phase
      boundaries with free capacity. Record mean/p50/p95/max, full interval stages,
      SQL round trips, topology, fixture limitations and any missed target.
- [x] Review the complete affected diff and update feature guides/status/TODO.

## Verification design

Use task-owned PostgreSQL/object storage, synthetic accounts and model transports,
and separate API/poller lifetimes. Compare the frozen baseline and final code on
the same host/workload. Exercise one-at-a-time admissions, bursts, a held unrelated
pool, a full target pool, concurrent organizations and two pollers. A missed
notification must still progress through periodic polling. Retained context must
not suppress cancellation or generation checks. Restart recovery reloads the
accepted configuration and original native identity; it never reconstructs a
fresh prompt execution.

The serving profiler stays default-off; enable the existing content-free stages
for qualification and keep payloads/credentials out of results. Use the existing
native fixture where runtime behavior is relevant; scripted provider timing is
not a live model or hosted latency guarantee. No paid resource is needed for the
scheduler qualification. Preserve the running preview and unrelated edits.

## Tradeoffs

One session-mode listener connection per standalone poller is required for
PostgreSQL notifications. Transaction-pooled hosting needs a configured direct
URL; polling still works during listener failure. A hint is deliberately lossy,
whereas Run identity, claims and results remain durable. The existing bounded
execution quantum preserves competition instead of allowing a hot Run to hold
a local slot indefinitely. No public contracts or unrelated SDK builds change.

## Verification record

### Matched local qualification

The frozen child poller/core is commit `50f59404`. Both cohorts use the same
authenticated current HTTP API, migrated disposable PostgreSQL database and
scripted native MachineProvider. Submit after each poller becomes idle, exposing
the old periodic-wait cost instead of assuming a random arrival distribution.
Current listeners connect before submission. API and poller run in separate Node
24.13.0 processes on an Apple M1 Pro, ten logical CPUs, 32 GiB RAM, with Docker
PostgreSQL 17.11. Existing preview processes remain running. Profiling samples
every operation; production profiling defaults remain unchanged.

Eighty calls pass: twenty per version and prompt size, using a 42-byte prompt
and a 98,304-byte ASCII prompt below the public 100,000-character limit. The
real admission owner's after-commit hook marks eligibility. The execution
boundary is the actual MachineProvider provision call, stronger than the SQL
`started_at` timestamp, which is set within the earlier claim transaction.
Handoffs include the preceding phase's publication commit and the next phase's
claim transaction, rather than measuring only the JavaScript phase body.

| Committed admission → provision | Before mean / p50 / p95 / max | After mean / p50 / p95 / max |
| ------------------------------- | ----------------------------- | ---------------------------- |
| 42-byte prompt                  | 682.8 / 703 / 753 / 767 ms    | 42.8 / 38 / 59 / 88 ms       |
| 96 KiB prompt                   | 728.2 / 724 / 769 / 773 ms    | 42.55 / 38 / 56 / 86 ms      |

| Ready handoff          | Before p95, small / large | After p95, small / large |
| ---------------------- | ------------------------- | ------------------------ |
| Provision → input      | 59 / 46 ms                | 19 / 22 ms               |
| Restore → verification | 76 / 60 ms                | 27 / 10 ms               |
| Poll → index           | 39 / 50 ms                | 14 / 14 ms               |
| Publish → close        | 39 / 64 ms                | 15 / 14 ms               |

Pooled handoffs have after mean/p50/p95/max of 9.54/8/19/28 ms for the small
prompt and 11.23/8/17/216 ms for the large prompt. The 216-ms provision-to-input
outlier remains in the results. Per-operation records were not retained by that
first qualification fixture, so its SQL/JavaScript/host cause cannot be recovered;
PostgreSQL's logged checkpoints do not overlap it. This establishes the agreed
p95 target, **not a hard maximum or a hosted latency SLA**. The fixture now retains
at most 64 existing per-Run slow profiles for future tail attribution.

Per twenty completed Runs, small-prompt SQL statements/groups/commits decrease
from 8,872/6,272/1,260 to 7,357/5,311/983; large-prompt counts decrease from
8,884/6,284/1,260 to 7,342/5,298/982. Those totals cover the entire native
lifecycle and idle/discovery work, not just admission. Immutable accepted input
is no longer repeatedly downloaded between retained phases. Every cohort has
exactly twenty native launches and no unattributed SQL statements.

First current calls reach provision 54/56 ms after commit. Full request-to-
provision p95 is still 334/284 ms: native API authorization, funding and durable
admission precede the scheduling interval. They are measured separately and are
not claimed to be below 100 ms. Cold compute, harness/model loading, occupied
capacity and intentional output waits are also outside this scheduling target.

### Correctness and reproduction

The new fixture's four functional cases exercise single/two-poller execution,
near-limit input integrity, a saturated transfer pool and exactly-once native
launch with verified persistence. Existing targeted suites cover fair turns,
cancellation, deadlines, stale phase owners, failed publication, bounded
continuations, lost/reconnected notifications, independent discovery and graceful
shutdown. Actual Docker/Codex public-API execution and a second conversation turn
also pass with synthetic rejecting model transports; this is real container and
harness execution, not a paid model or hosted-provider acceptance result.

Verification commands and scope:

- The seven-file cloud/portable/decision/failure/poller regression cohort passes
  90 cases; its one stale exact-result assertion was updated for explicit
  competing-owner scheduling fields and passes in the isolated rerun.
- Six additional notification, event-observer, runtime-efficiency and scheduling
  load files pass 34 cases. The resource-capacity file passes all ten cases;
  its minute-window clock fixture now starts on a real minute boundary.
- The final policy-wakeup review adds a ninth notification case: a queued Run
  blocked at account concurrency one becomes eligible and emits a committed hint
  when the limit rises to two. Unchanged limits and unrelated metadata remain
  silent. All nine notification cases pass, including a fresh forward-migration
  rerun of the added case.
- Both matched and tail-diagnostic qualifications pass all five selected cases.
- `pnpm test:journey:docker codex` passes actual two-turn container/API execution.
- `pnpm check`, `pnpm docs:check` and final diff/format checking pass. The
  TypeScript SDK build remains included; no public API/transport changed, so
  unrelated language SDK generation/builds were omitted under testing policy.
- No paid model/provider test or cloud resource was needed. Full release CI and
  hosted latency qualification remain separate gates.

Normal functional checks are unpaid:

```sh
ALLOW_PAID_EXECUTION=false EXECUTION_PROVIDER=simulator PLATFORM_MODE=local \
  pnpm test:domain tests/integration/native-scheduling-latency.test.ts
```

For a matched run, prepare the frozen source with the repository's installed
dependencies (unchanged by this work). Run from the repository root; the guard
prevents replacing an existing baseline:

```sh
test ! -e .data/native-scheduling-20261031/baseline && \
  mkdir -p .data/native-scheduling-20261031/baseline && \
  git archive 50f59404 packages docs/api package.json tsconfig.json \
    tests/fixtures/cloud-machine.ts | \
  tar -x -C .data/native-scheduling-20261031/baseline
ln -s "$PWD/node_modules" .data/native-scheduling-20261031/baseline/node_modules
```

Do not copy `.env` or keys.
The baseline child uses the current fixture adapter but imports its core/database
modules from that frozen directory. Select a new JSON filename within the ignored
`.data/native-scheduling-20261031/` directory, then run:

```sh
ALLOW_PAID_EXECUTION=false EXECUTION_PROVIDER=simulator PLATFORM_MODE=local \
  NATIVE_SCHEDULING_PROFILE=1 \
  NATIVE_SCHEDULING_PROFILE_OUTPUT=profile-new-qualification.json \
  pnpm test:domain tests/integration/native-scheduling-latency.test.ts
```

Optional `NATIVE_SCHEDULING_PROFILE_COUNT` defaults to twenty per cohort.
`NATIVE_SCHEDULING_DIAGNOSTIC=1` selects current-only diagnostics. Never overwrite
an earlier failed or successful measurement to hide variance.

Private raw results are retained under `.data/native-scheduling-20261031/`:
`profile.json`, `profile-iteration1.json`, `profile-diagnostic.json` and the
associated command logs. Historical 8.596-second created-to-start and
4.358/1.852-second phase gaps remain incident observations, not measurements of
this workload or proof that a numeric capacity limit was full. The initial
iteration retained full created-to-provision latency before the precise
after-commit marker was added; those intervals include API admission and are
not interchangeable with this scheduling metric.

A subsequent ten-call current-only diagnostic did not reproduce the 216-ms
handoff: maximum gaps were 27/19 ms. One first-call scheduling interval reached
exactly 100 ms (20 ms to the SQL claim timestamp, then 80 ms to provision),
including a 75-ms admission span. The fixture's 80-ms slow-record threshold did
not capture that span's SQL breakdown. Its two retained slow records concern
later checkpoint/publication work, not scheduling. This diagnostic is additional
tail evidence, not a replacement for the original matched results. See
`profile-tail-diagnostic.json`.

### Local activation

Migrations 059 and 060 are applied to the existing local preview database without
a reset. Migration 060 adds the account-policy wake after that final review,
using the existing notifier rather than another scheduling path.
The current Docker poller runs this source with a connected
`macrofold_dispatch_wakeup` listener; the migration did not stop the preview or
change accepted Run identities.
Existing concurrency ceilings and paid-execution settings were preserved. Other
deployments need the migration and a current standalone poller with a session
listener URL. Hosted latency, fleet-scale notification load and a strict
100-ms maximum remain separate acceptance work.
