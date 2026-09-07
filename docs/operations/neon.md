# Neon and PostgreSQL

PostgreSQL owns tenant state, durable queues, authentication, and accounting. The application uses its existing SQL migrations and Better Auth schema. Neon Auth, Data API, Functions, and Object Storage are not required: authentication runs in the application, hosting uses Vercel, and project files use R2. Register the application domain with Vercel/DNS and configure its OAuth origin in the application; no additional Neon application-domain registration is needed.

## Create an isolated environment

Create a Neon project and database in a region near the application. Use separate staging and production branches or projects with explicitly reviewed data access. Prefer schema-only branches for tests that do not need customer data.

Retain the provider's owner credential for migrations. Create a separate SQL runtime role with LOGIN, NOBYPASSRLS, no superuser, no role/database creation, no replication privilege, and no inherited administrative membership. The runtime must not own application tables. Set its password privately using your SQL client's protected password facility.

For a new database, the following SQL creates that role without supplying a password in command history. Run it once as the database owner, then use the SQL client’s protected password prompt (for example, `\password platform_app` in psql). Do not recreate or reset a role in an existing installation.

```sql
CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOBYPASSRLS NOREPLICATION;
```

The migrations also use a NOLOGIN `platform_reporting` role for bounded operator views. The migration owner needs the privileges required by the reviewed migrations to create and assign that role; do not grant its membership to the serving runtime.

## Configure connections

| Variable                 | Role and connection                              |
| ------------------------ | ------------------------------------------------ |
| `DATABASE_URL`           | Restricted runtime role, pooled endpoint, TLS    |
| `AUTH_DATABASE_URL`      | Same restricted role, direct endpoint, TLS       |
| `MIGRATION_DATABASE_URL` | Database owner, direct endpoint, TLS; admin only |

The domain uses transaction-local tenant context. Identity connections set the `auth,public` search path at startup; the Neon pooler rejects this startup option, so identity uses the direct endpoint. Never substitute an owner URL to work around a runtime connection error.

## Apply the schema

Use the ordered `migrate.ts`, `auth-migrate.ts`, and `provision-cli.ts` commands in [deployment](launch-guide.md#2-configure-postgresql). Configure the final application origin and retained auth/vault keys before OAuth provisioning.

For upgrades, compare the current `schema_migrations` records with the release's numbered SQL files. Rehearse unapplied forward migrations on an isolated branch. Existing numbered migrations are immutable after release. Do not reset or seed a database containing customer accounts.

After migration, verify forced tenant RLS, restricted journal mutation, and authentication with the runtime role. Confirm that a request in one organization cannot read another organization's resources.

## Use the Neon CLI deliberately

If you use the Neon CLI, select the intended project and branch explicitly. Use `--no-env-pull` with link, checkout, and deploy operations to preserve the local simulator environment. Neon policy deployment does not run this application's SQL migrations or deploy the dashboard.

The repository's [neon.ts](../../neon.ts) has an empty policy. It does not provision additional Neon services. Operator CLI/MCP credentials belong in private tooling configuration, never in the application or native agent environment.

## Production recovery safeguards

Before accepting customer data, select a recovery window that covers delayed discovery of accidental changes. **Seven days is the recommended starting target for this deployment.** In Neon Console, open **Settings → Instant restore → History window**, select seven days, save, and verify the effective value. The current Free plan caps history at six hours; Launch supports up to seven days and Scale up to thirty. An upgrade alone does not establish a seven-day setting. Longer retained history has a usage cost, and extending the setting cannot recover history already discarded. See [Neon's history-window reference](https://neon.com/docs/postgres/backup-restore/history-window).

On a paid plan, open the production branch and select **Protect**. Verify the protected designation before launch. This blocks branch deletion/reset and protects associated project/compute deletion; it does not prevent SQL writes, dropped tables, or application mistakes. New branches created from a protected parent receive different role passwords, so retrieve each branch's own connection credentials. See [protected branches](https://neon.com/docs/guides/protected-branches).

Rehearse point-in-time recovery in an isolated environment with a known before/after marker and verify schema, records, tenant permissions, and application access after recovery. Current Neon guidance limits instant restore to root branches; a child branch used for migration rehearsal is not proof of root-branch PITR. Record the actual recoverable interval and recovery time. Do not reset the serving production branch as a test. Follow [Neon's restore procedure](https://neon.com/docs/introduction/branch-restore).

PITR restores database state, not R2 objects or vault keys. Retain and test the matching encrypted objects and decrypt keys independently. Keep outstanding account-specific safeguards in the [release TODO](../maintainers/TODO.md).

## Capacity and recovery

Budget the sum of domain, identity, and credential-refresh connections across application instances. Inspect query latency, active connections, queue age, and provider compute headroom before increasing execution concurrency.

Monitor CPU, connection usage, database/history storage growth, query latency, and billed compute time. The application's minutely maintenance and dashboard/worker polling can prevent the idle interval needed for suspension. Budget for the observed active time rather than assuming scale-to-zero savings; see [Neon's suspension behavior](https://neon.com/docs/introduction/scale-to-zero).

Recover from a consistent database point together with all referenced encrypted objects and retained vault keys. Rehearse restoration in an independent environment. See [scaling](scaling.md), [hosting](hosting.md), and the maintainer [database verification record](neon/verification.md).
