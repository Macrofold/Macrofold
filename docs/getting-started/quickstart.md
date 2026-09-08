# Quickstart

Create a project, run an agent, and inspect the files it saves. You can follow this guide on a deployment you have access to or with the [free local simulator](local-development/simulation.md).

## 1. Sign in

Open the dashboard and create an account. Verify your email before using protected features. For local development, use the demo account from the [local setup guide](local-development/simulation.md#start).

Choose the organization you want to work in. Projects, API keys, and usage belong to that organization.

## 2. Create a project

Open **Projects**, choose **New project**, and give it a name. A persistent project keeps its files across runs. Start with an empty project; you can connect GitHub or upload files afterward.

A **workspace** is the project's independent working folder and branch. Use a separate workspace when two agents need to write at the same time.

## 3. Start a run

Create a run from the dashboard. Select your project, harness, and an available model. Try a small task such as “Read the project files and write a short summary.” Set a runtime and spending limit, then submit.

On a real deployment, managed execution uses prepaid credits. To use your own model account, add a provider connection and select BYOK. Compute and authorized tools can still use platform credits. The local simulator uses synthetic credits and does not call a model.

## 4. Follow the work

Open the run to follow status, output, tool activity, and any provider-exposed reasoning summaries. A run may wait for capacity, an earlier workspace task, or input from you. The run view explains its current state.

You can leave the page and return later. Closing the browser does not cancel the run. Use **Cancel** when you want to stop it.

## 5. Review and continue

When persistence finishes, open the workspace files and its checkpoint history. Execution, persistence, and Git synchronization have separate outcomes; check all three before relying on a remote Git update.

Continue the same session to preserve a compatible native conversation, or start a new session over the saved files.

## Next steps

- [Core concepts](concepts.md): learn what persists and what a run represents.
- [API quickstart](../features/api/quickstart.md): submit a task from your application.
- [CLI guide](../features/cli/README.md): link a directory and stream remote work.
- [Connections](../features/identity-integrations/README.md): add provider keys, MCP servers, and apps.
