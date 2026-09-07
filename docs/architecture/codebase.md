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

## Design and contribution

See [architecture](README.md), [engineering](../engineering/README.md), and [contributing](../../CONTRIBUTING.md).
