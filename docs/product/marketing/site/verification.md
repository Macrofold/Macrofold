# Marketing-site verification

[Feature guide](README.md) describes the homepage; [pricing](pricing.md) describes estimates and sales-assisted offers. Checks use public synthetic examples and local rendering. No customer records, subscriptions, or paid provider calls are involved.

## Current checks

The latest onboarding follow-up passes **39 TypeScript unit/SDK/CLI contract tests**, **117 Python HTTPX contract tests**, and the focused homepage browser journey. The exact displayed TypeScript example passes the API request schema and streams text; the exact Python example traverses typed response/event parsing and closes its client. A clean temporary npm installation verifies the `macrofold` executable, help, and SDK public exports under Node 24. The new browser assertions verify direct harness/model selection, no prerequisite session, public imports, and the CLI command. No provider execution occurred. Earlier visual checks below were not all repeated for these copy/example changes.

All **12 Chromium journeys** in the [landing suite](../../../../tests/browser/landing.spec.ts) passed across the final suite run and two focused reading follow-ups. The final full run passed ten checks; an older gallery timed out during navigation, and one scroll test still assumed the distance from the previous header layout. The gallery passed on its focused rerun. The scroll test now moves the actual chapter to the same focal point and retains its opacity, centering, and spacing assertions. Both pricing journeys were also rerun successfully after the final dark input-control and live-announcement polish. No timeouts, retries, or concurrency limits were increased.

The suite covers:

- Exact hero copy, sign-up/docs/source links, the Saddle lockup and favicon, sticky navigation, six benefits, integration marks, language tabs, and copying.
- Stronger cyan heading reflections, two-dimensional pointer response, ambient light, and unchanged button geometry. A pixel comparison requires changes inside the letters and zero changed background pixels outside their antialiased edges.
- Centered desktop diagrams, preserved worker identity, typed prompts, simultaneous filenames, checkpoint/Git convergence, four interface inputs, and ten rotating tool marks. The header and example selector leave room for the scene on short desktop windows.
- Playback enabled independently of system motion settings, replay after returning, and explicit Pause. Scroll-driven text fades remain independent of decorative playback.
- Keyboard operation, homepage/pricing accessibility scans, tall-phone layouts, short-screen fallback, resize recovery, no-JavaScript reading, the signed-out homepage, and all three preserved design libraries.
- Self-serve prices and limits, the Business/Enterprise presentation, dark pricing surfaces, managed/BYOK estimates, invalid-input recovery, separate provider costs, and navigation from the calculator.

All **17 unit/example tests** passed: thirteen calculator cases and four existing homepage/journey SDK examples. Calculator cases cover subscription versus credit allowance, managed versus BYOK funding, unused credits, fractional precision, supplied rates, zero usage, invalid inputs, and maximum supported inputs. They test the estimate, not the billing ledger or a paid checkout.

Repository TypeScript checking passed using a temporary incremental cache. Scoped Prettier and diff checks passed. The documentation generator verified 40 public pages; the link checker verified 141 Markdown files and 54 requirement mappings. Documentation checks ran through `node --import tsx scripts/docs/generate.ts --check` and `python3 scripts/check-docs.py`; this avoids the blocked local IPC socket used by the `tsx` CLI.

## Visual inspection and artifacts

Connector-color inspection covers all four use cases at desktop and tall-phone sizes. All 17 distinct local SVGs decode; pixel checks confirm color in the colored brands, computed styles apply no recoloring filter, and the orbit keeps running. Desktop and phone screenshots were inspected. Asset validation rejects placeholder artwork, scripts, and external image references; documentation checks pass. This visual-only change adds no new behavioral test and does not repeat the full suite.

Heading-scope inspection confirms plain scrolling copy and benefit titles on desktop, tall phones, and the short-screen layout, including tile hover. Pricing-card titles are also plain. The two existing reflection and chapter-fade journeys pass in `test-results/gleam-heading-scope`; large-heading/button reflections and scroll fades remain working. This styling-only adjustment adds no new behavioral test.

The in-app browser was inspected for the public logo, hero, plan cards, and sticky navigation. Chromium screenshots were inspected for heading masking, the centered scene, phone interfaces, and desktop/mobile calculator layouts. Desktop coverage includes 1440 × 1000 and 1280 × 720; phone coverage includes 390 × 844 and the ordinary-flow fallback at 390 × 667.

The snippet follow-up artifact is in `test-results/snippets-onboarding`. Earlier browser artifacts live in the ignored `test-results/landing-pricing-final`, `test-results/landing-pricing-reading`, and `test-results/landing-pricing-polish` directories. The former retains the two initial reading failures; the latter records their passing follow-ups. Earlier `landing-pricing-refresh` and `landing-pricing-corrections` artifacts record the short-window layout regression, a pixel-test misclassification at one antialiased glyph edge, and interrupted checks under heavy host load. The layout and pixel classification were corrected without weakening the intended assertions. The favicon uses the supplied static mark through root metadata; its request check follows Chromium’s local IPv4 mapping.

## Scope and remaining acceptance

Changes are public presentation, branding, estimate arithmetic, examples, CLI executable naming, and local checks. Run admission and API defaults remain unchanged; projects and funding are still explicit, and the catalog determines the model provider. No billing entitlement, checkout, native execution, authentication, or provider integration was changed. Business and Enterprise require agreed terms and activation work; a configured public email is needed for sales links. [Maintainer TODO](../../../maintainers/TODO.md#marketing-publication) owns these release tasks.

No dependency was added. The running preview and unrelated work were preserved. The current optimized production build was not repeated on this heavily loaded machine; an earlier release build does not validate this source.

Before publication, build the reviewed source and verify the deployed hostname, asset delivery, real contact/sign-up/docs/repository links, Safari/Firefox, and physical devices. Measure loading and frame pacing on representative hardware. Hidden-tab suspension is implemented but was not exercised through a real background/foreground transition in this pass. Local rendering and calculator checks do not establish live billing, cloud packaging, or sustained frame rate.
