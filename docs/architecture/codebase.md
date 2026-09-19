# Codebase map

Find the source module that owns a behavior, then read its feature guide before making changes.

## Module responsibilities

| Location                                                             | Responsibility                                                                                     | Documentation                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [apps/web](../../apps/web)                                           | Dashboard shell, views, HTTP routes, Vercel Workflow entry points                                  | [Dashboard](../features/dashboard/README.md), [API](../features/api/README.md)                             |
| [packages/core](../../packages/core/src)                             | Authorization, execution, worktrees, billing and reporting services                               | [Feature index](../features/README.md)                                                                     |
| [packages/db](../../packages/db)                                     | PostgreSQL migrations, tenant transactions and connection pools                                    | [Architecture](../architecture/README.md)                                                                  |
| [packages/providers](../../packages/providers/src)                   | Sandbox, object storage, Git and other provider adapters                                           | [Portability](../architecture/portability.md), [integrations](../features/identity-integrations/README.md) |
| [packages/runtime](../../packages/runtime)                           | Protected sandbox supervisor and native harness adapters                                           | [Runtime implementation](../features/execution/runtime.md)                                                 |
| [packages/cli](../../packages/cli), [sdk](../../sdk)                 | Terminal and programmatic clients of the public API                                                | [CLI](../features/cli/README.md), [API](../features/api/README.md)                                         |
| [packages/contracts](../../packages/contracts), [docs/api](../api)   | Generated public types and machine-readable contracts; private dashboard signal types are separate | [API contracts](../features/api/README.md)                                                                 |
| [tests](../../tests), [scripts](../../scripts), [infra](../../infra) | Local acceptance, setup, migration, maintenance and deployable images                              | [Engineering](../engineering/README.md), [operations](../operations/README.md)                             |

## Product presentation

The [dashboard](../features/dashboard/implementation.md) keeps navigation in `components/shell.tsx`, workspace list/grid views in `components/workspaces.tsx`, and the file tree, editor, and Markdown preview in `components/files/`. `lib/use-resizable-panel.ts` shares accessible resizing between navigation and the file explorer; worktree authorization and persistence remain in `packages/core/src/files.ts`. `packages/core/src/worktree-names.ts` owns display-name uniqueness and saved branch discovery; `components/create-worktree.tsx` consumes that validation API. Rich Markdown editing uses Tiptap in `components/files/rich-markdown-editor.tsx`, alongside the safe reading preview and draft diff.

The [documentation site](../engineering/documentation.md) publishes selected Markdown through `docs/navigation.json`, `scripts/docs/generate.ts`, and `apps/web/lib/docs`. Its AI setup prompt is owned by the public guide and resolved to the deployment origin; Cloud account setup and self-hosted operations remain separate from shared product guides.

The [ten marketing concepts](../product/marketing/README.md) share server-rendered product content, generated hero posters, and small interactive controls under `apps/web/app/concepts` and `apps/web/components/concepts`. The selected Swarm direction has ten [homepage studies](../product/marketing/homepages/README.md) under the corresponding `homepages` directories. These use one shared SVG feature model with scroll, tab, chapter, and guided layouts; no backend or provider calls power the illustrations. The current [journey library](../product/marketing/journeys/README.md) lives under `app/journeys` and `components/journeys`: three use cases, five pillars, ten diagram treatments, and one shared Foundation hero. Public connector documentation uses the bundled catalog through `lib/docs/connectors.ts`, a static export, and `components/docs-connectors.tsx`; it imports no credential-aware provider. All three libraries remain separate from the [final homepage](../product/marketing/site/README.md), owned by `components/landing`. Its server-rendered page and code controls surround one data-driven Fanout story; `/site` renders the same page for signed-in review.

## Design and contribution

See [architecture](README.md), [engineering](../engineering/README.md), and [contributing](../../CONTRIBUTING.md).

The [SDK architecture](../features/api/sdks/implementation.md) connects the shared OpenAPI contract to five public clients. Shared resource generation lives in `scripts/sdk/`; typed REST/model/resource sources live under `sdk/`. Maintained transports, constructors, stream helpers, and protocol fixtures stay separate. The generated [method index](../features/api/sdks/reference.md) maps every public operation across languages.

## Trigger intake and scheduling

[Trigger architecture](../features/triggers/implementation.md) maps the incoming HTTP routes, authorized configuration, encrypted receipts, existing SQL outbox, run admission and Slack reply phases. Scheduled tasks use the same maintenance path as existing background work.

## Model selection and pricing

The [model catalog](../features/execution/models.md) separates reviewed compatibility/retail rules in `packages/core/src/model-policy.ts`, shared PostgreSQL cache/claims in `model-catalog.ts`, and provider discovery in `packages/providers/src/model-catalog.ts`. Existing maintenance refreshes availability; admission freezes the selected prices for gateway settlement. The public API and dashboard use the same cached selection.

## Named connections

Named account configuration is owned by `packages/core/src/connections.ts` and `claude-connections.ts`; Composio authorization by `composio-auth.ts`; native authentication path exclusions by `packages/runtime/src/auth-paths.ts`. See [feature behavior](../features/identity-integrations/named-connections.md) and [remaining subscription architecture](../engineering/testing/named-connections.md).

The native adapter registry lives in `packages/contracts/harnesses.ts`; the sandbox worker selects Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness or Pi. The [Unified Harness Interface](../features/execution/unified-harness-interface.md) is implemented by `HarnessAdapter` in `packages/runtime/src/types.ts` and defines the contribution boundary. [Harness architecture](../features/execution/runtime.md#harness-adapters) explains the embedded cores, private process bridge and shared gateway/checkpoint boundaries.

## Typed policy and preparation boundaries

`packages/core/src/cloud-engine.ts` owns durable execution phases and their internal timings. `execution-hydration.ts` bounds and verifies restore batches through the existing machine-provider port; it leaves SQL progress and leases in the engine. Workflow and the standalone poller honor its explicit waits and immediately continue ready phases. See [startup latency](../features/execution/runtime.md#startup-latency-and-measurement).

`packages/core/src/resource-models.ts` maps persisted resource data to concrete domain models; `api-types.ts` checks handler results against the public contract. `operations.ts` requires an explicit scope and resource binding for every operation result. The [agent permission guide](../features/execution/permissions.md) maps canonical policies, admission and native enforcement.

Small file mutations use a bounded storage preparation lease, immutable object/Git preparation outside SQL, and a short revision-checked publication transaction. See [file implementation](../features/workspaces/implementation.md). Provider wire details live behind `ModelProtocol`; the shared gateway retains authority, credential selection, reservations and settlement. See [billing implementation](../features/billing/implementation.md).

Dashboard public data access uses the typed operation interface in `lib/dashboard-data.ts`. `components/files/use-file-document.ts` owns the editor buffer and conflict revision, while the browser component owns tree presentation. Global focus, hover, scrollbar and reduced-motion rules live in `app/interaction.css`; see [dashboard implementation](../features/dashboard/implementation.md).

## Optional integration paths

[Customer-agent composition](../features/customer-agents/implementation.md) keeps app identity mapping in `customer-agents.ts`, operation delegation in `customer-agent-handlers.ts`, capability-to-policy mapping in `customer-agent-connections.ts`, and short-lived consent in `customer-connect.ts`. Provider protocol details stay behind `CustomerConnectorProvider`; execution and permission enforcement remain in their existing owners. Public endpoint names, SDK grouping and documentation identify this as an optional use-case path.

## Connector access

The pure connection-access-policy module defines exact matching and selection precedence. connection-access owns tenant SQL queries and versioned edits; connection-access-resolution owns previews, admission and current snapshot checks. The broker consumes this resolver at listing and final dispatch. Providers own protocol details and cannot grant authority. [Implementation map and activation](../engineering/testing/connection-access.md).

## Customer applications and operator setup

[Examples](../../examples/README.md) stay outside core domain policy. `examples/personal-agent/store.ts` owns the application customer/agent mapping and durable step journal; `service.ts` composes the public SDK, and `server.ts` injects customer authentication. The file-memory helper is opt-in. Data adapters implement a bounded customer-scoped read port; the Prisma package has its own lockfile and acceptance, with no platform ORM dependency.

`packages/core/src/connector-setup.ts` coordinates operator setup through `ConnectorSetupProvider`; the Composio adapter owns discovery and managed auth creation. `connector-enablement.ts` provides read-only serving configuration. `trigger-quota.ts` owns saved-trigger counts/limits. Migration 033 and the operator-only `connectors:setup` / `triggers:quota` commands configure these policies without adding management-MCP writes. See [connector setup](../features/identity-integrations/composio.md) and [trigger implementation](../features/triggers/implementation.md).

## Files and media

[Media implementation](../features/media/implementation.md) maps path/hash admission in `core/run-attachments.ts`, bounded extraction behind the runtime `DocumentExtractor` port, native image mapping, gateway media accounting and shared verified artifact publication. Browser previews are separate from text editor state; upload preparation is shared by Files and the run composer.

## Customer MCP and operational tooling

[Customer MCP](../features/mcp/implementation.md) derives its tool catalog from `http-contract.ts` in `customer-mcp-catalog.ts`; `customer-mcp.ts` adapts the protocol to the existing authorized API pipeline. OAuth resource/audience ownership remains in `auth.ts`. The operator MCP remains separately read-only.

[Recovery](../operations/recovery.md) shares `scripts/recovery/archive.ts` between the operator CLI and independent install/restore acceptance. The object-store port supports archive verification without changing the active deployment. [Staging releases](../operations/staging-releases.md) separate workflow credentials/gates from the small release coordinator in `scripts/releases/staging.ts`; production promotion remains an operator procedure.

## Explicit-context execution

`decision.ts` owns the typed protocol contract; `inferences.ts` owns admission and `inference-engine.ts` durable provider steps. `bounded-decisions.ts` brokers immutable evidence reads. `decision-definitions.ts` and `context-artifacts.ts` own reusable inputs; `decision-tasks.ts` and `decision-task-engine.ts` own allocation, wake receipts and sequential coordination. Provider HTTP stays in `packages/providers/src/decision-protocols.ts`. [The ownership map](../features/decisions/implementation.md) covers migrations 035–038, scheduling, retention, presentation and rollout.

## Execution observability

[Tracing](../features/observability/implementation.md) uses the vendor-neutral `TraceSink` port in `packages/core/src/trace.ts` and composition in `tracing.ts`. `run-tracing.ts` owns tenant-scoped attribution and lifecycle observations; the gateway and decision executor supply committed usage/billing. `packages/providers/src/langfuse.ts` uses the official SDK and OTLP API. Next `after()` and durable-step `waitUntil` flush exports in the background; only worker shutdown awaits delivery. No SQL trace store is added. `billing-usage.ts` separately queries existing financial records for the itemized billing API.

## Reusable execution environments

`packages/core/src/sandboxes.ts` owns lifecycle, idle policy, worktree affinity and compute allocations; `sandbox-machines.ts` bridges it to the existing native execution port. `packages/contracts/sandbox-control.ts` owns the provider/control contracts. `packages/providers/src/sandboxes.ts` composes Vercel, Docker and Render adapters, while `packages/runtime/src/sandbox-control.ts` serializes authenticated operations on a reusable machine. See [runtime lifecycle](../features/execution/runtime.md#reusable-sandbox-lifecycle).
