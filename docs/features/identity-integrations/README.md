# Connections and access

Give agents the model accounts, applications, and tools they need through named connections, approved tools, and access rules. Secrets stay in the server's encrypted credential store.

Browse the [public connector directory](catalog.md) for application toolkits and native integrations.

## Add a connection

Open **Connections**, select a provider or connection type, and complete its setup. Available applications depend on the deployment's registered integrations. A catalog entry describes an integration; it does not mean your account is connected.

You can add several accounts for the same integration. Each has a stable ID, editable name, independent status, and explicit grants. [Named connections](named-connections.md) explains account selection, presets, and the currently gated Claude subscription configurations.

| Connection      | Use it for                                                        |
| --------------- | ----------------------------------------------------------------- |
| Model provider  | Bring an OpenAI, Anthropic, or OpenRouter API key                 |
| Search provider | Search with Brave, Exa, Tavily, Parallel AI, or Firecrawl         |
| Application     | Authorize an app through Composio                                 |
| Remote MCP      | Use a permitted HTTP MCP server with its supported authentication |
| Sandbox MCP     | Run an operator-approved, pinned stdio tool package               |

## Bring your own model key

Create a provider connection, enter the secret in the protected form, and select it when starting a BYOK run. Use a model supported by both the provider and harness. Model charges go to your provider; compute and authorized tools can still use platform credits.

Keys are not exposed to native agents as long-lived credentials. Revocation prevents further authorized calls and never enables managed fallback. Rotate a key through its provider and update the connection when needed.

## Connect an application or MCP server

For an application, complete its account authorization and choose the permitted tools. For remote MCP, enter its endpoint and follow the authentication flow supported by that server. The deployment validates network destinations and can reject private or unsupported endpoints.

In **Tools**, approve the tool ceiling. In **Access**, enable organization access or add workspace, preset, or workspace + preset rules. A run inherits eligible connections unless an explicit selection narrows them. Ownership and provider authorization alone grant no runtime access. See [connector access rules](connection-access.md), including explicit one-run exceptions. Tool descriptions and workspace instructions do not change permissions. External tools can modify third-party systems, so inspect uncertain outcomes before retrying a write.

See [connector discovery](connectors.md), [web search](web-search.md), [Composio configuration](composio.md), and [tool security](tools-security.md).

## Accounts and teams

**Account & security** provides password, MFA, recovery codes, sessions, and OAuth application controls. **Team** manages owners, admins, members, viewers, and invitations. Invitations bind a verified email and expire after seven days; share the invitation link with its intended recipient.

Permissions combine current membership, credential scopes, workspace restrictions, ownership, and connection grants. An API key is shown once and bound to one organization. Ownership changes preserve at least one owner. Removal or demotion affects delegated credentials and ongoing work.

## Data and security boundaries

The dashboard reauthorizes the selected organization and clears its cached context when switching. Native model/tool calls recheck the current actor and grants. Account closure is operator-assisted because ownership, subscriptions, financial retention, and provider revocation require coordination.

Read [security architecture](implementation.md) for encryption, OAuth audiences, tenant isolation, and secret rotation.
