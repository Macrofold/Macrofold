# Troubleshooting

Start with the current run or operation ID and its error code. Preserve the request ID when reporting an API problem; do not include keys, prompts, or private files in a public issue.

## Local setup fails

Run `node --version`, `pnpm --version`, and `docker info`. Use Node 24 and pnpm 10, start Docker, and retry `pnpm run setup`. If the web port is occupied, inspect the existing process before starting another copy. `pnpm doctor` checks the selected environment.

A job that remains queued locally often means the second terminal is missing `pnpm worker`. Do not replace a local database URL with a production URL to fix setup.

## A run is waiting

The run's waiting fields explain whether global capacity, account concurrency, or earlier workspace work blocks it. Inspect the deadline and held credits. Create another workspace for independent file changes, lower other workload where appropriate, or cancel an unneeded run. No exact global queue position or start time is guaranteed.

## Access is denied

Confirm the active organization, current membership, key scopes, and project restrictions. A key belongs to one organization. Revoked connector grants and removed memberships affect subsequent requests, including already queued work. Sign in again for expired sessions or use the account's recovery flow for MFA.

## A file save returns 409 or 412

A `409 workspace_busy` means another writer owns the workspace. Wait for it to finish or use a separate workspace. A `412 stale_revision` means files changed after your read; refresh, compare, and reapply the edit. Do not retry with an invented revision.

## Git synchronization failed

Inspect the synchronization outcome independently of run completion. Check repository access, branch protection, and merge conflicts. Your checkpoint can be saved even when a push fails. Resolve the conflict or permissions, then request synchronization again; do not force-push to bypass the failure.

## A connection stopped working

Open **Connections** and inspect its status, tool grants, and authorized account. Reauthorize expired app access or replace a revoked provider key. BYOK does not silently fall back to platform credentials. A tool timeout may have an unknown external outcome; inspect the target system before repeating a write.

## A stream disconnected

Reattach with the CLI or SDK, preserving the last received event sequence. Streams rotate deliberately. If detailed history has expired, retrieve the current result and metadata. Closing a stream does not cancel its run.

## A mutation response was lost

Keep its idempotency key and original request. Inspect server state before retrying the same request with that key. A new key may create another action. The SDK's transport error carries the recovery key when an outcome is uncertain.

See [API errors and retries](../features/api/README.md#errors-and-retries) and [reporting bugs](../../CONTRIBUTING.md#report-a-bug).
