# Run native agents locally with Docker

Use the public API, CLI, or dashboard with actual native harnesses in local Docker containers. PostgreSQL owns execution and billing state; encrypted local storage owns verified files and conversation state. Docker does not make upstream model calls free.

## Start

Complete [simulation setup](simulation.md#start), then stop its application and dispatcher before changing modes. Keep the local PostgreSQL and mail services running.

```sh
docker build -f infra/runtime.Dockerfile -t platform-runtime:0.1.0 .
```

The image uses the pinned runtime packages and shared lockfile. Docker caches downloads; retrying a failed registry download can reuse that cache.

Configure the **same `.env`** used by the API and dispatcher:

```dotenv
PLATFORM_MODE=local
EXECUTION_PROVIDER=docker
ORCHESTRATION_BACKEND=poller
DOCKER_RUNTIME_IMAGE=platform-runtime:0.1.0
COMPUTE_MICRO_USD_PER_MINUTE=0
ALLOW_PAID_EXECUTION=false
```

Use the [model catalog](../../features/execution/models.md); no model JSON configuration is required. For managed inference, securely configure the corresponding `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`. Alternatively, add an encrypted model connection in the dashboard and choose BYOK. Change `ALLOW_PAID_EXECUTION` to `true` only after choosing an inference budget. A saved credential alone does not authorize spending.

In terminal 1:

```sh
pnpm doctor:docker
pnpm dev:docker
```

In terminal 2:

```sh
pnpm worker:docker
```

These aliases validate the Docker settings and start the existing application or dispatcher. They read `.env`, preserve it, and let exported environment variables take precedence. Open **http://localhost:3210**; the dashboard identifies **Local Docker**, and the existing local demo login works.

## Run and continue a task

Follow the [API quickstart](../../features/api/quickstart.md) against localhost with a real enabled model instead of `fixture-model`. For a first task, ask the agent to create `hello.txt` containing a short note and read it back. Start with a 120-second timeout and an explicitly approved Run budget.

Follow events and inspect the published file. Continue with the returned `session_id`; Macrofold restores compatible native history and files when compute is replaced. Execution, verified persistence, and optional Git synchronization have separate outcomes.

The seeded account has synthetic application credits, so Stripe is unnecessary for local development. **Synthetic credits do not make provider inference free.** Local Docker compute defaults to zero, but model/tool budgets, exact BYOK selection, revocation, reservations, and settlement still apply.

## Reuse capacity with a Worker

Omit `worker_id` for automatic per-Run compute. Create a [Worker](../../features/execution/workers.md) to retain baseline capacity or run independent agents concurrently on shared local compute. Both server and sandbox offerings can use Docker locally; no Render credentials are required.

For sustained trusted workloads:

```json
{
  "name": "local-agent-service",
  "compute": "server",
  "dedicated": true,
  "isolate_runs": false,
  "min_instances": 1,
  "max_instances": 2,
  "max_concurrency": 8,
  "idle_timeout_seconds": 300,
  "max_hourly_compute_cost_micro_usd": "1000000"
}
```

Send this to `POST /v1/workers`, then include its ID as `worker_id` on Runs. The dollar ceiling is illustrative, not a model budget. The offering catalog and effective settings are authoritative. Each Run reserves memory and CPU; Macrofold adds backing Hosts within resource, plan, concurrency, and cost bounds.

For bursts, choose `min_instances: 0`. The Worker remains addressable after its idle Hosts stop. A compatible native process may remain warm between turns while its Host survives. Different Worktrees can run concurrently; one Worktree still has one writer globally. `isolate_runs: true` requires the advertised isolated environment and does not share that environment between Runs.

Pause stops admissions and drains active work before releasing compute. Resume enables new Hosts lazily. Destroy retires the Worker but never its Worktrees, Sessions, or verified checkpoints. These operations use the same API locally and in hosted deployments.

## Stop and resume the application

Pause explicit Workers, cancel unwanted queued Runs, and let active Runs finish persistence and cleanup before stopping the dispatcher. Press Ctrl-C in both terminals. Restart with `pnpm dev:docker` and `pnpm worker:docker`; durable state is independent of the process and Host lifecycle.

A dispatcher crash does not authorize replaying a native prompt. Its replacement inspects the original Host binding and execution marker. A stopped or externally restarted container is a recovery condition; do not use `docker start` to resume the agent. Continue the logical Session through the API from verified state instead.

To return to simulation, drain native work, stop the application and dispatcher, change `EXECUTION_PROVIDER=simulator` and `ALLOW_PAID_EXECUTION=false` in `.env`, then run `pnpm dev` and `pnpm worker`. Use separate databases and data directories for concurrent development environments. Both processes must restart after configuration changes; accepted native jobs cannot be executed by a leftover simulator.

## Boundaries and resource limits

Docker is trusted contributor infrastructure, not a claim of production hostile-code isolation. Host allocations use the selected offering's CPU/memory shape with no additional swap and a bounded process count. The protected controller assigns separate native process identities, paths, and cancellation scopes. Sharing trusted Runs is distinct from granting another customer access.

No host checkout, Docker socket, database credential, object-store credential, or upstream model key is mounted into the execution environment. Run-scoped gateway capabilities enter protected configuration through stdin. The adapter requires an already-built image and does not pull arbitrary images on admission. `DOCKER_RUNTIME_IMAGE` selects a compatible local image; `DOCKER_NETWORK` selects an optional bridge, not host networking.

Choose `GLOBAL_CONCURRENT_RUN_LIMIT` and Worker limits within Docker's actual resource allocation, leaving room for the application and PostgreSQL. A high configured concurrency limit is not proof that a particular harness mix fits in memory. [Worker operations](../../features/execution/workers/operations.md) explains headroom, usage receipts, and deployment-specific guarantees.

### Networking

The Docker adapter rewrites only application model/MCP URLs to `host.docker.internal`, retaining the port and exact Run path. The app must listen on a container-reachable interface. Local firewall/VPN rules can affect reachability; production HTTPS and user-URL SSRF rules are unchanged. `DOCKER_HOST_GATEWAY_IP` is an optional exact IPv4 mapping for a controlled local network; ordinary development leaves it unset. See [Docker host networking](https://docs.docker.com/desktop/features/networking/) and [host-gateway mapping](https://docs.docker.com/reference/cli/docker/container/run/#add-host).

### Recovery and cleanup

SQL leases, generation checks, Worktree writer claims, and hash-verified checkpoints are shared with hosted execution. Pending cleanup keeps its Host slot owned even after a Run becomes terminal. Failed persistence quarantines that Worktree's local materialization and retains the previous durable checkpoint; it must not stop unrelated Runs sharing a Host. Local unpublished bytes are not an independent backup and can be lost if the Host is deleted. Back up the database, encrypted objects, and vault keys together.

Remove only confirmed-owned idle resources after examining recovery state. Never use a global Docker prune as application cleanup. A Host name identifies provider infrastructure, not the durable Worker or Worktree identity.

## Free runtime verification

With local infrastructure and the matching image available, the existing isolated runners are:

```sh
pnpm test:journey:docker
pnpm test:native codex
pnpm test:native claude-code
pnpm test:native opencode
pnpm test:native hermes deepseek pi
```

They use synthetic data and scripted model responses, not provider credentials. The complete journey owns a disposable database/object directory and its network; native-only runners exercise the image/harness boundary separately. An unavailable daemon or image is a failure, not a passing live-provider check. Consult [Worker verification](../../features/execution/workers/verification.md) and [harness acceptance](../../engineering/testing/harnesses.md) for the scope actually exercised.

For paid model behavior, use the separately opted-in [complete journey runner](cloud.md#test-a-real-agent-journey) with `AGENT_JOURNEY_ENVIRONMENT=docker`, a synthetic customer, and a bounded approved budget.

Return to [development modes](../local-development.md).
