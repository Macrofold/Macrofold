# Configure provider integrations

Configure providers separately for staging and production. Keep credentials in the matching runtime secret store and validate the selected account, callback, and scopes before granting access to users.

## Models and search

Enable only models compatible with the pinned harnesses. Configure managed provider keys and a reviewed `MODEL_CATALOG_JSON`; use the [runtime catalog reference](../features/execution/runtime.md#production-model-catalog-example) for exact fields and supported routes. Review token rates and provider spending limits before enabling execution.

Customers can add OpenAI, Anthropic, or OpenRouter BYOK connections. For search, Brave supports managed funding; Brave, Exa, Tavily, Parallel AI, and Firecrawl support customer keys. [Search profiles](../features/identity-integrations/web-search.md) describe the normalized tool and which vendor features it exposes.

## Composio applications

Use a separate Composio Platform project per environment. Store its complete project key as `COMPOSIO_API_KEY`. Register the intended toolkit auth configurations and map their IDs in `COMPOSIO_AUTH_CONFIGS_JSON`. Pin tested toolkit versions in `COMPOSIO_TOOLKIT_VERSIONS_JSON`.

Configure public HTTPS callback verification before enabling `COMPOSIO_CALLBACK_VERIFICATION_ENABLED`. The authenticated returning application user, pending attempt, toolkit, and provider-verified account must agree. A connected-account ID by itself is not authorization.

Complete the application's **Connections** flow as a test user, grant a narrow tool, and verify both a permitted action and revocation. A catalog response or consent URL alone does not verify private-account access. See [Composio setup](../features/identity-integrations/composio.md).

## Remote and sandbox MCP

Remote MCP servers must support the configured HTTP transport and an allowed public HTTPS destination. Use supported OAuth discovery or an exact-origin pre-registered entry in `MCP_OAUTH_CLIENTS_JSON`. Grant explicit tools; do not pass arbitrary server credentials through prompts.

Sandbox stdio tools come from the reviewed `MCP_STDIO_CATALOG_JSON` and pinned runtime image. Rebuild and verify the image when changing executable packages. The [tool security guide](../features/identity-integrations/tools-security.md) specifies configuration and isolation requirements.

## GitHub

Create a GitHub App with repository Contents and Pull requests read/write permissions and Metadata read access. Subscribe to push, installation, and installation_repositories events handled by [the webhook receiver](../../packages/core/src/github-webhooks.ts). Limit installation to selected repositories. Configure repository access separately from optional social login.

Set the App callback to `APP_ORIGIN/integrations/github/callback`, setup URL to `APP_ORIGIN/connections`, and webhook URL to `APP_ORIGIN/webhooks/github`. Set App credentials and a distinct webhook secret in the runtime environment. An installation ID must also pass current user repository permission checks.

Test installation, signed webhook reception, repository selection, a protected-branch failure, clean synchronization, and a conflict. Verify that revocation blocks queued sync and leaves source checkpoints intact. Never test with a customer repository.

## Stripe

Use a separate Stripe test environment and a separate application ledger for staging. Create monthly USD Pro and Scale prices matching the application display fields and included credits. Starter does not require a recurring price. Set the two price IDs, runtime key, and endpoint signing secret.

Configure a snapshot-event webhook destination at `APP_ORIGIN/webhooks/stripe`, using an event API version tested with the repository's pinned Stripe SDK and [billing event processor](../../packages/core/src/billing-events.ts). The receiver expects `data.object`; a thin-event destination is not interchangeable. Select these fourteen events explicitly:

- Checkout: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`.
- Subscriptions: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Invoices: `invoice.paid`, `invoice.payment_failed`.
- Reversals: `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.

Use the signing secret belonging to that exact destination and account/mode for `STRIPE_WEBHOOK_SECRET`. It is separate from the API key and from the secret printed by `stripe listen`; they cannot substitute for one another. Keep raw request bytes intact and signature verification enabled. See [Stripe's signing-secret guidance](https://docs.stripe.com/webhooks/signature).

Configure and save Stripe's **default Customer Portal** in the same test environment for the supported Pro/Scale prices, payment-method changes, and cancellation. The application's `billingPortal.sessions.create` call does not supply `configuration`, so creating an unrelated custom configuration is insufficient. Repeat default Portal setup separately for live mode. See [Portal configuration selection](https://docs.stripe.com/api/customer_portal/sessions/create).

### Activate and test staging billing

1. Finish isolated staging database/storage/email setup, migrations, and deployment from one reviewed revision. Import the test API key, both price IDs, and the prepared destination's signing secret into the correct staging project/environment, then redeploy as needed. Prefer a restricted runtime key with permissions verified against the calls used by the application.
2. Confirm the default Portal configuration is saved and points to the intended prices. The Portal requires an application-associated Stripe customer; test Portal entry after the first application Checkout in step 4.
3. Ensure Stripe can reach the exact HTTPS webhook URL without a Vercel login page or redirect. If deployment protection is enabled, use a supported bypass method. Vercel documents the `x-vercel-protection-bypass` URL query parameter for webhooks that cannot set custom headers. This is a separate, project-wide bypass secret: keep the full URL private, redact it from logs, and retain Stripe signature verification. An OPTIONS allowlist does not permit webhook POSTs. See [Vercel's webhook protection guidance](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection).
4. Enable the prepared destination only when the receiver is ready. Submit a fresh application-created test Checkout and verify **payment → signed delivery → application ledger credit or subscription entitlement**. A Checkout success redirect or an unrelated sample event is not settlement evidence. Inspect failed deliveries and reconcile/resend applicable earlier events explicitly instead of assuming the disabled period will be replayed automatically.
5. Verify Portal entry, plan changes/cancellation, duplicate delivery without duplicate credit, and the remaining payment cases below. Keep public signup closed; Stripe test Checkout does not require enabling paid agent execution.

Verify top-up settlement, subscriptions, duplicate and out-of-order events, cancellation, refunds/disputes, and reservation reconciliation with test objects. Test keys and live keys require different destinations and signing secrets. Never enable live billing by merely replacing the key in a staging ledger.

## R2 and Resend

Use bucket-scoped R2 object credentials, private access, exact-origin CORS for staged transfers, and a lifecycle policy limited to temporary staging. Verify binary round trips, overwrite preconditions, checkpoint restore, and expired upload capabilities.

Verify the Resend sending domain and sender. Complete real signup verification and password-reset delivery using the deployment's origin. A test-recipient response validates the request shape but does not establish production domain reputation or inbox delivery.

## Acceptance

Use synthetic accounts and the minimum permitted provider usage. Record actual request shapes, outcomes, spending, and any unknown external effect. Deterministic adapter tests remain the default CI path; record live account acceptance with the [pre-deployment checks](pre-deployment.md).
