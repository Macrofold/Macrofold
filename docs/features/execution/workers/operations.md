# Worker operations

This is the maintainer deployment guide. Public behavior is in [Workers](../workers.md); ownership and invariants are in the [architecture](../../../architecture/worker-execution.md).

## Enable an offering deliberately

Run all forward database migrations before starting the matching API and dispatcher. Keep the API, runtime controller image, contracts, and dispatcher at the same release. Applied migration files and immutable financial history are not edited to remove old terminology.

Local simulation is explicitly free and does not start real native agents. Local Docker uses the pinned runtime image and actual Host controller. Hosted sandbox execution uses the configured Vercel integration. Hosted server-backed execution requires `RENDER_WORKER_ENABLED`, the Render API credentials/owner, a supported service plan and region, and an immutable runtime image reference. Provider driver configuration is private and never returned through offering discovery.

`packages/core/src/worker-catalog.ts` owns deployment catalog loading and validation. Publish only combinations supported by the backend: CPU/memory shape, concurrency, runtime, region, isolation, maximum Host lifetime, price revision, and meter type. Real deployments must use reviewed rates; fixture rates are zero and are not commercial defaults. Unsupported resource-metered offers fail closed when the backend cannot produce the required counters.

The accepted quote on each Worker and Host survives later catalog changes. A catalog edit must not retroactively reprice existing liabilities. Changing the Worker's compute/security contract requires a fully paused target and a newly accepted configuration.

## Run the control loops

The existing dispatcher calls Worker reconciliation alongside normal maintenance. Reconciliation is bounded and leased in SQL. It uses queued resource demand, current allocations, min/max capacity, credit, and accepted hourly exposure; it does not forecast tomorrow's traffic. Provisioning capacity counts as expected supply. At most four new allocations are planned in one Worker pass, and provider operations execute outside database transactions with bounded concurrency.

Every Host has a stable provider identity and immutable accepted allocation. Persist that receipt before controller startup. A failed health/configuration call must not turn an already-billable machine into an unknown resource. Controller boot identity and assignment identity fence every state-changing native operation.

Host health carries rotation requests. Draining stops admissions but lets owned work finish. Provider hard lifetime, customer expiration, manual pause, lost funding, and resource pressure are distinct reasons; none changes durable Worktree or Session ownership. A new provider allocation does not extend an explicitly expired Worker.

## Finalize usage before releasing liability

Dedicated allocation charging uses the accepted shape/rate and confirmed running interval. Resource-metered charging uses cumulative allocated-memory/CPU receipts. Sampling frequency must not change the total charge. Duplicate observations and duplicate shutdown acknowledgements must not duplicate settlement.

For a metered Host, stop admissions, finish assignments, evict retained processes, and request `quiesce`. The controller seals a final cumulative receipt and cannot admit new work afterward. Persist and settle that receipt before provider deallocation. `usage_finalized_at` distinguishes an acknowledged final meter from a missing usage tail. If the acknowledgement or controller generation is uncertain, retain funds and reconcile rather than assume zero.

A provider deletion request alone does not prove shutdown. Release remaining funds only after stopped/deleted state is confirmed. Keep starting and draining obligations in the hourly ceiling until that boundary. A Host with uncertain shutdown must not be replaced repeatedly without including the old obligation.

## Runtime requirements

The protected controller runs separately from unprivileged native harness handles. Each handle has its own process identity, state paths, and scoped termination. Per-turn capabilities are refreshed and removed when no Run is active. Worktree and Session files are captured only at a quiescent boundary; known authentication files are excluded while hidden Git and conversation files remain eligible.

Trusted shared execution is not cross-customer hostile-code isolation. Do not advertise stronger capabilities than the runtime and provider enforce. A non-dedicated price does not require unsafe colocation: the platform may absorb idle capacity until a verified shared allocator is available. Custom runtime offerings must preserve the trusted controller boundary.

## Operational verification

Build with `pnpm check` and `pnpm build:runtime`. `pnpm run setup` creates the local disposable infrastructure. The bounded [performance workload](../../../../scripts/workers/stress.ts) runs actual loopback HTTP, generated SDK, scheduler, PostgreSQL, persistence, and ledger while stubbing external model/compute calls. The native load workflow builds the actual pinned runtime, runs concurrent native processes against loopback model responses, and checks a fresh-container continuation boundary. Neither is a production-capacity claim.

See [verification](verification.md) for exact commit-scoped evidence and [maintainer TODO](../../../maintainers/TODO.md) for deferred regression coverage and deployment-specific acceptance. Do not infer that missing API keys prove a backend works; mark live-provider checks unrun until exercised within an authorized spending limit.
