# Connector access rules

Use **Connections → Tools** to approve a connection's maximum tool set, then **Access** to choose where it can be used. Completing provider authorization does not grant an agent access. New tool connections have no approved tools and no access rules.

These controls apply to application, remote MCP, approved sandbox MCP, and search connections. Model API keys and subscription configurations keep their separate owner and funding checks.

## Choose where access applies

**Available across the organization** allows the approved tools in any authorized workspace. Turning it off preserves the rules below it. Rules are additive: any matching rule allows access.

| Permission | Matches |
| --- | --- |
| Workspace | That workspace, with any preset or custom configuration |
| Agent preset | That exact preset, in any authorized workspace |
| Workspace + agent preset | Both targets together |

For example, **Sales + Writer** and **Support + Researcher** do not allow **Sales + Researcher**. A custom run has no preset identity. Copying a preset creates a new identity and does not copy rules targeting the original. Deleted targets stop matching; the owner can still remove their unavailable rule rows.

Only the connection's owner with `connections:write` and an owner/admin membership can broaden access or approve new tools. Other administrators cannot take over a connection's credentials or permissions. The owner can remove access after demotion if they still have write authority. Workspace-restricted credentials can grant only within their authorized workspaces; organization and preset-only grants require unrestricted workspace authority. Reading full access settings and rules requires `connections:read`; mutations require `connections:write`. Other users see a safe effective-access summary, not credential metadata or the owner's complete rules.

## Choose tools for a run

Tool selection narrows permission; it does not grant permission. The dashboard offers **Inherit**, **Select specific tools**, and **No tools**. The server resolves selections in this order:

1. An explicit run or message selection, including an empty list.
2. An explicit session or preset default, including an empty list.
3. All connections eligible for the actual workspace and preset.

New presets inherit unless you choose otherwise. An omitted `connection_grants` field preserves an existing preset default during PATCH. `[]` means no tools. `null` on **preset PATCH only** removes the default and restores inheritance. Run/message requests reject `null`. A run's explicit selection is not saved as a new session default.

The access preview shows unavailable connections, unapproved tools, and other rejection reasons without contacting providers or starting a run. It is advisory: admission validates the entire selection again, independently of preview pagination. One run supports at most 100 connections and 256 tools; choose a smaller explicit selection if automatic selection exceeds these limits.

## Allow an exception for one run

The connection owner can explicitly supply `connection_access_overrides` on a run or session message when they have connection-write, run-write, and workspace authority. Each item identifies a connection and approved tools. The exception does not change saved rules, session defaults, or preset defaults. It cannot add tools above the approved ceiling, override native tool restrictions, or change funding/account checks.

The server records who authorized the exception. Revoking that actor's delegated write permission, removing their membership, disconnecting the connection, or removing a tool blocks subsequent calls. An accepted OAuth run is not invalidated merely by ordinary access-token expiry or rotation. Triggers never accept inbound exceptions and always resolve their saved preset in the configured workspace.

## Browse and inspect

Connections can be filtered by workspace, preset, or both. With one filter, **Requires preset** or **Requires workspace** names the remaining target condition. Both filters test the exact combination. Unfiltered browsing includes listable connections with no access. A matching connection may still need authorization or tool approval.

Effective summaries contain authorized matching counts, scope kinds, and at most three representative rules. Each representative carries `rule_id`, scope, and authorized targets; pair representatives include both IDs. They do not expose rules in inaccessible workspaces. Workspace and preset detail responses add connections only with `include_connections=true`; the expansion has its own cursor and does not change the parent's revision.

## API and concurrency

| Operation | Endpoint |
| --- | --- |
| Read or change the tool ceiling and organization toggle | `GET` / `PATCH /v1/connections/{id}/access` |
| List or create rules | `GET` / `POST /v1/connections/{id}/access/rules` |
| Change or delete a rule | `PATCH` / `DELETE /v1/connections/{id}/access/rules/{rule_id}` |
| Preview persisted access | `POST /v1/connection-access/resolve` |

Every access mutation requires an `If-Match` header containing the quoted access version, for example `"3"`. Tools, the organization toggle, and rule edits share this version. A stale edit returns **412**; refresh, review the retained draft against current state, and explicitly retry. Duplicate rules return **409**; invalid shapes return **400**. Mutations return the new version and ETag, including deletion and idempotent replay. Renaming or refreshing credentials does not change the access version.

Rule listing supports `workspace_id`, `agent_id`, `sort=workspace|agent|created_at`, `direction=asc|desc`, and `limit` (25 by default, 100 maximum). Cursors are bound to identity, context, and filters. Reset pagination when changing filters. Repeating a scalar query parameter is an error.

Resolve accepts exactly one of `workspace_id`, `worktree_id`, or `session_id`. `worktree_id` is the API name for a worktree. An optional `agent_id` applies to new-session contexts; an existing session retains its verified preset identity. Preview requires connection-read plus the relevant workspace/run read scope and never creates a missing default worktree.

Using the TypeScript SDK with existing IDs:

```ts
const current = await client.connections.getAccess(connectionId);
const approved = await client.connections.updateAccess(connectionId, {
  tools: [toolName], ifMatch: `"${current.version}"`,
});
await client.connections.createAccessRule(connectionId, {
  scope: 'workspace_agent', workspace_id: workspaceId, agent_id: agentId,
  ifMatch: `"${approved.version}"`,
});
const preview = await client.connections.resolveAccess({
  workspace_id: workspaceId, agent_id: agentId,
});
```

Python rule mutations take an `input` discriminated object and `if_match` keyword. For preset reset, Python uses `connection_grants=None`; Go uses `SetConnectionGrants(nil)` (and `UnsetConnectionGrants()` for omission); Rust uses `Some(None)`; Java uses `setConnectionGrants(null)` through its nullable wrapper. Empty lists are explicit “no tools” in all five SDKs. See the [method reference](../api/sdks/reference.md).

## Enforcement during execution

Admission freezes exact connection IDs, allowed tools, provider account identity, the access version and a representative source. Later policy changes can reduce this maximum but cannot expand it. Any currently matching rule can maintain access, even if the original representative rule was removed. Newly discovered or newly approved tools require a new run to become available.

Tool listing, invocation checks, and final dispatch use the same predicate. Revocation committed before dispatch prevents the provider call and its fee. Once dispatch has committed, its result or unknown-outcome record remains durable; revocation cannot undo an external side effect. The broker preserves the original authorizing owner and exact connected account, never substitutes credentials, and never blindly retries ambiguous actions.

See [agent permissions](../execution/permissions.md), [named accounts](named-connections.md), and the [implementation and activation guide](../../engineering/testing/connection-access.md).
