# Real agents in local Docker

Run Codex, Claude Code, or OpenCode through the local API, with Docker providing compute and a model provider supplying inference. The application, PostgreSQL, captured email, and encrypted checkpoints stay on your computer. No Vercel account or public tunnel is needed.

The Docker provider and SQL worker integration are implemented. **Complete container acceptance is still pending**; run the deterministic check below before enabling inference on your workstation. [Acceptance evidence](../../engineering/testing/development-modes.md) separates tested application policy from Docker and live-provider acceptance.

## Start

You need Node 24, pnpm 10, Git, and a responsive Docker daemon. First complete the [simulation setup](simulation.md#start). Stop its application and worker before changing modes; keep PostgreSQL and Mailpit running.

```sh
docker build -f infra/runtime.Dockerfile -t platform-runtime:0.1.0 .
cp -n .env.docker.example .env.docker
```

Configure `.env.docker`:

1. Set `MODEL_CATALOG_JSON` to reviewed, enabled [model entries](../../features/execution/runtime.md#production-model-catalog-example). Each entry must support its selected harness.
2. For managed inference, configure the corresponding `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`. Alternatively, add an encrypted model connection in the dashboard and select BYOK.
3. Set `ALLOW_PAID_EXECUTION=true` only after choosing your inference budget. Merely adding a key never enables execution.

In terminal 1:

```sh
pnpm doctor:docker
pnpm dev:docker
```

In terminal 2:

```sh
pnpm worker:docker
```

Open **http://localhost:3210**. The dashboard identifies this mode as **Local Docker**. Your existing local demo login works. Both commands load the same profile; neither rewrites `.env` or `.env.docker`.

## Invoke an agent

Follow the [API quickstart](../../features/api/quickstart.md) against localhost, selecting a real enabled model instead of `fixture-model`. For a first task, ask the agent to create `hello.txt` containing `Hello from the agent`, followed by one newline, and read it back. Start with a 120-second timeout and a deliberately approved run budget.

Use the dashboard, CLI, or SDK to follow events and inspect the published file. Continue the returned session to restore both workspace files and compatible native conversation state in a fresh container. Execution, persistence, and optional Git synchronization retain their separate outcomes.

The seeded account has synthetic application credits, so Stripe is unnecessary for local development. **Synthetic credits do not make provider inference free.** Local Docker compute defaults to zero micro-USD per minute; `.env.docker.example` sets that explicitly. Model/tool budgets, exact BYOK selection, revocation, reservations, and settlement still apply.

## Test the complete journey for free

With the image built and local PostgreSQL running, invoke this from the ordinary unpaid simulation shell:

```sh
pnpm test:journey:docker
```

The runner owns a disposable database, private object directory, independent API/worker processes, an internal Docker network, and its containers. It submits actual API requests for all three harnesses. Scripted model responses pass through the real gateway and drive actual file tools. It checks stream reconnection/replay, exact file bytes, checkpoint publication, fresh-container session continuation, a killed/replaced worker, and released reservations. No provider credentials or paid calls are used.

A pass is expected to print one JSON result per harness with `passed: true`. An unavailable daemon or image fails before fixture provisioning; it is not reported as a skipped or successful test. This path still needs workstation and Linux CI acceptance; it has not yet demonstrated a complete Docker pass in the recorded environment.

For live reasoning, use the separately opted-in [complete journey runner](cloud.md#test-a-real-agent-journey), selecting `AGENT_JOURNEY_ENVIRONMENT=docker` and the local origin. It requires an approved budget and an idle synthetic customer.

## Run the existing native tests

```sh
pnpm test:native codex
pnpm test:native claude-code
pnpm test:native opencode
```

These narrower tests run real harnesses with networking disabled and a model fixture inside the container. They cover tools, capture, restore, and native continuation, but bypass API admission and Docker provisioning through the worker. `pnpm test:native --image-only` tests the code baked into the image; otherwise the runner mounts fresh runtime bundles. OpenCode questions and stdio MCP have `pnpm test:native opencode --questions` and `pnpm test:native --stdio` paths.

## Stop and resume

Cancel unfinished runs through the API or dashboard and wait for terminal persistence before stopping the worker. Then press Ctrl-C in both terminals. To resume this profile, run `pnpm dev:docker` and `pnpm worker:docker` again; saved projects live independently in PostgreSQL and encrypted local storage.

A worker crash does not restart a native prompt: the replacement worker observes the same container and execution marker. A stopped or externally restarted container is a recovery condition; do not `docker start` it to resume an agent. The normal continuation path creates a new container from a verified checkpoint.

To return to simulation, drain native work, stop both processes, and use `pnpm dev` and `pnpm worker`. Use separate databases/data directories if running modes concurrently. Accepted jobs retain their execution provider, preventing a leftover simulator from executing native work.

## Further details

### Profile precedence and networking

Exported environment variables override `.env.docker`, which overrides `.env`. The Docker overlay selects `PLATFORM_MODE=local`, `EXECUTION_PROVIDER=docker`, and `ORCHESTRATION_BACKEND=poller`. Hosted deployments retain their existing production configuration.

Only the Docker adapter rewrites the run's application model/MCP URLs to `host.docker.internal`, retaining the API port and exact run path. Docker's `host-gateway` mapping supports the Linux host route; Docker Desktop provides the host gateway on macOS. The app must listen on a container-reachable interface, as the standard Next.js development server does. Local firewall/VPN rules can affect reachability. Production HTTPS and user-URL SSRF rules are unchanged. [Docker host networking guidance](https://docs.docker.com/desktop/features/networking/), [host-gateway mapping](https://docs.docker.com/reference/cli/docker/container/run/#add-host).

### Isolation and limits

This is trusted contributor development, not hosted multi-tenant isolation. Containers use two CPUs, four GiB memory without additional swap, a 512-process limit, no new privileges, and only the Linux capabilities required by the existing supervisor. No host directory, checkout, Docker socket, database/storage credential, or upstream model key is mounted or passed into them. Only run-scoped gateway credentials enter protected configuration through stdin.

The example overlay starts with `GLOBAL_CONCURRENT_RUN_LIMIT=1`. Raise it only within Docker's allocated CPU/memory, leaving headroom for PostgreSQL and the application. Organization and workspace limits still apply.

The runtime image is already built locally; provisioning never implicitly pulls one. `DOCKER_RUNTIME_IMAGE` selects another locally built matching image. Normal development uses Docker's bridge network; `DOCKER_NETWORK` can select a custom bridge. Docker is deliberately not advertised as Vercel's microVM or egress-isolation equivalent.

The deterministic runner uses an owned internal network with no external route. A test-only relay forwards runtime paths to the fixture API; the gateway rejects unexpected upstream requests. The runner sets `DOCKER_HOST_GATEWAY_IP` to the relay's internal IPv4 address. Ordinary development leaves this unset to use Docker's host gateway. [Docker internal-network behavior](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode).

### Recovery and cleanup

SQL phase leases, workspace serialization, organization/global limits, and checkpoint verification are shared with cloud execution. Ordinary execution observation uses the existing two-second phase delay plus worker/provider time; input and cancellation follow that cadence. A killed worker may leave a two-minute phase lease before replacement can advance. Queue expiry uses the worker's 15-second maintenance sweep; its 24-hour deadline remains independent of execution timeout.

Successful checkpoint publication permits container deletion. Persistence failure stops and retains the owned container's writable layer for manual recovery, while preserving the last verified checkpoint and blocking competing workspace writes. That layer is not an independent backup; deleting Docker data destroys it. Containers also stop after the requested timeout plus the existing 30-minute persistence allowance. Back up PostgreSQL, encrypted objects, and vault keys together.

### Cleanup

The complete test runner removes only containers on its unique test network, its network, and its temporary database/files. Successful application runs remove their own containers. Recovery containers are retained deliberately; inspect the run's failure and recover needed files before removing the corresponding `run-<run ID>` container. Never use a global Docker prune as application cleanup.

Return to [development modes](../local-development.md).
