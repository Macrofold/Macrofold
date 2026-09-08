# Codebase map

Find the source module that owns a behavior, then read its feature guide before making changes.

## Module responsibilities

| Location                                                             | Responsibility                                                                                     | Documentation                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [apps/web](../../apps/web)                                           | Dashboard shell, views, HTTP routes, Vercel Workflow entry points                                  | [Dashboard](../features/dashboard/README.md), [API](../features/api/README.md)                             |
| [packages/core](../../packages/core/src)                             | Authorization, execution, workspaces, billing and reporting services                               | [Feature index](../features/README.md)                                                                     |
| [packages/db](../../packages/db)                                     | PostgreSQL migrations, tenant transactions and connection pools                                    | [Architecture](../architecture/README.md)                                                                  |
| [packages/providers](../../packages/providers/src)                   | Sandbox, object storage, Git and other provider adapters                                           | [Portability](../architecture/portability.md), [integrations](../features/identity-integrations/README.md) |
| [packages/runtime](../../packages/runtime)                           | Protected sandbox supervisor and native harness adapters                                           | [Runtime implementation](../features/execution/runtime.md)                                                 |
| [packages/cli](../../packages/cli), [sdk](../../sdk)                 | Terminal and programmatic clients of the public API                                                | [CLI](../features/cli/README.md), [API](../features/api/README.md)                                         |
| [packages/contracts](../../packages/contracts), [docs/api](../api)   | Generated public types and machine-readable contracts; private dashboard signal types are separate | [API contracts](../features/api/README.md)                                                                 |
| [tests](../../tests), [scripts](../../scripts), [infra](../../infra) | Local acceptance, setup, migration, maintenance and deployable images                              | [Engineering](../engineering/README.md), [operations](../operations/README.md)                             |

## Product presentation

The [ten marketing concepts](../product/marketing/README.md) share server-rendered product content, route-scoped SVG/CSS artwork, and small interactive controls. They live under `apps/web/app/concepts` and `apps/web/components/concepts`; the production homepage is independent.

## Design and contribution

See [architecture](README.md), [engineering](../engineering/README.md), and [contributing](../../CONTRIBUTING.md).

The [SDK architecture](../features/api/sdks/implementation.md) connects the shared OpenAPI contract to five public clients. Shared resource generation lives in `scripts/sdk/`; typed REST/model/resource sources live under `sdk/`. Maintained transports, constructors, stream helpers, and protocol fixtures stay separate. The generated [method index](../features/api/sdks/reference.md) maps every public operation across languages.

## Trigger intake and scheduling

[Trigger architecture](../features/triggers/implementation.md) maps the incoming HTTP routes, authorized configuration, encrypted receipts, existing SQL outbox, run admission and Slack reply phases. Scheduled tasks use the same maintenance path as existing background work.
