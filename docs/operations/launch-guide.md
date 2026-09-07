# Deploy on Vercel

Deploy the dashboard and API on Vercel, store application data in Neon PostgreSQL, keep encrypted project files in Cloudflare R2, and run agents in Vercel Sandbox.

Follow this guide **first for staging**, then repeat it for production with separate resources. The commands below are for macOS or Linux in Bash. Run each block in order and wait for its check to pass. You do not need to create a separate worker service, install Redis, or provision Neon Auth.

**Already have an environment?** Read [the existing-environment instructions](#if-this-environment-already-exists) before creating files or secrets. Existing customer data requires its existing encryption keys.

## Before you start

Have these ready:

| You need              | What to prepare                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A release checkout    | The application revision you intend to deploy, committed to Git. The release copy below includes committed changes only.             |
| Local tools           | Node **24.13.0**, pnpm **10.33.0**, Git, and a running Docker installation with Buildx.                                              |
| Vercel                | A **Pro or Enterprise team** with access to Sandbox and Container Registry. The checked-in every-minute cron cannot deploy on Hobby. |
| Neon                  | Permission to create a project and retain its owner connection string.                                                               |
| Cloudflare            | R2 enabled and permission to create a private bucket and bucket-scoped S3 credentials.                                               |
| Resend and DNS        | A sending domain you control, access to its DNS records, and a real inbox for the first operator account.                            |
| Application domains   | Two hostnames you control, such as `staging.example.com` and `agents.example.com`. Use staging first.                                |
| Billing and inference | Stripe test mode for staging, and an Anthropic API account for the small first agent test. Additional providers are optional.        |

Install Node from [Node.js downloads](https://nodejs.org/en/download) and Docker from [Docker's installation guide](https://docs.docker.com/engine/install/) if needed. On macOS, use Docker Desktop and start it before continuing. With Node installed:

```sh
npm install --global pnpm@10.33.0
node --version
pnpm --version
git --version
docker version
docker buildx version
```

**Check:** Node reports `v24.13.0`, pnpm reports `10.33.0`, and Docker reports both a client and a responding server.

Hosting, database uptime, image storage, email, and agent execution can incur charges. Review each provider's billing page before creating paid resources. Disabling agent execution does not disable those infrastructure costs. [Vercel cron plan requirements](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Let an agent handle setup

You can delegate the technical steps below to a coding agent with terminal access. The dashboard instructions provide a manual route; they do not require you to copy every setting yourself. Connect the intended provider accounts, identify the staging project and domains, and specify any approved infrastructure and acceptance-test budget. The agent can then prepare configuration, apply the existing scripts, configure services, and verify the results.

| Service | Agent access | Work the agent can handle |
| ------- | ------------ | ------------------------- |
| Vercel | [Vercel CLI](https://vercel.com/docs/cli), with the login used in step 4 | Project/build settings through CLI or API, runtime environment import, registry publishing, deployment, domain setup, logs, and readiness checks. The optional [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp) helps inspect projects and deployments; use CLI/API for settings its tools do not expose. |
| Neon PostgreSQL | [Neon CLI](https://neon.com/cli) or [Neon MCP](https://neon.com/docs/ai/neon-mcp-server), plus the private migration credential | Inspect or create the isolated database, run the restricted-role SQL and migration scripts, and verify privileges and recovery settings. Use the SQL in this guide for the serving role. |
| Cloudflare R2 and DNS | [Wrangler](https://developers.cloudflare.com/r2/buckets/cors/), Cloudflare API, or [Cloudflare API MCP](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Configure private buckets, exact-origin CORS and scoped lifecycle rules; create application and email DNS records when the authorized DNS zone is in Cloudflare. |
| Resend | [Resend CLI](https://resend.com/docs/cli), API, or [Resend MCP](https://resend.com/docs/mcp-server) | Add the sending domain, obtain its required DNS records, request verification, and inspect status. DNS changes require access to the actual DNS provider. |
| Stripe | [Stripe MCP](https://docs.stripe.com/mcp), CLI, or API | Configure the test product catalog, recurring prices, webhook destination and Customer Portal; verify their agreement with the application. |
| GitHub | GitHub CLI (`gh`) and API | Configure repository environments, [environment-scoped secrets](https://cli.github.com/manual/gh_secret_set), repository rules and release workflows once implemented. |
| Optional Composio | Platform SDK/API with the existing project key | Inspect [auth configurations](https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs), configure the selected integrations, and verify callbacks and connection state. Account owners still complete provider OAuth consent. |

Reuse an installed, authenticated tool before adding another. A remote MCP generally needs a one-time account connection rather than a local server installation. Confirm the actual account, project, environment and available permissions through read-only checks before changing anything; an installed tool is not proof of authorization. Preserve the development checkout and preview by working from the isolated release copy below.

Keep deployment administration credentials separate from application credentials. A database connection string does not grant Neon project administration; an R2 object key does not grant DNS administration; a Resend sending-only key does not grant domain administration. Use scoped administrative access for setup, retain existing encryption keys, and import only runtime settings into the application. Never paste secrets into chat or record them in release output.

You still own account enrollment and billing details, provider login/MFA and OAuth consent, domain ownership, spending and pricing decisions, legal/support information, and custody of recovery codes. After access is granted, the agent can perform the associated configuration. It should request only a specific missing input or inaccessible action and continue independent work. Sending test emails or running paid acceptance requires the agreed recipients and budget.

## Release automation

This walkthrough deploys each environment explicitly. The checked-in GitHub Actions workflows run verification; they do not currently deploy staging or automatically promote production. Following this guide does not install a release pipeline. First-time account setup and recurring releases are separate tasks: later releases reuse the retained environment settings and credentials described under [Upgrade and roll back](#upgrade-and-roll-back).

## The path through this guide

1. [Prepare an isolated release and two private configuration files](#1-prepare-the-release-and-configuration).
2. [Create or connect PostgreSQL and apply the schema](#2-configure-postgresql).
3. [Configure private storage and identity email](#3-configure-storage-and-email).
4. [Create the Vercel project and publish the runtime image](#4-build-the-native-runtime).
5. [Import the runtime file, deploy, and check HTTPS](#5-deploy-the-application).
6. [Configure a model and Stripe test billing](#6-configure-service-integrations).
7. [Create the operator account and verify the dashboard/API/CLI](#7-create-operator-access-and-verify-the-service).
8. [Run controlled acceptance and launch production](#8-test-back-up-and-open-access).

## 1. Prepare the release and configuration

### 1.1 Open a clean deployment terminal

Open a terminal **in the repository root**, where `package.json` and `pnpm-workspace.yaml` are located. Start a shell without inherited application credentials:

```sh
env -i HOME="$HOME" PATH="$PATH" TERM="${TERM:-xterm-256color}" /bin/bash --noprofile --norc
```

Keep this terminal open for the walkthrough. Enable failure checks so a failed command stops the shell instead of continuing with the wrong directory or incomplete setup:

```sh
set -e
set -o pipefail
set -o noclobber
```

The last setting also prevents a pasted file-creation block from overwriting an existing file. Use nano to edit an existing installation. If the shell closes, use [Resume this walkthrough](#resume-this-walkthrough); do not rerun file or secret creation.

Choose the staging directory and copy the committed release into it:

```sh
export LAUNCH_DIR="$HOME/.config/hosted-agents/launch-staging"
umask 077
mkdir -p "$(dirname "$LAUNCH_DIR")"
mkdir "$LAUNCH_DIR"
git clone --no-hardlinks "$(git rev-parse --show-toplevel)" "$LAUNCH_DIR/source"
cd "$LAUNCH_DIR/source"
git switch --detach
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

If `mkdir "$LAUNCH_DIR"` says the directory already exists, **stop this block**. Resume that installation instead of overwriting its files, or choose a new empty directory. `--frozen-lockfile` is intentional here: a release build must use its reviewed dependency versions.

**Check:** installation, type checking, and build succeed. Save the printed commit ID in your release notes. This release copy has no local development `.env` or preview database. Do not run `pnpm run setup` or the demo seed against a hosted environment.

### 1.2 Create the runtime import file

For a **new installation**, paste this entire block. It creates the exact dotenv file you will import into Vercel later:

```sh
cat > "$LAUNCH_DIR/runtime.env" <<'ENV'
PRODUCT_NAME=Platform
APP_ORIGIN=https://REPLACE_WITH_STAGING_HOST
PLATFORM_MODE=production
EXECUTION_PROVIDER=vercel
ORCHESTRATION_BACKEND=workflow
DATA_DIR=/tmp/hosted-agents
ALLOW_PAID_EXECUTION=false
RUN_ADMISSION_ENABLED=false
PUBLIC_SIGNUP_ENABLED=false
GLOBAL_CONCURRENT_RUN_LIMIT=2
POSTHOG_ENABLED=false
DATABASE_RUNTIME_ROLE=platform_app
DATABASE_URL=REPLACE_WITH_POOLED_RUNTIME_URL
AUTH_DATABASE_URL=REPLACE_WITH_DIRECT_RUNTIME_URL
AUTH_SECRET=GENERATE_NEW_INSTALLATION_SECRET
VAULT_KEY=GENERATE_NEW_INSTALLATION_SECRET
CRON_SECRET=GENERATE_NEW_INSTALLATION_SECRET
OPERATOR_EMAILS=REPLACE_WITH_YOUR_OPERATOR_EMAIL
R2_ENDPOINT=REPLACE_WITH_R2_S3_ENDPOINT
R2_BUCKET=REPLACE_WITH_PRIVATE_BUCKET_NAME
R2_ACCESS_KEY_ID=REPLACE_WITH_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=REPLACE_WITH_R2_SECRET_ACCESS_KEY
RESEND_API_KEY=REPLACE_WITH_RESEND_SENDING_KEY
EMAIL_FROM="Platform <REPLACE_WITH_VERIFIED_SENDER_EMAIL>"
RUNTIME_IMAGE=REPLACE_WITH_READY_RUNTIME_DIGEST
ENV
```

Generate three independent secrets directly into that file:

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = process.env.LAUNCH_DIR + '/runtime.env';
let text = readFileSync(file, 'utf8');
for (const key of ['AUTH_SECRET', 'VAULT_KEY', 'CRON_SECRET']) {
  const marker = key + '=GENERATE_NEW_INSTALLATION_SECRET';
  if (!text.includes(marker)) throw new Error('Refusing to replace an existing ' + key);
  text = text.replace(marker, key + '=' + randomBytes(32).toString('hex'));
}
writeFileSync(file, text, { mode: 0o600 });
console.log('Three independent secrets saved; values were not printed.');
JS
```

Open the file:

```sh
nano "$LAUNCH_DIR/runtime.env"
```

In nano, edit the values, press **Ctrl+O**, **Enter** to save, then **Ctrl+X** to exit. Fill these three fields now; later steps supply the remaining values:

| Field             | Enter exactly                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `PRODUCT_NAME`    | Your display name; use `Platform` until branding is decided.                                          |
| `APP_ORIGIN`      | Your staging HTTPS origin, such as `https://staging.example.com`, with **no trailing slash or path**. |
| `OPERATOR_EMAILS` | The real email address you will use to register. Multiple operators are comma-separated.              |

### 1.3 Keep database administration separate

Create the second file:

```sh
cat > "$LAUNCH_DIR/migration.env" <<'ENV'
MIGRATION_DATABASE_URL=REPLACE_WITH_DIRECT_DATABASE_OWNER_URL
ENV
chmod 600 "$LAUNCH_DIR/runtime.env" "$LAUNCH_DIR/migration.env"
```

| File              | Used by                                                    | Upload to Vercel?            |
| ----------------- | ---------------------------------------------------------- | ---------------------------- |
| `runtime.env`     | Web Functions, Workflow, and local administrative commands | **Yes**, after completing it |
| `migration.env`   | Schema migrations and OAuth provisioning on your computer  | **Never**                    |
| Repository `.env` | Local simulation only                                      | **Never**                    |

Back up the completed files in your password manager. The vault key is required to decrypt stored credentials and project data.

### If this environment already exists

Keep its current `AUTH_SECRET`, `VAULT_KEY`, `CRON_SECRET`, database role/password, and any vault keyring entries. Copy the active runtime configuration into your private `runtime.env`; keep only the owner URL in `migration.env`. **Skip the template and secret-generation blocks above.** Add missing settings from the template individually.

If several private files disagree, use the keys from the deployment that encrypted the existing data. Resolve the disagreement before deployment; generating fresh keys is not reconciliation. Follow [vault configuration](launch-environment.md#application-and-identity) for deliberate rotation.

## 2. Configure PostgreSQL

### 2.1 Create the staging database and save the owner URL

For an existing environment, open its project and start at item 4; retain its branch, database name, and PostgreSQL version.

1. Open [Neon Console](https://console.neon.tech/), select your organization, and create a project named `agents-staging`.
2. Choose PostgreSQL **18**, AWS **US East (N. Virginia)**, and the default database `neondb`. This matches the application's checked-in Vercel `iad1` region.
3. Use a fresh project with no customer data. Keep Neon's default owner role for administration. Do not enable Neon Auth or other Neon services for this application.
4. Click **Connect**. Select the intended branch, `neondb`, and the owner role. Turn **Connection pooling off**.
5. Copy just the `postgresql://…` connection URL, including its TLS query parameters. Do not copy a surrounding `psql` command.
6. Open the administrative file and replace its placeholder:

```sh
nano "$LAUNCH_DIR/migration.env"
```

It should contain one line in this shape:

```dotenv
MIGRATION_DATABASE_URL=postgresql://OWNER:ENCODED_PASSWORD@DIRECT_HOST/neondb?sslmode=require
```

The actual URL comes from Neon. Keep its password encoding and any additional query parameters.

### 2.2 Create the restricted serving role — new databases only

Run the following once. It uses the owner URL to create a restricted role, generates its password, and fills both runtime URLs without displaying the password. It refuses to reset an existing role.

```sh
node --env-file="$LAUNCH_DIR/migration.env" --input-type=module <<'JS'
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL);
if (!ownerUrl.hostname.endsWith('.neon.tech') || ownerUrl.hostname.includes('-pooler.')) {
  throw new Error('Use the direct Neon owner URL from Connect, with pooling off.');
}
const file = process.env.LAUNCH_DIR + '/runtime.env';
let text = readFileSync(file, 'utf8');
if (!text.includes('DATABASE_URL=REPLACE_WITH_POOLED_RUNTIME_URL') ||
    !text.includes('AUTH_DATABASE_URL=REPLACE_WITH_DIRECT_RUNTIME_URL')) {
  throw new Error('Runtime URLs already exist; do not recreate their role.');
}
const client = new pg.Client({ connectionString: ownerUrl.toString() });
await client.connect();
try {
  await client.query('BEGIN');
  const password = randomBytes(32).toString('hex');
  // The interpolated password contains only generated hexadecimal characters.
  await client.query(`CREATE ROLE platform_app LOGIN PASSWORD '${password}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
  const direct = new URL(ownerUrl);
  direct.username = 'platform_app';
  direct.password = password;
  const pooled = new URL(direct);
  pooled.hostname = pooled.hostname.replace('.', '-pooler.');
  text = text.replace('DATABASE_URL=REPLACE_WITH_POOLED_RUNTIME_URL', 'DATABASE_URL=' + pooled);
  text = text.replace('AUTH_DATABASE_URL=REPLACE_WITH_DIRECT_RUNTIME_URL', 'AUTH_DATABASE_URL=' + direct);
  writeFileSync(file, text, { mode: 0o600 });
  await client.query('COMMIT');
  console.log('Restricted role created; pooled and direct runtime URLs saved.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
JS
```

Do not create the serving role through Neon's role-creation UI: console-created roles receive elevated Neon membership. Creating it through SQL keeps the restrictions explicit. [Neon role behavior](https://neon.com/docs/reference/compatibility).

**Existing database:** skip this block. Put its existing restricted pooled URL in `DATABASE_URL` and its restricted direct URL in `AUTH_DATABASE_URL`. Preserve the owner URL separately. The serving role must not own tables or belong to an administrative role.

### 2.3 Apply migrations and provision the CLI

From `"$LAUNCH_DIR/source"`, run these commands **one at a time, in this order**:

```sh
node --env-file="$LAUNCH_DIR/runtime.env" --env-file="$LAUNCH_DIR/migration.env" --import tsx scripts/migrate.ts
node --env-file="$LAUNCH_DIR/runtime.env" --env-file="$LAUNCH_DIR/migration.env" --import tsx scripts/auth-migrate.ts
node --env-file="$LAUNCH_DIR/runtime.env" --env-file="$LAUNCH_DIR/migration.env" --import tsx scripts/provision-cli.ts
```

**Check:** the commands print:

```text
Database migrations applied.
Better Auth/OAuth schema migrated.
Public CLI OAuth client provisioned. No embedded client secret.
```

If one fails, fix it before running the next. Existing numbered migrations are skipped. For an existing customer database, rehearse unapplied migrations on an isolated branch first.

In Neon's SQL Editor, select the same branch/database and run:

```sql
SELECT version FROM schema_migrations ORDER BY version;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
FROM pg_roles WHERE rolname = 'platform_app';
SELECT identifier FROM auth."oauthResource" ORDER BY identifier;
```

**Check:** all migration files for this release are represented; every displayed role privilege is `false`; the OAuth resources include your exact origin followed by `/v1`, `/admin/v1`, and `/admin/mcp`. See [database safeguards](neon.md) for permissions and recovery details.

## 3. Configure storage and email

### 3.1 Create a private R2 bucket and credentials

1. In [Cloudflare Dashboard](https://dash.cloudflare.com/), select the intended account and open **R2 Object Storage**.
2. Create a bucket named `agents-staging-files` using the Standard storage class.
3. Open the bucket's **Settings**. Leave **Public Development URL** disabled and do not attach a public custom domain.
4. Return to R2's account overview and open **Manage R2 API Tokens**. Create an account token with **Object Read & Write**, scoped to **this bucket only**.
5. Save the displayed **Access Key ID**, **Secret Access Key**, and **S3 API endpoint**. These are S3 credentials, not the Cloudflare account API token.

Open the runtime file:

```sh
nano "$LAUNCH_DIR/runtime.env"
```

Replace the four existing R2 lines; do not append duplicate keys:

```dotenv
R2_ENDPOINT=https://REPLACE_WITH_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=agents-staging-files
R2_ACCESS_KEY_ID=REPLACE_WITH_DISPLAYED_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=REPLACE_WITH_DISPLAYED_SECRET_ACCESS_KEY
```

Use the exact S3 endpoint Cloudflare displays for your bucket's jurisdiction. [R2 credential setup](https://developers.cloudflare.com/r2/api/tokens/).

### 3.2 Allow browser uploads from your application

Open the bucket's **Settings → CORS policy → Add/Edit**. Paste this JSON, replacing the origin with the exact `APP_ORIGIN` from your runtime file, then save:

```json
[
  {
    "AllowedOrigins": ["https://REPLACE_WITH_STAGING_HOST"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The browser computes `Content-Length`; the application supplies `Content-Type`. Do not use a wildcard origin or add a public bucket URL. [R2 CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/).

In **Settings → Object lifecycle rules**, add a rule with:

| Field         | Value                     |
| ------------- | ------------------------- |
| Name          | `expire-staged-transfers` |
| Prefix filter | `staging/`                |
| Action        | Delete objects            |
| Age           | 1 day                     |

**Check:** the saved rule has the literal `staging/` prefix. A rule with an empty prefix can delete persistent checkpoints. [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### 3.3 Verify the sending domain in Resend

1. Open [Resend Domains](https://resend.com/domains) and choose **Add domain**. Use a sending subdomain you control, such as `mail.example.com`.
2. Copy each required DNS record's type, name, and value into your DNS provider. Keep any mail/DNS records that already serve other systems.
3. Return to Resend and verify the domain. Wait until the sending records are verified.
4. Open [Resend API Keys](https://resend.com/api-keys). Create a **Sending access** key restricted to that verified domain.
5. Replace the existing email lines in `runtime.env`:

```dotenv
RESEND_API_KEY=REPLACE_WITH_RESEND_SENDING_KEY
EMAIL_FROM="Platform <no-reply@mail.example.com>"
```

Replace `mail.example.com` with the domain you verified. The operator's receiving inbox can be Gmail or another provider; it does not need to use your sending domain.

**Check:** Resend shows the domain verified and the key scoped to it. Actual verification/reset email delivery is tested in step 7. [Resend key permissions](https://resend.com/docs/dashboard/api-keys/introduction).

## 4. Build the native runtime

### 4.1 Create and link the Vercel project

Keep using the release-copy terminal. Define a short command for the current Vercel CLI and log in:

```sh
vc() { pnpm dlx vercel@latest "$@"; }
vc login
```

Complete the browser login. In Vercel, select your team and open its **Settings → General** to find its URL slug. Set the two non-secret selections below, replacing only the team slug:

```sh
export LAUNCH_TEAM=REPLACE_WITH_VERCEL_TEAM_SLUG
export LAUNCH_PROJECT=agents-staging
```

If the project does not exist yet:

```sh
vc project add "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM"
```

Link this release copy to the project:

```sh
vc link --project "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM"
```

Confirm setup/linking of this directory and the existing project you just selected. If asked to download environment variables, choose **No**. **Check:** the CLI names the intended staging team/project. This link belongs to the isolated release copy; it does not change your development checkout's project selection. [Vercel project commands](https://vercel.com/docs/cli/project).

### 4.2 Set the web build configuration

Open the project's **Settings → Build and Deployment** and save:

| Setting                                                           | Value                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| Framework Preset                                                  | **Next.js**                                               |
| Root Directory                                                    | `apps/web`                                                |
| Include source files outside the Root Directory in the Build Step | **Enabled**                                               |
| Node.js Version                                                   | **24.x**                                                  |
| Install Command override                                          | `pnpm install --frozen-lockfile`                          |
| Build Command override                                            | `pnpm build`                                              |
| Output Directory                                                  | Leave the framework default; do not enter `dist` or `out` |

Vercel runs the build command inside `apps/web`; its script generates documentation, builds the shared SDK, and builds Next.js with Workflow. The outside-root option makes the workspace packages available. [Vercel monorepo setting](https://vercel.com/docs/monorepos/monorepo-faq).

The release already defines `iad1` and `/internal/maintenance` every minute in [vercel.json](../../apps/web/vercel.json). Keep those settings for this walkthrough. No separate cron service or worker deployment is needed.

### 4.3 Publish the Linux AMD64 image

From the **repository root of the release copy**, run:

```sh
export LAUNCH_REVISION="$(git rev-parse --short=12 HEAD)"
vc vcr login docker --project "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM"
vc vcr build docker . "agent-runtime:$LAUNCH_REVISION" --project "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM" --platform linux/amd64 --push -- -f infra/runtime.Dockerfile
vc vcr tag inspect agent-runtime "$LAUNCH_REVISION" --project "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM"
```

These commands authenticate Docker, build the checked-in runtime Dockerfile, push it to this project's registry, and inspect its tag. The `--` forwards `-f` to Docker. [VCR CLI reference](https://vercel.com/docs/container-registry/cli-reference).

Open the project's Container Registry repository `agent-runtime`, select that tag, and wait for **Ready**. Copy its full `sha256:` digest. `Preparing` is not ready; `Unoptimized` usually means the image was built for the wrong architecture. [Sandbox image readiness](https://vercel.com/docs/sandbox/concepts/images).

Replace the runtime file's image line:

```dotenv
RUNTIME_IMAGE=agent-runtime@sha256:REPLACE_WITH_THE_64_CHARACTER_HEX_DIGEST
```

There must be exactly one `sha256:` prefix. The short repository reference works because the image and application use the same Vercel project. Keep this image private and retain earlier release digests for recovery.

## 5. Deploy the application

### 5.1 Check the runtime import before uploading it

Run this local configuration check. It does not contact providers or print values:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
const text = readFileSync(process.env.LAUNCH_DIR + '/runtime.env', 'utf8');
const settings = parse(text);
const names = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]);
if (new Set(names).size !== names.length) throw new Error('Remove duplicate environment keys.');
for (const [key, value] of Object.entries(settings)) {
  if (!value || /REPLACE_WITH|GENERATE_NEW_INSTALLATION/.test(value)) {
    throw new Error('Complete the value for ' + key);
  }
}
for (const key of ['MIGRATION_DATABASE_URL', 'VERCEL_TOKEN', 'VERCEL_OIDC_TOKEN']) {
  if (key in settings) throw new Error('Remove administrative/temporary credential ' + key);
}
if (names.some(key => key.startsWith('NEXT_PUBLIC_'))) {
  throw new Error('This runtime template needs no NEXT_PUBLIC_ values.');
}
console.log('Runtime file has no duplicate keys or unfinished placeholders.');
JS
```

**Check:** it reports no placeholders. This checks the file's structure, not the validity of external credentials.

### 5.2 Import all runtime variables together

1. Open **Vercel → the staging project → Settings → Environment Variables**.
2. Choose **Import .env** and select `runtime.env` from your private launch directory. On macOS, press **Cmd+Shift+G** in the file picker and paste the absolute path printed by:

```sh
printf '%s\n' "$LAUNCH_DIR/runtime.env"
```

3. If the UI offers a paste field instead of a file picker, copy the file's complete contents there. On macOS, this copies without displaying secrets in the terminal:

```sh
pbcopy < "$LAUNCH_DIR/runtime.env"
```

4. Select **Production only**, even for this staging project. A dedicated staging project's Production deployment exercises Vercel's production-only cron behavior. Leave Preview and Development unselected.
5. Review the parsed rows and save. Values should contain no extra surrounding quotes; an imported `EMAIL_FROM` should display `Platform <…>`. Resolve existing keys by updating them, not leaving conflicting entries.
6. Never select `migration.env`. Do not add provider secrets with a `NEXT_PUBLIC_` prefix.

For later changes, edit the local runtime file **and** the matching Vercel rows, save, then redeploy. Saved environment changes only affect new deployments. [Vercel environment management](https://vercel.com/docs/environment-variables/managing-environment-variables).

### 5.3 Deploy and attach the final origin

Still at `"$LAUNCH_DIR/source"`, run:

```sh
vc deploy --prod --scope "$LAUNCH_TEAM"
```

Do not run this from `apps/web`; the remote Root Directory is already set. Wait for **Ready** and save the deployment URL.

1. Open **Project → Settings → Domains → Add**.
2. Enter only the hostname from `APP_ORIGIN`, for example `staging.example.com`.
3. Associate it with the project's Production environment.
4. At your DNS provider, add the exact record Vercel displays. Use the displayed target instead of guessing an IP or CNAME.
5. Wait until Vercel reports valid domain configuration and HTTPS works.
6. Open **Settings → Deployment Protection**. During operator bootstrap, retain protection if your plan covers this domain. Before external API/CLI/native tests, the canonical origin must be reachable without a Vercel login. Use a dedicated staging project with no customer data and keep application registration closed after bootstrap.

The application authenticates its own routes. Vercel's login page cannot stand in for API authentication: it would also block sandbox callbacks, CLI device requests, and provider webhooks.

Set a non-secret shell variable from the completed file and check the deployment:

```sh
export LAUNCH_ORIGIN="$(node --env-file="$LAUNCH_DIR/runtime.env" -p 'process.env.APP_ORIGIN')"
curl --fail-with-body --silent --show-error "$LAUNCH_ORIGIN/health"
curl --fail --silent --show-error --output /dev/null "$LAUNCH_ORIGIN/openapi.json"
curl --fail --silent --show-error --output /dev/null "$LAUNCH_ORIGIN/docs"
```

**Check:** the health response is:

```json
{ "status": "ok", "mode": "production", "configuration_ready": true }
```

If the origin is protected, first check these URLs in your authenticated browser; rerun the commands after making the canonical origin externally reachable. A Vercel login page is not a passing response.

### 5.4 Verify maintenance

Open **Project → Settings → Cron Jobs**. Confirm one enabled job targets `/internal/maintenance` with `* * * * *`. Open its logs after the next minute and verify a successful invocation. Vercel sends the configured `CRON_SECRET`; do not paste a separate secret into the cron URL. [Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The deployed application supplies its Workflow endpoints and uses automatic Vercel OIDC for Sandbox. Do not copy a local OIDC token into Vercel or the runtime image. An actual native run in step 8 verifies this credential path.

## 6. Configure service integrations

Keep execution and registration disabled during provider configuration. Complete models and test billing for the first working agent; configure other integrations only if you intend to offer them.

### 6.1 Add one model for the first smoke test

For a concrete initial path, use the versioned Anthropic model `claude-haiku-4-5-20251001` with Claude Code. It has recorded gateway compatibility; deployed native execution is checked in step 8. [Anthropic model IDs](https://platform.claude.com/docs/en/models/overview).

1. In your Anthropic API account, create or select a key for staging and configure a small provider-side spending allowance. A Claude chat subscription is not an API credential.
2. Add these lines to `runtime.env`, replacing the key:

```dotenv
ANTHROPIC_API_KEY=REPLACE_WITH_ANTHROPIC_API_KEY
MODEL_CATALOG_JSON=[{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5","provider":"anthropic","harnesses":["claude-code","opencode"],"input_micro_usd_per_million":"2000000","output_micro_usd_per_million":"10000000","enabled":true}]
```

3. Add the same two keys in Vercel's **Environment Variables → Production**. For an individual JSON value, paste the array beginning with `[` and ending with `]`, without a `MODEL_CATALOG_JSON=` prefix or wrapping shell quotes.

The example sets **your retail prices** to $2 per million input tokens and $10 per million output tokens. Those are explicit starter prices, not a vendor invoice or a margin guarantee. Review your provider's current rates and account entitlement before running the paid check. The application's existing compute rate is $0.008/minute. [Catalog schema and cache accounting](../features/execution/runtime.md#production-model-catalog-example).

You can later add OpenAI or OpenRouter catalog entries and their managed keys. Customers can also add encrypted BYOK connections in **Connections**; BYOK still requires platform credit for compute and applicable tools. Do not enable a model/harness combination until it passes your acceptance check.

### 6.2 Configure Stripe test payments

In [Stripe Dashboard](https://dashboard.stripe.com/), select **test mode or a sandbox**. Keep that selection throughout this step.

1. Open **Product catalog → Add product**. Create **Pro**, with a recurring **monthly USD $29** price. Copy its `price_…` ID.
2. Create **Scale**, with a recurring **monthly USD $199** price. Copy its `price_…` ID.
3. Open **Developers → API keys** and obtain the test secret key.
4. Add these lines to the private runtime file, using the two actual price IDs:

```dotenv
STRIPE_SECRET_KEY=REPLACE_WITH_STRIPE_TEST_SECRET_KEY
STRIPE_PRO_PRICE_ID=REPLACE_WITH_PRO_PRICE_ID
STRIPE_SCALE_PRICE_ID=REPLACE_WITH_SCALE_PRICE_ID
PRO_MONTHLY_PRICE_MICRO_USD=29000000
PRO_INCLUDED_CREDIT_MICRO_USD=10000000
SCALE_MONTHLY_PRICE_MICRO_USD=199000000
SCALE_INCLUDED_CREDIT_MICRO_USD=50000000
```

Starter has no subscription price. Pro includes $10 and Scale $50 of monthly platform credit with these settings. Keep Stripe prices and these application display/credit values aligned.

5. Open **Workbench/Developers → Webhooks → Add destination**. Select events from **your account**, API version **2026-02-25.clover** (the default of the repository's pinned Stripe SDK), and a **snapshot-event** webhook destination, not thin events. Set its URL to your exact origin plus `/webhooks/stripe`. If that version cannot be selected, verify a supported replacement against the billing acceptance tests before enabling the destination.
6. Select the fourteen events listed under [Stripe events](launch-integrations.md#stripe). Save the endpoint, then keep it disabled until step 7's receiver and reachability checks.
7. Reveal that endpoint's signing secret and add:

```dotenv
STRIPE_WEBHOOK_SECRET=REPLACE_WITH_THIS_ENDPOINT_SIGNING_SECRET
```

8. In Stripe **Settings → Billing → Customer portal**, configure and save the **default** portal. Allow payment-method changes, cancellation, and switching only between the Pro and Scale prices just created.
9. Import these Stripe fields into the staging project's **Production** environment. Do not use a secret from `stripe listen`, a live price, or another endpoint.

**Check:** both price amounts/intervals match, the portal is saved in the same test environment, and the destination uses the staging origin. Detailed event selection, API-version compatibility, and protected-webhook setup are in [the integration checklist](launch-integrations.md#stripe).

### 6.3 Optional integrations

These are independent of the first hosted agent. Follow the linked guide before exposing each one; adding a key alone is not a working integration.

| Capability                            | Setup and acceptance                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail, Slack, and other Composio apps | [Composio setup](../features/identity-integrations/composio.md): auth configurations, pinned toolkit versions, callback verification, tool grants and revocation.   |
| GitHub repository sync                | [GitHub registration](launch-integrations.md#github): repository-scoped GitHub App, OAuth callback, setup URL, signed webhook and selected-repository installation. |
| GitHub sign-in                        | Use separate social-login OAuth credentials; repository GitHub App credentials are not interchangeable.                                                             |
| Web search                            | [Search setup](../features/identity-integrations/web-search.md): managed Brave or customer-owned provider connections and explicit tool grants.                     |
| Remote or stdio MCP                   | [MCP setup](launch-integrations.md#remote-and-sandbox-mcp): allowed server, OAuth/client registration when required, reviewed image packages and tool grants.       |
| External analytics                    | Optional PostHog export. Leave it disabled for launch; [native reporting](../features/operations/README.md) already records product activity.                       |

## 7. Create operator access and verify the service

### 7.1 Open registration briefly for bootstrap

The initial registration switch applies to everyone, including operators.

1. If available, keep the staging origin behind Vercel protection while you create the account.
2. Edit `runtime.env` and the Vercel Production value to:

```dotenv
PUBLIC_SIGNUP_ENABLED=true
```

3. Keep `ALLOW_PAID_EXECUTION=false` and `RUN_ADMISSION_ENABLED=false`.
4. Deploy the completed model/billing configuration and bootstrap switch:

```sh
vc deploy --prod --scope "$LAUNCH_TEAM"
```

5. Open your canonical origin's `/login` page, choose registration, and use the exact `OPERATOR_EMAILS` address with a password of at least 12 characters.
6. Open the delivered verification email and follow its link. It must return to your canonical origin.
7. In **Security**, choose **Set up authenticator**, scan the code, complete verification, and save recovery codes privately.
8. Confirm **Operations** opens for this account.
9. Restore the local file and Vercel value:

```dotenv
PUBLIC_SIGNUP_ENABLED=false
```

10. Redeploy:

```sh
vc deploy --prod --scope "$LAUNCH_TEAM"
```

**Check:** the verified operator can sign in, and an incognito registration attempt is rejected. `OPERATOR_EMAILS` does not create an account or grant permission to register while registration is disabled.

### 7.2 Check identity, files, API access, and CLI login

Make the canonical staging origin externally reachable before testing CLI or webhooks: in **Settings → Deployment Protection**, use **Standard Protection**, which protects deployment URLs and previews while leaving production domains public. If another protection method still covers the canonical origin, remove that restriction for this isolated project before proceeding. Keep application registration closed. [Vercel protection settings](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).

Then:

1. Sign out and use **Forgot password**. Complete the emailed reset, sign in again, and verify the authenticator prompt.
2. In **Projects**, create `Launch check`. Keep it as an empty persistent project for now.
3. Open its workspace files, click **New file**, enter `launch-check.txt`, and click **Create file**. Enter a short test sentence, click **Save**, reload, and verify the contents remain.
4. In **API keys → Create API key**, enter `launch-check`, set **Project access** to `Launch check`, choose **30 days** under **Expires after**, and select only `projects:read` and `runs:read` in **Permissions**. Create it and copy the value once to your password manager. You will revoke it immediately after the check.
5. Test that key without storing it in shell history:

```sh
read -r -s -p "Paste the launch-check API key: " LAUNCH_API_KEY
printf '\n'
printf 'Authorization: Bearer %s\n' "$LAUNCH_API_KEY" |
  curl --fail-with-body --silent --show-error --header @- "$LAUNCH_ORIGIN/v1/projects"
unset LAUNCH_API_KEY
```

6. Verify that the JSON includes `Launch check`. Revoke the temporary key in the dashboard.
7. Use a separate local CLI credential directory for acceptance:

```sh
export AGENT_CONFIG_DIR="$LAUNCH_DIR/cli"
pnpm cli login --host "$LAUNCH_ORIGIN"
pnpm cli project list
pnpm cli doctor
```

Complete device authorization in your browser. **Check:** it selects the intended organization, project listing works, and doctor sees the configured model without executing it. [CLI instructions](../features/cli/README.md).

### 7.3 Activate and check billing

1. Confirm the canonical webhook URL is reachable by Stripe without Vercel login or redirect. If protection must remain enabled, follow the exact [webhook bypass procedure](launch-integrations.md#activate-and-test-staging-billing); an OPTIONS exception is insufficient.
2. Enable the prepared Stripe destination.
3. Open the application's **Billing** page, select **$10**, click **Add $10 in credits**, and complete its test Checkout using Stripe's test card `4242 4242 4242 4242`, a future expiry, and any three-digit CVC. [Stripe test payments](https://docs.stripe.com/testing).
4. In Stripe, inspect the resulting event delivery. Require HTTP **2xx**.
5. Return to the application and verify prepaid credit increased. A successful redirect alone is insufficient.
6. Open **Billing portal** to verify the default Customer Portal. Test Pro signup/change/cancellation with test payments.
7. Resend the same successful payment event from Stripe. Confirm credit is not added twice.

Test payments do not move real card funds, but the platform credit they create can fund **real** sandbox/model execution once enabled. Keep staging private and budgets small.

### 7.4 Optional: provision a read-only operator agent

If you want a management MCP client, run:

```sh
node --env-file="$LAUNCH_DIR/runtime.env" --env-file="$LAUNCH_DIR/migration.env" --import tsx scripts/provision-operator.ts --name launch-operator --output "$LAUNCH_DIR/operator-client.json"
```

**Check:** a new private `operator-client.json` is created. Store it in your secret manager and follow [operator OAuth](../features/operations/implementation.md) to obtain separate resource-scoped tokens for `/admin/v1` and `/admin/mcp`. Customer API keys are not operator tokens. Do not rerun with the same output file or enable PII scope unless required.

## 8. Test, back up, and open access

### 8.1 Run a bounded real agent in staging

This step spends real sandbox/model usage. Set a total acceptance budget in the provider accounts before beginning. A run's retail budget is not a hard cap on every infrastructure invoice.

1. Check the Vercel team has available Sandbox concurrency and runtime allowance. Keep the application-wide ceiling at **2**.
2. Confirm the synthetic staging organization has settled test credit and the Anthropic account can use the catalog model.
3. Update the local runtime file and Vercel Production environment:

```dotenv
ALLOW_PAID_EXECUTION=true
RUN_ADMISSION_ENABLED=true
PUBLIC_SIGNUP_ENABLED=false
GLOBAL_CONCURRENT_RUN_LIMIT=2
```

4. Redeploy, then repeat the health check:

```sh
vc deploy --prod --scope "$LAUNCH_TEAM"
curl --fail-with-body --silent --show-error "$LAUNCH_ORIGIN/health"
```

5. In `Launch check`, create a run with **Claude Code**, **Claude Haiku 4.5**, a **2-minute** execution timeout and **$0.50** maximum budget. Prompt: “Read launch-check.txt and write a one-sentence summary to launch-result.txt. Do not browse or install packages.”
6. Watch it progress through execution and persistence. Open `launch-result.txt`, reload, and confirm a checkpoint is present.
7. Continue the same session once with another small budget; ask it to append one sentence. Confirm prior files and conversation survive.
8. Inspect Vercel's Workflow and Sandbox records for the run. Confirm the runtime image is the expected digest and the sandbox stops after work completes.
9. In **Usage**, verify token/cost records. In **Billing**, verify the run no longer holds an unsettled reservation after final settlement.

If a check fails, pause admission, inspect the existing run and logs, and diagnose before starting another agent. Do not blindly resubmit an ambiguously launched job.

### 8.2 Complete the launch acceptance checks

Use only synthetic projects/accounts. Complete [the pre-deployment checklist](pre-deployment.md), including:

| Test                                  | Required result                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| External activity                     | An API- or CLI-created run appears in an already-open dashboard.                                                   |
| Dashboard navigation and reconnection | One shared refresh connection survives ordinary navigation; reconnect restores current state.                      |
| Historical streaming                  | Leave a run page and return; saved output and tool events replay.                                                  |
| Cancellation and queue expiry         | Explicit terminal outcome, preserved history, and released reservations.                                           |
| File transfer and recovery            | Upload a file larger than 4 MiB through staged transfer; download identical bytes; restore a known checkpoint.     |
| Tenant isolation                      | A second synthetic organization cannot read the first organization's project, files, run, or stream.               |
| Revocation                            | A revoked API key, session, or delegated connection loses access.                                                  |
| Scheduling/recovery                   | Worker/Workflow recovery preserves one execution identity; queues drain and limits hold.                           |
| Offered integrations                  | Each enabled harness/model, Git sync, search, connector, and MCP path passes its specific success/revocation test. |
| Billing                               | Subscription changes, refunds/disputes, interrupted settlement, and duplicate delivery reconcile correctly.        |

Detailed procedures and remaining cloud-specific checks live in the linked checklist. A green `/health` verifies a database round trip and required configuration shape; it does **not** validate all providers, sandbox execution, email delivery, R2 writes, or recovery.

### 8.3 Prepare production recovery and customer-facing settings

Complete this checklist while setting up production in step 8.4, before its final registration-opening step:

1. In the production Neon project, set **Settings → Instant restore → History window** to **7 days** on a supporting plan. Open the production root branch and choose **Protect**. Verify both settings.
2. Rehearse database recovery in an isolated environment, together with the matching R2 objects and retained vault keys. Record the measured recovery time and recoverable interval. Follow [production recovery safeguards](neon.md#production-recovery-safeguards).
3. Store runtime secrets, the administrative credential, and release/image digests in your secret manager with a tested recovery path.
4. Create real privacy and terms pages and a monitored support inbox. Add their actual values to the production runtime file and Vercel:

```dotenv
SUPPORT_EMAIL=support@example.com
PRIVACY_URL=https://example.com/privacy
TERMS_URL=https://example.com/terms
```

Replace all example addresses with working destinations. These settings link to pages; they do not create legal pages or an inbox.

5. Configure provider spending alerts and application monitoring for failed maintenance, queue age, failed runs/persistence, and unreconciled reservations. Confirm **Operations** shows recent maintenance and the active-execution ceiling.

### 8.4 Deploy production and invite a pilot

Use this replacement checklist when repeating the walkthrough; none of the staging database, object, or ledger contents should be copied:

| Setting or resource                       | Production value                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `LAUNCH_DIR` in step 1                    | `"$HOME/.config/hosted-agents/launch-production"`                              |
| `LAUNCH_PROJECT` in step 4                | `agents-production`                                                            |
| Neon project                              | `agents-production`, fresh database and restricted role                        |
| R2 bucket / `R2_BUCKET`                   | `agents-production-files`                                                      |
| `APP_ORIGIN`, DNS, CORS and callback URLs | Your production origin, for example `https://agents.example.com`               |
| Auth/vault/cron secrets                   | Independently generated for the new environment; retained if it already exists |
| Provider credentials                      | Production-scoped keys; Stripe **live** key, prices and webhook secret         |
| Runtime image                             | The accepted source revision published into the production Vercel project      |

1. Repeat steps 1–6 with the production values above and the accepted source revision. Publish the runtime into the production project's registry too. If the production database already exists, preserve its active keys and follow the existing-environment instructions.
2. In step 6.2 use **Stripe live mode**, live Pro/Scale prices, a new live webhook signing secret, and a saved live default Portal. Do not point production at the staging ledger or copy test credit.
3. Complete operator bootstrap and read-only checks from steps 7.1–7.2, then the production recovery/settings checklist in 8.3. Step 7.4 remains optional.
4. Activate the live Stripe destination. Perform the top-up and Portal checks from 7.3 using **your own real payment method** and the minimum **$10 top-up**; the test card must not be used in live mode. This is a real payment that funds the operator organization's credit. Subscription/refund scenario testing belongs in staging. Repeat step 8.1 on the production origin with the same small run limits, then confirm settlement and persistence.
5. Keep registration closed while validating the operator. When ready to invite the initial cohort, set:

```dotenv
ALLOW_PAID_EXECUTION=true
RUN_ADMISSION_ENABLED=true
PUBLIC_SIGNUP_ENABLED=true
GLOBAL_CONCURRENT_RUN_LIMIT=2
```

6. Redeploy from the linked production release directory. Verify the domain, login, health, Cron, and one normal customer journey.
7. Watch active executions, eligible queued work, oldest wait, errors, and spending. Increase capacity only through [the measured scaling procedure](scaling.md), after checking Sandbox/model quotas and database headroom.

Registration is a global switch, not an email allowlist. Advertise the URL only when you are ready for new accounts.

### Pause new work

To pause admission while preserving existing runs and history, update the local runtime file and Vercel:

```dotenv
RUN_ADMISSION_ENABLED=false
PUBLIC_SIGNUP_ENABLED=false
```

Then redeploy. Do not disable Cron or remove the runtime image to pause new submissions: existing work still needs recovery, persistence, and settlement.

## Resume this walkthrough

Start the clean Bash shell from step 1.1, then paste this block after replacing the team slug and, if needed, the directory/project with their production values:

```sh
set -e
set -o pipefail
set -o noclobber
export LAUNCH_DIR="$HOME/.config/hosted-agents/launch-staging"
export LAUNCH_TEAM=REPLACE_WITH_VERCEL_TEAM_SLUG
export LAUNCH_PROJECT=agents-staging
export AGENT_CONFIG_DIR="$LAUNCH_DIR/cli"
cd "$LAUNCH_DIR/source"
vc() { pnpm dlx vercel@latest "$@"; }
export LAUNCH_REVISION="$(git rev-parse --short=12 HEAD)"
export LAUNCH_ORIGIN="$(node --env-file="$LAUNCH_DIR/runtime.env" -p 'process.env.APP_ORIGIN')"
```

Continue at the first unfinished step. Do not recreate an existing role, regenerate secrets, or overwrite the runtime file. If a VCR upload needs a new login, rerun only `vc vcr login docker --project "$LAUNCH_PROJECT" --scope "$LAUNCH_TEAM"` before retrying the upload.

## Troubleshoot the step that failed

| Symptom                                      | Check and next action                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm` or Node version differs               | Select Node 24.13.0 and install pnpm 10.33.0 before rebuilding.                                                                  |
| Build cannot resolve workspace packages      | Vercel Root Directory must be `apps/web`, with outside-root source enabled. Run CLI deployment from the release repository root. |
| Cron deployment rejected                     | The selected team needs Pro/Enterprise for the checked-in every-minute schedule.                                                 |
| Database connection targets localhost        | A local fixture URL was imported. Replace it with the restricted Neon URLs and redeploy.                                         |
| Auth reports unsupported startup options     | `AUTH_DATABASE_URL` must be direct, without `-pooler`; keep `DATABASE_URL` pooled.                                               |
| Runtime role already exists                  | Skip role creation. Recover its existing restricted credentials; do not reset the role or use the owner URL as a workaround.     |
| Health returns `unavailable`                 | Check database reachability, TLS, credentials, and the selected environment in Vercel logs.                                      |
| Health returns `not_ready`                   | Recheck all required runtime fields, HTTPS origin, secret lengths, and digest format; redeploy changed values.                   |
| Registration is paused                       | Temporarily enable `PUBLIC_SIGNUP_ENABLED`, redeploy, create/verify the operator, then close it again.                           |
| Verification/reset email does not arrive     | Check Resend sending logs, verified domain, sender, key scope, and spam folder.                                                  |
| API/CLI/webhook receives HTML                | Deployment Protection or a domain redirect intercepted the request. Fix canonical-origin reachability before retesting.          |
| `image_not_ready`                            | Wait for VCR Ready; verify Linux AMD64, project identity, and exact digest.                                                      |
| Browser upload fails CORS                    | Check the exact HTTPS origin and saved bucket CORS; keep staging uploads private.                                                |
| No model is selectable                       | Import the single-line catalog as a JSON array, confirm enabled entries/harness mapping, and redeploy.                           |
| Payment succeeds but balance does not change | Check the exact Stripe destination secret, signed event delivery, account mode, and application-created Checkout order.          |
| Run waits indefinitely                       | Check enabled Cron, recent maintenance, available Sandbox quota, organization cap, and earlier workspace work in Operations.     |

## Upgrade and roll back

For later releases, use a new isolated source copy and the **same environment's retained credentials**. Test forward migrations on an isolated database, run schema updates with the owner credential, build/push a new immutable runtime digest, update `RUNTIME_IMAGE`, and deploy the matching source.

Before rollback, pause new admission and assess any in-flight work. Use a schema-compatible prior application deployment and its runtime configuration; do not restore the customer database as an ordinary app rollback. Keep old vault keys and runtime images.

Changing from Workflow to another scheduler requires pausing admission and draining or explicitly cancelling work first. Never restart an agent to reset Workflow history. See [release and rollback](deployment.md#release-and-rollback) and [hosting boundaries](hosting.md).
