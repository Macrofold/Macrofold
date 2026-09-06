# Launch environment: exactly what goes where

Use this alongside [the launch guide](../18-launch-guide.md). This is the complete inventory for the prepared launch worksheet, including settings you leave blank. The operator already has provider API keys: enter those existing values privately. Uppercase placeholders below describe values to obtain; they are not working credentials.

## 1. Edit locally, then import into Vercel

1. Open `/Users/mzw/Documents/ChatGPT/AgentCloud/.data/launch/production.env` in your editor. It is the **private operator worksheet**, not the file to upload. Do not edit the root `.env`, which runs the local simulator.
2. Reconcile the existing Neon credentials using [launch step 1](../18-launch-guide.md#1-open-the-right-local-files). The original successful setup is `.data/neon-provision/production.json`. Use its existing auth/vault keys, not newly generated replacements.
3. Fill the variables below as you complete each platform's setup. Each row marked **Vercel** goes into this local worksheet first, then into the web project's **Production** environment. A dedicated staging project also uses its own Production scope, with the separate staging values below. Never select Production, Preview and Development together for production secrets.
4. After editing a JSON source, run `node .data/launch/prepare.mjs render` from the repository root. Then run the filtered export command in [launch step 1](../18-launch-guide.md#1-open-the-right-local-files). It writes `.env.vercel.production`, preserving the worksheet and excluding administrative credentials.
5. Open [Vercel Dashboard](https://vercel.com/dashboard) → the Macrofold web project → **Settings → Environment Variables → Add / Import .env**. Import **`/Users/mzw/Documents/ChatGPT/AgentCloud/.env.vercel.production`**. Select **Production only**, review the names, and save. During project creation, the Environment Variables panel accepts the same file. If importing again reports duplicate names, update the existing variables by name rather than retaining an old value.
6. For a single-variable change, use the same page, find the exact name below, choose **Edit**, replace its value, retain Production scope, and save. Paste the actual value without dotenv wrapper quotes: a JSON value starts with `{` or `[`, and an email sender is `Macrofold <hello@macrofold.ai>`. Keep the private worksheet synchronized. Never add a `NEXT_PUBLIC_` prefix to these settings.
7. Open **Deployments → the intended production deployment → Redeploy** after changes. Environment edits do not change an existing deployment. Check its build/runtime results before opening admission. [Vercel environment management](https://vercel.com/docs/environment-variables/managing-environment-variables).

The renderer/export commands make no network calls. Migrations, doctor, deployment, bucket operations and actual provider acceptance are separate, potentially metered steps.

## 2. Application, identity and database

| Exact variable | Value to enter or source | Destination |
| --- | --- | --- |
| `PRODUCT_NAME` | `Macrofold` | Vercel |
| `APP_ORIGIN` | `https://app.macrofold.ai`, without a trailing slash | Vercel |
| `PLATFORM_MODE` | `production` | Vercel |
| `EXECUTION_PROVIDER` | `vercel` | Vercel |
| `ORCHESTRATION_BACKEND` | `workflow` | Vercel |
| `NODE_ENV` | `production`; Vercel also sets this for production builds | Vercel |
| `DATA_DIR` | `/tmp/hosted-agent-control-plane` | Vercel |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`; **add this line to the worksheet** so the filtered export retains it | Vercel build |
| `DATABASE_URL` | Full `runtimePooled` value from the verified private Neon JSON; restricted `platform_app`, pooled host, TLS options retained | Vercel |
| `AUTH_DATABASE_URL` | Full `runtimeDirect` value from that JSON; restricted `platform_app`, **direct** host, TLS options retained | Vercel |
| `DATABASE_RUNTIME_ROLE` | `platform_app` | Vercel / administrative helpers |
| `AUTH_SECRET` | Existing `authSecret` from that JSON | Vercel |
| `VAULT_KEY` | Existing `vaultKey` from that JSON; preserve it for encrypted credentials/content | Vercel |
| `CRON_SECRET` | Existing `cronSecret` from that JSON; Vercel sends this as the maintenance bearer credential | Vercel |
| `MIGRATION_DATABASE_URL` | Existing `ownerUrl` from that JSON; copy into `.data/launch/admin.env` as well as retaining it in the private combined worksheet | **Administrative only; exclude from Vercel** |
| `OPERATOR_EMAILS` | Exact email address you will use for the operator login; use `multiversalmike@gmail.com` if that is your chosen login. Multiple addresses are comma-separated | Vercel |
| `SUPPORT_EMAIL` | An existing inbox/forwarding address you monitor; do not assume `support@macrofold.ai` exists | Vercel |
| `PRIVACY_URL` | Full HTTPS URL of your published, reviewed privacy policy | Vercel |
| `TERMS_URL` | Full HTTPS URL of your published, reviewed terms | Vercel |

The filtered export must contain neither `MIGRATION_DATABASE_URL` nor `PLATFORM_APP_DATABASE_PASSWORD`. The older password in `admin.env` is not the current Neon role password. Do not reset that role. The helper merges `admin.env` over the combined worksheet, so populate its currently blank owner URL before using migration commands.

Corepack makes the build use `packageManager` from the root [package.json](../../package.json), currently pnpm 10.33.0. Keep Node 24.x in Vercel's build settings. Without Corepack, an overridden `pnpm install` command can select an older preinstalled pnpm. [Vercel package-manager selection](https://vercel.com/docs/package-managers), [Corepack configuration](https://vercel.com/docs/builds/configure-a-build#corepack).

## 3. Storage, email and agent runtime

Complete [launch steps 4–6](../18-launch-guide.md#4-configure-private-object-storage-and-email), then copy these values into the worksheet and Vercel Production.

| Exact variable | Value to enter or source |
| --- | --- |
| `R2_ENDPOINT` | Bucket account's displayed S3 endpoint, normally `https://ACCOUNT_ID.r2.cloudflarestorage.com`; do not append a bucket/path |
| `R2_BUCKET` | Exact private bucket name; the guide uses `macrofold-production` |
| `R2_ACCESS_KEY_ID` | Access Key ID from the existing bucket-scoped **Object Read & Write** S3 credential |
| `R2_SECRET_ACCESS_KEY` | Its matching Secret Access Key; a Cloudflare REST bearer token is not interchangeable |
| `RESEND_API_KEY` | Existing sending key authorized for the verified sender domain |
| `EMAIL_FROM` | `Macrofold <hello@macrofold.ai>` only after that domain/address is your verified chosen sender |
| `VERCEL_PROJECT_ID` | Web project → Settings → General → Project ID |
| `VERCEL_TEAM_ID` | Owning team → Settings → General → Team ID |
| `RUNTIME_IMAGE` | `agent-runtime@sha256:ACTUAL_64_HEX_DIGEST` from a **Ready** image in this project's Container Registry |
| `SANDBOX_EGRESS_DOMAINS` | Initial reviewed allowlist: `registry.npmjs.org,pypi.org,files.pythonhosted.org,github.com,api.github.com`; adjust only for supported workloads |
| `VERCEL_TOKEN` | Leave blank for the chosen Vercel-hosted OIDC route |

Do not create a persistent `VERCEL_OIDC_TOKEN` setting. Vercel provides the hosted identity context; a copied local token expires. Team/project IDs identify the intended project and satisfy the private setup checker; they do not implement static-token authentication in the current Sandbox adapter.

R2 CORS, lifecycle rules, Resend DNS verification, Vercel DNS, and a Ready image are dashboard/resource settings, **not additional environment variables**. Configure them using the guide even when all the keys above exist.

## 4. Models, search and app connections

Use [integration setup](launch-integrations.md) for the provider console screens, scopes and callbacks. These server variables go in the worksheet and Vercel Production. Customer BYOK keys go through **Macrofold → Connections**, not into the server's environment.

| Exact variable | Value to enter or source |
| --- | --- |
| `OPENAI_API_KEY` | Existing OpenAI project key, if offering managed OpenAI routes |
| `ANTHROPIC_API_KEY` | Existing Anthropic API key, if offering managed Anthropic routes |
| `OPENROUTER_API_KEY` | Existing OpenRouter API key, if offering managed OpenRouter routes |
| `MODEL_CATALOG_JSON` | Generated from `.data/launch/models.json`; enter actual accessible IDs, harness mappings and approved rates there, then render. Starts empty |
| `RATE_CARD_VERSION` | Your reviewed pricing revision, for example `2026-09-v1`; update deliberately with rate changes |
| `COMPUTE_MICRO_USD_PER_MINUTE` | Initial code rate `8000`; review against actual Sandbox costs before selling execution |
| `BRAVE_SEARCH_API_KEY` | Existing Brave Search subscription key for managed search |
| `BRAVE_SEARCH_MICRO_USD_PER_CALL` | Initial application rate `6000`; review before enabling managed search |
| `COMPOSIO_API_KEY` | Existing **Platform project** key for this environment |
| `COMPOSIO_AUTH_CONFIGS_JSON` | Generated from `.data/launch/composio-auth-configs.json`: toolkit slug → actual auth-config ID |
| `COMPOSIO_TOOLKIT_VERSIONS_JSON` | Generated from `.data/launch/composio-toolkit-versions.json`: matching toolkit slug → tested concrete version, never `latest` |
| `COMPOSIO_CALLBACK_VERIFICATION_ENABLED` | `false` during setup; change to `true` **after** enabling the project callback verifier with this environment's URL |
| `COMPOSIO_MICRO_USD_PER_CALL` | Initial application rate `3000`; review against actual connector costs |
| `MCP_OAUTH_CLIENTS_JSON` | Generated from `.data/launch/mcp-oauth-clients.json`: exact HTTPS server origin → registered client ID and optional secret; `{}` when no static client is required |
| `MCP_STDIO_CATALOG_JSON` | Leave absent for the bundled reviewed catalog. Override only using the supported schema after reviewing package/version/args/secrets in [the catalog source](../../packages/core/src/stdio-catalog.ts) |

The example numeric rates are **application charges, not provider quotations**: 1,000,000 micro-USD = $1. They are deliberately not zero-cost test settings. Model rates use micro-USD **per million tokens**; tool rates use micro-USD **per call**. Review the catalog and rates before opening paid execution.

Exa, Tavily, Parallel AI and Firecrawl use customer BYOK Connections only; this release has no server `EXA_API_KEY`, `TAVILY_API_KEY`, `PARALLEL_API_KEY` or `FIRECRAWL_API_KEY` setting. Managed and BYOK paths must be tested separately. Provider configuration tests do not necessarily call the provider.

## 5. GitHub

Use [GitHub registration](launch-integrations.md#github-repository-app-and-optional-social-login). All configured values below go in the worksheet and Vercel Production.

| Exact variable | Value to enter or source |
| --- | --- |
| `GITHUB_APP_ID` | Repository GitHub App settings → App ID |
| `GITHUB_APP_SLUG` | Final segment of the App's public `https://github.com/apps/SLUG` URL |
| `GITHUB_APP_CLIENT_ID` | Same GitHub App → Client ID |
| `GITHUB_APP_CLIENT_SECRET` | Existing client secret for that same App |
| `GITHUB_APP_PRIVATE_KEY` | GitHub-generated PEM contents for that App; use actual multiline text in Vercel, or the supported literal `\n` form in dotenv. Do not enter the downloaded filename |
| `GITHUB_WEBHOOK_SECRET` | Existing generated value in the private worksheet; paste the **same value** into the App's webhook-secret setting |
| `GITHUB_CLIENT_ID` | Optional, separate social-login OAuth App Client ID; leave blank if not offering Sign in with GitHub |
| `GITHUB_CLIENT_SECRET` | Matching social-login OAuth App secret, otherwise blank |

Repository App callback: `https://app.macrofold.ai/integrations/github/callback`. Repository webhook: `https://app.macrofold.ai/webhooks/github`. Optional social-login callback: `https://app.macrofold.ai/auth/callback/github`. These registrations serve different purposes; do not exchange their credentials.

## 6. Stripe

Use [Stripe registration and acceptance](launch-integrations.md#stripe-billing). Start in **the isolated staging project**, using `.data/launch/stripe-sandbox.env` for the already-created sandbox price IDs. Keep production payment credentials blank until sandbox application acceptance passes.

| Exact variable | Staging value | Live production value |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Existing sandbox runtime `rk_test_…` key with the documented permissions | Separately verified live `rk_live_…` key |
| `STRIPE_WEBHOOK_SECRET` | Actual signing secret of the **staging URL's** sandbox destination | Actual signing secret of the **production URL's** live destination |
| `STRIPE_PRO_PRICE_ID` | Pro price ID from `stripe-sandbox.env` | Live USD monthly Pro price ID |
| `STRIPE_SCALE_PRICE_ID` | Scale price ID from `stripe-sandbox.env` | Live USD monthly Scale price ID |
| `PRO_MONTHLY_PRICE_MICRO_USD` | `29000000` | `29000000` |
| `PRO_INCLUDED_CREDIT_MICRO_USD` | `10000000` | `10000000` |
| `SCALE_MONTHLY_PRICE_MICRO_USD` | `199000000` | `199000000` |
| `SCALE_INCLUDED_CREDIT_MICRO_USD` | `50000000` | `50000000` |

No `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is needed by this Checkout implementation. No Portal configuration ID is read: configure the account's **default** Portal in Stripe. The 14-event destination, pinned `2026-02-25.clover` snapshot payloads, Portal configuration, downgrade timing and tax treatment are separate requirements. A CLI forwarding secret is not your deployed destination's signing secret.

## 7. Launch controls and optional analytics/key rotation

| Exact variable | Initial value / action | Destination |
| --- | --- | --- |
| `ALLOW_PAID_EXECUTION` | `false`; `true` only for approved acceptance and subsequent live service | Vercel |
| `RUN_ADMISSION_ENABLED` | `false`; `true` only when admitting the approved test/pilot work | Vercel |
| `PUBLIC_SIGNUP_ENABLED` | `false`; open temporarily for controlled identity acceptance, then for the signed-off pilot | Vercel |
| `GLOBAL_CONCURRENT_RUN_LIMIT` | `5` for the initial pilot; verify actual provider quota | Vercel |
| `API_RATE_LIMIT_PER_MINUTE` | `300` | Vercel |
| `WORKER_CONCURRENCY` | `4` if using the portable poller; no separate worker is deployed for Vercel Workflow | Worksheet; portable worker only |
| `POSTHOG_ENABLED` | `false` for initial launch; SQL growth/usage reporting works without export | Vercel |
| `POSTHOG_REGION` | `us` or `eu` matching the optional PostHog project | Vercel only if enabled |
| `POSTHOG_PROJECT_TOKEN` | Optional project's ingestion token, otherwise blank | Vercel only if enabled |
| `POSTHOG_START_AT` | Approved export-start UTC timestamp such as `2026-09-06T00:00:00Z`, otherwise blank; avoid replaying historical activity accidentally | Vercel only if enabled |
| `POSTHOG_DAILY_EVENT_LIMIT` | `10000` or a lower approved attempt budget within your actual plan | Vercel only if enabled |
| `VAULT_ACTIVE_KEY_ID` | Leave blank for the initial single-key configuration | Vercel only during planned rotation |
| `VAULT_KEYRING_JSON` | Leave blank for the initial single-key configuration; never discard an existing retained keyring if rotation has already occurred | Vercel only during planned rotation |

No platform API key or management OAuth client secret belongs in Vercel's app settings. Customers generate their own scoped keys through the dashboard. The operator-agent helper writes its client credentials to private `.data/launch/operations-agent.json` for the management agent's own secret store.

## 8. Set up staging without borrowing production credentials

Use **`https://staging.macrofold.ai`** as the initial staging origin unless you deliberately choose another stable HTTPS hostname. This is a proposed DNS/project configuration, not a claim it already exists. Use a separate Vercel project, private bucket, and **fresh empty Neon project/database**. A copy of the production auth database with unrelated new vault keys is not a valid staging setup.

1. Create the separate Vercel project and add that staging domain using the same build settings as production. Create a fresh Neon project/database following [fresh database setup](neon.md#fresh-installation-or-connection-file-recovery), and a private `macrofold-staging` R2 bucket. Review account resource costs first.
2. Create `.data/launch-staging/` privately and copy the files from `.data/launch/` into it, preserving permissions. If it already exists, inspect/reuse it instead of overwriting. Keep this folder exactly one level below `.data` so its helper resolves the correct repository root. Do not run its helpers until all production-specific values below are replaced.
3. In that folder's `production.env` (the helper expects this filename), set `APP_ORIGIN=https://staging.macrofold.ai`; replace `DATABASE_URL` / `AUTH_DATABASE_URL` with this **staging** database's restricted pooled/direct URLs. Put its direct owner URL in both that private combined worksheet and `admin.env`. Use `PLATFORM_MODE=production` and the same closed launch flags: staging is a cloud profile, not the local simulator.
4. Generate fresh, distinct staging `AUTH_SECRET`, `VAULT_KEY`, `CRON_SECRET` and `GITHUB_WEBHOOK_SECRET` through your secret manager, each at least 32 random bytes encoded as 64 hex characters. These initialize the empty staging database only. Clear copied `VAULT_ACTIVE_KEY_ID` and `VAULT_KEYRING_JSON`. Do not rotate the production keys.
5. Replace `VERCEL_PROJECT_ID`, `R2_BUCKET`, and the R2 credentials with the staging resources. Set the team's ID and R2 endpoint for those resources. Publish an image in the staging Vercel project and use its Ready `RUNTIME_IMAGE` digest; do not assume images are shared across projects.
6. Fill Stripe variables from the existing **sandbox** record above. Use a separate Composio Platform project, matching key/auth-config/version maps and verifier `https://staging.macrofold.ai/integrations/composio/callback`. Use a separate GitHub App/social OAuth registration and replace **all** associated IDs/secrets/slug, with staging callbacks and webhook. Keep unused integration keys blank until their staging account is ready. Do not overwrite production callbacks to run staging tests.
7. Use a verified email sender authorized by the staging sending key. Managed model/search keys should come from a dedicated test project or be left blank until a bounded test window; do not accidentally spend through copied production credentials. Optional direct MCP registrations use staging callback `https://staging.macrofold.ai/integrations/mcp/callback`. Keep PostHog disabled.
8. Run `node .data/launch-staging/prepare.mjs render`. Apply the staging bucket's newly rendered CORS, and register its Stripe destination at `https://staging.macrofold.ai/webhooks/stripe`. Run staging `migrate`, `auth-migrate`, `provision-cli`, then `doctor` through `.data/launch-staging/run.mjs`, following the database guide. These are live database operations. Populate missing providers/image before requiring all readiness checks to pass.
9. Create a **separate** runtime import file with this complete offline command from the repository root. It checks the staging origin, distinct identity keys, restricted TLS database URLs and closed launch flags, then strips administrative credentials. It does not connect to either database:

   ```sh
   node --input-type=module <<'NODE'
   import { readFile, writeFile, chmod } from 'node:fs/promises';
   import { parse } from 'dotenv';
   const env = parse(await readFile('.data/launch-staging/production.env'));
   const production = parse(await readFile('.data/launch/production.env'));
   if (env.APP_ORIGIN !== 'https://staging.macrofold.ai') throw new Error('Wrong staging origin.');
   const keyNames = ['AUTH_SECRET', 'VAULT_KEY', 'CRON_SECRET'];
   for (const key of keyNames) {
     if (!/^[a-f0-9]{64}$/i.test(env[key] || '') || env[key] === production[key])
       throw new Error(`Configure independent staging ${key}.`);
   }
   if (new Set(keyNames.map(key => env[key])).size !== 3) throw new Error('Staging keys must differ.');
   for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL']) {
     const url = new URL(env[key]);
     if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== 'platform_app' ||
         !url.password || !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode')) ||
         url.hostname.replace('-pooler.', '.') === new URL(production[key]).hostname.replace('-pooler.', '.'))
       throw new Error(`Use the restricted staging database for ${key}.`);
     if (key === 'AUTH_DATABASE_URL' && url.hostname.includes('-pooler.'))
       throw new Error('Staging auth must use a direct connection.');
   }
   for (const key of ['ALLOW_PAID_EXECUTION', 'RUN_ADMISSION_ENABLED', 'PUBLIC_SIGNUP_ENABLED']) {
     if (env[key] !== 'false') throw new Error(`Keep ${key}=false for initial staging setup.`);
   }
   delete env.MIGRATION_DATABASE_URL;
   delete env.PLATFORM_APP_DATABASE_PASSWORD;
   delete env.VERCEL_OIDC_TOKEN;
   const lines = Object.entries(env).map(([key, value]) => {
     const quote = !value.includes("'") ? "'" : !value.includes('`') ? '`' : null;
     if (!quote) throw new Error(`Review dotenv quoting for ${key}.`);
     return `${key}=${quote}${value}${quote}`;
   });
   await writeFile('.data/launch-staging/runtime.env', lines.join('\n') + '\n', { mode: 0o600 });
   await chmod('.data/launch-staging/runtime.env', 0o600);
   console.log('Staging runtime export prepared; no secrets printed or network calls made.');
   NODE
   ```

   Check both database hostnames privately against the staging Connect dialog before importing. The comparison rejects the currently configured production host, but does not authenticate a database or prove all credentials are valid. If you choose another staging domain, change the worksheet, callback registrations and the explicit origin guard together.
10. Import `.data/launch-staging/runtime.env` into **the staging Vercel project's Production scope**, and redeploy. Run sandbox billing and the remaining acceptance journeys there. Once they pass, configure production with its own live credentials and resources; never copy the staging database or credit ledger into production.

## 9. Final variable check

- The local root `.env` still points to localhost; neither serving environment contains the migration owner, role-creation password, or local SMTP/test settings.
- Production and staging each have their own origin, matching auth/vault keys, database, bucket, provider callbacks and billing environment.
- JSON variables equal their private JSON sources after rendering. Model IDs/rates and Composio auth configs/version pins are real, reviewed values.
- Every changed Vercel variable has been saved to the intended scope **and redeployed**. `/health`, doctor and actual application acceptance agree; readiness alone does not prove provider execution.
- Keep the three launch gates closed until their explicit test/opening steps in the [launch guide](../18-launch-guide.md#17-open-the-service-to-real-users).
