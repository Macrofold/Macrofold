# Deploy on Vercel

Host the service using Vercel, Neon PostgreSQL, Cloudflare R2, and Vercel Sandbox. This guide assumes a source checkout, Node 24, pnpm 10, Docker, and permission to configure those provider accounts.

Cloud execution, hosting, and provider requests can incur charges. Keep paid execution and public signup disabled until configuration and a controlled staging run are complete.

## 1. Prepare the release and configuration

Choose one reviewed source revision and install its pinned dependencies:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Create separate staging and production environments. Use the [environment reference](launch-environment.md) to prepare a private runtime file outside the checkout and a separate migration file. No private file from another developer's machine is required. Follow [staging project selection](launch-environment.md#staging-and-vercel-project-selection) so an existing CLI link or environment variable cannot silently target production.

Set `APP_ORIGIN` to the exact public HTTPS application origin, such as `https://agents.example.com`. Use that origin consistently for OAuth, callbacks, CORS, and canonical documentation URLs. Set `PRODUCT_NAME` to your deployment's display name.

Initially use `PLATFORM_MODE=production`, `EXECUTION_PROVIDER=vercel`, `ORCHESTRATION_BACKEND=workflow`, `ALLOW_PAID_EXECUTION=false`, `RUN_ADMISSION_ENABLED=false`, and `PUBLIC_SIGNUP_ENABLED=false`. Choose a conservative `GLOBAL_CONCURRENT_RUN_LIMIT` within your actual provider quotas.

For a new installation, generate independent random `AUTH_SECRET`, `VAULT_KEY`, and `CRON_SECRET` values of at least 32 characters. Keep recoverable copies in a secret manager. For an existing installation, reconcile all runtime exports with the working database/OAuth configuration and retained auth/vault/cron secrets before importing them. Preserve the working key set unless performing a deliberate, tested rotation; do not overwrite existing encrypted credentials with newly generated keys. Export runtime fields only and keep the migration-owner credential separate.

## 2. Configure PostgreSQL

Follow [Neon and PostgreSQL setup](neon.md). Create a restricted runtime role before migrating. Use a pooled runtime `DATABASE_URL`, a direct restricted `AUTH_DATABASE_URL`, and a direct owner `MIGRATION_DATABASE_URL` available only to administrative commands.

Complete the [production recovery safeguards](neon.md#production-recovery-safeguards): configure the seven-day history target on a supporting plan, protect the production branch, and rehearse PITR in isolation before accepting customer data. A completed schema migration does not establish these safeguards.

After preparing the two environment files, run from the repository root, substituting their real absolute paths:

```sh
node --env-file=/absolute/path/runtime.env --env-file=/absolute/path/migration.env --import tsx scripts/migrate.ts
node --env-file=/absolute/path/runtime.env --env-file=/absolute/path/migration.env --import tsx scripts/auth-migrate.ts
node --env-file=/absolute/path/runtime.env --env-file=/absolute/path/migration.env --import tsx scripts/provision-cli.ts
```

Use a dedicated administrative shell without conflicting exported variables: Node preserves existing process variables ahead of env files. Confirm every database target before running a migration. Do not run `pnpm setup` or demo seeding against a hosted database.

## 3. Configure storage and email

Create a private R2 bucket and bucket-scoped object credentials. Set `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Configure exact-origin CORS for browser staging transfers and one-day expiration for temporary staging objects. Never expire permanent checkpoint objects with a blanket bucket lifecycle rule.

Verify a sending domain in Resend and set `RESEND_API_KEY` and `EMAIL_FROM`. Complete signup verification and password-reset delivery in staging. A successful request to a test recipient does not establish deliverability for real users.

See [provider configuration](launch-integrations.md) for permissions and callback ownership.

## 4. Build the native runtime

Build the Linux AMD64 runtime from the same release revision:

```sh
docker build --platform linux/amd64 -f infra/runtime.Dockerfile -t agent-runtime:release .
```

Upload it to the Vercel Container Registry using the [current Sandbox image workflow](https://vercel.com/docs/sandbox/concepts/images). Wait for image readiness and set `RUNTIME_IMAGE` to its immutable `@sha256:…` digest. Do not point production at a moving image tag.

The image contains the pinned native harnesses and protected supervisor. Keep old images for sessions and recovery points that require them. The control plane uses Vercel's OIDC identity for Sandbox access.

## 5. Deploy the application

Import the repository into Vercel and select `apps/web` as the project root. Use the checked-in Next.js and Workflow configuration. Install dependencies from the workspace lockfile and run the app's build script. Associate the custom domain with this application.

Import **runtime variables only** into the intended environment. Exclude `MIGRATION_DATABASE_URL`, provider administrator credentials, local demo values, and private tooling tokens. Never prefix server secrets with `NEXT_PUBLIC_`. Configure Preview separately so preview deployments cannot reach production customer data.

Vercel's Workflow adapter and the authenticated maintenance Cron are configured in [the deployment files](deployment.md). Confirm generated Workflow endpoints and Cron registration after deployment. Redeploy after changing runtime configuration where the hosting provider requires it.

## 6. Configure service integrations

Use [provider integrations](launch-integrations.md) to configure the reviewed model catalog, managed keys, optional Composio apps and MCP, GitHub, search, and Stripe. Enable only integrations for which your deployment has completed authorization and callback setup.

Keep the model catalog compatible with the pinned runtime, include reviewed retail rates, and set vendor-side spending limits. BYOK connections use customer credentials; they do not remove compute or tool charges.

For Stripe, keep a prepared webhook disabled until the deployed receiver and its signing secret are ready. Configure the default Customer Portal, verify delivery through Vercel protection, then enable and exercise [staging billing end to end](launch-integrations.md#activate-and-test-staging-billing) before using live money flows.

## 7. Create operator access and verify the service

Set `OPERATOR_EMAILS` to the verified accounts responsible for operations. Temporarily allow signup for the intended staging/operator registration, complete email verification and MFA, then restore your desired signup policy.

Check `/health`, `/openapi.json`, `/docs`, login, organization creation, scoped API reads, and CLI device authorization. Check a real file upload, checkpoint restore, and detailed stream reconnection. Inspect the Operations dashboard for worker freshness and financial reconciliation.

For an operator agent, provision a separate read-only service client with the migration environment and `scripts/provision-operator.ts --name NAME --output /private/path/client.json`. The output must be a new private file. Customer API keys cannot access the management MCP.

## 8. Test, back up, and open access

In staging, enable `ALLOW_PAID_EXECUTION` and `RUN_ADMISSION_ENABLED` for the controlled test while keeping public signup closed. Use an isolated funded organization and a small explicit spending budget for a real native run, continuation, cancellation, persisted file restore, and selected external tools. Check usage and the provider invoice. Verify SSE flushing, connection rotation, revoked access, Workflow recovery, and queue expiry on the deployed topology.

Rehearse recovery with a database backup, every referenced encrypted object, and retained vault keys. Record recovery time and acceptable data-loss intervals. Configure support contact, privacy and terms URLs, edge abuse controls, monitoring, and provider alerts.

After acceptance, enable paid execution, admission, and signup according to your rollout policy. Start with a small cohort and measure queue age and quota headroom before increasing capacity. Use [the scaling procedure](scaling.md) and [release checklist](pre-deployment.md) to record evidence.

## Upgrade and roll back

Rehearse forward migrations in an isolated database branch, apply them with the owner role, and deploy a schema-compatible application revision. Roll back the application without restoring the database when compatible. Database recovery is an incident procedure, not a routine deployment rollback.

Pause admission and drain active work before changing orchestration providers. Never restart native execution simply to reset scheduler history. See [deployment architecture](deployment.md) and [hosting recovery](hosting.md).
