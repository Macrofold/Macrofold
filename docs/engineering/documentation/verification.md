# Documentation verification

The documentation acceptance suite uses public pages and synthetic local fixtures. It makes no model, sandbox, payment, email, or connector-provider calls and does not attach to the running preview.

## Verified behavior

| Check                           | Result and scope                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publication and links           | 24 published pages; 84 Markdown files and 54 requirement mappings pass generation drift, local target, heading-anchor, and reachability checks                                                                                                                     |
| Focused regression tests        | 27 tests pass across documentation, contract inventory, and coverage collection; eight documentation tests cover explicit publication, private-path rejection, generated drift, links, headings, all-guide server rendering, exports, and current OpenAPI metadata |
| Full TypeScript domain suite    | 425 tests in 61 files pass; 192 application files remain visible in coverage; 48.71% lines, 47.53% statements, 38.74% branches, and 38.95% functions, with existing floors unchanged                                                                               |
| Strict checks and build         | `pnpm check`, generated API/client contracts, and the isolated optimized Next.js/Workflow build pass; all 24 guide pages are generated                                                                                                                             |
| Browser acceptance              | Six journeys pass on Chromium with one worker and no retries, including the existing dashboard files → run → historical output journey                                                                                                                             |
| Public routes                   | Every published HTML/Markdown route, canonical URL, sitemap entry, search/agent index, unknown-page 404, and unpublished-source 404 is checked; a guide is readable with JavaScript disabled                                                                       |
| Documentation UX                | Persistent shell navigation, keyboard search, failed-fetch retry, empty results, anchors, clipboard success/failure, mobile menu, and horizontal overflow checks pass                                                                                              |
| Accessibility and visual review | WCAG A/AA axe checks pass on the sampled landing/pricing/docs, search-dialog, API, and mobile billing views; desktop/mobile screenshots were visually reviewed                                                                                                     |
| Client regression acceptance    | Four CLI subprocess cases, the real POSIX terminal journey, and Python HTTP/SSE continuation pass against the final isolated build                                                                                                                                 |
| Executable guide                | The cURL quickstart's actual shell blocks create a project and run, stream `run.succeeded`, and retrieve a final result through the isolated application and simulator worker; only the service origin is replaced                                                 |

The full domain coverage measurement precedes the final metadata test and keyboard-scroll rendering adjustment; the focused checks and browser build cover those changes. Supplemental server/browser/worker/CLI observations are retained for this targeted run, but a new complete combined/native coverage percentage is not claimed. The preceding complete baseline remains in [testing and CI](../testing.md).

## Reproduce the documentation acceptance

Use the unpaid local prerequisites from [testing and CI](../testing.md). Choose a new coverage directory for each run:

```sh
pnpm docs:check
pnpm check
pnpm test:domain tests/unit/docs.test.ts tests/unit/coverage-pipeline.test.ts tests/unit/manifest.test.ts
COVERAGE_DIR=coverage/docs-review pnpm test:dashboard:isolated tests/browser/public.spec.ts tests/browser/docs.spec.ts tests/browser/dashboard.spec.ts
```

The isolated runner also executes the four CLI subprocess tests, the real POSIX terminal journey, and Python HTTP/SSE continuation. It creates disposable PostgreSQL/files and a separate application/worker port, then cleans up those fixtures. Build output has its own strict TypeScript configuration so another preview's generated route validators cannot contaminate acceptance. JavaScript-disabled browser contexts have no client execution coverage to collect.

The final acceptance artifacts use `coverage/docs-publication-20260906-final`; browser screenshots and traces use ignored `test-results` and `playwright-report`. These are local evidence locations, not shipped documentation assets.

The server shutdown log contains a V8 “Precise coverage has not been started” diagnostic. Acceptance exited successfully and captured observations are retained, but this targeted run is not evidence of complete supplemental coverage. Use a fresh full collection and its required-surface gates for a release coverage claim.

## Hosted acceptance

Verify canonical URLs and metadata with the production build's `APP_ORIGIN`, public source links after the release is pushed, deployed caching/content types, and crawler access on the real domain. Search Console setup, package publication, and GitHub private reporting are separate maintainer tasks in [release TODO](../../maintainers/TODO.md).

Automated accessibility checks and Chromium acceptance do not establish complete assistive-technology, Safari/Firefox, or hosted-edge compatibility. No new native-container, live-provider, mutation, or cloud deployment run was performed for the documentation change.
