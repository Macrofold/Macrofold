# Marketing verification

The marketing suite targets public `/concepts` pages. It does not create users, jobs, database fixtures, or provider requests. The canonical homepage and dashboard are outside this change.

## Local checks

The updated `tests/browser/concepts.spec.ts` contains 13 passing Chromium journeys, run against the existing local preview. All ten directions exercise product copy, generated image loading, language tabs and keyboard navigation, focus/Escape motion notes, workflow selection, pause, desktop/mobile layout, reduced motion, JavaScript errors, and an axe WCAG A/AA audit. Shared checks cover gallery navigation, clipboard content, unknown routes, JavaScript-free content, pointer hover, and touch toggle behavior.

The suite writes desktop/mobile screenshots to its configured test output directory. Visual inspection also covers every generated original, the five hero compositions, code and explanatory sections, and the animation-note overlay. Automated checks complement visual review; they do not establish usability, conversion, or live infrastructure performance.

Run only the marketing journeys against an already-running unpaid local app:

```sh
APP_ORIGIN=http://localhost:3210 pnpm exec playwright test tests/browser/concepts.spec.ts --output test-results/marketing --reporter=list
```

No new package, database service, provider key, or paid API is required for these checks. Image concepts were created using the built-in image-generation tool; no repository provider credentials were used.

Strict TypeScript checking (`pnpm exec tsc --noEmit --incremental false`) and `pnpm docs:check` also pass. The documentation check verifies generated public pages and local Markdown targets.

Direct HTTP checks pass for the gallery and its documentation, SDK, pricing, login, and API-reference destinations. The separate canonical `/` route returned HTTP 500 because its session lookup could not connect to local PostgreSQL on port 55432. That database was not started or reconfigured during this design task. Recheck the canonical homepage with its local services running; the independent concept routes render successfully without them.

## Measurement limits and production follow-up

Hero images are static posters with proposed motion descriptions. Only the small explanatory trace is animated. Encoding and device acceptance of a selected hero video, shader, or Rive scene remain future work. Verify loading priority, caching, transferred bytes, frame pacing, accessibility, and reduced-motion behavior on the chosen hosting deployment and representative devices.

Only Chromium is covered here. Safari/Firefox acceptance and a production build of the selected direction remain release checks. Selecting a direction, final brand copy, public package publication, and promoting the canonical homepage remain separate work in the [release TODO](../../maintainers/TODO.md).
