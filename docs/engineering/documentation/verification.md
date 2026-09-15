# Documentation verification

The documentation uses Macrofold’s shared Saddle identity and product palette across guides, search, code examples, connector discovery and mobile navigation. [Documentation architecture](../documentation.md) owns the implementation; this record distinguishes rendered/local evidence from hosted acceptance.

## Current local results

| Check | Result and scope |
| --- | --- |
| Navigation appearance | The existing branded-docs Playwright journey passes after the CSS-only header correction, using a fresh browser context against the public local preview. Desktop light/dark screenshots confirm the matching header and contrasting lockup; appearance persistence, mobile layout, search and axe checks pass. This follow-up performs no account or data mutations. |
| Optimized build | Next.js production compilation, application TypeScript and static generation pass, including all 52 published documentation pages. |
| Documentation browser/API journeys | All 7 pass against an isolated optimized application and simulator worker. They cover appearance persistence, desktop/mobile accessibility, keyboard focus return, navigation/search/error recovery, clipboard feedback, all public HTML/Markdown pages, sitemap, no-JavaScript reading, and execution of the published cURL/Python examples with sequential preset handoff. |
| Documentation unit tests | All 11 pass, covering route inventory, private-path rejection, source drift, heading anchors, server rendering, metadata, search and agent exports. |
| Command-line acceptance | All 6 CLI subprocess tests pass, including command-inventory enumeration at its existing timeout. The real-terminal journey and Python HTTP/SSE with persisted session continuation also pass. |
| Strict TypeScript | `pnpm check` passes, including SDK build and application/test types. |
| Generation and links | All 52 public pages pass drift checks; 180 Markdown files and 54 requirement evidence mappings have valid local targets. |
| Visual review | Reviewed the landing page, customer-agent guide, code blocks, search and mobile navigation in the running preview. Automated screenshots cover light/dark desktop, the landing page and mobile search/reading; layout checks include 900, 390 and 320-pixel widths. Axe reports no violations in the tested states. |

The complete isolated runner passed for the branded shell before the navigation appearance correction on September 11, 2026 with Node 24.13.0, the normal Docker PostgreSQL 17 and Mailpit services, and the pinned Playwright Chromium browser. It built an optimized application and simulator worker against a fresh disposable database, checked the build source manifest, ran the browser/API, CLI, terminal and Python surfaces above and cleaned up its fixtures. Evidence is retained under `coverage/docs-branding-docker/`; the existing developer preview and its data were preserved. The CSS-only follow-up reran the relevant existing browser journey and documentation checks, without repeating the production build or unrelated CLI/API checks.

This successful run supersedes the earlier disk-space, unavailable-Docker and missing-browser failures, as well as the ancillary CLI timeout. No CLI implementation or timeout changed. These results establish local UI/API simulation behavior, not live Cloud acceptance, model reasoning, email delivery or hosted crawler acceptance. Earlier customer-agent acceptance is recorded [separately](../testing/customer-agents.md).

## Reproduce the checks

Use the [local test prerequisites](../../../TESTING.md), including Node 24, the pinned Playwright Chromium browser and Python SDK dependencies. With the normal test database available:

```sh
pnpm docs:generate
pnpm docs:check
pnpm check
pnpm exec vitest run tests/unit/docs.test.ts
COVERAGE_DIR=coverage/docs-branding-next pnpm test:dashboard:isolated tests/browser/docs.spec.ts
```

Choose a fresh coverage directory for each acceptance run. The isolated runner creates its own database, files, build, application port and worker, then cleans up its fixtures. It also runs the existing CLI subprocess, real-terminal and Python HTTP/SSE checks. It must not attach to the developer preview. Restore a missing test browser with `pnpm exec playwright install chromium`.

## Hosted and user acceptance

Verify Cloud account access, the real `APP_ORIGIN`, canonical metadata, source links, Markdown content types, caches and crawler access on the released hostname. Confirm SDK installation from the documented source and override the origin when testing self-hosting. Model availability and limits must come from the authenticated deployment.

Give the setup prompt to a coding agent in a small customer application and verify first-run, file-read, interruption recovery and sequential handoff tasks. A remote agent needs reachable docs or attached Markdown; localhost is not universally accessible. This live onboarding exercise has not been performed.

Safari/Firefox, assistive-technology review and cloud edge behavior remain unverified. Hosted publication and optional future skill/MCP distribution remain in the [maintainer backlog](../../maintainers/TODO.md#documentation-publication). No new native-container, provider, email or cloud execution acceptance is claimed for this branding change.
