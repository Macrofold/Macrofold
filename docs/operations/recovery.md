# Paired backup and recovery

A usable recovery set includes the database, every encrypted file object, and the vault keys needed to decrypt both. The `recovery` command creates and verifies a private encrypted archive and restores it into an empty independent database and object store. It never resets an existing database or starts a scheduler.

## Make a backup

Install PostgreSQL client tools compatible with the source server. Load the source administrative environment securely: direct `MIGRATION_DATABASE_URL`, object-store settings, `VAULT_KEY` and any retained `VAULT_KEYRING_JSON`/`VAULT_ACTIVE_KEY_ID`. Keep keys in a separate recovery secret store; the archive does not contain them in plaintext.

1. Pause **all writers**: API mutations, workers, Cron, retention maintenance and key rotation. Pausing run admission alone is insufficient. Drain active work or record unresolved external executions for reconciliation.
2. Choose a new private destination. Parent directories must exist; an existing destination is rejected.
3. Run:

```sh
pnpm recovery backup /private/backups/release-2026-09-18 --confirm-writers-paused
pnpm recovery verify /private/backups/release-2026-09-18
```

4. Copy the entire directory to an independent private backup location, verify it there with the retained keys, then resume writers. Keep a copy off the serving account/device, with retention and access appropriate to customer data.

The PostgreSQL custom dump is streamed through AES-256-GCM. An authenticated encrypted manifest wraps its random data key and lists ciphertext hashes, sizes, source database identity and timestamps. The manifest is written last; an interrupted copy has no valid completion marker. File objects remain encrypted. Temporary signed-transfer/model-upload staging objects are deliberately excluded because they are not durable user content.

This version requires a short maintenance window for a consistent database/object pair. It does not pretend that a database PITR point plus an unrelated current bucket is a complete backup. Online cross-store backup coordination is deferred until backup duration warrants the added complexity.

## Restore independently

Prepare an empty disposable database and empty private bucket/directory, with the required database roles matching the source. Point the administrative and storage settings to those **targets** and load the retained vault keys. Keep paid execution, Cron, workers, webhooks, email and public routing disabled. Do not attach a running application while restoring.

```sh
pnpm recovery restore /private/backups/release-2026-09-18 --confirm-isolated-target
```

The command rejects the source database, an occupied database, or a nonempty object store. It verifies the full archive before writing, restores files first and restores the database in one transaction. Failure leaves the target quarantined for inspection or disposal; do not retry into the same partially restored target.

Verification detects missing/corrupt database ciphertext, wrong retained keys, missing/corrupt objects, plaintext hash failures and manifests that leave a tenant's content prefix. The receipt reports snapshot time, restore duration and snapshot age. Those measurements describe this rehearsal; they are not a promised recovery SLA.

Before routing users, verify authenticated tenant access, historical results and current/checkpoint files, then reconcile active runs, payments, external effects and reservations. Never blindly replay an in-flight native prompt or restore an old payment state into active service.

## Automated rehearsal

`pnpm exec tsx scripts/test-install.ts` creates separate disposable databases and object directories, rotates fixture vault keys, invokes the same paired backup/restore implementation, reads files through the restored application, continues a simulator session and checks replayed events. The existing CI acceptance job runs it; weekly verification also reruns the rehearsal. Unit tests inject key, manifest, database and file corruption and cross-tenant manifests.

For the local Docker PostgreSQL fixture only, set `RECOVERY_POSTGRES_CONTAINER` to run PostgreSQL tools inside that container. Hosted backups use installed `pg_dump`/`pg_restore`; secrets go through child environments, never command arguments. Preserve the backup with its source revision, runtime digest and retained keyring in your private recovery record.

A local pass does not establish Neon restoration time or independent R2 backup availability. Those hosted measurements remain in [release acceptance](../maintainers/TODO.md). See [hosting incidents](hosting.md#incident-runbooks) and [environment configuration](launch-environment.md).

The installation rehearsal also restores a lightweight decision, task allocation, active evidence pin and encrypted published proposal. New decision invocation, tool and task-wake ciphertext participates in the existing vault rotation command. Set `TEST_POSTGRES_CONTAINER=none` when running the rehearsal against a local PostgreSQL server with installed client tools; the default test profile uses Docker.
