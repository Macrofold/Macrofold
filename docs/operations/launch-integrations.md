# Register the launch integrations

Use this with [launch steps 8–11](../18-launch-guide.md#8-configure-models-and-web-search). All `production.env` and JSON worksheet paths below are under **`.data/launch/`** in your private checkout. Open its `README.md` for clickable private-file links. The canonical deployed API/dashboard origin is **`https://app.macrofold.ai`**, matching the existing Neon OAuth registration. For staging, use the staging origin, provider project and private worksheet throughout; never mix its callbacks or billing facts with production.

These are operator registration steps. Users subsequently connect their own accounts in Macrofold and grant selected tools. A provider key existing is not evidence of successful execution. Record acceptance in the private `release-record.json` and complete [the endpoint checklist](../21-pre-deployment-checklist.md).

The operator already has the provider API keys. Reuse them in the correct environment; create another only when a required credential or isolated staging/live credential is actually missing. Continue the resource, scope, callback and acceptance steps even when key creation is complete.

## Models and Brave Search

### Managed model accounts

1. Open only the provider accounts whose routes you intend to offer. Create a dedicated project/key for Macrofold, enable account MFA and configure the provider's available budgets/alerts. Alerts are not necessarily hard spending caps. Do not use a personal chat subscription as an API credential.

   | Provider | Dashboard location | Server environment key | Supported harnesses in this app |
   | --- | --- | --- | --- |
   | OpenAI | [API keys](https://platform.openai.com/api-keys), select the intended project | `OPENAI_API_KEY` | Codex, OpenCode |
   | Anthropic | [Console](https://platform.claude.com), organization/project → API keys | `ANTHROPIC_API_KEY` | Claude Code, OpenCode |
   | OpenRouter | [Keys](https://openrouter.ai/settings/keys), create a key with an appropriate limit | `OPENROUTER_API_KEY` | OpenCode |

2. Save each actual key in the matching `production.env` field. These keys fund **managed inference**. A user's BYOK value is stored through Connections and does not replace the server's key for everybody else.
3. Check your account's actual model availability and the exact model identifier in its console/catalog. Consult the current [OpenAI catalog](https://developers.openai.com/api/docs/models), [Anthropic model list](https://platform.claude.com/docs/en/api/models/list), and [OpenRouter model catalog](https://openrouter.ai/models). This guide does not hardcode an untested model choice.
4. In `models.json`, add one entry per offered model using the following **shape only**. Replace the ID/name and rate examples with the reviewed values before enabling it:

   ```json
   [
     {
       "id": "REPLACE_WITH_ACCOUNT_ACCESSIBLE_MODEL_ID",
       "name": "REPLACE_WITH_DISPLAY_NAME",
       "provider": "openai",
       "harnesses": ["codex", "opencode"],
       "input_micro_usd_per_million": "1000000",
       "output_micro_usd_per_million": "5000000",
       "enabled": false
     }
   ]
   ```

   Rates are integer **micro-US-dollars per million tokens**, encoded as strings: a hypothetical $1/M input rate becomes `"1000000"`; $5/M output becomes `"5000000"`. These are unit examples, not provider prices. Choose the product's actual approved retail rates, validate underlying provider costs/cache accounting, and record the pricing source/date. The exact contract is in [catalog.ts](../../packages/core/src/catalog.ts). IDs must be unique; Codex entries require `openai`, Claude Code requires `anthropic`, and OpenCode supports the listed provider families.
5. Update `RATE_CARD_VERSION` to the reviewed release identifier. Review `COMPUTE_MICRO_USD_PER_MINUTE`, `BRAVE_SEARCH_MICRO_USD_PER_CALL`, and `COMPOSIO_MICRO_USD_PER_CALL` in [.env.example](../../.env.example) and the [cost model](../06-billing-costs.md). These are application charges, not a quotation of your next provider invoice.
6. Set `enabled: true` only for the model routes you are preparing to test. Run `node .data/launch/prepare.mjs render`, import the resulting JSON and keys into the target Vercel environment, and redeploy. Keep run admission/paid execution off until the explicitly budgeted test window.
7. Test managed **and** BYOK paths separately for every advertised harness/model combination using [model acceptance](../21-pre-deployment-checklist.md#model-gateway-and-all-native-harness-routes). A provider model-list read or Macrofold's no-inference connection test does not prove generation/streaming/metering.

### Brave Search

1. Open the [Brave Search API dashboard](https://api-dashboard.search.brave.com), create/sign into the operator account, and select a Web Search subscription that covers the intended usage. Review [current search pricing](https://brave.com/search/api/).
2. In the dashboard's API Keys area, create a key for Macrofold and save it as `BRAVE_SEARCH_API_KEY` in `production.env`. The key is supplied to Brave in its subscription-token header by the existing adapter; do not put it in browser code.
3. Review the application `BRAVE_SEARCH_MICRO_USD_PER_CALL` and redeploy the key/rate. Users can choose a Web search connection in Connections and grant `web_search` to a run. They can provide their own Brave key where BYOK is offered.
4. Schedule one deliberate search in the acceptance budget and verify title/URL/excerpt, count, safe search, quota errors and usage. Search requests consume usage; an API key being saved is not a live search test.

Return to [launch step 9](../18-launch-guide.md#9-configure-app-connections-and-direct-mcp).

### Additional BYOK search providers

The implemented search catalog includes **Exa, Tavily, Parallel AI and Firecrawl**, alongside Brave. In **Connections → Add connection → Web search**, select the provider, enter its existing API key and a name, save, then grant `web_search` and attach the connection to a run or preset. Every provider supports BYOK; only Brave also supports managed funding.

Do not add operator environment variables or managed rates for these four providers: the app does not read them. Customer keys are encrypted through Connections. Provider charges for BYOK search are outside the platform run budget, so configure that provider account's own limits. The connection Test action makes no search call and cannot verify quota or credential validity.

Use [the search reference](launch-integrations.md#additional-byok-search-providers) for each provider's official API documentation, exact endpoint and implemented options. Complete the [search acceptance gate](../21-pre-deployment-checklist.md#github-connectors-mcp-web-search-and-stdio-tools) for every provider offered to customers; a passing Brave call does not validate the other adapters.

## Composio app connections

**Composio is optional infrastructure for this connector family.** Model keys, persistent projects, direct MCP, GitHub repository sync and the rest of the control plane are separate. This launch requests Composio, so the following gates must pass before advertising authenticated app actions.

1. Open [Composio](https://dashboard.composio.dev). Select the correct organization and **Platform project**; create a dedicated Macrofold production project if none exists. Use a separate Composio project for staging because the verifier URL is project-wide.
2. Find the project's API-key settings and create/copy the **project API key**, then save it as `COMPOSIO_API_KEY` in `production.env`. Use a key authorized for toolkit discovery, connected-account flows and approved execution; a management-only account token is not interchangeable. [Project API-key permissions](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions).
3. In **Platform → Auth Configs → Create Auth Config**, select an app/toolkit (start with Gmail, Google Drive, Slack, Notion, Linear or another app you actually intend to support). Choose its supported authentication method. Use managed authentication when suitable; for custom OAuth, register a provider application and enter the credentials/scopes required by that toolkit. Copy the exact OAuth redirect URI displayed by Composio into the provider app. That provider-to-Composio URI is different from Macrofold's final callback. [Auth-config navigation](https://docs.composio.dev/kb/guide/dashboard-auth-configs-navigation), [custom OAuth branding](https://docs.composio.dev/docs/authentication/white-labeling-authentication).
4. Copy the resulting auth-config ID and the exact toolkit slug into `composio-auth-configs.json`. For example, the structure is `{"gmail":"YOUR_REAL_AUTH_CONFIG_ID"}`; replace the placeholder. Do this once per supported app/configuration, not once per agent or user.
5. Open the toolkit in Composio's **All Toolkits** catalog (or its linked [toolkit reference](https://docs.composio.dev/toolkits)), inspect the available version selector and select the concrete version you will test. Put that exact value under the same slug in `composio-toolkit-versions.json`. Do not copy a date from an old tutorial or use `latest`. This application's direct execution adapter deliberately pins versions. [Version behavior](https://docs.composio.dev/docs/tools-direct/toolkit-versioning).
6. After the canonical HTTPS application is reachable, open the Composio project's **Settings → General → Configuration** and configure its **callback identity verifier URL** as:

   ```text
   https://app.macrofold.ai/integrations/composio/callback
   ```

   This holds returning OAuth connections until Macrofold verifies the signed-in user and redeems the one-time session. The implemented flow posts `session_uri` and its organization/user identity to `POST /api/v3.1/connected_accounts/complete_auth`, checking the returned account/toolkit against the initiating connection. [Callback identity verification](https://docs.composio.dev/reference/api-reference/connected-accounts).
7. Set `COMPOSIO_CALLBACK_VERIFICATION_ENABLED=true` **only after** that project setting is saved. Run the renderer, import the key/maps/flag into Vercel and redeploy. If the setting is unavailable to your account, leave the flag false and resolve it with Composio; changing the flag alone cannot implement server-side verification.
8. Sign in to **Macrofold → Connections → Add connection → App**. Search/select the configured app, authorize through its provider, and return to Macrofold. Confirm the connection becomes healthy and displays its app logo. Test from Macrofold, not the Composio dashboard's **Connect Account** playground, whose user identity does not match a Macrofold user when the verifier is enabled.
9. Grant one harmless read action and test it in an owned disposable account during the budgeted run window. Revoke the action/account and confirm later calls fail. Test an expired/reused callback and a different signed-in user. Keep credentials/results out of public evidence.

The UI discovers apps, names, categories and logos through the authenticated paginated toolkit catalog, with a bundled snapshot for unavailable credentials/upstream failure. Check all pages and logo fallback in [connector acceptance](../21-pre-deployment-checklist.md). Showing a catalog card does not mean its auth config exists. OAuth consent screens can identify Composio when using managed provider apps; use approved custom OAuth branding where available rather than promising the infrastructure is invisible.

## Direct and sandbox MCP

1. No extra platform vendor account is required for direct MCP. For each server you want to recommend, obtain its **exact public HTTPS MCP endpoint** and authentication requirements from its owner; review any discovery/call pricing.
2. If the server needs a pre-registered OAuth client, register Macrofold in that server's developer settings and use the callback `https://app.macrofold.ai/integrations/mcp/callback`. Put its `client_id` and optional `client_secret` in `mcp-oauth-clients.json`, keyed by the server **origin only**, such as `https://mcp.example.com` (no `/mcp` path or trailing slash). Verify the matching rule in [MCP OAuth implementation](../../packages/core/src/mcp-oauth.ts); the current mapping is origin-scoped, so two servers on the same origin cannot use separate static registrations without an implementation change.
3. For servers using supported dynamic registration or bearer credentials, follow that server's documented flow instead. Users add the server in **Connections → Add connection → MCP server**, authenticate, discover tools and select grants. No server's tool description can authorize extra permissions or spending.
4. Sandbox MCP uses reviewed packages/versions in the native runtime image. Keep its allowlist and connection setup consistent with [tool security](../19-tools-and-security.md). An arbitrary package install is not enabled by registering a remote MCP URL.
5. Test the real server's pagination, OAuth refresh, revocation and a bounded read action using [MCP acceptance](../21-pre-deployment-checklist.md#github-connectors-mcp-web-search-and-stdio-tools). These calls can consume that server's plan allowance.

## GitHub repository App and optional social login

### Repository access

1. Open [Macrofold organization GitHub Apps](https://github.com/organizations/Macrofold/settings/apps), then **New GitHub App**. You need the organization's app-management permission. Use the existing App if one is already registered; source-repository ownership alone does not create it.
2. Enter the values below, also recorded in the regenerated `github-app-settings.json`:

   | GitHub form field | Value |
   | --- | --- |
   | Name | `Macrofold`, or an available distinctive suffix if the name is taken |
   | Homepage URL | `https://app.macrofold.ai` |
   | User authorization Callback URL | `https://app.macrofold.ai/integrations/github/callback` |
   | Webhook | Active, `https://app.macrofold.ai/webhooks/github` |
   | Webhook secret | Existing `GITHUB_WEBHOOK_SECRET` from the production worksheet |
   | Repository Contents | Read and write |
   | Repository Metadata | Read-only |
   | Repository Pull requests | Read and write |
   | Events | Push; installation and installation-repository changes are delivered automatically |
   | Where it can be installed | Any account when offering customer repository access |

3. Leave **Request user authorization during installation** off for the initial flow and do not use the OAuth callback as a bare installation Setup URL. Macrofold starts its own signed-in, state-bound authorization flow; a direct installation redirect without that state will be rejected. A separate safe Setup URL can simply return users to the application's Connections page. Keep GitHub device flow off; the customer CLI authenticates to Macrofold's OAuth service. [Registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [setup versus callback](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).
4. Create/save the App. On its settings page copy **App ID**, **Client ID**, generate a **Client secret**, and copy the slug from the App's public URL. Set `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_SLUG` in `production.env`.
5. Under **Private keys**, generate/download GitHub's PEM key. Store it in your secret manager and `GITHUB_APP_PRIVATE_KEY`. The app supports a quoted dotenv PEM with literal `\n` separators; in Vercel verify the value is the PEM content or that supported escaped form, not a filename. Never commit the downloaded key. The runtime must use a GitHub-generated key registered to this App.
6. Import those values into Vercel Production and redeploy. In the App's **Install App** page install it on a dedicated test repository using **Only select repositories**.
7. In Macrofold start **Connect GitHub** from Connections or a project's Git view, complete authorization, and verify only authorized repositories are listed. Installation and per-user authorization are separate. Test import, worktree, push/PR and revoked/protected access using [Git acceptance](../21-pre-deployment-checklist.md#github-connectors-mcp-web-search-and-stdio-tools).

### Optional Sign in with GitHub

If you want the social-login button, create a **separate OAuth App** at [GitHub OAuth Apps](https://github.com/settings/developers) → **New OAuth App**, homepage `https://app.macrofold.ai`, callback **`https://app.macrofold.ai/auth/callback/github`**. Save its client values under `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, redeploy, and test login/account linking. These keys do not replace `GITHUB_APP_CLIENT_*`. Email/password authentication works without this optional login method.

## Stripe billing

**Existing setup:** `.data/launch/stripe-sandbox-settings.json` records authenticated metadata verification in **Macrofold sandbox**, including the two active prices below. The matching IDs are already in `stripe-sandbox.env`. Reuse those products and prices in that sandbox. This is metadata evidence from the setup record, not a successful application billing test. The staging origin, runtime credential, webhook destination, default Portal and tax configuration are still pending. `stripe-settings.json` is the generic target specification, not proof those settings were applied.

### Isolate the test ledger first

1. Complete [launch step 11](../18-launch-guide.md#11-configure-stripe-in-test-mode-then-live-mode)'s staging isolation before using test payments. Use a separate Vercel project, database branch, bucket, secrets and stable HTTPS origin, for example an operator-owned staging subdomain. Provision that origin's auth/OAuth resources with its own keys. Do not point test Stripe webhooks at a live-customer database.
2. Open [Stripe](https://dashboard.stripe.com), choose **Macrofold sandbox** in the account/environment selector, and confirm it is visibly the test environment recorded in the private settings file. Put its runtime key in `STRIPE_SECRET_KEY` in the **staging** worksheet and Vercel project. Prefer an existing **restricted** `rk_test_…` key with the permissions below; the variable name does not require an unrestricted `sk_test_…` key. No publishable key is required by this server-created Checkout implementation. [Restricted keys](https://docs.stripe.com/keys/restricted-api-keys).
3. Open **Product catalog** and check the existing products/prices against `stripe-sandbox-settings.json` and the table below. Copy their `price_…` IDs from `stripe-sandbox.env` into the isolated staging configuration. Do not create duplicates. In a genuinely new environment, use **Add product**, USD, monthly, quantity one. [Stripe product/price setup](https://docs.stripe.com/products-prices/manage-prices).

   | Product | Stripe monthly amount | Environment price ID | Application recurring included credit |
   | --- | --- | --- | --- |
   | Pro | $29.00 | `STRIPE_PRO_PRICE_ID` | $10.00 |
   | Scale | $199.00 | `STRIPE_SCALE_PRICE_ID` | $50.00 |

   The matching application display/inclusion fields are `PRO_MONTHLY_PRICE_MICRO_USD=29000000`, `PRO_INCLUDED_CREDIT_MICRO_USD=10000000`, `SCALE_MONTHLY_PRICE_MICRO_USD=199000000`, `SCALE_INCLUDED_CREDIT_MICRO_USD=50000000`. Confirm exact field names in [.env.example](../../.env.example) before editing. Starter has no subscription price. Top-ups use the server's Checkout flow; do not invent a third recurring price.

### Runtime key permissions

In the selected sandbox's **Developers → API keys**, inspect/edit the existing restricted key's permissions. These are the resource operations used by [billing](../../packages/core/src/billing.ts) and [webhook reconciliation](../../packages/core/src/billing-events.ts):

| App operation | Permission to verify in Stripe |
| --- | --- |
| Create a customer | Customers: write |
| Create a Checkout session | Checkout Sessions: write |
| Create a customer Portal session | Customer Portal/Billing Portal: write |
| Retrieve current subscription state | Subscriptions: read |
| Retrieve a charge for dispute reconciliation | Charges: read |
| List paid invoice payment associations | Invoice Payments / corresponding invoice resource: read |

Dashboard permission grouping can differ from SDK resource names; use test-mode request logs to confirm all six operations succeed with the actual key. Product, price, Portal-configuration and webhook-destination administration are separate setup activities; the runtime does not create those resources. Give a metadata inspection key its own required read permissions rather than assuming a runtime key must also read account balance. Webhook signature verification uses the destination's `whsec_…`, independently of the API key.

Test/live separation is an operational requirement: this application does not currently reject an otherwise valid webhook solely from `event.livemode`. Use separate destinations, keys, databases and app environments. Do not treat the key prefix or a dashboard toggle as a replacement for that isolation.

### Webhook destination

1. Open **Developers → Workbench → Webhooks / Event destinations → Add destination**. Select events for **your account**, webhook/HTTPS destination, the API version matching the locked **Stripe SDK 20.4.1** (**`2026-02-25.clover`** in the prepared worksheet), and **snapshot** event payloads where the UI offers that choice. This intentionally matches the installed SDK, not the newest version in Workbench. Upgrade the SDK, parsers, fixtures and destination together through compatibility review. Do not use thin events with this event parser. [Workbench setup](https://docs.stripe.com/workbench/overview), [API versioning](https://docs.stripe.com/api/versioning).
2. Use `https://YOUR_STAGING_ORIGIN/webhooks/stripe` for staging and later **`https://app.macrofold.ai/webhooks/stripe`** for live production. Replace `YOUR_STAGING_ORIGIN` with the hostname, without duplicating `https://`. Subscribe to all of these implemented events:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.expired
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   charge.refunded
   charge.dispute.created
   charge.dispute.updated
   charge.dispute.closed
   charge.dispute.funds_withdrawn
   charge.dispute.funds_reinstated
   ```

3. Create the destination, reveal its **Signing secret**, and save that actual `whsec_…` value as `STRIPE_WEBHOOK_SECRET` in the matching environment. A CLI forwarding secret or a secret from a different destination will fail verification. Preserve raw webhook request bodies through every proxy.
4. In Workbench **Event deliveries**, verify successful delivery to this URL after actual staging Checkout activity. A browser success redirect does not establish payment; only the verified server event credits the ledger.

### Portal and lifecycle tests

1. Open Stripe **Settings → Billing → Customer portal** in the same test environment. Configure and save the account's **default** Portal: the app creates Portal sessions without a configuration ID. Enable payment-method changes, invoice history, cancellation at period end, and switching only between the approved Pro and Scale monthly prices. Keep quantity fixed at one; choose and test proration deliberately. **Scheduled downgrades need a decision:** Stripe's built-in period-end downgrade setting only supports prices on the same product, while the existing Pro and Scale prices belong to separate products. Period-end cancellation remains a different setting. Before promising scheduled Pro ↔ Scale changes, either review/recreate the two prices under one subscription product with corresponding catalog changes, or implement and test explicit subscription scheduling. Do not silently replace the existing prices. [Portal configuration and downgrade constraint](https://docs.stripe.com/customer-management/configure-portal).
2. Use **Macrofold Billing** to create a top-up and each subscription using [Stripe test payment methods](https://docs.stripe.com/testing). Exercise the portal from Macrofold. Use Stripe's documented test-clock/lifecycle tools where applicable; a synthetic dashboard webhook disconnected from a real subscription/invoice is not sufficient accounting evidence.
3. Complete [Stripe acceptance](../21-pre-deployment-checklist.md#stripe-money-flow-and-analytics): renewal, failed payment, cancellation, Pro ↔ Scale, proration, refund/dispute, duplicate/out-of-order delivery, included credit exactly once and reconciliation. Retain provider event/invoice IDs, never card/secret data.
4. Resolve tax treatment before live payments. The existing prices have unspecified tax behavior and Checkout does not enable `automatic_tax`. Review the applicable product treatment and registrations with your tax adviser. If tax collection is required, implement and test it before launch: top-up reconciliation currently requires the Checkout total to equal the intended credit purchase exactly, so adding tax to that total without separating tax from credit would fail reconciliation. Record the approved approach and tax-inclusive/exclusive price behavior; an API key does not configure this.
5. Complete business/bank/identity verification in Stripe yourself. Switch to **Live**, repeat product/price/destination/default-Portal setup using existing resources where available, and obtain the separate live restricted key, price IDs and signing secret. Copy **only live values** into production. Do not promote a database containing test credits/subscription/customer IDs into production.
6. Confirm currency/catalog and webhook readiness before opening customer billing. If you require a live payment acceptance test, make it deliberately under an approved budget; processor fees/refunds are not guaranteed free.

Return to [launch step 12](../18-launch-guide.md#12-plan-the-controlled-paid-smoke-test).
