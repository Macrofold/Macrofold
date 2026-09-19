# Customer-agent integration path implementation

This optional path composes the existing resource model. The server owns a minimal binding; the integrating application owns authentication, customer-facing lifecycle, callback state and action IDs. The [public guide](README.md) and [connection guide](connections.md) describe the supported behavior.

## Owners and interfaces

| Owner                                                                                       | Responsibility                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [customer-agents.ts](../../../packages/core/src/customer-agents.ts)                         | Atomic ensure, member/customer scoping, conversation and run checks                   |
| [customer-agent-handlers.ts](../../../packages/core/src/customer-agent-handlers.ts)         | API composition; delegates execution, reads and cancellation to existing services     |
| [customer-agent-connections.ts](../../../packages/core/src/customer-agent-connections.ts)   | Reviewed capabilities mapped to existing tool ceilings and workspace/preset rules       |
| [customer-connect.ts](../../../packages/core/src/customer-connect.ts)                       | Short-lived consent, app-confirmed identity, recovery receipts and permission fencing |
| [customer-connector-provider.ts](../../../packages/core/src/customer-connector-provider.ts) | Small catalog/start/complete provider port                                            |
| [composio-consent.ts](../../../packages/providers/src/composio-consent.ts)                  | Pinned SDK and fixed provider verification protocol, shared with dashboard consent    |
| [migration 034](../../../packages/db/034_customer_agent_path.sql)                           | Tenant-RLS bindings, connection capability metadata and expiring consent attempts     |
| [React controls](../../../sdk/typescript/src/react.tsx)                                     | Optional presentation callbacks, no platform credential or app authentication logic   |
| [hosted consent](../../../apps/web/components/customer-connect.tsx)                         | Branded, accessible capability selection without requiring a Macrofold login          |

OpenAPI tags these operations `customerAgents` and `x-platform-layer: integration-path`. All five generated SDKs expose the path; maintained stream transports share their cursor/detach algorithms with core run streaming. TypeScript additionally binds its existing text/wait helpers to ownership-checked endpoints. No new management-MCP or CLI resource group is introduced.

## Transactions and external effects

Ensure serializes the organization/owner/customer/key and creates the workspace, default worktree, preset and binding in one database transaction. Unique constraints enforce that mapping. IDs remain the core authorities for downstream persistence and execution; the binding only adds ownership resolution.

Tool catalogs and provider calls happen outside the API commit transaction. Consent stores dispatch state before account creation or single-use verification. The browser callback stores an encrypted opaque provider URI and returns a separate one-time code. Completion requires an authenticated app assertion of the same customer and rechecks the original delegating credential, current membership, binding, connection and attempt. A verified receipt survives a failed local commit; a completed attempt cannot activate twice. Permission-version snapshots prevent revocation during consent from being overwritten.

Account creation has no provider idempotency guarantee. An uncertain `starting` attempt blocks a new link; an operator must inspect the exact recorded account/alias and provider logs, reconcile the same connection, and mark the attempt resolved before permitting another creation. Do not simply clear the record and retry. Refresh always targets a known account. No database transaction spans provider I/O in this new flow.

Maintenance removes expired encrypted URIs and old resolved attempts. Uncertain `starting`/`verifying` records remain available for reconciliation. Vault rotation includes encrypted consent URIs. Tickets, codes and provider URIs must stay out of request logs and analytics. The provider-specific subject is an opaque hash of organization, owning member and app customer, and the tool broker uses that subject with the exact bound account.

## Deliberate limits

- No customer directory, mandatory memory format, fleet scheduler or second run engine. Use core IDs for advanced edits, schedules and lifecycle actions.
- Bindings and connection capability definitions are creation-only. Owner transfer and changing a capability catalog need an explicit future migration design; they are not guessed from new credentials or display names.
- Provider consent requires owning administrative authority. Browser-link possession alone is not customer identity. The app’s callback must authenticate its own user.
- Local fixtures cover simulator execution and provider protocol boundaries. Live multi-account HTTPS consent and deployed-cookie behavior require separate acceptance in [maintainer TODO](../../maintainers/TODO.md).

See [integration tests](../../../tests/integration/customer-agent-path.test.ts) for ownership, concurrency, recovery and revocation evidence, and [SDK acceptance](../../engineering/testing/sdk-resources.md) for language transport verification.

## Verification and rollout

September 15, 2026 local acceptance:

- `pnpm check` and `pnpm docs:check` pass. Pre-existing OpenAPI paths retain their contracts; the new operations live only in the integration-path namespace.
- Disposable database suites cover customer ownership, concurrent ensure, idempotency, full API consent completion, expired/revoked authority, permission conflicts, uncertain dispatch and reconnect. Existing connector and tool-broker regressions pass, including both member and customer provider subjects.
- `pnpm test:sdks` passes against the isolated simulator for TypeScript, Python, Go, Rust and Java. Customer IDs containing spaces, slashes and non-Latin characters survive transport; streams, saved files and wrong-customer denials are exercised.
- An optimized application build and nine Playwright journeys pass for customer consent, embedded controls and documentation. Checks include light/dark appearance, mobile layout, keyboard disclosure, axe accessibility, stale permission drafts and inline error recovery. Provider consent itself uses deterministic protocol fixtures, not real accounts.
- The same isolated application acceptance also passes six CLI tests, real-terminal interaction and Python SDK execution/persistence checks. No paid provider calls were made.

Migration 034 is additive and needs no backfill. Apply it before starting the updated web and worker processes. It has been exercised on disposable databases; this task does not migrate or restart the existing preview. Before enabling customer consent in a deployment, complete the explicit multi-account HTTPS/provider acceptance in [maintainer TODO](../../maintainers/TODO.md).
