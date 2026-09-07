# Architecture and ownership

Use the [codebase map](../../docs/architecture/codebase.md) and [accepted architecture](../../docs/architecture/README.md). Extend the existing modular application; a feature request is not an invitation to replace its stack.

## Dependency direction

| Layer                               | Responsibility                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/web` routes and composition   | HTTP/auth context, validated input, domain invocation, response/stream presentation, provider wiring               |
| `packages/core`                     | Shared authorization, business rules, lifecycle, accounting, persistence coordination, domain-owned provider ports |
| `packages/db`                       | Transactions, restricted roles, RLS, migrations, database access primitives                                        |
| `packages/providers`                | Vendor SDK/protocol adaptation behind the domain's ports                                                           |
| `packages/runtime`                  | Protected supervisor, isolated native harness execution, filesystem recovery                                       |
| CLI and SDKs                        | Public API clients; never direct database access or privileged server shortcuts                                    |
| `packages/contracts` and `docs/api` | Owned schemas and public compatibility contracts                                                                   |

Keep domain policy independent of Next.js, Vercel, Stripe, and provider SDK types. `packages/core` also contains application orchestration, including existing vendor composition; it is not a wholly vendor-free package. Preserve those working flows and use existing ports. Extract another adapter only for a concrete isolation, testing, or replacement need, not a package-wide purity rewrite. A provider port with one implementation may still be a necessary security or isolation boundary.

## Sources of truth

PostgreSQL owns accepted jobs, authorization context, reservations, leases, and lifecycle state. Object storage owns verified persisted bytes. Sandboxes, UI caches, and delivery channels are replaceable infrastructure. Route handlers, dashboard components, CLI commands, and management MCP must call the same policy owner rather than implement competing checks.

Model state transitions explicitly and keep execution, persistence, and Git synchronization outcomes separate. Preserve public contract compatibility; regenerate clients when owned schemas change. Keep one validation policy at each trust boundary rather than repeated parsing at every internal call.

## Change the architecture only for a present need

Prefer local composition and existing deployment infrastructure. Keep the Vercel-first/provider-port topology from [portability](../../docs/architecture/portability.md). A new service, queue, cache, framework, storage system, or generic abstraction needs a current requirement or measured bottleneck and a short explanation of failure/operational cost.

Record consequential decisions in the existing feature or architecture document: what constraint changed, why the small existing approach no longer works, and how compatibility/recovery is preserved. Do not create an ADR for routine extraction or styling. Keep future possibilities in a follow-up, not dormant production machinery.
