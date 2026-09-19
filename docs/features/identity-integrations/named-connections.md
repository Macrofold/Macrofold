# Named connections

Connect each account separately and give it a recognizable name, such as **Gmail Research**, **Slack Engineering**, or **Anthropic Coding**. Each connection has its own permanent ID, owner, status, and tool permissions.

## Connect and select an account

1. Open **Connections → Add connection** and choose the integration.
2. Name the account and complete its authorization. Repeat for another account of the same integration.
3. Approve tools under **Tools**, then add rules under **Access**. Presets and runs can inherit eligible connections, select specific tools, or explicitly choose none. See [connector access rules](connection-access.md).

**Edit** changes the display name without changing its ID. The account identifier shown on an authorized app connection is Composio's verified connected-account ID; it is not an inferred email address. Connecting another account never changes an existing agent's selection. Reconnect targets the same provider account. To switch to another account, create another connection and explicitly select it.

Connections belong to their authorizing user. Tool access can target the organization, a workspace, a preset, or an exact workspace + preset pair; model keys and Claude subscription configurations remain owner-bound. Disconnect removes local authority immediately. Upstream revocation can require a separate provider action; see [connection security](implementation.md).

## Save authentication in a preset

An agent preset saves its harness, model, funding mode, provider connection, instructions, and optional tool-selection defaults. The dashboard preset editor lets you choose a named API-key connection. API and SDK clients use `provider_connection_id` for model authentication and `connection_grants` for app tools.

For example, using an existing Anthropic API-key connection:

```python
from macrofold import Macrofold

macrofold = Macrofold()
preset = macrofold.agents.create(
    name="Coding",
    harness="claude-code",
    model="YOUR_ENABLED_ANTHROPIC_MODEL",
    billing_mode="byok",
    provider_connection_id="YOUR_ANTHROPIC_CONNECTION_ID",
)
run = macrofold.runs.create(
    workspace_id="YOUR_WORKSPACE_ID",
    agent_id=preset.id,
    prompt="Update the workspace notes.",
)
for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)
macrofold.close()
```

From a linked terminal directory, use `macrofold run "Update the workspace notes." --agent AGENT_ID`. The preset supplies authentication and limits. Explicit timeout/budget flags override only the corresponding limit. Use a new session when changing authentication; continuing an existing session keeps its original configuration.

TypeScript, Python, Go, Rust, and Java expose the same generated connection and preset fields. See [SDKs](../api/sdks/README.md) and the [API reference](../api/README.md).

Local simulation can select an owned API-key connection to exercise this journey without reading or sending its key. Native execution requires a model from that key's provider; a simulation preset must select a compatible enabled model before switching to native execution.

## Claude subscription availability

You can save multiple named **Claude subscription configurations**, such as Research, Coding, and Personal, and reference them from Claude Code presets using `billing_mode="subscription"`. These configurations are **not authenticated accounts**: subscription login and execution are currently unavailable. They stay pending and do not collect Claude login tokens or credential files. Anthropic API-key execution remains available through the existing Claude Code harness.

This gate applies to every invocation surface, including simulation. A rejected subscription run does not start a sandbox, reserve funds, or silently use an API key. The [maintainer acceptance record](../../engineering/testing/named-connections.md) distinguishes implemented configuration from the remaining authentication/runtime work.

### Optional backup policy

In a Claude configuration's **Edit** dialog, you can save an owned Anthropic API-key connection and a positive **per-run API spending limit**. The default is disabled. This policy remains inactive while subscription execution is unavailable.

The API field is `api_fallback`: set `enabled` to `true` with `connection_id` and `max_cost_micro_usd`, or set `enabled` to `false` to clear the selection. One million micro-USD equals $1. Omitting the field during an edit preserves its current setting.

The policy permits paid fallback only for confirmed quota exhaustion before native execution starts. Unknown quota, ordinary authentication errors, temporary failures, and ambiguous launches do not authorize spending. After execution starts, quota exhaustion requires an explicit continuation over preserved files/history; the original prompt must not be restarted automatically. Infrastructure charges are separate from any API fallback allowance.

## Related guides

- [Connections and access](README.md)
- [Composio configuration](composio.md)
- [Persistent files and sessions](../workspaces/README.md)
- [Billing and budgets](../billing/README.md)
