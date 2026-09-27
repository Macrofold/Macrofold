# Local MCP development

## Accepted scope

Allow operator-configured local MCP origins only when the existing `isLocal()` gate passes. Keep public HTTPS requirements for hosted deployments and unrelated outbound requests. No API schema or SDK changes.

## Implementation plan

1. Share the DNS-pinned, bounded transport while exposing separate public and MCP policies. Parse `LOCAL_MCP_ALLOWED_ORIGINS` as exact HTTP/HTTPS origins, with no credentials, paths, queries or fragments. Allowed local destinations must resolve entirely to loopback, private IPv4 or unique-local IPv6 addresses; metadata/link-local/reserved destinations remain denied.
2. Apply MCP policy during connection validation, discovery, calls and MCP OAuth discovery/authorization/refresh/revocation. Preserve existing owner, token and tool-grant checks.
3. Document local setup and restart requirements, including separate OAuth origins and container addressing. Keep local configuration opt-in; do not change the developer environment automatically.
4. Verify public-policy isolation, malformed/unlisted origins, local-mode gates, DNS pinning and redirects with focused tests. Exercise a real loopback MCP server through connection save, discovery and invocation, then run TypeScript and documentation checks.

## Decisions

Reuse the existing network transport rather than adding a proxy or tunnel. The allowlist grants access to an origin, not individual paths, because MCP and OAuth use multiple paths. It is operator authority, never request input. Public HTTPS destinations continue through the existing public policy. Local HTTP is appropriate only for explicitly trusted development services.

## Completion

Implemented. All 69 focused network, loopback MCP, OAuth, broker and webhook checks passed using disposable local fixtures. The actual loopback server received authenticated discovery and tool requests; removing the allowance blocked subsequent requests. TypeScript checking and the application TypeScript SDK build passed. This is local protocol evidence, not an OpenLegend deployment or native-agent acceptance run. Current behavior belongs in [tool security](../features/identity-integrations/tools-security.md); tracked in [maintainer work](../maintainers/TODO.md#local-mcp-development).
