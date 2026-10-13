# Bounded operations and recovery

Status: implemented and locally verified. Hosted acceptance is separate.

## Scope and decisions

Audit authored retry, polling, pagination and recursive traversal paths. Preserve intentional service lifetimes (worker polling, interactive chat, warm harness input and event delivery), while bounding each operation and automatic failure recovery. A finite input traversal must consume input or reject non-progress. Do not replace security, execution identity or financial uncertainty with success to stop a retry.

- Native phases: retain three transient failures before failure publication; bound cancellation observation, total advances and post-execution recovery time. Exhausted publication/cleanup stops automatic dispatch and keeps checkpoints, execution identity and unresolved holds for operator recovery.
- Durable dispatch: cap consecutive unexpected failures at eight, including Workflow startup, Git, tasks and trigger delivery. Successful steps reset the failure budget. Periodic schedules are separate occurrences, not unlimited retries of one failed occurrence.
- Database: retain pool ceilings while bounding connection/acquisition, server lock/query waits and stalled client I/O; preserve shorter per-transaction deadlines.
- Hosts: cap repeated provider/settlement failures, drain a failed allocation before exhausting cleanup, and retain unconfirmed stop/meter obligations. Explicit authorized lifecycle actions can restart a bounded cleanup budget.
- Clients: bound SDK waits and stream attachment in all five languages; timeout detaches and never cancels the remote Run. Allow explicit finite wait budgets. Guard client/tool pagination against repeated cursors and excessive pages.
- Review existing byte/deadline/process/traversal bounds, rather than add redundant counters to loops that already consume a fixed input. Record intentional lifetime loops and their inner-operation limits.

## Owners and verification

### Actionable failure notices

Replace the dashboard's generic recovery label with the failed operation: dispatch, checkpoint saving, billing settlement, final publication or worker cleanup. Core records the operation, safe cause code and consecutive failure count in the existing `run.recovery_required` event; an earlier run failure remains separate. The dashboard derives consequences from the actual persistence receipt, never from the retry limit. Unknown steps/causes stay explicitly unknown. No new replay or retry action is introduced.

Use the shared event-data type and one dashboard presentation helper. Verify checkpoint, billing and cleanup failures with disposable database fixtures, unknown-data presentation, and the stopped-stream browser journey. Preserve the event name/error code, SDK stopping behavior, file/financial holds, and the running local preview. Check the TypeScript build, all SDK consumers of the event envelope, and documentation.

The stopped-dispatch fixture exposed a fair-turn bug: the claim gate rejected a blocked queued Run, while the scheduler still selected it ahead of healthy Runs. Migration 050 adds only a `dispatch_blocked` flag to the sanitized scheduling view; eligibility excludes it. Active Run counting and Worktree ordering remain unchanged, preserving uncertain ownership and holds. Verify blocked-queue progress across tenants, blocked active capacity, and expiry/cancellation settlement before local activation.

- [x] Record specific failed steps and safe causes; render actionable stopped-run notices without replay or false checkpoint confirmation.
- [x] Verify dispatch, publication, billing and cleanup diagnostics, blocked-queue fairness and active ownership; inspect the browser result and apply migration 050 to the loopback database.

Core orchestration and dispatch own durable budgets; provider/runtime adapters own transport and cursor limits; maintained SDK helpers own local wait deadlines. Public API shapes remain unchanged. Migration 048 adds internal dispatch/Host/Worker failure counters, notification expiry and scheduling filters. Migration 049 grants the restricted reporting role only the three dispatch columns those filters need; isolated installation and an actual restricted-role query cover both migrations.

- [x] Complete loop/retry inventory and implementation.
- [x] Regression checks for exhausted publication/cleanup, stalled pagination, provider failures, preserved money/files and no agent replay.
- [x] Targeted domain/native/CLI checks and all affected SDK transport checks.
- [x] Final image/browser acceptance, application typecheck and documentation integrity.
- [x] Inspect affected diff; update runtime, operations, SDK/CLI docs, status and maintainer acceptance gaps.

## Audit and bounds

| Owner | Bound and exhaustion behavior |
| --- | --- |
| Native engine | Accepted execution deadline; one-minute cancellation grace; 250,000 advances; 30-minute recovery allowance; three transient phase failures and eight publication/cleanup failures. Stops without replay or false settlement. The advance ceiling covers the existing 100,000-file/10-GiB envelope. |
| Durable dispatch | Eight consecutive failures survive restart and Workflow handoff. Successful steps reset only failures, not delivery identity. Blocked jobs cannot reenter automatic dispatch. |
| Host/Worker reconciliation | Provisioning 15 minutes, draining three hours, eight provider failures and a separate eight-failure cleanup budget. Unconfirmed stop/meter obligations remain; explicit lifecycle actions can restart bounded cleanup. |
| Git, triggers, notifications | Operation expiry is checked before a busy Worktree lock. GitHub notifications expire after one day. Triggers retain deadlines and eight send attempts; a new explicit occurrence has its own budget. |
| Database | Five-second connection/acquisition, 60-second server statements, 65-second client query I/O and 120-second idle transactions. Existing smaller transaction deadlines remain. Pool ceilings are unchanged. |
| Object and request bodies | S3 requests/bodies expire after 60 seconds with at most three SDK attempts; bodies enforce byte limits and reject sixteen empty reads. Cleanup cancellation is best effort and never awaited past a deadline. |
| Native model bridge | Absolute 300-second request deadline, Run abort propagation and existing byte/progress bounds. An ambiguous model side effect is never automatically replayed. |
| Pagination and capture | Repeated cursors reject; general traversal stops at 1,000 pages, Pi discovery at 100 pages/5,000 tools. Capture counts empty directories and bounded local inventories; incomplete traversal cannot publish success. |
| SDKs and CLI | All five SDK wait helpers default to a finite 30 hours and validate finite wait overrides. Native streams cap attachments at 2,048 and failed reconnects at eight. Timeout detaches without cancelling the Run. CLI Git processes expire after two minutes and downloads after five minutes. |
| Dashboard | Stalled body reads abort, repeated refresh failures stop, periodic reconciliation remains separate. Recovery exhaustion closes detailed SSE after replay and stops waiting/reconnection in the page. |

Deliberate service lifetimes remain: worker daemons, interactive chat, warm harness stdin and healthy periodic UI reconciliation. Their individual operations have finite bounds. Fixed-input parsers, root-path walks and visited-node graph traversals consume input or terminate; adding retry machinery to them has no present benefit.

This inventory covers authored loops and their owned I/O/retry paths, not a formal guarantee about arbitrary third-party code or OS failures. Local fault checks include a reader whose cancellation promise never settles, confirming that cleanup cannot defeat the body/stream deadline. Exact results and remaining hosted checks are recorded in [Worker verification](../features/execution/workers/verification.md#bounded-work-and-recovery).

No paid provider execution or deployment is required. Local evidence does not establish hosted acceptance.
