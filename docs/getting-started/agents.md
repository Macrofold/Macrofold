# Read with an agent

Use the same documentation as a human reader, with plain Markdown and explicit contracts for reliable retrieval.

## On a deployed site

- `/llms.txt` lists the public guides, descriptions, and Markdown URLs.
- `/llms-full.txt` contains all published guides in one text response.
- Each guide has a **View Markdown** link and a **Copy page** action.
- `/openapi.json` describes customer REST operations, schemas, scopes, and errors.
- `/docs/search-index.json` contains the public documentation search index.
- `/sitemap.xml` lists canonical public HTML pages.

These resources require no login and contain documentation only. They do not grant access to projects, customer records, or operator tools. Use scoped API credentials for application operations.

## In a checkout

Start with [the documentation index](../README.md), then select a feature. [The codebase map](../architecture/codebase.md) identifies source ownership. [OpenAPI](../api/openapi.json), [CLI commands](../api/cli.json), and [admin MCP tools](../api/admin-mcp.json) are machine-readable references.

Read [AGENTS.md](../../AGENTS.md) before editing. It points to the repository's required coding and documentation rules; public API guides are not a replacement for contributor instructions.

## Choose the smallest useful context

Read a feature overview first, then its linked API or implementation details. Use stable page and heading links when citing behavior. For deployed limits and model choices, query the authorized API: documentation defaults do not override the account's effective policy or model catalog.

`llms.txt` is a discovery convention. It does not guarantee adoption by every agent or inclusion in search results.
