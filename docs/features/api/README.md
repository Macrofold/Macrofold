# API overview

Give an agent a task and get back its response and saved files. The API, SDKs, and CLI work with **Macrofold Cloud and self-hosted deployments** using the same resource methods.

Start with the [API quickstart](quickstart.md), or give your coding agent the [setup prompt](../../getting-started/agents.md).

## Connect once

Create a key in your dashboard's **API keys** page. Store it in your server environment as `MACROFOLD_API_KEY`.

SDKs default to `https://app.macrofold.ai`. For a self-hosted, local, or staging deployment, set the client's base URL to that deployment's origin, without `/v1`. Use a key created on the same deployment. See [Cloud setup](../../cloud/README.md) or [self-hosting](../../operations/README.md).

## Three steps

| Step                        | SDK operation                           | Result                                 |
| --------------------------- | --------------------------------------- | -------------------------------------- |
| Choose a home for the files | `workspaces.create`                       | A workspace you can reuse                |
| Give the agent a task       | `runs.create`                           | An accepted run ID                     |
| Get the finished work       | `runs.wait`, then `worktrees.readFile` | Response text and persisted file bytes |

Method spelling follows each language's conventions. Use `streamText` / `stream_text` when you want text as it arrives, or `events` for tool activity and structured progress. [Choose a language](sdks/README.md).

## Optional integration paths

The core API exposes reusable workspaces, worktrees, presets, sessions, runs and connections. **Integration paths** package those capabilities for a particular use case without replacing them. [Customer agents](../customer-agents/README.md) adds customer ownership resolution, atomic setup and embedded connection consent under `/v1/integration-paths/customer-agents`. Choose it when each app customer needs an assistant; use the core API directly for a different resource layout. OpenAPI marks these operations with `x-platform-layer: integration-path` and the `customerAgents` tag.

## Build on it

- [Share files between agents](../workspaces/shared-agents.md) or [continue a conversation](../execution/README.md).
- [Choose a harness](../execution/harnesses.md): the Unified Harness Interface keeps run operations consistent across native agents.
- [Read saved files](../workspaces/read-files.md) and [connect GitHub](../workspaces/README.md#connect-github).
- [Connect tools and model accounts](../identity-integrations/README.md).
- [Start runs from Slack, webhooks, or schedules](../triggers/README.md).

## Reference when you need it

[Authentication, errors, retries, and pagination](conventions.md) · [Streaming and webhooks](events.md) · [HTTP quickstart](http-quickstart.md) · [All SDK methods](sdks/reference.md) · [OpenAPI](../../api/openapi.json)

The interactive API reference is available at `/reference` on your deployment. Keep API keys on your server; authorize your application's users before submitting work on their behalf.

Use [the customer MCP](../mcp/README.md) to access the same operations from Codex or Claude Code.
