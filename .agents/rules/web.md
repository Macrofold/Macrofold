# Web application

Read `apps/web/AGENTS.md` and the relevant installed Next.js documentation before Next.js changes. Use the current React, TanStack Query, Radix, Tailwind/CSS, and component patterns; do not add a competing frontend or state library for a routine feature.

Before changing visual design, product copy, or interaction patterns, read the [Design Language](../../docs/product/design-language.md). It owns design preferences and reference priorities; consult linked research as needed rather than copying those preferences into new rules.

## Boundaries and data

Keep route handlers thin and authorize through the existing server/domain boundary. A layout, hidden button, middleware redirect, or client route guard is not resource authorization. Pass minimal safe data to client components; keep credentials and privileged objects server-side. Treat server actions, if added, as public mutation endpoints.

Use server components for noninteractive server-rendered content and client components where interaction requires them. Preserve the dashboard's existing query-driven shell. Do not rewrite a working client flow just to match a new tutorial. Scope caching by authorized data identity; never place tenant responses or mutable request state in an unscoped module/global cache.

Query keys must distinguish organization, resource, and meaningful filters. Reuse query helpers and mutation invalidation. On identity/organization changes, prevent old requests and cached data from appearing in the new context. Show usable initial loading, background refresh, empty, error, retry, and pending-mutation states; preserve selections and unsaved work.

When an editor mirrors query data, keep its draft protected until the post-save cache contains the saved revision. Test a delayed refresh; clearing the dirty flag before invalidation completes can restore stale content.

## React and interaction

Derive values during rendering when possible. Handle user-triggered work in event handlers. Effects synchronize with external systems and must clean up; do not suppress dependencies to hide stale closures. Keep state close to its owner, avoid duplicated derived state, and make subscription setup/teardown safe across remounts.

Use established components and design tokens. Preserve semantic elements, accessible names, keyboard operation, focus management, contrast, reduced motion, and readable errors. Radix supplies interaction primitives, not complete application accessibility. Reuse chart/table/editor packages with accessible context; visually inspect meaningful desktop/mobile changes.

## Performance and freshness

Fix avoidable fetch waterfalls, oversized client payloads, and heavy eagerly loaded features before micro-optimizing rendering. Introduce memoization, virtualization, or new caching only for an observed issue or known workload requirement.

Preserve detailed run SSE/replay and the separate shared dashboard refresh channel. Coalesce invalidations, reconcile after reconnect, and release subscriptions on logout/organization switch/unmount. Do not turn best-effort freshness into a claimed durable delivery contract. See [dashboard refresh](../../docs/features/dashboard/live-refresh.md).
