# Environment configuration

Keep one configuration source per environment. Local development, serving processes, and database administration have different credential needs.

## Where settings belong

| Location                                        | Purpose                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Repository `.env`                               | Local simulation; created by `pnpm setup`                      |
| Hosting secret manager or private `runtime.env` | One staging or production runtime environment                  |
| Private `migration.env`                         | Owner database credential for administrative commands only     |
| Provider consoles                               | Account-level quotas, callbacks, domains, and billing controls |

Use [`.env.example`](../../.env.example) as the setting inventory, not as a production-ready secret file. No `.data` worksheet or developer-specific helper is required. Avoid multiple `.env.local` files that give Next.js and command-line workers different values.

Store private files outside version control with owner-only permissions. Parse dotenv files with Node or a dotenv reader rather than sourcing arbitrary text as shell code. Existing exported variables can override env-file values; use a clean administrative shell for migration commands.

## Staging and Vercel project selection

1. Use a dedicated staging Vercel project with a stable HTTPS origin. Configure an isolated database, private R2 bucket, identity sender, secrets, and Stripe test ledger. A normal database branch can copy production data and credentials; prefer a schema-only branch or new database with synthetic accounts.
2. For a dedicated staging project, put its staging runtime settings in that project's **Production** environment and deploy to its production URL. Vercel's environment label describes the deployment target within that project, not whether it serves real customers. This also lets staging exercise the production deployment's Cron behavior. Configure Preview deployments separately with non-production resources.
3. Before importing variables or deploying, verify the selected Vercel team, project, environment, and origin. Check command selection, `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID`, and local `.vercel` links for conflicts. Explicitly select staging instead of relying on a root `.env` or previous CLI link that may select production. [Vercel CLI project selection](https://vercel.com/docs/cli/global-options).
4. Reuse a valid Vercel CLI login for interactive administration. `VERCEL_TOKEN` authenticates API/CLI automation; it is not an application secret or the runtime's Sandbox identity. Unattended tooling can use a separately managed, expiring token with the intended team scope. Keep it in the tooling secret store, outside the web runtime and agent image. [Vercel access tokens](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token).
5. Confirm the database, bucket, sender, Stripe account/mode, price IDs, and callback destinations by identity and behavior. A count of saved environment variables is not a readiness check. Finish [Stripe activation](launch-integrations.md#activate-and-test-staging-billing) after deployment.

## Application and identity

| Setting                                     | Purpose                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `PRODUCT_NAME`                              | Display name; does not change domain identifiers                    |
| `APP_ORIGIN`                                | Exact public HTTPS origin for application, API, callbacks, and docs |
| `PLATFORM_MODE`                             | `local` for fixtures; `production` for hosting                      |
| `AUTH_SECRET`                               | Independent secret of at least 32 characters                        |
| `VAULT_KEY`                                 | Retained encryption key, independent of the auth secret             |
| `CRON_SECRET`                               | Authentication for scheduled maintenance                            |
| `OPERATOR_EMAILS`                           | Comma-separated verified operator identities                        |
| `RESEND_API_KEY`, `EMAIL_FROM`              | Identity email credentials and verified sender                      |
| `SUPPORT_EMAIL`, `PRIVACY_URL`, `TERMS_URL` | Deployment contact and policy links                                 |

For rotation, configure `VAULT_ACTIVE_KEY_ID` and `VAULT_KEYRING_JSON`, retain old decrypt keys, rehearse restoration, and use the reviewed rewrap procedure. Do not replace the only copy of an old key.

## Database and storage

| Setting                                    | Purpose                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Restricted pooled domain connection                                       |
| `AUTH_DATABASE_URL`                        | Restricted direct identity connection                                     |
| `DATABASE_RUNTIME_ROLE`                    | Restricted runtime SQL role, default `platform_app`                       |
| `MIGRATION_DATABASE_URL`                   | Direct owner URL; administrative environment only                         |
| `R2_ENDPOINT`, `R2_BUCKET`                 | Private object-store location                                             |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket-scoped object credentials                                          |
| `DATA_DIR`                                 | Local working data; use temporary space for serverless control-plane work |

See [database setup](neon.md) and [hosting](hosting.md). Database backups alone cannot restore encrypted project content.

## Execution and admission

| Setting                       | Hosted configuration                             |
| ----------------------------- | ------------------------------------------------ |
| `EXECUTION_PROVIDER`          | `vercel`                                         |
| `ORCHESTRATION_BACKEND`       | `workflow` on Vercel                             |
| `RUNTIME_IMAGE`               | Ready VCR image with immutable SHA-256 digest    |
| `ALLOW_PAID_EXECUTION`        | Keep `false` until controlled acceptance         |
| `RUN_ADMISSION_ENABLED`       | Pause or resume new accepted work                |
| `PUBLIC_SIGNUP_ENABLED`       | Control public registration                      |
| `GLOBAL_CONCURRENT_RUN_LIMIT` | Ceiling within verified vendor capacity          |
| `SANDBOX_EGRESS_DOMAINS`      | Reviewed additional outbound destinations        |
| `WORKER_CONCURRENCY`          | Concurrent phase steps for the standalone poller |

The Sandbox adapter currently uses Vercel OIDC. Static `VERCEL_TOKEN`, team, and project fields do not enable production execution on another host by themselves.

## Models, tools, and billing

Managed models use `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`, with `MODEL_CATALOG_JSON` defining enabled models, compatible harnesses, provider routes, and reviewed rates. See [the catalog schema and example](../features/execution/runtime.md#production-model-catalog-example).

Optional Composio settings are `COMPOSIO_API_KEY`, `COMPOSIO_AUTH_CONFIGS_JSON`, `COMPOSIO_TOOLKIT_VERSIONS_JSON`, `COMPOSIO_CALLBACK_VERIFICATION_ENABLED`, and `COMPOSIO_MICRO_USD_PER_CALL`. MCP uses reviewed `MCP_STDIO_CATALOG_JSON` and optional exact-origin `MCP_OAUTH_CLIENTS_JSON`. Managed search uses `BRAVE_SEARCH_API_KEY` and `BRAVE_SEARCH_MICRO_USD_PER_CALL`. Other supported search providers use customer connections.

GitHub repository access uses `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`. Optional social login uses separate `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` values.

Stripe uses `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_SCALE_PRICE_ID`. Align recurring prices with the `PRO_*` and `SCALE_*` display and included-credit fields in `.env.example`. Keep test and live accounts, destinations, and ledgers separate.

Optional PostHog exports require `POSTHOG_ENABLED`, region, project token, start time, and a daily event budget. They are disabled by default and are not needed for native reporting.

## Apply and validate

Import only runtime fields into the matching hosting environment, then redeploy. Use the administrative environment only for migrations and provisioning. Verify origin, role restrictions, readiness, and callbacks without printing secrets. The [deployment guide](launch-guide.md) provides the ordered steps; [provider integrations](launch-integrations.md) explains external setup.
