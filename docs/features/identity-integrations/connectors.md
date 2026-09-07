# Connector discovery and setup

Connections opens a large app browser with category navigation, an All category, local search, and three columns of logo cards. Results render in batches as the user scrolls; all catalog entries remain searchable. Smaller screens use two columns and horizontally scrollable categories. Selecting an app opens its setup form. Returning to the catalog preserves filters and focuses search. Model keys, remote MCP, sandbox MCP and [web search providers](web-search.md) retain their existing setup and explicit permission flows.

Discovery and authorization are separate. Apps that the operator has not enabled remain discoverable. Their setup forms explain that an administrator must enable them before authorization; saving a pending connection remains allowed. Catalog data cannot grant tools, create upstream accounts or change spending limits.

## Architecture and API

The additive `GET /v1/connector-catalog` endpoint uses existing authentication, organization selection, `connections:read`, response projection, rate limiting and request accounting. OpenAPI and generated SDK routes include the operation. It returns the complete bounded metadata index (`data`, `source`, `updated_at`); there is no customer-resource pagination. The browser searches locally and progressively renders batches of 48 cards. It does not fetch tool schemas or connected accounts for discovery.

The domain owns the catalog contract and configuration-readiness projection. The provider adapter uses the pinned Composio SDK's raw `toolkits.list` client because the high-level helper discards pagination. Every page of native Composio-managed toolkits must complete. A refresh is bounded to 15 seconds, 100 pages, 10,000 entries and 8 MiB of normalized metadata. Repeated cursors, duplicate app identifiers and incomplete responses fail the refresh.

Each server instance shares an in-flight request and caches a successful result for one hour. Failures preserve the last complete result and back off for five minutes. Without `COMPOSIO_API_KEY`, the adapter immediately returns the bundled public snapshot. No connected-account or tool execution endpoint is called to populate the catalog. Multi-instance deployments have independent metadata caches; add shared caching only if measured volume warrants it.

The bundled snapshot contains **1,467 public connectors**, obtained from Composio's MIT-licensed documentation data on September 6, 2026. It includes names, descriptions, categories, tool counts and logo URLs. Its source revision/timestamp are recorded in the JSON and the upstream license accompanies it. This complete published snapshot is a fallback, not proof that every app is configured or live-tested.

Run `pnpm connectors:refresh` before release to refresh the snapshot from Composio's public repository. The script loads no credentials and makes no account or tool requests. Review the metadata diff, rerun the catalog checks and deploy. Runtime refresh uses authenticated metadata requests when the operator key is configured.

Readiness is computed after metadata caching: the operator key, callback-verification flag, app auth-config mapping and explicit toolkit version pin must all be present for `connectable: true`. Only that boolean is returned. Auth-config IDs and keys stay server-side. Readiness does not establish OAuth success, provider scope approval, billing setup or authenticated execution.

## Images and accessibility

App images use Composio's logo CDN with validated slugs, lazy loading, fixed dimensions, no referrer, and a text fallback on failure. Arbitrary upstream image origins are not fetched. SVGs render as isolated images, never injected markup. Local provider marks and attribution are in `apps/web/public/brands`.

The existing Radix dialog supplies focus trapping, Escape dismissal and accessible title/description. Results scroll independently of the modal header and categories. Search, empty, loading and retry states are explicit. Styles load with the root layout to avoid an unstyled modal during lazy component loading. Transitions respect reduced motion.

## Related guides

See [connections and access](README.md), [provider setup](../../operations/launch-integrations.md), and the [API guide](../api/README.md).
