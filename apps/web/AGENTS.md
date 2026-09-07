<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Application-specific rules

Follow [root instructions](../../AGENTS.md), [web application rules](../../.agents/rules/web.md), and [TypeScript rules](../../.agents/rules/typescript.md). HTTP/auth/provider changes also use [integration rules](../../.agents/rules/integrations.md); Workflow/dispatch changes use [state and execution rules](../../.agents/rules/state-and-execution.md).

For version-matched framework guidance, locate these files beneath `apps/web/node_modules/next/dist/docs/`:

- Components: `01-app/01-getting-started/05-server-and-client-components.md`.
- Data access and authorization: `01-app/02-guides/data-security.md`.
- Fetching and caching: `01-app/01-getting-started/06-fetching-data.md` and `08-caching.md` in the same folder.
- HTTP routes: `01-app/01-getting-started/15-route-handlers.md`.

Read only the relevant guides. If package updates move them, locate their new paths; do not use stale framework APIs from memory. Preserve the generated instruction block above.
