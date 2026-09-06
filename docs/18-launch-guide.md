# Operator setup and launch guide

This is the operator procedure for deploying the implemented product. See [the verification record](16-implementation-status.md) for the exact local checks and live-provider limits. Read this once before creating paid resources; account setup alone is not a live launch sign-off. Local tests have not spent money on inference, sandboxes or provider accounts. The steps below that activate hosting, payments, inference or execution are operator actions and may incur charges.

Complete [the integration acceptance checklist](21-pre-deployment-checklist.md) on the exact deployed release before inviting customers. It distinguishes free public probes from credential-dependent and metered tests, with endpoint-level steps and pass criteria.

## 1. Run the complete local development profile

Install Node.js 24, pnpm 10 and Docker. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

In another terminal, run `pnpm worker`. Open `http://localhost:3210`. The local sign-in form supplies the demo email and password; these fixtures exist only in the local setup. `pnpm run doctor` validates the database role, policies and OAuth provisioning without invoking an agent provider. Mailpit is available at `http://localhost:58025` for local verification/reset messages.

Use `pnpm run setup`, not `pnpm setup`: the latter is a built-in pnpm command. Keep `.env`, `.data`, browser traces and test screenshots out of source control. Never reuse local fixture credentials, signing keys or vault keys in production. The setup script refuses a nonlocal or paid execution profile.

Run `pnpm check`, `pnpm test:domain` (isolated disposable database/object storage), and the fresh database test `pnpm exec tsx scripts/test-install.ts`. Keep the preview web/worker running for `pnpm test:e2e`, `pnpm test:cli`, and `python3 scripts/test-terminal.py`. Native protocol tests require the locally built runtime image; they use intercepted model fixtures with external container networking disabled.

## 2. Create the operator-owned accounts

Use your preferred operator email for accounts that do not already exist. Enable MFA and save recovery codes in your password manager. You need:

| Account | Purpose | Configuration you retain |
|---|---|---|
| GitHub | Application source and optional customer GitHub App | Repository, app ID/client credentials/private key |
| Vercel | Next.js, Workflow, Sandbox and image registry | Project/team IDs, production domain, workload identity or server credential |
| Neon | PostgreSQL | Migration owner and restricted application connection strings |
| Cloudflare R2 | Private persistent content | Bucket, endpoint and bucket-scoped service credentials |
| Resend | Verification, reset and account mail | Verified sender domain and API key |
| Stripe | Customer payments | Test/live keys, webhook secrets, recurring price and portal |
| Model providers | Managed inference, if offered | Separate operator keys and explicit account spending limits |
| Composio, optional | App OAuth and connector actions | Project key, auth configurations, pinned toolkit versions |

Before connecting Vercel, create a private source repository in your GitHub account and upload this checkout. Review `git status` first: `.env`, `.data`, `node_modules`, build output and test traces must remain ignored. Commit the application, docs and lockfile on `main`, add your own repository as `origin`, and push it. If you use the GitHub CLI, authenticate interactively and use `gh repo create YOUR_REPOSITORY --private --source . --remote origin --push` only after committing and confirming that no existing remote would be replaced. The checked-in CI runs on `main` pushes; configure your Actions budget as desired. Public release can follow the dependency/legal review in step 15.

Creating accounts alone does not enable a usable production runtime. Provider access, payment verification, DNS ownership, secrets and the paid smoke test below remain required inputs. Do not put a production key into a preview deployment.

## 3. Create PostgreSQL and apply migrations

Create a PostgreSQL 17 database in US East. Keep the migration owner separate from the application login. Create a `platform_app` login with a generated password and `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; do not grant it membership in the owner or reporting role. Configure TLS in the provider connection strings. The migration scripts create the reporting role/views and tenant policies.

Set `MIGRATION_DATABASE_URL` to the owner connection, `DATABASE_URL` to the restricted runtime connection, `AUTH_DATABASE_URL` to the restricted connection used for the `auth` schema, and `DATABASE_RUNTIME_ROLE=platform_app` in a private administrative environment. The runtime must not receive the migration-owner URL. Use the direct owner connection for migrations. Validate the selected pooler's handling of the auth connection's `search_path` startup option before switching that connection to a transaction pooler.

The migration owner needs database/schema ownership, `CREATEROLE`, and permission to grant the NOLOGIN reporting role it creates. On a provider with restricted role administration, create/grant that role with the provider administrator first. The runtime login must never inherit it. The migration runner temporarily grants CREATE on the reporting schema to transfer view ownership, then removes CREATE. Fresh-install validation also uses a non-superuser migration login.

In a private `psql` session connected as the provider owner, create the application login (set its password interactively rather than storing it in shell history):

```sql
CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password platform_app
```

With the intended production origin and secrets loaded into that administrative environment, run:

```sh
pnpm db:migrate
pnpm exec tsx scripts/auth-migrate.ts
pnpm exec tsx scripts/provision-cli.ts
```

Better Auth may warn that its numeric `lastRequest` field has PostgreSQL type `int8`; its own migration creates this BIGINT epoch-millisecond column. The shared-counter and fresh-install tests verify it; do not narrow it to a 32-bit integer.

Do not run the demo seed against production. Migrations serialize through a database advisory lock. Use forward migrations and database restore points for recovery; do not reverse billing or file-persistence migrations on a live database. Record the provider's actual backup/PITR retention and perform a restore into a separate database before accepting customer data.

## 4. Configure private object storage and secrets

Create a private R2 bucket. Set `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Keep public bucket access disabled. Application objects are tenant-prefixed and encrypted; a bucket credential never enters a customer sandbox. Configure a one-day lifecycle rule for the `staging/` prefix and exact-origin CORS for staged uploads. A starting R2 CORS rule is below; replace the origin, and use a separate bucket for previews/tests:

```json
[{"AllowedOrigins":["https://YOUR_PRODUCTION_DOMAIN"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","x-amz-checksum-sha256"],"MaxAgeSeconds":3600}]
```

Exact signed length/type/hash are independently verified by the application. Never add an untrusted origin or public-read policy merely to bypass a browser CORS error. Do not apply an indiscriminate age-based deletion rule to persistent content.

Generate distinct random production values for `AUTH_SECRET`, `VAULT_KEY` and `CRON_SECRET`, each with at least 32 random bytes. Store them in Vercel's server-side environment and a separate recovery vault. Losing `VAULT_KEY` loses access to encrypted connection credentials and persistent objects. Changing a key without rewrapping existing data is not a valid rotation procedure. For rotation, add a new random key to `VAULT_KEYRING_JSON`, choose it with `VAULT_ACTIVE_KEY_ID`, retain `VAULT_KEY` and all previous entries, then redeploy every writer. Run `pnpm exec tsx scripts/rewrap-vault.ts` as a dry run. After pausing API/worker writers, run it with `--write --confirm-paused`, then repeat the dry run and a restore test. Preserve old keys in the backup vault. Do not retire a key while backups or unexpired URLs/invitations still use it.

## 5. Create the Vercel project and deploy the control plane

Connect the source repository. Select Next.js, root directory `apps/web`, Node.js 24, and include source files outside the root directory so the workspace packages are available. The checked-in Vercel configuration selects `iad1` and minutely maintenance. The Workflow Next.js plugin builds the orchestration entrypoints. Public API and maintenance handlers allow bounded 300-second work; SSE connections rotate after 55 seconds.

Set production variables from `.env.example`, including:

```dotenv
PLATFORM_MODE=production
EXECUTION_PROVIDER=vercel
ALLOW_PAID_EXECUTION=false
APP_ORIGIN=https://YOUR_PRODUCTION_DOMAIN
PRODUCT_NAME=YOUR_BRAND
DATA_DIR=/tmp/hosted-agent-control-plane
```

Add the restricted database URLs, auth/vault/cron secrets, R2 settings and email settings. Set `OPERATOR_EMAILS` to your exact verified operator email. Use the same canonical HTTPS origin when provisioning OAuth clients and callbacks. The production configuration must not contain `local-` fixture secrets. Authentication pages render at request time so promoting a build does not preserve a local demo sign-in form.

Deploy with the Vercel Git integration or linked CLI. Keep execution disabled while configuring services. Inspect `/health`; it returns readiness status without secrets. The API reference is at `/reference`, and the machine-readable contract is at `/openapi.json`. Run `pnpm run doctor` in a private environment containing the same production settings.

## 6. Build and register the native runtime image

Build from the repository root for the actual cloud architecture:

```sh
docker buildx build --platform linux/amd64 -f infra/runtime.Dockerfile -t YOUR_RUNTIME_TAG --load .
```

Link the Vercel CLI to the same project and authenticate to VCR using its documented login flow. Tag and push the resulting image to `vcr.vercel.com/TEAM/PROJECT/agent-runtime:RELEASE`. Image upload/storage and preparation may carry provider charges. Wait until VCR shows **Ready**, then copy its immutable digest. Configure `RUNTIME_IMAGE=agent-runtime@sha256:ACTUAL_DIGEST` for that project. This is a Sandbox image reference; the Docker push destination includes the registry/team/project path. [VCR authentication](https://vercel.com/docs/container-registry), [Sandbox image behavior](https://vercel.com/docs/sandbox/concepts/images).

The application explicitly launches the supervisor; Sandbox does not execute the image's `CMD` automatically. The image contains pinned harness dependencies and a separate unprivileged agent user. Configure Vercel workload identity, or the supported server-side team/project/token credentials, for the production project. Set `SANDBOX_EGRESS_DOMAINS` to the permitted package and repository hosts; include only destinations your product intends to support.

## 7. Configure email and user identity

Verify your sender domain in Resend and publish its required DNS records. Set `RESEND_API_KEY` and `EMAIL_FROM`, for example `Your Brand <hello@your-domain>`. Complete a registration, email verification and password reset using an address you own. This sends actual email, so perform it intentionally after configuration.

The customer CLI uses device OAuth with a public client and PKCE-capable identity infrastructure. Do not give it an embedded client secret. Operator clients are provisioned separately with `scripts/provision-operator.ts`; inspect that script's arguments before running it and capture its one-time credential in your password manager. Customer API keys are not accepted by the management MCP. Its URL is `/admin/mcp`, and its OAuth resource audience is that exact absolute URL.

## 8. Enable managed models or BYOK

Set `MODEL_CATALOG_JSON` using the concrete schema/example in [runtime implementation](17-runtime-implementation.md). Every enabled model needs a reviewed provider/harness mapping and integer token rates. Pin and verify the rate card before enabling managed execution. Set the corresponding operator provider key only for managed routes you intend to fund. A customer BYOK connection is stored through Connections and remains bound to its owner; the application never silently substitutes an operator key.

Keep `ALLOW_PAID_EXECUTION=false` during free verification. Registering a model key is not a credential-validation inference call. The first real run validates it with the provider and may be billed. Set provider spending alerts and account limits in addition to the platform's per-run budget reservation.

## 9. Configure app connections and direct MCP

For Composio, create a project and app auth configurations. Configure its callback identity verifier as `https://YOUR_DOMAIN/integrations/composio/callback`. Set `COMPOSIO_CALLBACK_VERIFICATION_ENABLED=true` only after enabling that setting in Composio. Set `COMPOSIO_API_KEY`, `COMPOSIO_AUTH_CONFIGS_JSON`, exact `COMPOSIO_TOOLKIT_VERSIONS_JSON` versions, and the disclosed fixed `COMPOSIO_MICRO_USD_PER_CALL` retail fee. The SDK's analytics and automatic file uploads are disabled. Review scopes in the provider's consent screen. [Composio callback verification](https://docs.composio.dev/reference/api-reference/connected-accounts).

For remote MCP, users add a public HTTPS Streamable HTTP endpoint and choose OAuth, bearer token or no authentication. OAuth servers may support dynamic registration. For a server that requires pre-registration, configure `MCP_OAUTH_CLIENTS_JSON` keyed by that server's exact origin, with its client ID and optional secret; register `https://YOUR_DOMAIN/integrations/mcp/callback`. The dashboard's Connect flow finishes authorization. Test discovers tools, and Tools selects explicit grants; a newly authorized account does not grant every tool to every agent.

Disconnect revokes platform access immediately. Upstream cleanup retries separately. Users must revoke an API key at its issuing provider if they also intend to invalidate it outside this product. MCP servers without a supported revocation endpoint require a provider-side revocation step.

## 10. Configure GitHub repository access

Register a GitHub App with selected repository access, Contents read/write, Metadata read, and Pull requests read/write for draft PR creation. Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and its generated `GITHUB_APP_PRIVATE_KEY`. Register the OAuth callback `https://YOUR_DOMAIN/integrations/github/callback`. The user authorization URL is `/integrations/github/install`; GitHub sign-in credentials, if desired, are separate `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` values.

In a project’s Git sync tab, authorize your GitHub identity, install the App on the intended repositories, refresh the list, choose the repository and target branch, then connect. The server checks both repository write access and installation membership. Initial import preserves remote Git history. Enable automatic publication only when desired. Use an independent workspace branch for draft PRs. A protected target or merge conflict appears separately from run/persistence success. Never force-push to resolve a blocked sync. Configure the App webhook at `https://YOUR_DOMAIN/webhooks/github` with `GITHUB_WEBHOOK_SECRET`, JSON content type, Push and installation/repository-access events. Enable the separate automatic incoming fetch/merge option only when desired. Notifications defer while an agent writes. Revocation blocks queued sync; reconnect explicitly after restoring App access. Use GitHub delivery inspection/redelivery and explicit fetch for unusually large or undelivered notifications.

## 11. Configure Stripe in test mode, then live mode

Create monthly USD prices for Pro ($29, $10 included credit) and Scale ($199, $50 included credit). Set `STRIPE_PRO_PRICE_ID`, `PRO_MONTHLY_PRICE_MICRO_USD=29000000`, `PRO_INCLUDED_CREDIT_MICRO_USD=10000000`, `STRIPE_SCALE_PRICE_ID`, `SCALE_MONTHLY_PRICE_MICRO_USD=199000000`, and `SCALE_INCLUDED_CREDIT_MICRO_USD=50000000` consistently. Enable Portal payment updates, invoices, cancellation, and switching only between those two approved monthly prices with quantity one. Prefer period-end downgrades. Mid-cycle proration invoices grant no extra credit. See [billing policy](06-billing-costs.md) and [scheduler rollout](25-scheduling.md).

Set `STRIPE_SECRET_KEY` and create a webhook endpoint at `https://YOUR_DOMAIN/webhooks/stripe`. Subscribe to checkout session completion/async success/expiration, subscription create/update/delete, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, and dispute events. Set that endpoint's exact `STRIPE_WEBHOOK_SECRET`. Use the API version supported by the pinned Stripe SDK and verify invoice payment mappings in test mode. A success-page redirect does not grant credits; the verified server event does.

Test a top-up, renewal, failed payment, cancellation, partial refund and dispute lifecycle using Stripe's test environment. Confirm balance/lot history and webhook responses before changing to live keys. Complete Stripe's identity/business/bank verification yourself. Test-mode and live-mode product IDs, keys and signing secrets are separate. Production credit is never seeded by local setup.

## 12. Plan the controlled paid smoke test

Complete steps 13–16 before executing this test or opening registration to customers. This test is intentionally not run during free development verification. Set an explicit small provider/platform spending limit. Enable `ALLOW_PAID_EXECUTION=true`, redeploy, and use your own funded test organization. For each enabled harness, create a file, execute a short bounded task, verify streamed output and tool events, end the run, restore its checkpoint into a fresh workspace, and continue its native session. Confirm actual gateway usage, compute settlement, durable files and Git history. Verify a webhook against your own receiver and an explicitly granted harmless connector action. Check the cloud snapshot/recovery lifecycle and limits in the provider console.

Before accepting real customers, review the verification record, execute the release suite, publish your actual support/privacy/terms and retention policy, verify backup/key recovery, and record the paid smoke-test results. Package the CLI and SDKs under namespaces you control; local tarball/wheel installation is already supported, but publishing to npm/PyPI is a separate operator release step.

Operationally, watch oldest queued job age, active/failed/persisting runs, failed webhook/cleanup jobs, provider breakers, unknown usage, credit/debt reconciliation, database connection saturation and object growth. Use read-only `/admin/v1` and `/admin/mcp` reporting to let your own agents report these conditions. Scale or change prices through reviewed operator configuration; the management MCP deliberately cannot change infrastructure, transfer money or read arbitrary customer files.

## Storage, deletion and retention settings

In Billing, inspect the storage observation and included allowance. Overage is disabled initially. Enable it only with an explicit monthly storage budget; the platform also requires unreserved prepaid funds. Pricing is $0.10/GiB per fixed 30-day month, prorated from completed physical-byte observations. Quota exhaustion pauses new runs/uploads/editor writes while preserving downloads/recovery. Accepted runs can temporarily exceed the measured allowance when saving their results. Monitor storage sweep age and scale dispatch throughput before onboarding large numbers of active organizations.

Checkpoint sampling keeps all revisions for 24 hours, daily for 30 days, weekly for 12 weeks, plus current/base, pinned and recent run checkpoints. Unreferenced encrypted objects wait fourteen days before bounded collection. Configure database PITR/backup retention with that object window in mind: an older database backup is not sufficient if its referenced objects have already been collected. If longer backup retention is required, keep a separate immutable copy of both database and object data; do not enable a generic expiration rule on live content.

Project Settings supports archival/restoration and permanent deletion. Permanent deletion requires an owner/admin, exact project-name confirmation and recent browser authentication (or password confirmation). Its seven-day undo period is visible under Projects → Archived & pending deletion. Deletion requests cancel active work. Once the period passes and execution is idle, maintenance removes file/session/result content and preserves accounting identifiers. Object collection follows its additional fourteen-day delay; database/provider backups have their separately configured expiry. Detailed run content expires after 30 days on PAYG and 90 days on Pro and Scale, while terminal status and usage remain queryable. Native session state remains with a persistent project until that project is deleted.


## 13. Configure launch controls, support and operator agents

Set `GLOBAL_CONCURRENT_RUN_LIMIT` below the actual Sandbox quota; the default is 50, and tenant caps still apply. Start the paid pilot lower if desired. `WORKER_CONCURRENCY` controls portable worker steps, not total customer runs. `API_RATE_LIMIT_PER_MINUTE` defaults to 300 per credential. Authentication uses shared PostgreSQL counters in production; run the authentication migration on upgrades as well as fresh installs. Its endpoint-specific limits are separate from customer API-key limits. Ensure the deployment proxy overwrites forwarded client-IP headers and prevents direct origin bypass. Configure Vercel's edge abuse/rate controls for unauthenticated traffic and registration, and provider account spending alerts. Keep webhook signature validation in the app even when an edge rule permits the endpoint.

Set `SUPPORT_EMAIL`, `PRIVACY_URL` and `TERMS_URL` to your actual reviewed published documents/contact. Public navigation renders configured links. Publish the precise 30/90-day trace, 400-day request/activity, seven-day deletion undo and delayed backup/object policies. State that project files are processed by selected model/tool providers, and that native vendor components have separate terms. The supplied brand candidates are brainstorming, not trademark/domain clearance. Set `PRODUCT_NAME`, sender, domain, package namespaces and repository metadata to the chosen brand; the internal database/code does not rely on the directory codename.

Create your operator human account, verify its email and enable MFA; use that exact address in `OPERATOR_EMAILS`. In an administrative environment with the migration URL, create a separate least-privilege management client:

```sh
pnpm exec tsx scripts/provision-operator.ts --name operations-agent --output /PRIVATE_DIRECTORY/operations-agent.json
```

The output is a protected one-time credential file; the command never prints its secret. Store it in your agent's secret manager. Request `client_credentials` tokens at the file's token endpoint with a form containing client_id, client_secret, scope and **one** resource audience. Use `https://YOUR_DOMAIN/admin/mcp` for an MCP client and `https://YOUR_DOMAIN/admin/v1` for REST; a token for one is rejected by the other. Do not expose credentials in an agent prompt or shell argv. Inspect [the MCP catalog](api/admin-mcp.json) for tools/schemas and [metric definitions](08-analytics-operations.md) for a suggested operating-agent instruction. To disable, rerun the script with `--name operations-agent --disable`. Rotation uses `--rotate` and a new unused output-file path. PII is excluded unless you explicitly provision `--pii`.

Native reports work immediately from committed SQL facts. PostHog is optional: leave it disabled for the initial pilot, or intentionally configure its project/region/start time/daily-attempt ceiling after reviewing its plan and your privacy policy. Local mode never forwards events. Operational reports do not call an LLM; whichever agent consumes them may have its own inference cost.

## 14. Verify backup and disaster recovery

Choose database PITR retention and object-backup retention together. The live bucket delays collection fourteen days; a database restore older than the referenced objects is insufficient. For longer retention, maintain an independently protected immutable copy of the bucket plus a matching database snapshot and retained keyring. Do not run a mirror with destructive deletion against the recovery copy.

For the first production drill:

1. Set `RUN_ADMISSION_ENABLED=false` and `PUBLIC_SIGNUP_ENABLED=false`, deploy and drain existing runs; keep paid access enabled until already authorized work finishes. Then stop scheduler/maintenance and block mutations at the deployment edge. This produces a consistent quiet backup point.
2. Record the app commit/build, runtime digest, all applied migration numbers, UTC time and active/retained key IDs. Export a provider database backup or `pg_dump --format=custom` using your private credential environment. Copy **all** referenced encrypted objects and manifest children into a separate protected bucket/prefix. Record counts/hashes and the copy's completion. Copying a database without content is not a backup of projects.
3. In a separate recovery environment, restore the database as its owner, preserve/recreate its roles, restore object keys without renaming prefixes, and supply the retained keyring. Use a distinct isolated domain and disable paid execution, webhook delivery and cron while inspecting. Do not connect a restored clone to live Stripe/GitHub endpoints where it could duplicate effects.
4. Run `pnpm run doctor`, then verify a scoped user's saved files by SHA-256, project/workspace revision, native session state, terminal SSE and financial reports. Establish what external calls were in flight at the backup point; do not launch them again merely because a queue row is present.
5. Record measured RPO/RTO, gaps and the recovery operator. Keep the original recovery copy until acceptance. Resume the main deployment's scheduler/mutations/admission separately after the drill; never point production back to an old backup as a routine rollback.

The repository's no-cost analogue is `pnpm exec tsx scripts/test-install.ts`: it uses two disposable local PostgreSQL databases, an independent object copy, retained rotated keys and actual restored API/session checks. Repeat your production drill periodically and before changing storage/key retention.

For key rotation, retain old decrypt keys, activate the new key everywhere, run `rewrap-vault.ts` dry-run, pause all writers, use `--write --confirm-paused`, verify no remaining values need rewrap, restore-test and restart. Outstanding signed URLs/invitations/backups can still need old keys even after stored objects are rewrapped. Retirement is a deliberate separate decision.

## 15. Publish customer packages and release source

`pnpm test:packages` builds CLI/TypeScript tarballs and installs them in an independent temporary npm project. The initial names `@hosted-agents/cli`, `@hosted-agents/sdk` and `hosted-agents` are provisional; claim your own npm/PyPI namespace and update package names, CLI README/examples and release metadata before publication. Internal source aliases need not contain the final brand.

For a private pilot, users can install the generated archives without public publication. For public packages, configure protected tag/release jobs and npm/PyPI trusted publishing/provenance in accounts you own. Build the CLI with `pnpm --filter @hosted-agents/cli build`, TypeScript SDK with `pnpm sdk:build`, and Python wheel with `python -m build sdk/python`. Install each built artifact into a clean environment and use its documented host/login flow. No package is claimed already published. The initial verified terminal targets are macOS/Linux; run a real Windows install/Git/TTY job before advertising Windows support.

Add the real maintainer/team to `.github/CODEOWNERS`, configure branch protection/private security reporting, and run the checked-in free CI. Keep API generated types/routes current with `pnpm contracts` and include changelog/API version. Preserve third-party notices and review [distribution notes](20-dependency-review.md), especially native vendor SDK terms. Source LICENSE does not grant rights to unrelated vendor binaries or model services.

## 16. Account closure and incident support

Project archival/deletion is self-service. Whole-account closure is initially operator-assisted: verify the requester through their signed-in/verified support identity, identify shared organizations and transfer ownership where appropriate, cancel subscriptions through Stripe, settle/refund only under your published policy, revoke application keys/OAuth clients and provider connections, request cancellation, export requested customer data and schedule project deletion. Do not delete another member's organization merely because one user closes their personal account.

After execution/deletion completes, remove personal authentication/session/contact records in a reviewed administrative transaction, preserving necessary financial identifiers and audit evidence under your retention policy. External provider tokens, PostHog exports and backups have separate revocation/deletion steps. Record completion and the remaining backup expiry; never promise instantaneous erasure of every vendor copy. An operator must review an account's memberships/payment state before writing deletion SQL; no generic destructive SQL snippet is supplied for arbitrary customer accounts.

For a graceful deployment/provider switch, pause new admission, drain, verify checkpoints, stop the old scheduler, deploy the replacement and resume. For suspected credential abuse, turn off paid execution and revoke affected actors/connections immediately, understanding that already completed external actions cannot be undone. Use queue, reconciliation and storage health plus provider consoles to confirm recovery.

## 17. Open the service to real users

After all configuration and recovery steps above, execute the controlled smoke test in step 12 and record its provider/harness results. Verify the chosen public domain, real registration and email, funded run and BYOK run, streamed continuation, file restore, GitHub opt-in sync, payment reconciliation and operator reports. Offer only routes you tested. Set `RUN_ADMISSION_ENABLED=true` and `PUBLIC_SIGNUP_ENABLED=true`, deploy the reviewed release, and invite a small initial cohort. Watch queue age, unknown usage, storage sweep freshness, payment discrepancies and support reports during the pilot before increasing global concurrency. Record account quotas and update the cost estimator from actual invoices. Keep a tested rollback revision and retained recovery keys.
