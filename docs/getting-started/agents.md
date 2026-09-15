# Build with AI

Give your coding agent a goal and the current Macrofold docs. It can add agent execution to your existing application using Cloud or your own deployment.

## Copy a setup prompt

Copy this prompt into the coding agent working in your application repository. Replace the first two lines. Use the **Copy setup prompt** action on the docs site to include direct documentation URLs.

```prompt
Feature to build: [Describe what the user should be able to do.]
Deployment: [Macrofold Cloud, or my self-hosted/local origin.]

Integrate Macrofold into this application. Inspect its framework and existing
patterns first; implement the smallest complete feature that fits them.

Read these current docs before choosing methods or installation commands:
- [API quickstart](../features/api/quickstart.md)
- [SDK installation and language guides](../features/api/sdks/README.md)
- [Core concepts](concepts.md)
- [API conventions and error recovery](../features/api/conventions.md)

Use a typed SDK for this application's language. Reuse its transport, retries,
idempotency, and stream helpers. Keep calls on the server. Read MACROFOLD_API_KEY
from the existing secret environment; never ask me to paste it into chat, print
it, commit it, or expose it to the browser. If missing, tell me exactly where
to configure it securely. Use an API key issued by the selected deployment.

First implement one project -> run -> completed result flow. Reuse project and
workspace IDs instead of creating new ones on every request. Use an enabled
model and an explicit run budget; ask before paid execution if no budget was
authorized. A local simulator run uses fixture-model and makes no model calls.

Use runs.wait for a complete result or the SDK's text-stream helper for live
text. Preserve the run ID for status/recovery and explicit cancellation.
Authorize this application's users before accessing their Macrofold resources.
Use stable idempotency keys for intended actions that may be retried across
requests. Never blindly restart a run with an uncertain outcome.

If the feature needs saved files or multiple agents, read:
- [Read persisted files](../features/workspaces/read-files.md)
- [Share a workspace between agents](../features/workspaces/shared-agents.md)
Wait for persistence before reading the new files or starting the next writer.
Two agents may take turns in one workspace; parallel writers need independent
workspaces and an explicit merge. Shared files do not share conversations.

Test the complete feature against free local simulation or deterministic
fixtures, including failure and recovery. Report what passed, any manual
setup, and any untested paid/cloud behavior. Do not overwrite this project's
existing instructions or replace its architecture with a new demo app.
```

## Give it access to the docs

A local coding agent can read the same checkout and localhost documentation as you. A remote agent cannot usually reach your laptop's `localhost`; give it an accessible documentation deployment or attach the Markdown files instead. Do not expose your local application just to share documentation.

Every page offers **Copy page** and **View Markdown**. Start with a guide and follow the links for the feature you need. Use the full reference only when the guide does not answer a specific question.

| Resource on your deployment | Use it for |
| --- | --- |
| `/llms.txt` | Find public guides and their Markdown URLs |
| `/docs/raw/agents.md` | Retrieve this setup brief as plain Markdown |
| `/openapi.json` | Verify exact request fields, responses, scopes, and errors |
| `/docs/search-index.json` | Search the public page inventory and text |
| `/llms-full.txt` | Load all public guides when a large context is actually needed |

Documentation is public; accessing runs and files still requires authorized credentials. Model availability and account limits come from the authenticated API, not assumptions in a prompt.

## Keep context in your application

Save the adapted brief as a Markdown file in your own repository and reference it from your coding agent's project instructions. Keep only your integration goals, documentation links, and non-secret configuration there. Your tool's file attachment or project-rule mechanism can supply it in later sessions.

For additional features, point the agent to [connectors](../features/identity-integrations/README.md), [triggers](../features/triggers/README.md), or [CLI workflows](../features/cli/README.md). Add one feature at a time after the first run works.

## Contribute to Macrofold itself

The setup prompt is for building applications that call Macrofold. When changing Macrofold's source, read [AGENTS.md](../../AGENTS.md), [contributing](../../CONTRIBUTING.md), and the [codebase map](../architecture/codebase.md).
