# Neon project setup

This checkout is linked to Neon project `dry-thunder-40391696` (Macrofold), organization `org-proud-mountain-34682791`, and default branch `production` (`br-noisy-glade-ae3uycu1`). Database `neondb` runs PostgreSQL **18.6** in `aws-us-east-2`. Its application schema and OAuth registration are configured for **https://app.macrofold.ai**. Local development still uses its separate PostgreSQL 17 database.

## Database configuration

| Responsibility | Configured value |
|---|---|
| Application login | SQL-created `platform_app`; no superuser, BYPASSRLS, role/database creation, replication, role memberships, or table ownership |
| Migration owner | `neondb_owner`, direct TLS connection; never supplied to serving processes |
| Domain connections | Pooled `platform_app` connection with transaction-local tenant context |
| Authentication connections | Direct `platform_app` connection; Neon's pooler rejects the existing `search_path=auth,public` startup option |
| Schema | Numbered migrations 001–027, Better Auth/OAuth schema and shared auth counters |
| OAuth | Public PKCE/device-flow CLI client, internal resource verifier, and customer/operator resources under the production origin |
| Reporting | NOLOGIN `platform_reporting` owns the reporting views; the runtime has no membership in it |
| Data protection | Forced tenant RLS, journal mutation restrictions, and no public schema-creation privilege for the runtime |

The production database contains no demo/customer accounts or seeded credits. Validation rows were rolled back. Migration source hashes are retained with private setup artifacts so later release checks can detect edits to already-applied migrations.

## What is configured

- The globally installed Neon CLI is version 4.14.1 and authenticated on this machine. Its credentials are separate from application credentials.
- The ignored root `.neon` file selects the project and branch for CLI operations. Each new checkout must establish its own link.
- Root neon.ts (`neon.ts`, pending implementation release) contains the requested empty `defineConfig({})` policy. The pinned development dependency `@neon/config` 1.3.0 loads it; the existing application environment validator remains authoritative, so `@neon/env` is unnecessary.
- Official `neon`, `neon-postgres`, and `neon-postgres-branches` skills are installed under `.agents/skills/`, with versions tracked by root `skills-lock.json`.
- Codex's project-local `.codex/config.toml` connects to Neon's hosted MCP server using a project-scoped API key. The file is ignored and owner-readable/writable only. The key can manage resources inside this project; it is an operator development credential, separate from the product's read-only management MCP. Other projects and global coding-agent settings were not configured.

The application continues to use its existing PostgreSQL driver, SQL migrations, application-owned Better Auth, private R2 storage, and Vercel hosting. The policy declares no additional Neon services. An empty policy leaves unspecified existing services/settings unmanaged; it does not remove them.

## Use the CLI without switching the local application to production

From the repository root, use explicit targets and skip automatic environment downloads:

```sh
neon link --project-id dry-thunder-40391696 --branch production -y --no-env-pull
neon config plan --project-id dry-thunder-40391696 --branch production
neon deploy --project-id dry-thunder-40391696 --branch production --no-env-pull
```

`neon deploy` applies Neon branch policy. It does not run this application's SQL/auth migrations, configure Vercel, or publish the dashboard. Both `link` and `deploy` pull environment variables by default; omitting `--no-env-pull` can replace the local simulator's `DATABASE_URL` with a privileged cloud URL. Use the same flag for `neon checkout`. Never point routine local setup, seed, or test commands at the linked production branch.

To reproduce operator tooling on another trusted checkout, install `neon`, log in, and run:

```sh
neon skills -y --agent codex --skill neon --skill neon-postgres --skill neon-postgres-branches
neon mcp -y --agent codex --project --project-id dry-thunder-40391696
```

The MCP command may mint a new project-scoped key; check existing configuration before repeating it. Reload the project/start a new Codex session if the newly configured server is not available. No MCP secret belongs in Git, application environment variables, or customer sandboxes. The setup-created key has ID `3316508`; revoke it through Neon key management when retiring this checkout, then remove or replace its local MCP configuration. Do not revoke other operator credentials.

## Credentials and application deployment

The private, ignored `.data/launch/production.env` contains the consolidated runtime and administrative values. The separate root Neon environment files were removed. Existing nonempty worksheet values took precedence; empty database URLs were filled and missing keys were added.

The application origin is `https://app.macrofold.ai` in the production worksheet, Vercel environment file and provider callback/CORS worksheets, matching the verified database OAuth registration. The apex domain `macrofold.ai` remains available for marketing and email. Updating these local files does not configure DNS or external provider dashboards.

**Reconcile the secrets before deployment.** The retained `AUTH_SECRET`, `VAULT_KEY`, and `CRON_SECRET` still differ from the original setup values. The stored OAuth verifier was encrypted and derived using the original vault/auth keys, so the worksheet is not the environment used by the successful OAuth verification. Resolve the intended keys before provisioning or launching; do not silently rotate encrypted credentials. Original setup material remains in private `.data/neon-provision/production.json` for reconciliation/recovery.

The combined worksheet includes the privileged owner `MIGRATION_DATABASE_URL` at the operator's request. **Exclude it from Vercel/web/worker imports** using the filtered `.env.vercel.production` export in [launch step 1](../18-launch-guide.md#1-open-the-right-local-files), and supply it only to administrative migration commands. The offline launch checker deliberately flags administrator credentials in `production.env`; merging the files does not bypass that guard. Runtime `DATABASE_URL` remains pooled and restricted; `AUTH_DATABASE_URL` remains direct and restricted.

The worksheet is not automatically loaded by Next.js or the local `.env` loader. Git and Docker exclude it, private setup artifacts, and local MCP credentials. It retains owner-only file permissions. Save the appropriate keys in a recovery vault before retiring this checkout.

The initial database setup through migration 027 is complete; reconcile later release migrations in [launch guide step 3](../18-launch-guide.md#3-create-postgresql-and-apply-migrations). Finish Vercel/domain setup, R2, email, operator identity, vendor registrations and the [pre-deployment acceptance checks](../21-pre-deployment-checklist.md). Then exercise the actual deployed database connections, signup/login, CLI device authorization and dashboard streaming. A successful database setup does not enable those external services or establish production capacity.

## Step-by-step release migrations

The setup record now covers migrations **001–027**, including 027_queue_deadline_default.sql (`packages/db/027_queue_deadline_default.sql`, pending implementation release). Apply every later migration after rehearsal; do not redo the initial role/bootstrap setup. Do not edit an already-applied numbered file. The source hashes in `.data/neon-provision/` identify the rehearsed/applied sources.

1. Complete [launch guide step 1](../18-launch-guide.md#1-open-the-right-local-files): reconcile the combined worksheet's auth/vault/cron key conflicts above, and supply its `MIGRATION_DATABASE_URL` to `.data/launch/admin.env` only when using helpers that require that administrative file. Do not import the owner key into hosting. The helpers parse dotenv data without executing it or replacing the local simulator `.env`.
2. Open [Macrofold in Neon](https://console.neon.tech/app/projects/dry-thunder-40391696), then **Branches → Create branch / New branch**. Select **production** as parent, current state, and name the branch `release-rehearsal`. Review the branch compute allowance/cost, use a small compute cap and a short expiration if offered, then create it. Branch writes are isolated, not necessarily free. With customer data, use schema-only branching unless the test specifically requires an approved data copy. [Neon branching instructions](https://neon.com/docs/manage/branches).
3. From the repository root, create a separate private worksheet directory once:

   ```sh
   if [ -e .data/launch-rehearsal ]; then
     echo "Existing rehearsal directory: inspect it before continuing."
   else
     mkdir -m 700 .data/launch-rehearsal
     cp -p .data/launch/* .data/launch-rehearsal/
   fi
   ```

   If the directory already exists, inspect that directory and reuse only if it is the intended rehearsal; do not overwrite blindly. This copy is private test configuration, not a Vercel environment import. Do not run it as a worker or web server.
4. In Neon select **release-rehearsal → Connect**. Select `neondb` and the **owner** with pooling **off**; replace only the rehearsal `admin.env`'s `MIGRATION_DATABASE_URL` with its complete TLS URL. Select **platform_app** and pooling **on**; replace rehearsal `production.env`'s `DATABASE_URL`. Switch pooling **off** for its `AUTH_DATABASE_URL`. The role is cloned with the branch, so do not create/reset it. Keep the existing auth/vault keys and origin for migration compatibility; no emails or provider work is started by these migration commands.
5. Confirm all three copied hostnames belong to **release-rehearsal**, not production. Keep the three launch flags false; remove copied external provider keys from the rehearsal worksheet if present. Run:

   ```sh
   nvm use
   node .data/launch-rehearsal/run.mjs migrate
   node .data/launch-rehearsal/run.mjs auth-migrate
   node .data/launch-rehearsal/run.mjs provision-cli
   node .data/launch-rehearsal/run.mjs doctor
   ```

   Stop after any failing migration. Require database-role, tenant-isolation, OAuth-resource and auth-counter checks to pass. Execution-profile readiness can remain incomplete in this database-only rehearsal; record that distinction. A full hosted release test belongs in a dedicated staging environment with its own origin, keys and provider accounts.
6. Inspect the applied migration record using `node .data/launch-rehearsal/run.mjs database-shell`, then:

   ```sql
   SELECT current_database(), current_user, version();
   SELECT version, applied_at FROM schema_migrations ORDER BY version;
   ```

   Type `\q` to exit. Record branch ID, source commit, migration results and any permission failures. Test the migration's feature-specific behavior in the isolated environment before applying to production.
7. For an existing live deployment, pause admission, drain old Workflows and take the release restore point first. For this initial empty installation there are no customer runs to drain. Recheck the original `.data/launch/` files still name **production**, then run its `migrate`, `auth-migrate`, `provision-cli` and `doctor` commands as shown in [launch step 3](../18-launch-guide.md#3-create-postgresql-and-apply-migrations).
8. Retain evidence, then delete only the named disposable rehearsal branch through the branch settings after its tests/diagnostics are finished. Do not reset/promote it over production. Remove or retire its private credentials after the retention period you choose.

The exact scripts are [numbered migration runner](../../scripts/migrate.ts), [auth migration](../../scripts/auth-migrate.ts), [CLI provisioning](../../scripts/provision-cli.ts) and [doctor](../../scripts/doctor.ts). Auth initialization uses the configured origin and secrets; loading the wrong origin before auth provisioning can register the wrong OAuth resources. A renamed domain requires a coordinated auth/callback migration, not just a DNS change.

## Fresh installation or connection-file recovery

**For Macrofold, recover/reuse the existing project and role.** The following console instructions also describe how to bootstrap a genuinely separate installation.

1. Sign in at [Neon Console](https://console.neon.tech) and select your organization. For the existing service open [project `dry-thunder-40391696`](https://console.neon.tech/app/projects/dry-thunder-40391696) and branch **production**. Its database is **neondb**, PostgreSQL **18.6**, AWS **US East 2 / Ohio**.
2. Only if creating a different installation: choose **New project**, enter the name, expand **Postgres database**, explicitly choose engine and region, leave the other services off, review the plan, then create it. PostgreSQL 17 / AWS US East 1 (Northern Virginia) matches the local fixture and current Vercel region if offered. Do not recreate Macrofold to follow this alternative. [Project instructions](https://neon.com/docs/manage/projects).
3. Select the branch's **Postgres database → Databases** (or **Roles & Databases** in older console layouts). Reuse its default database; no product-name-specific database is required. Click **Connect**, choose the database/owner role and switch **Connection pooling off**. Copy the full TLS URL into the private migration environment, never runtime settings. [Connection dialog](https://neon.com/docs/connect/connect-from-any-app).
4. If restoring the existing credential files, retrieve matching runtime URLs and auth/vault keys from the recovery vault. Do not generate replacement vault/auth keys or rotate the database password as a shortcut: provisioned OAuth values and encrypted content depend on them.
5. For a fresh database only, create `platform_app` **with SQL** using the owner session. Do not use Neon's console/CLI **Add role**, which grants `neon_superuser` membership. [Neon role rules](https://neon.com/docs/manage/roles). From root run `node .data/launch/run.mjs database-shell`; inside psql run:

   ```sql
   CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   \password platform_app
   ```

   Enter the matching private fresh-install password at the hidden prompts. The prepared `.data/launch/database-role.sql` performs the same operation and fails if the role exists; it must not be run against the already-configured Macrofold database. Never grant runtime membership in the owner/reporting/admin roles.
6. Obtain both runtime URLs from **Connect** selecting **platform_app**: pooling **on** for `DATABASE_URL`, pooling **off** for `AUTH_DATABASE_URL`. Save them in the private runtime environment, with `DATABASE_RUNTIME_ROLE=platform_app`. Preserve TLS options. Migration/recovery tools use the direct owner connection.
7. Set the final HTTPS origin and independent auth/vault/cron secrets before applying the app SQL/auth migrations and CLI provisioning. Use the rehearsal and release sequence above. The owner needs database/schema ownership plus permission to create/grant the NOLOGIN reporting role; do not fix missing migration permissions by making `platform_app` an administrator.

`psql` is already installed on the prepared Mac. On another Mac, install [Homebrew libpq](https://formulae.brew.sh/formula/libpq) and add its `bin` directory to that terminal's PATH. For PostgreSQL 18 backup/restore use version 18 client tools. The fresh-install helper's `\i`/`\password` commands belong in psql, not the browser SQL editor. Never use `pnpm run setup` or `pnpm seed` against this cloud database.

## Capacity and recovery

The project remains on the Free plan with a 0.25–2 CU production autoscaling range, provider-default five-minute idle suspension, a 512 MiB branch logical-size ceiling, and a six-hour retained-history window. No paid upgrade or custom suspension policy was applied. Keep cron/stream polling and storage growth in view: continuously active workloads can exhaust the free allowance. Follow [measured scaling](../scalability-guide.md#6-neon-setup-and-resizing-procedure) before increasing traffic; the current configuration is not a measured high-concurrency guarantee.

Use direct connections for backup/migration tools. PostgreSQL 18 client tools are required for this server; libpq clients using `sslmode=verify-full` also need a trusted root configuration, such as `PGSSLROOTCERT=system`. The SQL backup was restored into an independent local PostgreSQL 18 instance with policies, ownership roles and grants checked. A complete production recovery rehearsal must still pair SQL with encrypted R2 objects and recovery keys and exercise Neon point-in-time recovery. Free-plan branch protection/custom suspension settings were not enabled.

## Verified scope

Live Neon SQL checks passed for migrations, direct/pooled role and tenant isolation, journal privileges, reporting access, direct auth counter writes, OAuth credential decryption and authenticated introspection. The same setup was rehearsed on a temporary Neon branch before production. [Database verification](neon/verification.md) records the evidence and remaining limits, including the direct-auth requirement and independent SQL restoration.

CLI/MCP authentication and the unchanged empty-policy deployment are verified. The config passes strict TypeScript/formatting checks; its dependencies have Apache-2.0 licenses and no known audit findings at setup time. No paid upgrade, inference, sandbox, email, connector or object-storage operation was invoked. PostgreSQL 18 database integration is verified within the listed checks; the complete application release suite and deployed Vercel acceptance remain separate gates.

See the official [Neon CLI reference](https://neon.com/docs/reference/neon-cli) and [Neon config reference](https://neon.com/docs/reference/neon-ts) for command and policy semantics.
