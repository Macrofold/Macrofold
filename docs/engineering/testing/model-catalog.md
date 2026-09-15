# Model catalog acceptance

The [model catalog](../../features/execution/models.md) replaces environment JSON with reviewed compatibility/retail rules, provider discovery and a PostgreSQL cache. This record distinguishes deterministic accounting and refresh checks from vendor execution acceptance.

## Deterministic coverage

The complete unit/integration/Git suite passes **628 tests in 80 files**. Strict TypeScript and generated SDK compilation pass. Aggregate coverage and mutation scores were not recomputed; existing gates were not changed.

The catalog tests use a freshly migrated disposable PostgreSQL database, synthetic accounts, injected metadata responses and a fake machine provider. They cover:

- Built-in defaults, free simulation and harness compatibility; unknown discoveries remain disabled.
- Exact decimal price conversion, malformed prices, unsupported capabilities and unaccounted fees.
- Fixed metadata endpoints, credential selection, complete pagination, duplicate identifiers, bounded bodies, rate limits and malformed responses.
- Concurrent refresh claims, expiry recovery, late-worker fencing, failed-refresh preservation and retry backoff.
- Dynamic price expiry at the 24-hour boundary and rejection of undated snapshots.
- Actual API admission followed by a catalog price change, gateway settlement, cancellation and verified checkpoint publication. The admitted price remains unchanged, the machine launches once and all reserved funds are released.
- OpenRouter price ceilings and rejection of alternate model lists, hosted search and invalid routing preferences before reservations or provider calls.
- Missing accepted rate cards fail reconciliation instead of substituting current prices.

The complete-journey fixture reserves available test capacity and uses interactive scheduling because the broader suite retains synthetic background work. It still goes through the real SQL scheduler. Existing authorization, BYOK, financial, cancellation and replay tests remain enabled.

## SDK and command verification

All five SDKs were regenerated from OpenAPI. The model response now exposes its name and exact integer-string input/output prices; these fields previously disappeared during API response validation.

`pnpm test:sdks` passes TypeScript's API/simulator journey, 150 Python tests and strict Python type checking, the Go suite, 12 Rust tests and 10 Java tests. These include actual API calls, streaming/replay, persistent files and cancellation against isolated local servers and workers. They use no vendor inference or hosted sandboxes.

`pnpm models:status` and `pnpm models:refresh` were exercised against a disposable database. The command journey reads built-in defaults, fetches public metadata, persists it and reads it back. Developer credentials are removed from that fixture; direct-provider discovery is skipped there.

## Free live metadata verification

Four metadata GET requests succeeded: one authenticated OpenAI listing, one authenticated Anthropic listing and two public OpenRouter listings, including the command journey. No inference, sandbox, search or other paid calls were made.

| Provider | Discovered entries | Reviewed routes found |
| --- | ---: | --- |
| OpenAI | 125 | GPT-5.4 mini |
| Anthropic | 11 | Claude Sonnet 4.6 and Haiku 4.5 |
| OpenRouter | 428 | OpenAI GPT-5.4 mini, with text/tool support and usable token prices |

OpenRouter's response also lists an optional search charge. The catalog accepts that text route because the gateway prohibits hosted search, plugins and search options. The second metadata check confirms that the route is enabled and cached. No account identifiers, keys or provider response bodies are included in this public record.

## Reproduce

Start a local database using [local development](../../getting-started/local-development.md). These commands create their own database/filesystem fixtures:

```sh
pnpm test:domain tests/unit/model-catalog.test.ts tests/integration/model-catalog.test.ts tests/integration/gateway.test.ts
pnpm test:domain
pnpm test:sdks
pnpm check
pnpm docs:check
```

The two operator catalog commands use the database selected by the current environment. Refresh is an explicit free metadata network operation; ordinary deterministic tests never perform it against vendors.

## Remaining hosted acceptance

Verify migration 029 and hourly refresh on the deployed maintenance path, cold starts, cross-instance lease recovery, provider entitlements and maintenance latency during upstream timeouts. Refresh can add up to 45 seconds to a maintenance sweep; on the standalone poller that can delay the next dispatch tick. No database connection remains checked out during network I/O.

Under a separately approved budget, verify every enabled native harness/model route, managed and BYOK execution, OpenRouter acceptance of the routing price ceilings, rejected/no-matching-provider responses and actual invoice reconciliation. Review direct-provider account service-tier and region settings: catalog prices are retail policy, not an automatic mirror of every vendor pricing variant. Native Docker/cloud, deployed browser behavior, aggregate coverage and mutation scores were not remeasured for this catalog change. See [pre-deployment checks](../../operations/pre-deployment.md#model-catalog-acceptance).

## Changelog

- September 7, 2026: Provider metadata, reviewed pricing rules and accepted-run snapshots replace mutable environment catalog JSON. Metadata discovery remains separate from paid execution acceptance.
