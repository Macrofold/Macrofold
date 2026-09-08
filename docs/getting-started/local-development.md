# Run and test the application

Choose where execution happens and whether you need real model reasoning. **New contributor? Start with [local simulation](local-development/simulation.md).** It needs no provider account and makes no paid agent calls.

## Choose a development mode

| Mode                                                       | Where the application and agent run                                                           | Accounts and costs                                                                 | Availability                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Local simulation](local-development/simulation.md)        | Dashboard, API, database, and worker on your computer; scripted agent activity                | No cloud or model account; free agent runs                                         | Working default                                                    |
| [Real agents in local Docker](local-development/docker.md) | Local application and Docker sandbox; real Codex, Claude Code, or OpenCode                    | No Vercel account; a model provider key and inference budget                       | Provider implemented; complete Docker acceptance pending           |
| [Real agents in cloud staging](local-development/cloud.md) | Deployed application, database, storage, and Vercel Sandbox; clients can run on your computer | Access to a staging environment; cloud infrastructure and inference can cost money | Cloud adapter implemented; requires deployment and live acceptance |

A **harness** is the agent software, such as Codex or Claude Code. A **model** supplies its reasoning. A **sandbox** is the isolated machine where its commands and file edits happen. A local sandbox can still call a remote, paid model.

## Start

Follow the [two-terminal simulator setup](local-development/simulation.md#start). It starts the actual dashboard and API at **http://localhost:3210**, with local PostgreSQL, captured email, and a separate worker.

The default setup does not launch Vercel sandboxes. Installing Docker or adding a model key does not switch simulated runs to real agents.

For real reasoning, choose the explicit [Docker profile](local-development/docker.md) or [cloud staging](local-development/cloud.md). Both require a reviewed model route and inference budget; staging also requires cloud resources.

## Try the API

Use the same [API quickstart](../features/api/quickstart.md) in each implemented mode: create an API key and project, submit a run, stream events, and retrieve the result. Point the client at the local or staging origin. Select `fixture-model` only for simulation; real execution needs an enabled model compatible with the selected harness.

Start with cURL or the interactive API reference. Postman is optional; import [OpenAPI](../api/openapi.json) and set your service origin and Bearer token. The CLI and SDKs use that same API.

## Test

Choose tests based on the boundary you changed:

| Question                                               | Use                                                                                          | What a pass establishes                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Does the application workflow work?                    | [Local domain and customer-journey tests](local-development/simulation.md#test-your-changes) | API, database, dashboard, and client behavior with simulated execution                       |
| Can each real harness run tools and restore its files? | [Native Docker fixtures](local-development/docker.md#run-the-existing-native-tests)          | Actual harness software works with deterministic model responses                             |
| Does our gateway speak to the actual provider?         | [Opt-in live provider tests](../engineering/testing/live-integrations.md)                    | Selected real provider protocols and accounting, without launching an agent sandbox          |
| Does API-to-Docker work with free model fixtures?      | [Complete Docker journey](local-development/docker.md#test-the-complete-journey-for-free)    | Actual API, SQL worker, native tools, gateway, checkpoint and continuation                   |
| Does the entire real-agent journey work?               | [Cloud staging acceptance](local-development/cloud.md#test-a-real-agent-journey)             | API admission through real sandbox execution, model calls, persisted files, and continuation |

Development modes and test levels are different. Mocked model responses let real harnesses execute tools, but cannot prove live reasoning or provider compatibility. A successful provider request alone cannot prove sandbox startup. The complete journey needs both together.

## Stop

Use the selected guide's shutdown steps: [simulation](local-development/simulation.md#stop-and-resume), [Docker fixtures](local-development/docker.md#cleanup), or [cloud staging](local-development/cloud.md#stop-new-work).

## Further details

[Testing and CI](../engineering/testing.md) owns the full suite catalog. [Implementation status](../status/README.md) records measured acceptance; [development-mode architecture](../engineering/development-modes.md) explains the shared execution integration and complete-journey acceptance boundary.
