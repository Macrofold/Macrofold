# Native runtime and durable execution

This document records the implementation decisions made while validating the production execution path. It supplements the architecture and portability plans.

## One execution identity across retries

The database admits a run and commits an outbox record in the same transaction. The Next.js transport dispatches that outbox after responding; a scheduled maintenance route repairs missed dispatches. Vercel Workflow advances a small domain state machine. Workflow arguments contain organization and run identifiers, not credentials, prompts, or file contents. Those remain in the application database and encrypted object store.

The phases are input preparation, machine provisioning, hydration, restore, launch, polling, snapshot indexing, chunk upload and verification, publication, and cleanup. A database phase lease fences concurrent workers. The named VM is `run-<run UUID>`. The native supervisor creates a non-removable atomic execution marker before launching a harness. A lost launch acknowledgement can cause a second launch request, but the marker prevents the prompt from executing twice. Unknown external tool outcomes are recorded as unknown and are not silently replayed.

The Vercel adapter deliberately calls `Sandbox.get({name, resume: false})`, checks the original session identifier, and performs I/O through `currentSession()`. High-level Sandbox I/O can resume a stopped machine. Session-bound I/O avoids that behavior. A stopped or replaced VM is a recovery condition. The platform does not resume an agent merely to inspect its status. [SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

## Runtime image and process isolation

`infra/runtime.Dockerfile` builds a Linux image with Node.js 24, Git, Python, ripgrep, and pinned native harness packages. Codex uses its app-server JSON-RPC protocol; Claude Code uses the official Agent SDK; OpenCode uses its official SDK and server. The production configuration requires a VCR image digest. The image must be built for `linux/amd64` and reach VCR's Ready state. Sandbox does not execute a Docker image's CMD or ENTRYPOINT automatically; the adapter explicitly starts the supervisor. [Custom images](https://vercel.com/docs/sandbox/concepts/images)

The root supervisor starts the native worker as UID 10001, without sudo rights. Native processes receive a sanitized environment and a short-lived capability restricted to their run, lease, deadline, model and approved connection grants. Vendor model keys, database credentials, object-store credentials and Composio credentials stay in the control plane. The sandbox network policy permits the application gateway and reviewed package/repository domains; operators can configure additional domains.

The supervisor owns a protected control directory. Native state lives in `/agent-home`; user files live in `/workspace`. Before capture, the supervisor terminates processes belonging to the agent UID, including daemonized descendants. This separates a quiescent checkpoint from a copy made while agents are still writing. Cancellation and timeouts still enter the capture path. An agent failure is independent from persistence success.

The runtime emits normalized output deltas, tool events, lifecycle metadata and provider-exposed reasoning summaries. It does not export private chain-of-thought blocks. Each event has a producer sequence; the database assigns the public durable sequence and deduplicates repeated ingestion. The supervisor writes bounded JSONL records and the cloud poller resumes by byte offset. Large tool payloads and oversized traces are explicitly marked as truncated.

## Portable persistence

The portable checkpoint includes regular files and symbolic links, including ignored files, Git's internal state and native session files. Symlinks are recorded without traversing them. Runtime sockets and FIFOs are excluded because they are process resources. Empty directories are not represented. Hard links restore as independent files with identical content. Restore creates ordinary files before links and rejects any entry that descends through a symlink, preventing a checkpoint from redirecting writes outside its restore root.

Files are split into 4 MiB content-addressed chunks. Each chunk is encrypted before object storage. An encrypted manifest records chunk hashes, complete file hash, size, mode and timestamp. The control plane verifies chunks and the complete file hash before atomically publishing a checkpoint. Large file verification streams chunks, bounding memory use. Public file transfer and editor limits remain separate from the internal checkpoint format.

The initial runtime limits are 10 GiB and 100,000 persistent file entries across workspace and native home. Exceeding a capture limit fails persistence explicitly. The last verified checkpoint stays available, the VM recovery snapshot is retained, and further writers are blocked until recovery or an explicit restore. Provider recovery snapshots expire after seven days by default; they are an emergency recovery mechanism, not the long-term source of truth. Successful portable publication permits VM and temporary snapshot cleanup.

Git data is stored separately from the dashboard's editable file collection. Native home state belongs to the session and is restored when that session continues. The same run model rate card is frozen at admission, so configuration changes cannot retroactively alter its retail token rates.

## Model and connector accounting

The model gateway supports the reviewed OpenAI Responses/chat, Anthropic Messages, and OpenRouter chat routes. It accepts text and client-executed tools. Hosted billable tools, media and server-side conversation references require separately reviewed accounting and are rejected by this route. Before every upstream request it reserves a conservative token bound plus the remaining compute allowance. Streaming usage settles that reservation; a missing final usage frame remains explicitly provisional. BYOK never falls back to managed credentials.

The runtime MCP broker presents only tools granted to both the session and the current connection owner/organization. It rechecks grants on execution, validates the tool schema, and records a tool invocation before calling the external service. Composio toolkit versions and retail call fees must be configured. Tool results are encrypted for replay. Native MCP request IDs are scoped to a run for idempotency; an ambiguous request cannot be retried as a new action automatically.

The published compute rate currently covers the run's configured execution window. Bounded provisioning and checkpoint recovery overhead beyond that window is borne by the platform; it must be included in margin estimates and observed operationally. This is deliberately distinct from claiming the provider invoice has been measured. R2 request/storage expense, native snapshots, Workflow events and connector subscription fees remain operator costs until the billing integration records their actual dimensions.

## Local Docker execution

The [Docker development guide](../../getting-started/local-development/docker.md) connects public API admission to the same persisted phases through `DockerMachines` and the standalone SQL worker. Local infrastructure remains separate from simulated inference. The adapter keeps owned container identity, protected supervisor state, scoped gateway credentials and independent encrypted checkpoints. Successful runs remove their containers; failed persistence retains a stopped recovery layer. Docker is trusted contributor compute, while production retains Vercel microVM isolation. See [architecture and acceptance](../../engineering/development-modes.md).

## Validation boundary

The local native tests run actual pinned binaries in Docker with `--network none` against a loopback mock model server. They exercise native protocol compatibility, tools, filesystem capture, portable restore, and session continuation without paid inference. Fault tests use a fake machine provider with real PostgreSQL and encrypted local object storage to test duplicate launch acknowledgements, failed-agent checkpoints and unavailable-machine recovery.

These tests do not prove Vercel account quotas, image acceptance, production egress/TLS behavior, provider model entitlements or real invoice reconciliation. The launch guide must include those operator checks and keep inference disabled until the operator chooses a budget for a paid smoke test.

## Production model catalog example

`MODEL_CATALOG_JSON` is an array validated by `packages/core/src/catalog.ts`. Supply model IDs you have actually verified in your provider account. This deliberately disabled example demonstrates schema and units, not supported model names or price recommendations:

```json
[
  {
    "id": "REPLACE_WITH_VERIFIED_OPENAI_MODEL_ID",
    "name": "Reviewed OpenAI model",
    "provider": "openai",
    "harnesses": ["codex", "opencode"],
    "input_micro_usd_per_million": "2400000",
    "output_micro_usd_per_million": "12000000",
    "enabled": false
  },
  {
    "id": "REPLACE_WITH_VERIFIED_ANTHROPIC_MODEL_ID",
    "name": "Reviewed Anthropic model",
    "provider": "anthropic",
    "harnesses": ["claude-code", "opencode"],
    "input_micro_usd_per_million": "3600000",
    "output_micro_usd_per_million": "18000000",
    "enabled": false
  }
]
```

`2400000` micro-USD per million means $2.40 per million. These are final retail rates; no additional automatic markup is applied. Providers are `openai`, `anthropic`, `openrouter`. Codex cannot be assigned an Anthropic entry, nor Claude Code an OpenAI entry. OpenRouter entries are for OpenCode. Duplicate model IDs and incompatible mappings fail validation. Configure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` only for managed routes offered. BYOK uses an owner-bound model connection of the same provider.

Retail cache policy is intentionally simple: cache reads use the stated input rate; Anthropic cache writes use twice that input rate, with ordinary uncached input counted once. OpenAI input totals already include their cached subset and are not added twice. Output uses the stated output rate and includes reasoning tokens when reported within output. This is not a pass-through of every vendor discount. Disclose this policy with your prices; change schema/accounting and tests before offering separate cache tiers. The gateway preserves diagnostic usage dimensions and completeness.

Enable reviewed entries and paid execution only for the bounded live smoke test described in the launch guide. Changing a catalog does not alter the frozen rate/configuration of an existing admitted run. Harness upgrades require fixture and live-account compatibility checks before adopting their new native session formats.
