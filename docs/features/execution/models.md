# Model catalog

Macrofold includes a model catalog. Choose an enabled model in the dashboard or with `client.models.list()`; you do not need to maintain model JSON in environment variables.

## Get started

1. Configure a managed provider key, or add your own model connection in **Connections**.
2. Select a model compatible with your [harness](harnesses.md).
3. Set a run budget and submit your task. Enabling paid execution remains a separate deployment decision.

The initial direct-provider catalog includes GPT-5.4 mini for Codex, OpenCode, Hermes, DeepSeek Harness, and Pi and Claude Sonnet 4.6 and Haiku 4.5 for Claude Code/OpenCode. OpenRouter discovery admits compatible text/tool models across its catalog after validating prices and supported protocol capabilities. Local simulation continues to offer only its free fixture model.

Discovery describes available models; it does not authorize a customer, prove account entitlement, or establish that a live native run has passed. BYOK still requires a healthy, owner-bound connection for the selected provider and never falls back to platform credentials.

## Refresh and caching

The existing worker or hosted maintenance job checks for an hourly refresh. OpenAI and Anthropic discovery use configured platform keys; without those keys, their built-in defaults remain available for BYOK. OpenRouter discovery is public and receives no key. Customer credentials never populate the shared catalog.

Complete provider responses are cached in the application's PostgreSQL database. This is local persistence in development and shared persistence across hosted instances. API requests read that cache; they do not call providers. No Redis, additional queue, or continuously running process is required beyond the existing worker or cron job.

A failed refresh preserves the last complete result and retries after five minutes. A worker that disappears can be replaced after its two-minute claim expires. Late responses cannot overwrite a newer refresh. OpenRouter routes stop accepting new work when their dynamic price snapshot is over 24 hours old. A complete provider response that removes a reviewed model disables that route for new work. Existing accepted runs retain their original configuration.

## Prices and enablement

Provider discovery is filtered through the versioned policy in [model-policy.ts](../../../packages/core/src/model-policy.ts). New OpenRouter models can be admitted automatically when they support text output and tools, and every charge fits the existing accounting policy. Their supported harnesses are OpenCode, Hermes, DeepSeek Harness and Pi. Codex and Claude Code retain their direct-provider protocol boundaries; broad discovery does not imply every harness supports every model. Provider-routing aliases under `openrouter/` are excluded because they choose a different model at runtime.

OpenAI and Anthropic model-list responses do not provide a retail rate card. Their prices therefore come from the built-in, reviewed policy. OpenRouter supplies token prices; the application converts those decimal strings exactly into integer micro-USD per million tokens. Missing prices, unsupported output modalities, missing tool support, nonzero unaccounted fees, and unfamiliar pricing structures keep that route disabled. There is no additional automatic markup.

For OpenRouter requests, the gateway sets provider price ceilings from the run's accepted input/output rates and requires a zero per-request fee. It rejects fallback model lists, so a request cannot silently switch models. An optional search price in discovery does not disable a text route: hosted search tools, plugins and search options are already blocked. If no provider meets the price ceiling, the request fails instead of increasing the customer's rate.

The existing cache accounting policy remains: cache reads use the full input rate, Anthropic cache writes use twice the input rate, and reported reasoning tokens are included in output. Retail charges are distinct from the provider's invoice and discounts. See [billing](../billing/README.md).

Run admission saves the exact selected rate card in the same transaction as the reservation and queued run. A price refresh affects subsequent admissions, including later session continuations. It cannot reprice queued or running work. Gateway settlement and interrupted-request reconciliation require the accepted snapshot; they never substitute today's prices. Public rate-card versions are derived from content rather than manually assigned environment labels.

## Operate the catalog

After applying database migrations, inspect or refresh the catalog from the deployment's configured shell:

```sh
pnpm models:status
pnpm models:refresh
```

Status shows provider timestamps, refresh failures, and policy-based model enablement. Refresh performs metadata GET requests only, leaves active refresh claims alone, and exits unsuccessfully when a discovery attempt fails. Neither command launches an agent. Use the configured database for the intended environment; the commands do not copy credentials or change environment files.

Ordinary availability refreshes require no redeployment. Deliberate retail-price or compatibility-policy changes are reviewed source changes and ship with the application. Secrets, service origins, infrastructure limits, and paid-execution opt-in remain environment configuration. See [deployment configuration](../../operations/launch-environment.md).

## Implementation and verification

[model-catalog.ts](../../../packages/core/src/model-catalog.ts) owns the cache and refresh claims; the [provider adapter](../../../packages/providers/src/model-catalog.ts) owns fixed URLs, pagination, response-size bounds, and a 15-second deadline per provider. Migration 029 adds only global, non-customer metadata and does not rewrite runs or financial history. Refresh can take up to 45 seconds across three providers; running it through existing maintenance means that invocation may take correspondingly longer.

Provider references: [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list), [GPT-5.4 mini pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Anthropic model listing](https://platform.claude.com/docs/en/api/models/list), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenRouter discovery](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), and [OpenRouter routing price ceilings](https://openrouter.ai/docs/guides/routing/provider-selection). Bundled rates were reviewed September 7, 2026. [Acceptance evidence](../../engineering/testing/model-catalog.md) records deterministic tests, free live metadata checks and remaining native/invoice verification.

### Runtime compatibility floor

OpenRouter discoveries must publish at least a 128,000-token context and an 8,192-token maximum completion, in addition to text/tool capabilities and supported pricing. Missing limits leave the route disabled. These match the current OpenCode, Hermes, DeepSeek and Pi runtime configuration. This intentionally defers smaller-context models: admitting them requires carrying their limits into every runtime, including compaction, rather than advertising a model that cannot accept the runtime's requests. Larger models use this conservative common window. Routing-provider failures still surface as run failures; discovery is not account entitlement or a guarantee of provider availability.
