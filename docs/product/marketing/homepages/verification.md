# Homepage study verification

These checks cover the public `/homepages` gallery and its ten Swarm homepage compositions. They exercise illustrative UI and public SDK transports, not native cloud execution. No provider calls, paid APIs, customer data, database mutations, or production configuration are involved.

## Browser and visual checks

The 12 Chromium journeys in [homepages.spec.ts](../../../../tests/browser/homepages.spec.ts) cover all ten compositions: exact approved hero copy, code before features, image loading, language keyboard navigation, actual scroll-driven stage changes, selected interface routing, pause, axe WCAG A/AA checks, mobile layout, responsive feature navigation, and reduced motion. Shared checks cover clipboard content, gallery navigation, unknown-route 404s, guided step boundaries, keyboard selection, and JavaScript-free feature summaries.

All 12 new journeys pass. The existing 13 [original-gallery journeys](../../../../tests/browser/concepts.spec.ts) also pass, including animation notes, hover, focus, Escape, and touch behavior. Tests run against the existing unpaid local preview without restarting it or accessing its accounts. Desktop/mobile screenshots are saved in the selected test output directory.

Visual review covers the seven hero compositions, both galleries, code, feature layouts, routing, and mobile presentation. It caught an oversized interface-icon rule and a sticky mobile diagram that obscured feature text. Diagram sizing now targets the main SVG, with a regression assertion for control icons. Small-screen scrolling stories use selectable panels. Pausing motion leaves feature text fully readable rather than freezing its entrance fade.

Run the focused browser suites against a running free local preview:

```sh
APP_ORIGIN=http://localhost:3210 pnpm exec playwright test tests/browser/homepages.spec.ts tests/browser/concepts.spec.ts --output=test-results/homepages --reporter=list
```

## Example and build checks

The two [homepage example tests](../../../../tests/unit/homepage-examples.test.ts) execute the authored TypeScript snippets through the real SDK with a deterministic transport. They verify the five-field new-run request, authorization/idempotency headers, returned-session continuation, and terminal streamed event. Together with the existing seven SDK tests, all nine pass.

The three authored Python examples were also executed through the real Python client and `httpx.MockTransport`: new run, stream, and continuation produced the expected requests/events, and all clients closed. This is a manual fixture check; it does not add Python measurements to TypeScript coverage. cURL fields and CLI commands were checked against the current API/CLI contracts; these examples did not launch a paid run or live provider session.

Strict TypeScript checking, documentation checks, and the isolated optimized Next.js build pass. The build emits all ten homepage routes as static pages. Its output and type-check configuration live under a separate ignored `.next` subdirectory, leaving the preview's build and local services intact. The illustrations need no new dependency or infrastructure.

```sh
pnpm exec vitest run tests/unit/homepage-examples.test.ts tests/unit/sdk.test.ts
pnpm exec tsc --noEmit --incremental false
pnpm docs:check
```

## Acceptance boundaries

These pages explain existing capabilities; their diagrams make no API calls and do not prove native execution, GitHub synchronization, model billing, or deployed streaming. Those acceptance records remain in the corresponding feature and launch guides. The complete application suite and coverage/mutation measurements were not rerun for this presentation change.

The Swarm hero is a static original with implemented CSS light/drift. It is not a real-time particle renderer. The SVG feature traces, commit pulses, selection and routing transitions are implemented. Safari/Firefox, physical mobile devices, deployed loading/caching, frame pacing and final media budgets remain checks for the selected production page. Local axe and responsive checks do not prove usability or conversion.

The canonical homepage is unchanged. Both galleries remain noindexed and outside the public sitemap. Publication decisions and device/deployment acceptance stay in [release TODO](../../../maintainers/TODO.md#marketing-publication).
