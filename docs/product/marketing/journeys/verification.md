# Journey library verification

The scope is `/journeys`, its ten pages, public connector discovery, and the displayed SDK examples. No paid execution, customer data, provider authentication, database fixtures, or production settings are involved.

## Verification scope

The [browser suite](../../../../tests/browser/journeys.spec.ts) checks approved copy and links, loaded hero marks, keyboard language selection, actual scroll progression, checkpoint and interface counts, changed use-case context, connector choices, clipboard output, mobile controls, reduced motion, static content, gallery preservation, unknown routes, and connector search/pagination/retry. Accessibility checks use axe WCAG A/AA rules. Desktop/mobile screenshots accompany the run.

The [unit fixtures](../../../../tests/unit/journey-examples.test.ts) execute the actual TypeScript run-and-stream example through the SDK with a deterministic transport, checking request shape, credentials, idempotency, and the terminal event. They also verify that public catalog data contains every snapshot entry and only public metadata. These tests do not duplicate provider authentication or toolkit behavior.

## Measured results

All **14 new Chromium journeys pass across scoped runs**, including all ten desktop/mobile page variants, switched use cases, the new and preserved galleries, connector search/pagination/retry, and JavaScript-free content. An initial pass exposed ambiguous test selectors and delayed client-side gallery navigation. Selectors now target the named result region and exact toolkit; preview links use ordinary document navigation instead of prefetching entire study pages. The recovery checks pass. Accessibility checks passed for each homepage and the connector directory.

All **four TypeScript fixture tests** pass across the new journey suite and existing homepage-example suite. The authored Python snippet also passed through the actual SDK with `httpx.MockTransport`, including typed responses, streaming, and client closure. The actual cURL snippet passed against a disposable loopback HTTP server, including a rejected creation that must not start a stream. These latter checks are manual fixture executions, not TypeScript coverage measurements.

Strict TypeScript checking, documentation generation/link checks, and an isolated optimized Next.js build pass. The build emits the ten journey routes and connector export as static output. A separate temporary server used for checking that build was stopped; the existing preview was not restarted. Build and screenshot artifacts stay in ignored local paths.

Go/Rust snippets were checked against the generated resource methods and model types but were **not compiled locally**: neither toolchain is on this environment's command path. CLI syntax was checked against the existing command contract; this change does not run a native CLI job. SDK registry publication and real provider execution remain separate acceptance work. The complete application suite, mutation tests, and aggregate coverage were not rerun for this presentation change.

## Run locally

Against an existing unpaid local preview:

```sh
APP_ORIGIN=http://localhost:3210 pnpm exec playwright test tests/browser/journeys.spec.ts --output=test-results/journeys --reporter=list
pnpm exec vitest run tests/unit/journey-examples.test.ts tests/unit/homepage-examples.test.ts
pnpm exec tsc --noEmit --incremental false
pnpm docs:check
```

## Acceptance boundaries

These are design studies, not evidence of production conversion, capacity, native execution, Git sync, billing settlement, or successful authorization to every catalog app. No automatic repository star or native schedule is implemented. Public metadata is a release snapshot; individual tool availability is controlled by authentication, pinned versions, and explicit grants.

Safari/Firefox, physical devices, hosted image delivery, production frame pacing, published SDK package installation, and the final hosted API origin remain publication acceptance checks. The canonical homepage and both prior design libraries remain unchanged.
