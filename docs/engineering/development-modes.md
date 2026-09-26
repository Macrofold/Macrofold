# Development-mode implementation

The [developer overview](../getting-started/local-development.md) provides three paths: [free simulation](../getting-started/local-development/simulation.md), [local Docker](../getting-started/local-development/docker.md), and [cloud staging](../getting-started/local-development/cloud.md). This document owns their architecture; [acceptance evidence](testing/development-modes.md) records actual verification and remaining deployment checks.

## Shared execution path

API, CLI, and SDK requests use the same authorization, model/grant validation, budget reservation, SQL scheduling, events, and checkpoints. Simulation remains the default and produces scripted work without inference. Real Docker and Vercel execution share `advanceCloudRun`: input preparation, provisioning, restore, launch, observation, verified checkpoint publication, accounting, and cleanup.

`isLocal()` describes infrastructure and trusted local identity/email behavior. `isSimulated()` identifies simulated execution. `realExecutionEnabled()` requires explicit paid enablement and the Docker provider for local inference. Local storage and captured email remain usable when agents are real; model keys alone never change mode. Native admission retains full reservations, frozen rates, exact BYOK and current authority checks. Accepted runs record the selected execution provider so another local mode cannot execute them.

## Provider boundary

`MachineProvider` and `MachineTools` remain the domain-owned ports. `machines()` composes automatic or explicit Worker execution over the Host runtime. Provider ports select Docker for the explicit local poller profile, Vercel for enabled sandbox offers, and Render for enabled server offers. The Docker adapter uses the installed Docker CLI, with argument arrays, bounded output/timeouts and stdin for sensitive configuration; it adds no dependency, queue, or lifecycle engine.

Each Host container has a stable allocation name and installation/execution ownership labels. Successful lookup distinguishes absence from transport failure. Provisioning may start a never-started container; a stopped or externally restarted execution is never resumed implicitly. Container ID and start timestamp fence later operations. Native restore/execution markers retain deduplication after uncertain command acknowledgements. Successful automatic execution releases its private allocation; shared Worker capacity remains until lifecycle policy drains it. Failed persistence preserves the last verified checkpoint and quarantines the affected materialization rather than destroying neighboring Runs.

The runtime keeps the protected controller separate from native handles, each with its own unprivileged identity and scoped paths. Docker imposes the accepted Host CPU/memory allocation, no additional swap, a bounded process count and a restricted capability set. It mounts no host files, sockets or credentials. This is trusted local development, not a second production multi-tenant sandbox product. The runtime lifespan includes the existing 30-minute recovery allowance after its requested execution window.

Only Docker preparation rewrites the authorized application gateway host to `host.docker.internal`, preserving run path and port. The container's host-gateway mapping is local to this provider. Production HTTPS, tenant authority, user-URL SSRF checks, and Vercel egress policy are unchanged. Workstation/Linux networking acceptance remains explicit.

## Configuration and accounting

`dev:docker`, `worker:docker`, and `doctor:docker` share `scripts/docker-profile.ts`: exported environment values override the single `.env`. These aliases validate `PLATFORM_MODE=local`, `EXECUTION_PROVIDER=docker`, and `ORCHESTRATION_BACKEND=poller`; they do not create another overlay or rewrite configuration. Paid execution remains disabled until deliberately enabled. Restart both serving processes after a mode change.

Synthetic demo credits exercise the actual ledger without Stripe. Docker compute defaults to zero; automatic Run rates and explicit Worker offering quotes are accepted independently. Configured rates are never retroactively applied to old liabilities. Inference and authorized tools remain budgeted and can incur real provider charges. BYOK uses only its selected encrypted credential and never falls back to managed funding. The same worktree/account/global limits, queue expiry, cancellation, recovery and historical replay remain authoritative.

Drain work before switching profiles; use independent databases and object directories for concurrent modes. A provider setting does not migrate an active container, native session format or cloud deployment. Hosted Vercel Workflow or the portable poller can drive the same bounded SQL phases; maintenance repairs dispatch and reconciles Worker capacity independently from the requested Run context.

## Test and acceptance ownership

| Test | Boundary |
| --- | --- |
| Domain/browser/CLI/SDK simulation | Actual application workflows, no real harness reasoning |
| `test:native` | Actual harness/container tools and restore against an in-container fixture; bypasses API/worker provisioning |
| `test:journey:docker` | Public API, SQL worker, actual native container, gateway fixture, files, replay, fresh-container continuation, worker replacement and settlement |
| `test:live` | Separately opted-in provider/gateway protocols; no native sandbox |
| `test:journey:live` | The same customer API journey through Docker or deployed staging, with explicit isolation and approved budget |

The deterministic native journey reuses the native protocol fixture, substitutes only the gateway's upstream transport, and rejects unexpected upstream URLs/credentials. It owns a unique internal Docker network, disposable database/files and isolated processes. A test-only relay connects that network to the host API: it forwards only runtime paths to one fixed destination. Agents have no external route. The relay uses the existing runtime image and adds no production service. Default/fork CI has no paid provider credentials; the native image job runs this path after narrower native fixtures.

The live runner is never part of default CI. It requires explicit destination, idle synthetic customer, compatible harness/model, timeout, run ceiling and aggregate approval. It journals uncertain attempts before admission, retains original idempotency keys, and counts continuation separately. Application ceilings do not bound every infrastructure invoice; staged quotas, conservative model rates and separately approved infrastructure budgets remain prerequisites. Production release automation and external Vercel authentication are separate work.

## Verification and remaining work

Use [the acceptance record](testing/development-modes.md) for measured tests and exact outstanding commands. The provider is implemented; a passing domain fixture is not a claim that the complete Docker or deployed staging path has passed. [Release TODO](../maintainers/TODO.md#development-modes-and-complete-agent-acceptance) retains those acceptance requirements.
