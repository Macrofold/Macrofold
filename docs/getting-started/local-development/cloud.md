# Real agents in cloud staging

Use a separate staging deployment to exercise the complete hosted journey: an API request starts a real agent in Vercel Sandbox, the agent calls a real model, and its files and history remain available afterward. Your API client or CLI can run on your computer; the execution happens in the cloud.

You need access to a configured staging deployment and an approved budget for model and sandbox usage. Infrastructure can have costs even when no agent is running. Ordinary open-source contributions can use [local simulation](simulation.md) without these accounts.

## Run your first task

On an existing staging deployment:

1. Sign in, select your test organization, and create a project and API key.
2. Select an enabled model compatible with the desired harness. Use managed inference with test credits, or add your own provider connection and select BYOK. Compute and authorized tools can still consume application credits.
3. Follow the [API quickstart](../../features/api/quickstart.md), using your staging HTTPS origin and real model ID instead of localhost and `fixture-model`.
4. Use a small task: **Create `hello.txt` containing `Hello from the agent`, then read it back.** Set a short execution timeout and an explicitly approved spending limit.
5. Follow the run stream, retrieve its final result, and open the workspace file in the dashboard after checkpoint publication.

The quickstart uses Codex and managed billing. To try Claude Code or OpenCode, change its `harness` field and select a matching model. The [model catalog](../../features/execution/runtime.md#production-model-catalog-example) defines supported combinations; changing only the provider name is insufficient.

There is no separate `pnpm worker` process for the Vercel Workflow deployment. Workflow advances the execution phases, and the application's scheduled maintenance repairs pending dispatches.

## Set up staging once

If you do not already have a deployment, follow [Deploy on Vercel](../../operations/launch-guide.md) using a dedicated staging project. That guide owns the exact provisioning commands. The dependency order is:

1. Prepare an isolated release checkout and private runtime/migration configuration.
2. Configure a staging PostgreSQL database with restricted runtime access, private R2 storage, and identity email.
3. Build and publish the matching Linux AMD64 native image to Vercel Container Registry; retain its ready immutable digest.
4. Deploy the application to its staging HTTPS origin with Workflow and maintenance enabled.
5. Configure reviewed models, Stripe test billing, a synthetic test account, and test credits. Enable admission and paid execution only for the agreed acceptance budget.

Use separate staging data, storage, credentials, and payment mode. A Vercel project's environment named **Production** can serve staging; what matters is that the project and all its resources are isolated from the customer deployment. See [project selection](../../operations/launch-environment.md#staging-and-vercel-project-selection).

Keep the source checkout's local `.env` for simulation. Cloud configuration belongs to the selected deployment, not to every contributor's development shell.

## Test a real agent journey

Repeat the small task for each supported harness/model route, in separate test workspaces. Confirm the run selects the intended harness, executes tools, emits output and usage, and publishes the exact file contents. Then continue its session in a fresh sandbox and confirm it can read the existing file and retain compatible native conversation state.

For the complete journey, also check API status/result, detailed stream replay, dashboard freshness, and final accounting. Execution, persistence, and optional Git synchronization have separate outcomes. Provider acceptance alone cannot prove any of the sandbox or persistence steps.

The complete runner uses the public API and an idle synthetic customer. After an operator approves the destination, model rates and spending allowance, export the customer API key as `AGENT_API_KEY` and configure:

```sh
export LIVE_AGENT_TESTS=1
export AGENT_JOURNEY_ISOLATED=1
export AGENT_JOURNEY_ENVIRONMENT=staging
export AGENT_HOST=https://YOUR_STAGING_ORIGIN
export AGENT_HARNESS=codex
export AGENT_MODEL=YOUR_REVIEWED_ENABLED_MODEL
export AGENT_TIMEOUT_SECONDS=120
export AGENT_JOURNEY_BUDGET_MICRO_USD=2000000
export AGENT_RUN_BUDGET_MICRO_USD=1000000
pnpm test:journey:live
```

The example permits two $1 application run ceilings under a $2 aggregate allowance; **it is not spending authorization or a complete cloud invoice cap**. Choose approved values and catalog rates that conservatively cover actual provider charges. Sandbox, storage, Functions, Workflow, and idle infrastructure require a separately approved allowance. The runner deliberately does not load `.env` or provision accounts.

For local Docker acceptance, change `AGENT_JOURNEY_ENVIRONMENT` to `docker` and `AGENT_HOST` to `http://localhost:3210`, keeping the Docker API and worker running. For BYOK, also set `AGENT_CONNECTION_ID` to the synthetic customer's selected model connection. Repeat explicitly for each compatible harness/model route; one route does not establish another's compatibility.

Each invocation creates a project, performs the file task, replays its stream, and continues the native session to copy the restored bytes into `continued.txt`. It checks native identity, tool/output/checkpoint events, file bytes, and terminal reservations. Successful output is sanitized JSON with `passed: true` and run IDs. The project is archived afterward; known unfinished runs receive explicit cancellation if a check fails. Inspect failed runs until persistence and settlement finish.

The private `.data/agent-acceptance/attempts.jsonl` journal records full run ceilings and idempotency keys **before** requests. Retries and uncertain responses never free that allowance; continuation consumes another ceiling. Concurrent invocations are rejected by a lock. After a process crash, inspect the recorded request keys/runs and confirm no runner remains active before removing its stale lock. Never delete or reset the budget journal to retry without a new approval. Keep the API, worker/deployment and approved provider rates unchanged through acceptance.

The automated runner is implemented but live Docker/cloud execution has not been accepted yet. [Current evidence](../../engineering/testing/development-modes.md) lists exact prerequisites and remaining checks. The older `pnpm test:live` command still tests individual gateways and **never launches a sandbox**.

## Stop new work

Use **Cancel** or the API cancellation operation to stop a particular run; closing a client does not cancel it. To pause new submissions, follow [Pause new work](../../operations/launch-guide.md#pause-new-work). Let accepted work complete or cancel it explicitly, then verify persistence and settlement. Disabling admission does not delete storage or stop all infrastructure charges.

## Further details

### Deployment settings

These select the topology; they are not a complete environment file:

| Setting                 | Staging value                                                    |
| ----------------------- | ---------------------------------------------------------------- |
| `PLATFORM_MODE`         | `production`, to use the hosted security and accounting behavior |
| `EXECUTION_PROVIDER`    | `vercel`                                                         |
| `ORCHESTRATION_BACKEND` | `workflow`                                                       |
| `APP_ORIGIN`            | The staging application's HTTPS origin                           |
| `RUNTIME_IMAGE`         | The matching ready image pinned by digest                        |
| `ALLOW_PAID_EXECUTION`  | `false` during setup; enable deliberately for budgeted runs      |
| `RUN_ADMISSION_ENABLED` | `false` during setup; enable when ready to accept test runs      |

The [environment reference](../../operations/launch-environment.md) covers identity, database, storage, models, and budgets. Stripe test credits do not make the upstream model or sandbox free, and the application run budget does not cap all hosting charges.

### Local application with a cloud sandbox

This hybrid is not the documented local startup path. The local worker supports simulation and the explicit Docker poller profile. The Vercel adapter uses OIDC, and a cloud sandbox needs a reachable application gateway; it cannot call the API at your computer's localhost address. Setting a Vercel token in `.env` does not complete that integration.

Use a deployed staging application for the supported cloud topology. The [standalone deployment reference](../../operations/deployment.md#alternative-standalone-control-plane) describes the separate poller option and its remaining cloud-authentication limitation. Neither is a substitute for the [local Docker development mode](docker.md).

### Release acceptance

Image startup, callbacks, egress, hosted SSE, Workflow recovery, storage writes, and quotas must be accepted on the deployed revision. Free fixtures and a successful build do not prove these properties. Keep results and outstanding checks in the [pre-deployment checklist](../../operations/pre-deployment.md).

Return to [development modes](../local-development.md) for the overview and faster local paths.
