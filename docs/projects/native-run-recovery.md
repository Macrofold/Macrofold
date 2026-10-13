# Native run recovery

Status: implemented and locally verified. The caller's complete draft/approval journey and hosted rollout remain separate acceptance work.

## Scope and decisions

Two independent failures blocked native reflection: failed checkpoint capture was treated as an empty output snapshot, repeatedly rejecting deletion of a protected file; Docker provisioning could not find the configured runtime image and reported only a generic transport error.

- Validate file changes only for verified captures. On capture/publication failure, preserve the previous checkpoint and session, settle through the existing ledger, finalize the run, and retain the normal degraded-worktree recovery contract. Never relaunch an uncertain prompt.
- Keep explicit Docker image configuration and owned-container reconciliation. Classify bounded Docker stderr into fixed, actionable diagnostics without exposing stderr, command arguments, credentials or customer content. Unknown failures remain generic; a missing image is not permission to select an arbitrary replacement.
- Repair local configuration using the verified runtime image, restart only the poller, and finish the affected runs through the existing engine. Restore their last verified checkpoints through the existing recovery operation if needed. Do not automatically replay reflection requests or change the caller.

## Owners and verification

`packages/core/src/cloud-engine.ts` owns publication and settlement; `packages/providers/src/docker.ts` owns Docker transport; `scripts/doctor.ts` owns setup diagnostics. Authoritative behavior lives in [runtime](../features/execution/runtime.md), [Worker operations](../features/execution/workers/operations.md) and [local Docker setup](../getting-started/local-development/docker.md).

- [x] Regression checks: guarded failed capture before/after launch, rejected verified output, cancellation, unchanged checkpoint/session and single settlement; Docker diagnostic privacy and timeout/size bounds.
- [x] Run affected domain checks and application typecheck; exercise a real disposable Docker Host with scripted native execution.
- [x] Verify affected local runs are terminal without a second agent launch; preserve and recover their last verified files.
- [x] Review the complete affected diff and update authoritative docs. Local recovery does not establish the caller's draft/approval journey or hosted-provider acceptance.

The [verification record](../features/execution/workers/verification.md#native-publication-and-local-docker-recovery) owns executed checks and their limits. Remaining caller/hosted work stays in [maintainer TODO](../maintainers/TODO.md#native-home-persistence).
