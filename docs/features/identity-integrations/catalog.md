# Connector directory

Find an application, connect an account, and grant the agent the tools it needs. Macrofold supports a public application catalog through Composio, native model and search integrations, repository synchronization, and custom MCP servers.

## Choose a connection

1. Browse the searchable directory below, or give an agent the [complete public catalog](https://app.macrofold.ai/docs/connectors/catalog.json).
2. Open **Connections** in the dashboard and select the application.
3. Authenticate your account, then grant the connection to the session that needs it.

Catalog inclusion describes available integration metadata. Your deployment must enable the app and configure its authentication before you can connect it. A catalog entry does not authorize an agent, establish a connection, or guarantee access to every upstream action.

## Native integrations

Native integrations include Anthropic, OpenAI, and OpenRouter model keys; Brave, Exa, Tavily, Parallel AI, and Firecrawl search; GitHub repository synchronization; and remote or command-based MCP servers. Custom MCP servers can expose additional tools, including database access.

See [connections and permissions](README.md) for setup and grants, and [persistent workspaces](../workspaces/README.md) for repository synchronization. Harnesses and model providers are distinct: choose a model compatible with the selected harness.

## Application catalog

The directory includes every application in the bundled Composio catalog snapshot, with descriptions, tool counts, and links to upstream toolkit documentation. Search by name, capability, or category. The public export includes the source and snapshot timestamp, all application entries, and native integrations. It contains no customer account information or credentials.

The catalog is updated with application releases. The dashboard can refresh metadata from the provider when configured; public documentation uses the bundled snapshot so it remains available without an account or provider call. Availability and tool counts can change upstream.

## Connect an agent's tools

A connection belongs to its authenticated owner. Grant only the tools needed by a task; another member's connection is not automatically available. Approval, authentication, and authorization still apply even when a toolkit appears in this directory.

Continue with the [API quickstart](../api/quickstart.md) or the [connector configuration guide](connectors.md).
