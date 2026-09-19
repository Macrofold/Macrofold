# Use Macrofold from your coding agent

Connect Claude Code, Codex, or another MCP client to your Macrofold account. Your local agent can configure workspaces and worktrees, inspect team presets, connect approved tools, start cloud runs, and retrieve their results and saved files.

This is another interface to the existing platform API. Runs, permissions, connector access, budgets, and billing behave the same as requests from your application. Customer-agent operations remain an optional [integration path](../customer-agents/README.md).

## Connect Codex

Run in your terminal:

```sh
codex mcp add macrofold --url https://app.macrofold.ai/mcp
codex mcp login macrofold --scopes identity:read,workspaces:read,workspaces:write,files:read,files:write,runs:read,runs:write,connections:read,connections:write,usage:read,offline_access
```

This initial scope set supports workspaces, presets, connections, files and runs. Explicit scopes prevent clients from requesting the separate operator scopes advertised by the shared authorization server. Complete sign-in and review the requested access in your browser. The configuration is shared by Codex CLI and desktop through your user configuration. Reload the client if a conversation already has its tool list loaded.

## Connect Claude Code

```sh
claude mcp add --transport http --scope user macrofold https://app.macrofold.ai/mcp
```

Open Claude Code, run `/mcp`, select Macrofold and authenticate. For other clients, choose a remote HTTP MCP server with the same URL and OAuth authentication. For self-hosting, replace `https://app.macrofold.ai` with your own HTTPS origin.

## Try a shared agent

Paste this into your coding agent:

```text
Use the Macrofold MCP to show my organizations, workspaces, and saved agent presets.
Find the preset and workspace that fit a short repository review. Show me the chosen
agent, connector access and maximum budget before starting paid work.
After I approve, start one cloud run, retain its run ID, and return the final
response and links to any generated files. Do not create a duplicate if a request
is slow or times out.
```

The agent should begin with `getIdentity`, then `listWorkspaces` and `listAgents`. Starting a run returns an ID immediately. `getRun`, `getRunResult`, and `listRunEvents` show progress; `continueSession` reuses the conversation and files. A shared preset supplies its configured instructions, harness, model, and permitted connections. Discover available models and harnesses rather than guessing names.

## Scope access when needed

OAuth still applies your current organization role. Add the required customer scopes when signing in for additional account, schedule, key-management or billing operations; the [API reference](../../api/openapi.json) lists each operation’s requirements. A restricted API key is useful for an automated client or access limited to specific workspaces. Create it in **API keys**, select the smallest useful preset, and keep it in the client's secret/environment store—not in a prompt or source file.

For Codex, an environment-backed key configuration is:

```sh
# Set MACROFOLD_API_KEY securely in the environment that launches Codex.
codex mcp add macrofold --url https://app.macrofold.ai/mcp --bearer-token-env-var MACROFOLD_API_KEY
```

For multiple organizations, supply the discovered `organization_id` to tools. OAuth access can be revoked from **Account → Connected applications**; API keys can be revoked from **API keys**. Revocation is rechecked before later model and connector actions in accepted runs.

## Files and long-running work

- Tool names match [REST operation IDs](../../api/openapi.json). Path/query/header arguments are at the top level; JSON request fields are inside `body`.
- Every mutation requires an `idempotency_key`. Generate a new UUID for a new action and retain the same key and arguments for uncertain retries.
- Runs and file/Git operations may return `run_id` or `operation_id` before completing. Check that operation rather than starting a replacement.
- Small file reads/writes support UTF-8 or base64, up to 64 KiB through MCP. For larger files, use `createTransfer`/`getTransfer`, transfer bytes directly through the returned short-lived URLs, and `applyTransfer` for uploads. Use `listArtifacts`/`downloadArtifact` for generated deliverables. Never paste large base64 content into a conversation.
- Follow pagination cursors. There are 50 tools per discovery page; the client must follow `nextCursor`. Resource lists use the API's `next_cursor`.
- OAuth connector consent and billing checkout return browser links. Your local agent cannot complete a person's consent or payment steps on their behalf.

The customer MCP covers customer REST operations except SSE transports, which have durable paginated event equivalents. Identity-provider protocol routes, internal runtime endpoints, and the separate read-only operator MCP are not customer tools. API scopes and server-side checks—not tool annotations—authorize access.

For implementation, protocol compatibility, and testing boundaries, see [MCP architecture](implementation.md).
