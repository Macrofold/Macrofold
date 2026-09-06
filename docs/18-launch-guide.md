# Macrofold launch guide

**Release prerequisite:** this publication changes documentation only. The local workspace's additional search providers, shared dashboard refresh, Workflow ownership changes and migrations 025–027 require a separate reviewed application release before deployment. Supporting design/status/testing links point to the previously committed baseline; use this guide and the pre-deployment checklist for the current launch gates. The private launch kit must be available on your prepared Mac or restored from your vault; it is intentionally absent from GitHub.

Follow this document in order. It deploys the implemented application using **Vercel + Neon + Cloudflare R2**, with Resend, Stripe, GitHub, Composio, Brave Search and managed/BYOK models. The canonical application origin is **`https://app.macrofold.ai`** in the local production configuration and provisioned database; `macrofold.ai` can serve the marketing site. Application, API, authentication and integration URLs derive from `APP_ORIGIN`; keep marketing, legal and email domains separate. See [current Neon setup](operations/neon.md) for the verified origin and database state.

Start with [private files](#1-open-the-right-local-files), then [accounts](#2-open-your-accounts-and-select-the-release), [Neon](#3-create-postgresql-and-apply-migrations), [R2/email](#4-configure-private-object-storage-and-email), [Vercel](#5-create-the-vercel-project-and-deploy-the-control-plane), [runtime image](#6-build-and-register-the-native-runtime-image), [identity](#7-verify-the-control-plane-and-create-your-operator-login), and [integrations](operations/launch-integrations.md). Finish [operator access](#13-configure-launch-controls-support-and-operator-agents), [recovery](#14-verify-backup-and-disaster-recovery), [distribution](#15-publish-customer-packages-and-release-source), [support](#16-account-closure-and-incident-support), and [release](#17-open-the-service-to-real-users).

This is the established GitHub launch-guide entry point. The companion [pre-deployment checklist](21-pre-deployment-checklist.md) is the release sign-off, not a second setup guide. Cloud hosting, migrations, storage operations, email and provider tests can consume usage; nothing in this documentation update deploys or spends on your behalf.

**Current handoff:** the operator has created the provider API keys but has not entered them in the launch environment. Reuse those keys and existing accounts; instructions to create a key/resource apply only when that specific item is missing. Enter credentials privately in the files below, never in chat. An API key does not supply a bucket name, runtime image, Stripe price/webhook, Composio auth config or model catalog; those remain separate configuration steps.

Keep [the exact environment-variable reference](operations/launch-environment.md) open alongside this guide. It lists every prepared setting, its value/source, destination, optional blanks, and the Vercel save/import/redeploy steps, including separate staging values.

## 1. Open the right local files

On the prepared Mac, open this repository in your editor:

```sh
cd /Users/mzw/Documents/ChatGPT/AgentCloud
nvm install 24.13.0
nvm use 24.13.0
node --version
pnpm --version
```

Expected: Node **24.13.0** from .nvmrc (`.nvmrc`, pending implementation release), pnpm **10.33.0** from [package.json](../package.json). `nvm use` changes this terminal, not the system default. On a fresh terminal where nvm is unavailable, load your existing nvm installation first. Install missing prerequisites from [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), [pnpm](https://pnpm.io/installation), and [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/).

On a fresh checkout, run `pnpm install --frozen-lockfile` before the helper commands. Do not run local setup against a cloud profile.

The following private files already exist on this Mac. Open `.data/launch/README.md` for **clickable links to each private file**. They are intentionally absent from Git, Docker images and public documentation links; on another machine, recover them from your private vault before following commands that use the launch kit. The public configuration reference is [.env.example](../.env.example).

| File to open in the repository | Exact purpose |
| --- | --- |
| `.env` | Local simulator only. Leave it unchanged. |
| `.data/launch/production.env` | Consolidated operator worksheet, including the migration-owner URL. **Do not import it wholesale into Vercel.** |
| `.data/neon-provision/production.json` | Original successful Neon setup values. The origin matches; its auth/vault/cron keys currently differ from the merged worksheet. Reconcile using the mapping below. |
| `.data/launch/admin.env` | Private administrative worksheet for helper commands; copy the owner URL here. Never upload it to Vercel. |
| `.env.vercel.production` | Runtime-only export for Vercel, regenerated below. The existing placeholder file is not deployable. |
| `.data/launch/models.json` | Model IDs, harness mappings and reviewed token rates. |
| `.data/launch/composio-auth-configs.json` / `composio-toolkit-versions.json` | App authentication configuration IDs and tested toolkit version pins. |
| `.data/launch/mcp-oauth-clients.json` | Exact MCP server origins mapped to pre-registered OAuth clients, only where needed. |
| `.data/launch/r2-cors.json` / `r2-lifecycle.json` | Bucket CORS and temporary-upload cleanup rules. |
| `.data/launch/github-app-settings.json` / `stripe-settings.json` | Provider settings to transcribe in their dashboards. |
| `.data/launch/stripe-sandbox-settings.json` / `stripe-sandbox.env` | Existing Stripe sandbox verification record and matching Pro/Scale price IDs. Use for staging only; runtime key, webhook, Portal and application billing acceptance remain pending. |
| `.data/launch/callback-urls.json` / `vercel-settings.json` | Generated endpoint list and hosting worksheet. |
| `.data/launch/release-record.json` | Your actual release, recovery and provider test results. Empty/false fields are not sign-off. |

**Resolve the consolidated worksheet before migration or deployment:**

1. Open `.data/neon-provision/production.json` and `.data/launch/production.env` side by side in your private editor. To keep the already-verified OAuth setup, use this mapping:

   | Key in original private JSON | Key in `production.env` |
   | --- | --- |
   | `origin` | `APP_ORIGIN` |
   | `runtimePooled` | `DATABASE_URL` |
   | `runtimeDirect` | `AUTH_DATABASE_URL` |
   | `authSecret` | `AUTH_SECRET` |
   | `vaultKey` | `VAULT_KEY` |
   | `cronSecret` | `CRON_SECRET` |
   | `ownerUrl` | `MIGRATION_DATABASE_URL` (administrative only) |

   The production origin already matches `https://app.macrofold.ai`. The worksheet still retains different auth/vault/cron keys, so it is **not** the environment used by the successful OAuth verification. Choose the original working keys to preserve those encrypted credentials. If retaining the worksheet's different key set is intentional, complete a coordinated key migration and repeat OAuth verification before proceeding; do not silently rotate existing encrypted data. The separate `.env.neon.runtime` and `.env.neon.migration` files were removed. No credential value is changed by the origin update.
2. Copy the chosen `ownerUrl` into `MIGRATION_DATABASE_URL` in `.data/launch/admin.env` for the wrappers. This field is currently blank: the helper merges `admin.env` over `production.env`, so the blank value overrides the populated owner URL and blocks administrative commands. The older `PLATFORM_APP_DATABASE_PASSWORD` there is not the existing role's password. Do not run `database-urls` or `database-role.sql` for this already-provisioned database.
3. Keep these settings during setup:

   ```dotenv
   PRODUCT_NAME=Macrofold
   APP_ORIGIN=https://app.macrofold.ai
   PLATFORM_MODE=production
   EXECUTION_PROVIDER=vercel
   ORCHESTRATION_BACKEND=workflow
   ALLOW_PAID_EXECUTION=false
   RUN_ADMISSION_ENABLED=false
   PUBLIC_SIGNUP_ENABLED=false
   GLOBAL_CONCURRENT_RUN_LIMIT=5
   DATA_DIR=/tmp/hosted-agent-control-plane
   ENABLE_EXPERIMENTAL_COREPACK=1
   ```

4. Fill `OPERATOR_EMAILS` with your exact login email; choose an existing support inbox for `SUPPORT_EMAIL`. Set `EMAIL_FROM` after verifying the sender in step 4. `multiversalmike@gmail.com` is a previously supplied contact, but operator/support/sender choices still need confirmation. A support address must actually receive mail.
5. Run the **offline** renderer after every origin or JSON change:

   ```sh
   node .data/launch/prepare.mjs render
   node .data/launch/prepare.mjs check
   ```

   This updates JSON environment values, CORS and callback worksheets; it does not upload settings. The local worksheets already use `https://app.macrofold.ai`, with `domain` in `vercel-settings.json` set to `app.macrofold.ai` and `production_origin` in `release-record.json` matching the canonical origin. The renderer does not update those last two records; maintain them manually if the domain changes. The checker reports field names without secrets. Its **administrator-credentials finding is expected** while this combined worksheet contains `MIGRATION_DATABASE_URL`: retain the guard and use the filtered export below. Resolve every other core finding and the `pending_launch_configuration` entries for selected integrations before launch.
6. Generate the Vercel import file with this offline command from the repository root. It preserves the consolidated source, checks the original working identity keys/origin, strips administrative credentials, and replaces the existing placeholder export:

   ```sh
   node --input-type=module <<'NODE'
   import { readFile, writeFile, chmod } from 'node:fs/promises';
   import { parse } from 'dotenv';
   const env = parse(await readFile('.data/launch/production.env'));
   const original = JSON.parse(await readFile('.data/neon-provision/production.json', 'utf8'));
   for (const [key, source] of Object.entries({
     APP_ORIGIN: 'origin', AUTH_SECRET: 'authSecret', VAULT_KEY: 'vaultKey', CRON_SECRET: 'cronSecret'
   })) {
     if (!env[key] || env[key] !== original[source]) throw new Error(`Reconcile ${key} before export.`);
   }
   delete env.MIGRATION_DATABASE_URL;
   delete env.PLATFORM_APP_DATABASE_PASSWORD;
   delete env.VERCEL_OIDC_TOKEN;
   const lines = Object.entries(env).map(([key, value]) => {
     const quote = !value.includes("'") ? "'" : !value.includes('`') ? '`' : null;
     if (!quote) throw new Error(`Review dotenv quoting for ${key}.`);
     return `${key}=${quote}${value}${quote}`;
   });
   await writeFile('.env.vercel.production', lines.join('\n') + '\n', { mode: 0o600 });
   await chmod('.env.vercel.production', 0o600);
   console.log('Runtime-only Vercel export prepared; no secrets printed and no network calls made.');
   NODE
   ```

   Open the resulting `.env.vercel.production` privately: it must have restricted runtime URLs and **no** `MIGRATION_DATABASE_URL` or `PLATFORM_APP_DATABASE_PASSWORD`. Repeat this export after provider changes, then import that file into Vercel **Production only**. In `.data/launch/vercel-settings.json`, replace the stale `environment_file: "production.env"` entry with `".env.vercel.production"` (relative to the repository root). The hosting worksheet is not an import command, but its old filename points at a privileged combined file. This deliberately stops if the original keys/origin have not been reconciled; a separately chosen migration needs its own verified export baseline. The command does not test credentials, deploy, or make incomplete configuration ready for users.
7. Save the reconciled active keys and private files in an independent recovery vault. Never regenerate an active `VAULT_KEY` as a deployment fix. Keep dotenv files as data; do not execute them with `source`.

**Done when:** the worksheet's origin/keys match a verified OAuth setup, the admin helper has its owner URL, the Vercel export excludes administrator credentials, all three launch flags remain false, and your local simulator `.env` is untouched.

## 2. Open your accounts and select the release

The source repository is already [Macrofold/Macrofold](https://github.com/Macrofold/Macrofold), with `main` as the deployment branch. Do not create a replacement repo or change `origin`. Check `git status --short` and `git log -1 --oneline`; a Vercel Git deployment includes only pushed commits, not current uncommitted work. Finish review/CI and push the intended release before the final deployment. Configure repository checks using [the CI procedure](24-testing-ci.md#enable-github-checks-and-a-live-coverage-badge).

| Platform to open | What this application needs |
| --- | --- |
| [GitHub repository](https://github.com/Macrofold/Macrofold) | Source/Actions; a separate GitHub App for customer repositories |
| [Vercel dashboard](https://vercel.com/dashboard) | **Pro** team, web project, Workflow, Sandbox, Container Registry |
| [Existing Neon project](https://console.neon.tech/app/projects/dry-thunder-40391696) | Existing `production` database; additional isolated test/recovery branch as needed |
| [Cloudflare dashboard](https://dash.cloudflare.com) | R2 subscription and private bucket; DNS only if Cloudflare hosts your zone |
| [Resend domains](https://resend.com/domains) | Verified outgoing domain and sending key |
| [Stripe dashboard](https://dashboard.stripe.com) | Sandbox/test billing first; business/bank verification before live payments |
| [Composio dashboard](https://dashboard.composio.dev) | Platform project, callback verifier, per-toolkit auth configurations |
| [Brave Search API](https://api-dashboard.search.brave.com) | Search subscription and key |
| [OpenAI platform](https://platform.openai.com) / [Anthropic Console](https://platform.claude.com) / [OpenRouter keys](https://openrouter.ai/settings/keys) | Separate managed-inference accounts/keys for the routes you enable |
| [PostHog](https://app.posthog.com) | Optional metadata export; native growth/usage reporting needs no PostHog account |
| [npm](https://www.npmjs.com) / [PyPI](https://pypi.org) | Customer package publication, if using public package distribution |

Use your own accounts, enable MFA, and retain recovery codes. Review each account's quotas and spending alerts before enabling work. **Vercel Hobby is not the launch plan:** this commercial application also has a minutely cron, which Hobby cannot schedule. Confirm current [Pro pricing](https://vercel.com/docs/plans/pro-plan), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), and [Sandbox pricing](https://vercel.com/docs/sandbox/pricing). Hosting and background polling can cost money even with `ALLOW_PAID_EXECUTION=false`; that flag prevents platform agent execution, not vendor infrastructure billing.

## 3. Create PostgreSQL and apply migrations

**Already completed for this project:** Neon PostgreSQL **18.6**, database `neondb`, production branch in **AWS Ohio**; migrations **001–027**, restricted `platform_app`, direct auth connection, CLI/resource OAuth provisioning, SQL/RLS checks and independent local SQL restore. See [exact database evidence](operations/neon/verification.md). The local test default remains PostgreSQL 17.

1. Open the [existing Neon project](https://console.neon.tech/app/projects/dry-thunder-40391696), select **production**, then **Postgres database**. Leave Neon Auth, object storage, functions and AI gateway unused: those responsibilities already have other implementations.
2. Reuse the private credentials from step 1. The domain URL is **pooled**; the auth URL must remain **direct** because the real Neon pooler rejected its startup `search_path` option. No new role/password is required.
3. Compare the applied migrations with the numbered files in [packages/db](../packages/db). The verified setup now includes **027_queue_deadline_default.sql**. Rehearse every later unapplied migration on an isolated Neon branch using [the exact migration procedure](operations/neon.md#step-by-step-release-migrations); then apply to production using the same release sources.
4. From the root, with the reconciled launch worksheets and paid execution off, run:

   ```sh
   node .data/launch/run.mjs migrate
   node .data/launch/run.mjs auth-migrate
   node .data/launch/run.mjs provision-cli
   node .data/launch/run.mjs doctor
   ```

   These commands contact the configured database. Stop after any failed migration. Doctor may report missing execution-profile fields until R2/email/runtime setup is finished; require all database and OAuth checks to pass now, then require the whole command to pass in step 7.
5. Record the final migration list and exact source commit in the release record. Never run the demo seed or local setup against Neon. A policy-only `neon deploy` does not apply SQL migrations.

For another installation or a lost connection file, follow [the specific Neon console and role instructions](operations/neon.md#fresh-installation-or-connection-file-recovery). Do not redo fresh-install role creation on this existing database. The current Neon region is Ohio while [Vercel configuration](../apps/web/vercel.json) selects Northern Virginia (`iad1`); measure deployed latency before scaling, and explicitly review any region migration rather than silently recreating the database.

## 4. Configure private object storage and email

### Cloudflare R2

1. Open [Cloudflare](https://dash.cloudflare.com), select your account, then **Storage & databases → R2 → Overview**. Complete the R2 subscription setup if prompted; included allowance does not cap future bills. [R2 setup](https://developers.cloudflare.com/r2/get-started/).
2. Choose **Create bucket**, name it `macrofold-production`, and use the Standard storage class. Choose a North America location hint if offered. Create the bucket and leave public access/custom public domains disabled. Set `R2_BUCKET` in `production.env` to its exact name.
3. From R2 **Overview → Account Details → API Tokens → Manage**, create an account token named `macrofold-production-objects`, permission **Object Read & Write**, restricted to this bucket. Save the resulting **Access Key ID** and **Secret Access Key** in `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Use the displayed **S3 endpoint** for `R2_ENDPOINT`; do not append the bucket name or substitute the Cloudflare REST bearer token. [R2 credential instructions](https://developers.cloudflare.com/r2/api/tokens/).
4. Open the bucket's **Settings → CORS policy**. Paste `.data/launch/r2-cors.json`, which uses the canonical app origin, and save. Its allowed origin must be `https://app.macrofold.ai`. [CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/).
5. In **Settings → Object lifecycle rules**, add rule `expire-staged-uploads-after-one-day`, prefix **`staging/`**, delete after **1 day**. Save it. The equivalent REST body is `.data/launch/r2-lifecycle.json`; it is not the CORS editor format. Keep existing unrelated rules, and do not expire all persistent project objects. [Lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
6. Keep backup credentials/storage separate from the application's bucket key. R2 upload/download and recovery acceptance happen later; creating the bucket alone does not establish persistence.

### Resend

1. Open [Resend Domains](https://resend.com/domains) → **Add domain**. Enter `macrofold.ai` if sending as `hello@macrofold.ai`, or use your actual chosen sender domain.
2. In the DNS service that manages `macrofold.ai`, add the exact record names/types/values Resend displays. If Cloudflare manages it, use your zone's **DNS → Records → Add record**. Preserve existing mailbox MX records; only add/alter the records requested for the chosen sending domain. Return to Resend and verify until sending is **Verified**. [Domain troubleshooting](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying).
3. Open [Resend API Keys](https://resend.com/api-keys) → **Create API Key**. Name it `macrofold-production`, select **Sending access** and restrict it to the verified domain. Save the one-time key as `RESEND_API_KEY`. [Key permissions](https://resend.com/docs/dashboard/api-keys/introduction).
4. Set `EMAIL_FROM` to `Macrofold <hello@macrofold.ai>` only if that is your chosen verified sender. Create/verify an actual inbox or forwarding route for `SUPPORT_EMAIL`; Resend sending verification alone does not create a support mailbox.
5. Leave email link tracking off for authentication mail. Actual verification/reset delivery is tested through the application in step 7. A sending-only key cannot list domains: inspect domain status in the console rather than expanding the application's key permissions just to perform a metadata probe.

## 5. Create the Vercel project and deploy the control plane

1. In [Vercel](https://vercel.com/dashboard), select the intended **Pro team** → **Add New → Project**. Import [Macrofold/Macrofold](https://github.com/Macrofold/Macrofold). If missing, allow the Vercel GitHub integration access to this repository. Reuse an existing correct Vercel project instead of importing twice.
2. Set **Framework Preset: Next.js**, **Root Directory: `apps/web`**, and enable **Include source files outside of the Root Directory**. Set Node.js to **24.x**, install command to **`pnpm install --frozen-lockfile`**, build command to **`pnpm build`**, and leave the output directory at its framework default. `pnpm build` here runs the web package because Vercel builds from `apps/web`. Confirm the repository's `packageManager` selects pnpm 10.33.0. [Monorepo setup](https://vercel.com/docs/monorepos).
3. Under **Environment Variables**, import the regenerated **`.env.vercel.production`** from step 1 into **Production only**. Add remaining values later as you obtain them. Do not import `.env`, the combined `.data/launch/production.env`, `admin.env` or `MIGRATION_DATABASE_URL`. Do not prefix server secrets with `NEXT_PUBLIC_`. If pasting individual values, remove dotenv wrapper quotes; JSON must remain valid JSON. [Environment scopes](https://vercel.com/docs/environment-variables).
4. Deploy the control plane with all three launch flags false. The first build can succeed before every provider is ready; `/health` is expected to report missing configuration until image/email/R2 settings are complete. Inspect the build log: Next.js must use Vercel adapter packaging, not standalone copying. The conditional configuration in [next.config.ts](../apps/web/next.config.ts) is intentional.
5. Open **Settings → General** and copy the Project ID into `VERCEL_PROJECT_ID`. In the owning team's **Settings → General**, copy Team ID into `VERCEL_TEAM_ID`. Keep `.data/launch/vercel-settings.json` as your worksheet, not a configuration file Vercel automatically reads.
6. Open **Settings → Domains → Add**, enter **`app.macrofold.ai`**, then add exactly the DNS record Vercel displays at your DNS provider. Wait for **Valid Configuration** and HTTPS. Do not copy an old IP/CNAME from a tutorial. Keep `APP_ORIGIN` equal to this canonical origin; do not replace it with a temporary preview hostname. [Domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
7. Keep previews isolated from production secrets/database/bucket. A dedicated staging project with a stable staging domain is easiest for callback acceptance. Preview protection must not accidentally block scheduled jobs, signed webhook destinations or sandbox callbacks. Configure narrow route exceptions where required and retain application authentication/signature checks.
8. In project **Settings → Cron Jobs**, confirm `/internal/maintenance` at `* * * * *`. Vercel supplies the configured `CRON_SECRET` as its Authorization bearer value. Do not make maintenance public to fix a 401. Watch execution/logs: frequent maintenance and open dashboard streams can prevent Neon from reaching its idle-suspension window. [Cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

After every environment change, use **Deployments → latest intended production deployment → Redeploy** (or deploy the reviewed new commit). Editing environment variables does not update already-running deployments. A successful build is not a database or provider test.

## 6. Build and register the native runtime image

This is a separate image for customer agent execution, built from [infra/runtime.Dockerfile](../infra/runtime.Dockerfile). The web app itself is deployed through Next.js. Image publishing/preparation can consume provider usage.

1. Start Docker Desktop. From the repository root, authenticate the [Vercel CLI](https://vercel.com/docs/cli):

   ```sh
   pnpm dlx vercel@latest login
   pnpm dlx vercel@latest link
   ```

   In `link`, choose the same team and **link to the existing web project**. Use the repository root as the local directory; the project's configured build root remains `apps/web`. If prompted to pull environment variables, decline. The generated `.vercel` link is local state, not customer configuration.
2. Authenticate Docker and build/push an image named `agent-runtime:launch`:

   ```sh
   pnpm dlx vercel@latest vcr login docker
   pnpm dlx vercel@latest vcr build docker . agent-runtime:launch --push -- --platform linux/amd64 -f infra/runtime.Dockerfile
   pnpm dlx vercel@latest vcr tag inspect agent-runtime launch
   ```

   The CLI supplies the registry/team/project prefix. Record the actual CLI version and image digest for repeatability. For later releases use a new tag associated with the release commit; the app is pinned by digest, not this mutable tag. [VCR build/push and reference syntax](https://vercel.com/docs/container-registry), [CLI reference](https://vercel.com/docs/container-registry/cli-reference).
3. Open the project's **Images** view, select `agent-runtime`, and wait for the uploaded image to become **Ready**. Copy its immutable digest and set:

   ```dotenv
   RUNTIME_IMAGE=agent-runtime@sha256:ACTUAL_64_HEX_DIGEST
   ```

   Put the real value in `production.env` and Vercel Production. Do not put the full `vcr.vercel.com/team/project/...` Docker push URL into this field. The runtime's supervisor is started explicitly; do not rely on Docker `CMD` being invoked by Sandbox. [Sandbox images](https://vercel.com/docs/sandbox/concepts/images).
4. For the Vercel-hosted app, use the Sandbox SDK's automatic project **OIDC** authentication. Do not copy a short-lived development `VERCEL_OIDC_TOKEN` into production or into the private worksheet. Keep `VERCEL_TOKEN` unset for this route. **The current adapter does not pass static token/team/project credentials to the SDK.** Setting `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` alone therefore does not enable Sandbox on a non-Vercel host. That alternative needs an adapter change and separate acceptance; it is not a blocker for the chosen Vercel-hosted route. See [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication) and [the adapter](../packages/providers/src/vercel.ts).
5. Review `SANDBOX_EGRESS_DOMAINS` for the package/Git hosts you support; the platform origin is added by the adapter. Redeploy. Do not create a sandbox yet: that is the budgeted execution test in step 17.

## 7. Verify the control plane and create your operator login

1. Rerun `node .data/launch/prepare.mjs render`, then `node .data/launch/prepare.mjs check`. Resolve missing core fields; handle the combined-file administrator finding with the filtered export in step 1. Regenerate/import `.env.vercel.production` after filling providers. Run `node .data/launch/run.mjs doctor` and require every check to pass. Doctor tests database/configuration, not model inference or bucket access.
2. Open [health](https://app.macrofold.ai/health), [API reference](https://app.macrofold.ai/reference), and [OpenAPI JSON](https://app.macrofold.ai/openapi.json). Health must stop reporting missing production settings; then verify actual runtime connections separately. No local demo account should be offered.
3. In an access-controlled acceptance window, temporarily set `PUBLIC_SIGNUP_ENABLED=true` in Vercel Production and redeploy. Leave run admission and paid execution **false**. Register using your exact `OPERATOR_EMAILS` address, open the verification email, log in, and enable MFA with recovery codes.
4. Sign out and exercise password reset. Both messages must arrive at an address you own with links under `https://app.macrofold.ai`. Then set public signup back to false and redeploy. The signup flag is global; it is not an operator-email allowlist.
5. Use the dashboard's API-key flow to create a scoped key for a test organization. Verify a permitted read in the [API reference](https://app.macrofold.ai/reference), revoke the key, and confirm it is rejected. Do not share operator credentials with customer CLI users.

The customer CLI's OAuth client was provisioned with Neon; an actual browser/device login still needs acceptance. See [CLI login and streaming](14-cli.md). No Auth0, Clerk or Neon Auth registration is required by this implementation.

## 8. Configure models and web search

Follow [model and Brave setup](operations/launch-integrations.md#models-and-brave-search). Fill `.data/launch/models.json` with actual account-accessible model IDs, harness mappings and reviewed rates; fill the selected managed-provider keys in `production.env`. Customer BYOK keys go through dashboard **Connections**, not the server's environment file.

Web search also supports **Exa, Tavily, Parallel AI and Firecrawl through BYOK connections**. Only Brave has an operator-funded environment key and managed search rate in this release. Follow [additional search-provider setup](operations/launch-integrations.md#additional-byok-search-providers); do not invent server environment variables for those four providers.

The catalog starts empty deliberately. Do not publish fabricated sample model IDs or zero prices. The application already has its own gateway; enabling a Vercel/Neon AI gateway is not part of this setup. Metadata/model-list success does not establish inference, token accounting or harness compatibility.

## 9. Configure app connections and direct MCP

Follow [Composio setup](operations/launch-integrations.md#composio-app-connections) and [direct MCP setup](operations/launch-integrations.md#direct-and-sandbox-mcp). These instructions include the exact project callback-verification setting, auth-config maps, toolkit pins and dashboard connection journey.

All catalog apps can be browsed; an app becomes authorizable only after its operator configuration and callback verification are ready. Connecting a user's app does not grant every tool to every agent. Users choose connections/tool grants for their work. Keep untested routes unavailable and test each advertised integration.

## 10. Configure GitHub repository access

Follow [GitHub App registration](operations/launch-integrations.md#github-repository-app-and-optional-social-login). This is separate from the GitHub repository holding Macrofold's source and from optional **Sign in with GitHub**. Use the regenerated `.data/launch/github-app-settings.json` and callback worksheet.

Install the App on a dedicated test repository first. Customer repository access remains opt-in, selected-repository scoped, and independent of run success. Branch protection, conflicts, revocation and continued access to persistent files are acceptance gates.

## 11. Configure Stripe in test mode, then live mode

Follow [Stripe setup](operations/launch-integrations.md#stripe-billing). It gives the exact Pro/Scale products and price fields, full webhook event list, API version, Portal restrictions and the separation between test and live environments.

The private `stripe-sandbox-settings.json` records an existing **Macrofold sandbox** and verified $29 Pro / $199 Scale prices; `stripe-sandbox.env` has their matching IDs. Reuse them. Its staging URL, runtime key, webhook destination/signing secret and default Portal configuration are still pending. Metadata verification does not establish Checkout or ledger correctness. The current two-product catalog also needs the documented decision on scheduled downgrades before offering that behavior.

Use a **dedicated staging Vercel project + fresh empty Neon project/database + R2 bucket + Stripe test/sandbox settings** for billing acceptance. Follow [the exact staging setup and variable overrides](operations/launch-environment.md#8-set-up-staging-without-borrowing-production-credentials), using `https://staging.macrofold.ai` as the initial staging hostname. Regenerate all OAuth/webhook/CORS settings for it. Do not share production secrets or test-credit facts with the live ledger. Keep the production payment keys blank until the test lifecycle passes, then configure separate live prices/keys/destination and copy those values into the production worksheet. Hosted staging still consumes infrastructure usage.

## 12. Plan the controlled paid smoke test

Complete steps 13–16 before executing this test or opening registration to customers. This test is intentionally not run during free development verification. Record a numeric test budget and provider/platform limits in `.data/launch/release-record.json`. At step 17, enable both `ALLOW_PAID_EXECUTION=true` and `RUN_ADMISSION_ENABLED=true`, keep `PUBLIC_SIGNUP_ENABLED=false`, redeploy, and use your own funded acceptance organization. Enabling paid execution alone does not open admission. Use separate staging/test credit for billing tests; do not seed production credit. For each enabled harness, create a file, execute a short bounded task, verify streamed output and tool events, end the run, restore its checkpoint into a fresh workspace, and continue its native session. Confirm actual gateway usage, compute settlement, durable files and Git history. Verify a webhook against your own receiver and an explicitly granted harmless connector action. Check the cloud snapshot/recovery lifecycle and limits in the provider console.

Before accepting real customers, review the verification record, execute the release suite, publish your actual support/privacy/terms and retention policy, verify backup/key recovery, and record the paid smoke-test results. Package the CLI and SDKs under namespaces you control; local tarball/wheel installation is already supported, but publishing to npm/PyPI is a separate operator release step.

Operationally, watch oldest queued job age, active/failed/persisting runs, failed webhook/cleanup jobs, provider breakers, unknown usage, credit/debt reconciliation, database connection saturation and object growth. Use read-only `/admin/v1` and `/admin/mcp` reporting to let your own agents report these conditions. Scale or change prices through reviewed operator configuration; the management MCP deliberately cannot change infrastructure, transfer money or read arbitrary customer files.

## Storage, deletion and retention settings

In Billing, inspect the storage observation and included allowance. Overage is disabled initially. Enable it only with an explicit monthly storage budget; the platform also requires unreserved prepaid funds. Pricing is $0.10/GiB per fixed 30-day month, prorated from completed physical-byte observations. Quota exhaustion pauses new runs/uploads/editor writes while preserving downloads/recovery. Accepted runs can temporarily exceed the measured allowance when saving their results. Monitor storage sweep age and scale dispatch throughput before onboarding large numbers of active organizations.

Checkpoint sampling keeps all revisions for 24 hours, daily for 30 days, weekly for 12 weeks, plus current/base, pinned and recent run checkpoints. Unreferenced encrypted objects wait fourteen days before bounded collection. Configure database PITR/backup retention with that object window in mind: an older database backup is not sufficient if its referenced objects have already been collected. If longer backup retention is required, keep a separate immutable copy of both database and object data; do not enable a generic expiration rule on live content.

Project Settings supports archival/restoration and permanent deletion. Permanent deletion requires an owner/admin, exact project-name confirmation and recent browser authentication (or password confirmation). Its seven-day undo period is visible under Projects → Archived & pending deletion. Deletion requests cancel active work. Once the period passes and execution is idle, maintenance removes file/session/result content and preserves accounting identifiers. Object collection follows its additional fourteen-day delay; database/provider backups have their separately configured expiry. Detailed run content expires after 30 days on PAYG and 90 days on Pro and Scale, while terminal status and usage remain queryable. Native session state remains with a persistent project until that project is deleted.


## 13. Configure launch controls, support and operator agents

Keep `GLOBAL_CONCURRENT_RUN_LIMIT=5` for this initial pilot, below the actual Sandbox quota; the code default is 50 and tenant caps still apply. Confirm actual provider quotas before raising the worksheet value. `WORKER_CONCURRENCY` controls portable worker steps, not total customer runs. `API_RATE_LIMIT_PER_MINUTE` defaults to 300 per credential. Authentication uses shared PostgreSQL counters in production; run the authentication migration on upgrades as well as fresh installs. Its endpoint-specific limits are separate from customer API-key limits. Ensure the deployment proxy overwrites forwarded client-IP headers and prevents direct origin bypass. Configure Vercel's edge abuse/rate controls for unauthenticated traffic and registration, and provider account spending alerts. Keep webhook signature validation in the app even when an edge rule permits the endpoint.

Set `SUPPORT_EMAIL` to the working support inbox, and set `PRIVACY_URL` / `TERMS_URL` to the full HTTPS URLs where you publish reviewed policies. You can host these on the marketing site at `macrofold.ai`; do not assume the app already provides `/privacy` or `/terms` pages. Open each URL logged out and send a test message to support before signing off. Public navigation renders configured links. Publish the precise 30/90-day trace, 400-day request/activity, seven-day deletion undo and delayed backup/object policies. State that project files are processed by selected model/tool providers, and that native vendor components have separate terms. The supplied brand candidates are brainstorming, not trademark/domain clearance. Set `PRODUCT_NAME`, sender, domain, package namespaces and repository metadata to the chosen brand; the internal database/code does not rely on the directory codename.

Reuse the verified operator account from step 7. With the reconciled private worksheet and migration URL, create a separate least-privilege management client from the repository root:

```sh
node .data/launch/run.mjs provision-operator
```

The helper writes `.data/launch/operations-agent.json` with owner-only permissions and refuses to overwrite an existing client/file; the command never prints its secret. Store it in your agent's secret manager. Request `client_credentials` tokens at the file's token endpoint with a form containing client_id, client_secret, scope and **one** resource audience. Use `https://app.macrofold.ai/admin/mcp` for an MCP client and `https://app.macrofold.ai/admin/v1` for REST; a token for one is rejected by the other. Do not expose credentials in an agent prompt or shell argv. Inspect [the MCP catalog](api/admin-mcp.json) for tools/schemas and [metric definitions](08-analytics-operations.md) for a suggested operating-agent instruction. For later disable/rotation, use [provision-operator.ts](../scripts/provision-operator.ts) with the same private environment and its `--disable` or `--rotate` options; rotation needs a new unused output path. The small launch wrapper accepts only its documented commands, not arbitrary forwarded flags. PII is excluded unless you explicitly provision `--pii`.

After signing in, open the operator dashboard and compare user counts, human DAU/WAU, requests, tokens, run states, queue ages and account totals with a few known test actions. Repeat a read through the management MCP; a customer key and the wrong token audience must be denied. Native reports read committed SQL facts. PostHog is optional: leave it disabled for the initial pilot, or intentionally configure its project/region/start time/daily-attempt ceiling after reviewing its plan and your privacy policy. Local mode never forwards events. Operational reports do not call an LLM; whichever agent consumes them may have its own inference cost.

## 14. Verify backup and disaster recovery

Open [Neon](https://console.neon.tech/app/projects/dry-thunder-40391696) and inspect the production branch history/restore settings. The recorded Free-plan history is only **six hours**; choose and record a recovery target and a plan/independent backup schedule that can meet it. In [Cloudflare R2](https://dash.cloudflare.com), create a separate private recovery bucket with credentials unavailable to the application. Choose database PITR retention and object-backup retention together. Follow [Neon history-window settings](https://neon.com/docs/postgres/backup-restore/history-window) and [Neon recovery branching](https://neon.com/branching/recovery-workflows). The existing independent SQL restore is evidence of SQL recovery only; paired R2/key restoration and Neon PITR remain required. The live bucket delays collection fourteen days; a database restore older than the referenced objects is insufficient. For longer retention, maintain an independently protected immutable copy of the bucket plus a matching database snapshot and retained keyring. Do not run a mirror with destructive deletion against the recovery copy.

For the first production drill:

1. Set `RUN_ADMISSION_ENABLED=false` and `PUBLIC_SIGNUP_ENABLED=false`, deploy and drain existing runs; keep paid access enabled until already authorized work finishes. Then stop scheduler/maintenance and block mutations at the deployment edge. This produces a consistent quiet backup point.
2. Record the app commit/build, runtime digest, all applied migration numbers, UTC time and active/retained key IDs. Export a provider database backup or `pg_dump --format=custom` using your private credential environment. Copy **all** referenced encrypted objects and manifest children into a separate protected bucket/prefix. Record counts/hashes and the copy's completion. Copying a database without content is not a backup of projects.
3. In a separate recovery environment, restore the database as its owner, preserve/recreate its roles, restore object keys without renaming prefixes, and supply the retained keyring. Use a distinct isolated domain, isolate outbound access, remove live provider credentials, and disable paid execution and cron while inspecting. Admission/signup flags do not disable all maintenance or webhook side effects; isolate the recovery deployment accordingly. Do not connect a restored clone to live Stripe/GitHub endpoints where it could duplicate effects.
4. Run `doctor` with the **recovery environment's** restricted URLs and retained keys (never the root simulator `.env` or the live launch worksheet), then verify a scoped user's saved files by SHA-256, project/workspace revision, native session state, terminal SSE and financial reports. Establish what external calls were in flight at the backup point; do not launch them again merely because a queue row is present.
5. Record measured RPO/RTO, gaps and the recovery operator. Keep the original recovery copy until acceptance. Resume the main deployment's scheduler/mutations/admission separately after the drill; never point production back to an old backup as a routine rollback.

The repository's no-cost analogue is `pnpm exec tsx scripts/test-install.ts`: it uses two disposable local PostgreSQL databases, an independent object copy, retained rotated keys and actual restored API/session checks. Repeat your production drill periodically and before changing storage/key retention.

For key rotation, retain old decrypt keys, activate the new key everywhere, run `rewrap-vault.ts` dry-run, pause all writers, use `--write --confirm-paused`, verify no remaining values need rewrap, restore-test and restart. Outstanding signed URLs/invitations/backups can still need old keys even after stored objects are rewrapped. Retirement is a deliberate separate decision.

## 15. Publish customer packages and release source

`pnpm test:packages` builds CLI/TypeScript tarballs and installs them in an independent temporary npm project. The initial names `@hosted-agents/cli`, `@hosted-agents/sdk` and `hosted-agents` are provisional; claim your own npm/PyPI namespace and update package names, CLI README/examples and release metadata before publication. Internal source aliases need not contain the final brand.

For a private pilot, users can install the generated archives without public publication. For public packages, sign into [npm](https://www.npmjs.com) and [PyPI](https://pypi.org), claim the intended names, and configure protected tag/release jobs with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/). No publishing workflow is claimed already configured. Verify package names in [CLI package metadata](../packages/cli/package.json), [TypeScript SDK metadata](../sdk/typescript/package.json), and [Python metadata](../sdk/python/pyproject.toml). Build the CLI with `pnpm --filter @hosted-agents/cli build`, TypeScript SDK with `pnpm sdk:build`, and Python wheel with `python -m build sdk/python`. Install each built artifact into a clean environment and use its documented host/login flow. No package is claimed already published. The initial verified terminal targets are macOS/Linux; run a real Windows install/Git/TTY job before advertising Windows support.

Edit [.github/CODEOWNERS](../.github/CODEOWNERS) to name the real maintainer/team, configure branch protection/private security reporting, and run the checked-in free CI. Keep API generated types/routes current with `pnpm contracts` and include changelog/API version. Preserve third-party notices and review [distribution notes](20-dependency-review.md), especially native vendor SDK terms. Source LICENSE does not grant rights to unrelated vendor binaries or model services.

## 16. Account closure and incident support

Project archival/deletion is self-service. Whole-account closure is initially operator-assisted: verify the requester through their signed-in/verified support identity, identify shared organizations and transfer ownership where appropriate, cancel subscriptions through Stripe, settle/refund only under your published policy, revoke application keys/OAuth clients and provider connections, request cancellation, export requested customer data and schedule project deletion. Do not delete another member's organization merely because one user closes their personal account.

After execution/deletion completes, remove personal authentication/session/contact records in a reviewed administrative transaction, preserving necessary financial identifiers and audit evidence under your retention policy. External provider tokens, PostHog exports and backups have separate revocation/deletion steps. Record completion and the remaining backup expiry; never promise instantaneous erasure of every vendor copy. An operator must review an account's memberships/payment state before writing deletion SQL; no generic destructive SQL snippet is supplied for arbitrary customer accounts.

For a graceful deployment/provider switch, set `RUN_ADMISSION_ENABLED=false` in Vercel, redeploy, drain, verify checkpoints, stop the old scheduler, deploy the replacement and resume. Use [incident runbooks](09-deployment.md#incident-runbooks) and retain the previous compatible app/runtime digest. For suspected credential abuse, turn off paid execution and revoke affected actors/connections immediately, understanding that already completed external actions cannot be undone. Use queue, reconciliation and storage health plus provider consoles to confirm recovery.

## 17. Open the service to real users

Before opening to customers, complete every enabled gate in [pre-deployment acceptance](21-pre-deployment-checklist.md) and put the exact deployed commit/image, migration list, provider results, budget and recovery evidence in `.data/launch/release-record.json`. After all configuration and recovery steps above, execute the controlled smoke test planned in step 12 and record its provider/harness results. Use only your own pre-created account while signup remains closed; open admission and paid execution for that bounded test window. After the test, pause admission and drain before disabling paid execution if more setup remains. Verify the chosen public domain, real registration and email, funded run and BYOK run, streamed continuation, file restore, GitHub opt-in sync, payment reconciliation and operator reports. Offer only routes you tested. Set `RUN_ADMISSION_ENABLED=true` and `PUBLIC_SIGNUP_ENABLED=true`, deploy the reviewed release, and invite a small initial cohort. Watch queue age, unknown usage, storage sweep freshness, payment discrepancies and support reports during the pilot before increasing global concurrency. Record account quotas and update the cost estimator from actual invoices. Keep a tested rollback revision and retained recovery keys.
