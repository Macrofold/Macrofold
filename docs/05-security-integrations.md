# Identity, security and integrations

The detailed broker, OAuth, web-search, stdio and upload procedures are in [19-tools-and-security.md](19-tools-and-security.md). This document defines the common authority and data boundaries.

## Identity and authorization

Better Auth owns email/password registration, verified email, reset, browser sessions, TOTP/recovery codes, optional GitHub social sign-in and OAuth. The domain owns organizations, owner/admin/member/viewer memberships, invitations and scoped API keys. Avoid two competing membership systems. Resend sends production mail; Mailpit captures local mail. No account-provider/model call is needed for the fixture profile.

The auth service initializes once per module instance on first use. Importing route handlers or scope definitions during a build does not connect to PostgreSQL or seed OAuth resources. Authentication requests and administrative migration tools retain the same typed Better Auth API and database requirements; see [deployment configuration](22-deployment.md).

Browser cookies are provider-managed Secure/HttpOnly/SameSite in production. Mutations check the exact configured Origin. The dashboard exposes profile/password, MFA, sessions/devices, connected OAuth applications, team invitations/roles and organization selection. Password changes can revoke other sessions. App revocation removes both access and refresh authority. The configured operator allowlist is server-side, not a user-selectable role.

An API key is generated with high-entropy randomness, shown once, stored by hash with prefix, scopes, optional projects, expiry and revocation. It cannot exceed its creator's effective authority. Keys belong to one organization; `X-Organization-Id` cannot redirect one into another. OAuth tokens select only current memberships. The browser's active-organization cookie is a selector and is reauthorized on every request. Switching reloads caches to prevent showing the prior organization as current.

Owner changes serialize and preserve at least one owner. Admins manage members/viewers; owners control ownership. Invitations bind a verified email, expire after seven days, are single-use and require current inviter authority. Links are created for explicit sharing rather than automatically emailing someone. Removal/demotion revokes relevant keys and requests cancellation of ongoing work; future model/tool calls recheck authority. Tenant audit records expose access changes.

Tenant RLS and service-level ownership checks are both required. Nested resources and async operations carry organization/project/scope bindings. A raw resource ID or operation ID is never bearer access. Model/tool execution rechecks current actor, permission, run generation, deadline, cancellation and grants. A malicious MCP description, repository instruction or model response cannot modify any of those facts.

## OAuth, CLI and management agents

The CLI uses a public OAuth client and device approval, without embedded secrets. Profiles bind credentials to trusted origins and protect credential files; refresh is serialized and atomically replaces tokens. CLI default scopes exclude billing/key/connector mutation and all operator scopes. Expanded consent is explicit. Local linking is non-secret metadata and never an implicit upload or grant.

Opaque access tokens are introspected in-process through Better Auth's official API, then checked against issuer, exact resource audience, enabled client/resource grants and current identity. This costs a database read but enables actual revocation instead of accepting a still-valid signed token after disconnect. Accepted runs delegate through their own limited lifetime and current source authority; ordinary short access-token expiry is not a reason to replay a task.

Operator REST and MCP have separate `/admin/v1` and `/admin/mcp` resource audiences. Customer keys are rejected. Service clients are provisioned/rotated/disabled by a private operator script. Scope is read-only: metrics, operations, accounts, with contact PII separate. Reports expose fixed projections and never arbitrary SQL, prompts, files, tool output, provider secrets or infrastructure mutation. Operator access is audited and immutable to the runtime role.

## Secrets and funding

Authenticated versioned AES-GCM envelopes protect stored provider keys, OAuth refresh credentials, signed-capability payloads, webhook secrets and object content. The active key and retained decrypt keys live outside database/object backups. Rotation supports old decrypt/new encrypt, dry-run inventory, paused-writer rewrapping and an independent restore test. Losing every decrypt key loses content; changing `VAULT_KEY` alone is not rotation.

Long-lived model credentials remain in the control plane. The sandbox receives a short-lived run capability. The application gateway calls the reviewed provider directly with either an operator managed key or the exact selected customer BYOK key. There is no fallback across funding modes and no required Vercel AI Gateway account. Models/routes, maximum output bounds and token costs are validated before forwarding. Unsupported hosted tools/media cannot silently incur unmetered charges.

API access is the supported funding mechanism; consumer ChatGPT/Claude subscriptions are not pooled into a public SaaS. Native adapter licenses and provider terms remain separate from this application's Apache-2.0 license. Operators review the actual vendor distribution/use terms before publishing a runtime image or selling access.

## Connector choices

Composio is optional for its maintained OAuth/app-tool catalog. It complements Better Auth rather than replacing platform identity. The platform owns connected-account identity binding, explicit grants, tool versions and retail metering. Configuration requires a project key, auth configuration IDs, pinned toolkit versions and callback identity verification. A callback URL/account ID alone does not authenticate a connected account. The returning owner, pending attempt and verified provider response must match.

Direct MCP uses the official SDK for Streamable HTTP, discovery, PKCE, supported dynamic client registration or preconfigured clients and refresh. The callback binds browser/user/organization/connection and is single-use. Refresh is serialized; rotated credentials survive a later tool error. Issuer/endpoints stay pinned while credentials exist. To change service identity, create a new connection rather than forwarding old credentials to an edited URL.

Users create a connection, authorize it, discover/test tools, choose grants and attach a subset to a run/preset. New tools are not automatically granted. Remote bearer/no-auth endpoints work independently of Composio. Incoming platform tokens are never forwarded upstream. Arbitrary custom request headers are not a supported escape hatch around the broker.

Approved stdio packages execute inside the already allocated customer's sandbox, never as an API-host child process. The operator catalog pins executable/argv/version/tool schema. Stdio credentials intentionally become visible to that customer's sandbox process tree; the dashboard explains that scope. Built-in discovery reads the catalog; invocation uses a protected runtime marker and central invocation journal to avoid blind replay after ambiguous dispatch.

Disconnect immediately clears platform grants. Durable cleanup separately deletes the Composio account or invokes supported MCP revocation. Unsupported revocation and provider API keys need explicit upstream revocation if the user intends to invalidate them everywhere. No background health check calls paid tools merely to color a dashboard badge: test/discovery and actual runtime outcomes supply status, and external setup still requires operator verification.

## Network, files and external effects

Use a public-HTTPS-only DNS-pinned network helper for user-configured remote endpoints, with private/reserved IP rejection, bounded request/response sizes and deadlines. Redirects do not silently forward credentials or bypass destination policy. GitHub smart HTTP is bound to the authorized repository endpoints. Webhook signature validation consumes exact raw bytes, not reserialized JSON.

Sandbox shell/file tools can affect the customer's own filesystem and allowed network services. Runtime egress policy is an independent provider-enforced boundary. A microVM, not a directory/worktree on a shared privileged worker, isolates untrusted code. The supervisor's control directory is inaccessible to the agent UID. Captures exclude sockets/devices and reject traversal/symlink ancestors. Customer HTML never runs as a same-origin preview.

Brave search is an explicitly budgeted broker tool. A configured key is not a free validation call; actual search can cost money. Results remain untrusted tool data. Full browser automation is an optional reviewed extension; the initial runtime is a shell/files/search product, not a browser desktop.

GitHub App authorization verifies current user repository permission and selected installation scope. Revocation events block queued sync; clean integration uses no force push. A successful tool or push may have an irreversible external effect: transport retries are not permission to repeat it. Native processes record ambiguous results and preserve work rather than claiming exactly-once execution.

## Launch controls and limitations

Production requires HTTPS, independent auth/vault secrets, restricted database login, private object storage, email configuration, an immutable runtime image and configured maintenance. Paid execution starts disabled. Set the global active-run limit, tenant limits, provider spending limits and hosting-edge abuse protection before inviting users. These controls have separate purposes; no one limit replaces the others.

Project deletion has explicit recent-auth confirmation, seven-day undo and delayed collection. Account closure is initially operator-assisted because subscriptions, ownership transfer, financial retention and external revocation require coordinated decisions. The launch guide specifies the closure procedure and requires a real support channel; there is no misleading one-click erase-everywhere button. Public privacy/terms/retention and vendor account approvals are operator-owned publication inputs.

Authentication throttling uses Better Auth's PostgreSQL storage in production, so replicas share counters. The unpaid local profile explicitly bypasses this login throttle while retaining domain API limits and MFA account lockout. Expired auth counters are collected after one day. Deploy behind an edge that overwrites client-IP headers; untrusted forwarded headers cannot be a reliable abuse boundary.
