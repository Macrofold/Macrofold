# Web search

Agents can use Brave Search, Exa, Tavily, Parallel AI, or Firecrawl through the same granted `web_search` tool. Search is implemented by platform adapters and exposed through the existing runtime MCP broker to Codex, Claude Code, and OpenCode. Model routing does not choose the search provider.

## Connecting a provider

In Connections, choose **Add connection → Web search**, select a provider, supply a connection name and API key, then grant `web_search` under Tools. Attach that connection to a run or preset. Each connection has one immutable provider; create another connection to change providers. Switching providers in the setup dialog clears the previous key. Multiple connections can be granted separately.

Every provider supports a customer API key (BYOK). Keys are encrypted, write-only, and stay at the broker. Missing customer credentials never fall back to an operator key. BYOK search charges are billed by the provider and are **outside the platform run budget**; model/compute charges still follow their own funding policy. Use provider-side quotas or spending controls for external search charges.

Only Brave currently offers managed funding, using `BRAVE_SEARCH_API_KEY` and the existing `BRAVE_SEARCH_MICRO_USD_PER_CALL` fee. Managed admission, ledger accounting and unknown-outcome behavior are unchanged. New providers have no operator-key environment variables or managed rate cards in this release.

The connection Test action checks credential configuration without calling a search endpoint. Its result is explicitly unknown until authenticated execution validates the credential; it does not establish quota, balance or provider availability.

## Search behavior and provider profiles

The tool accepts a query of 1–400 characters and an optional count of 1–10 (default five). Results have titles, URLs and descriptions/excerpts. Excerpts are bounded to 4,000 characters per result. Provider-specific response fields are discarded. Returned web content remains untrusted.

| Provider ID | Public API and authentication                                                                                        | Fixed request profile                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `brave`     | [GET web search](https://api-dashboard.search.brave.com/documentation/guides/authentication), `X-Subscription-Token` | Query/count, moderate safe search                                                    |
| `exa`       | [POST search](https://exa.ai/docs/reference/search-api-guide-for-coding-agents), `x-api-key`                         | `auto`, requested result count, `contents.highlights: true`; no answer synthesis     |
| `tavily`    | [POST search](https://docs.tavily.com/documentation/api-reference/endpoint/search), bearer key                       | Basic general search; automatic parameters, answers, raw content and images disabled |
| `parallel`  | [POST v1/search](https://docs.parallel.ai/api-reference/search/search), `x-api-key`                                  | Basic mode, one search query, total excerpt budget proportional to count             |
| `firecrawl` | [POST v2/search](https://docs.firecrawl.dev/api-reference/endpoint/search), bearer key                               | Web results only; no scrape options; 15-second provider timeout                      |

Parallel V1 does not expose a result-count parameter. The adapter bounds upstream excerpt volume and returns at most the requested count locally. Every provider may return fewer results than requested. This search tool does not promise full page extraction, image search, crawling, research agents or advanced provider options; those remain separate MCP capabilities when configured.

## Boundaries and failure behavior

The domain owns the search contract and credential/funding policy; adapters own HTTP serialization and response normalization. The [shared catalog](../../../packages/contracts/search.ts), [domain service](../../../packages/core/src/search.ts), [provider adapters](../../../packages/providers/src/search.ts), and [tool broker](../../../packages/core/src/tool-broker.ts) are the implementation entry points.

Requests use fixed reviewed HTTPS endpoints, the existing public-network transport, redirect rejection and a 2 MiB response cap. Brave retains its 15-second transport timeout; new providers use 30 seconds, shortened to the run's remaining execution deadline. Permission, cancellation and run-generation checks happen at tool admission. A cancellation after an external request starts cannot undo provider work or charges.

Malformed JSON/result envelopes, non-HTTP(S) result URLs and URLs with embedded username/password credentials fail explicitly. HTTP/provider errors do not expose upstream response bodies or credentials. There are no automatic provider retries or provider fallbacks: timeouts and connection loss may still consume credits. The broker records ambiguous dispatches as unknown and rejects blind replay; a completed invocation reuses its stored result for the same call identity. Detailed run history records tool calls through the existing system.

## API usage

Create a connection with `POST /v1/connections` using a credential with `connections:write`:

```json
{
  "name": "Research search",
  "kind": "search",
  "provider": "exa",
  "auth_method": "api_key",
  "secret": "YOUR_PROVIDER_API_KEY"
}
```

Substitute `brave`, `tavily`, `parallel`, or `firecrawl` as needed. Discover tools through `GET /v1/connections/{id}/tools`, update the versioned grants through `PUT /v1/connections/{id}/grants`, then include that connection and `web_search` in the run's `connection_grants`. The [API contract](../../api/openapi.json) and [API guide](../api/README.md) define scopes, grant subjects and request fields. Existing Brave connections and run configurations remain compatible; no database migration is required.

## Integration details

[Connection and grant contracts](../api/README.md) apply to every search provider. Self-hosted operators configure provider access using [provider integrations](../../operations/launch-integrations.md).
