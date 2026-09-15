# Agent permissions

Configure `permissions` on a project, worktree or new run. This controls the agent's access; it does not change the human user's API-key scopes or grant a connection the user has not authorized. Project and worktree Settings expose the same editor as Advanced options in worktree creation and new runs.

```json
{
  "version": 1,
  "files": {
    "read": { "exclude": ["**/*.env", "secrets/**"] },
    "write": { "include": ["docs/**"], "exclude": ["docs/published/**"] }
  },
  "tools": { "exclude": ["**/SEND_EMAIL"] }
}
```

Patterns are case-sensitive, relative to the worktree, and support `*`, `**`, and `?`. Dotfiles participate in matching. Absolute paths, traversal, backslashes, negation, brace expansion and character classes are rejected. Omitted include lists inherit all access; an empty include list allows nothing. All layers must allow an action, and an exclusion at any layer wins. Writes additionally require read access. Tool patterns use `connection-ID/tool-name`; [connector access](../identity-integrations/connection-access.md) and the server-resolved frozen run selection remain mandatory. An omitted selection inherits current eligible tools; it does not bypass policy.

The server freezes the three permission layers at admission, before reserving funds, and returns them as `permission_layers` on the run. Stop pending project runs before editing project or worktree permissions. A session keeps its original policy, including its run-level restrictions; start a new session after changing that policy. This prevents a conversation that has already read protected content from being relabeled with narrower access.

## Harness support

Connector include/exclude rules apply to all six harnesses at broker discovery and again at dispatch. File read/write patterns and disabling shell also work with all six pinned runtimes:

| Harness | Native permission mapping | Checked file transport |
| --- | --- | --- |
| Codex | Named filesystem profile denies native worktree access (including `apply_patch`); shell, hooks, plugins, subagents and other execution extensions disabled | App-server dynamic tool |
| Claude Code | SDK tool allowlist, explicit builtin deny list, no project settings or additional MCP configuration | SDK MCP tool |
| OpenCode | Native default-deny permission map; only questions, checked files and authorized broker tools allowed; project configuration, LSP and formatters disabled | Loopback MCP |
| Hermes | Explicit native toolsets for clarification, checked files and authorized broker tools | Native registry handler forwarding to loopback MCP |
| DeepSeek | Minimal profile disables both shell dialects and the bare filesystem editor; native agent/session loop retained | Loopback MCP |
| Pi | Builtin tools disabled; explicit custom-tool allowlist | SDK custom tool |

Guarded runs expose the shared `worktree_files` implementation for listing, reading, writing, deleting files and creating folders. It validates paths and patterns, rejects symlinks and traversal, bounds content, and serializes file calls. Remote connector tools continue through the authorized broker. MCP file endpoints bind to loopback with a fresh per-worker credential and close with that worker; their addresses and credentials are never portable state.

**File restrictions disable shell access**, including when a child policy requests shell access. A general shell could bypass individual file checks. Unrestricted runs retain their normal native file and shell tools. Native glob languages and rule precedence differ, so the adapters do not flatten intersecting policies into approximations: native controls close alternate execution paths while the canonical evaluator decides each file operation. Codex's profile provides an additional native filesystem boundary rather than a second translation of our glob grammar. See [Codex filesystem profiles](https://learn.chatgpt.com/docs/permissions#filesystem-permissions) and [OpenCode permissions](https://opencode.ai/docs/permissions/).

Hermes' pinned generic MCP handler mistakes repeated tool errors for connection failures. Its file handler uses the official MCP client through the native tool registry, preserving denied results without disconnecting or retrying mutations. Other granted MCP tools continue through Hermes' normal discovery bridge.

Only permitted regular files are hydrated for a guarded run; excluded files, symlinks and Git history stay in durable storage. Checkpoint publication independently checks new, modified and deleted files against the frozen write policy, preserves omitted originals and rebuilds Git state from the original metadata. Forbidden output preserves the prior verified checkpoint. File policies do not redact text a user explicitly puts in a prompt or data returned by an independently granted remote connector.

## Extension points

The canonical policy schema and evaluator live in `packages/contracts/permissions.ts`; translation plans and extension transports live in `packages/contracts/permission-adapters.ts`. Concrete native settings live in `packages/runtime/src/permission-settings.ts` and the corresponding adapter; vendor types stay inside the runtime. Domain admission, editing and output verification live in `packages/core/src/agent-permissions.ts`. The runtime file implementation is shared by the native adapters, not duplicated per vendor. Operation-result authorization is a separate exhaustive registry in `packages/core/src/operations.ts`; adding an operation requires an explicit scope and resource binding.

Extend a native adapter only when its pinned version can enforce the policy without granting another path to the same capability. Unsupported native concepts must return a diagnostic; do not round-trip arbitrary native settings through a lossy generic dictionary. Claude's permission callbacks can be skipped by allow modes, and Codex documents hook coverage limitations, so approval callbacks alone are insufficient for universal file restrictions. [Claude SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [Codex hooks](https://learn.chatgpt.com/docs/hooks).

Tests use disposable filesystems, databases and scripted models. `pnpm test:native --permissions --image-only` exercises all six actual pinned harnesses with permitted edits, denied reads/writes, traversal and symlink attempts, disabled native tool calls, and replacement-runtime continuation. CI runs this matrix without external network access. Native paid execution and live cloud acceptance remain separate, opt-in checks; see [testing](../../engineering/testing.md).
