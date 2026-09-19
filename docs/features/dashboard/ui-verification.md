# Dashboard UI verification

Contributor evidence for the [dashboard interface](implementation.md) and [design language](../../product/design-language.md). This record separates current copy timing from earlier motion, file/navigation, and dashboard acceptance. None establishes a deployed release or live provider acceptance.

## Copy confirmation timing

The shared copy control now returns from its green check to the copy icon three seconds after a successful write. Copying again restarts the timer after success; changed content, failure and unmount still invalidate feedback. Earlier persistent-check evidence below describes the previous behavior.

All seven cases in `tests/browser/copy-feedback.spec.ts` passed against the local development preview using isolated browser contexts and public pages, without changing account data. The suite verifies the three-second deadline with a controlled browser clock, repeated clipboard writes and timer restart, unchanged labels/dimensions, animated checks in both motion modes, changed content, pending writes, denied clipboard access, and late completions after unmount. No production build or provider acceptance was rerun for this client-only change.

## Worktree editor and explicit playback

The September 10 update enables dashboard playback by default, independently of the system Reduce Motion preference. The account menu exposes a persistent Play/Pause animations control. Shared loading uses left-to-right waiting text, successful copy controls retain a green check, and the composer border rotates over 32 seconds. Dropdown exit animations retain their transparent final frame until Radix unmounts them.

Worktree creation accepts optional names and branches, validates saved branch choices, and defers an entirely blank identity until the first accepted task. Migration 030 preserves existing records and enforces trimmed, case-insensitive workspace name uniqueness. File menus add copy, duplicate, inline rename and drag-to-folder moves. Tiptap supplies the Rich toolbar; Source, Preview and unsaved Rich/Source diff remain available. Rich controls avoid unsupported block structures inside Markdown table cells. Viewing a document never rewrites its source.

The first browser pass caught unintended Tiptap updates during editable-state changes and menu focus restoration interrupting inline rename. The fixes suppress non-edit update events and defer inline input mounting until the menu focus trap closes. All **32 distinct focused browser cases** have passing evidence across the worktree follow-up: 14 motion/editor cases, six copy cases, three icon cases, four workspace-layout cases, and five sidebar cases. This is not a single full-suite invocation.

The final production run passed 13 of its 14 targeted motion/editor cases. Its remaining dropdown test installed a mutation observer concurrently with the outside click and missed the short closing event. The trace established the ordering defect in the test; awaiting observer installation corrected it. That case then passed against the same production application, with its source manifest verified unchanged. It checks the retained exit frame, actual border rotation, left-to-right loading sheen, and filter placement. All eight file journeys passed together, including both themes, drag-to-folder persistence, copy checks, inline rename, deferred names, concurrent edit protection, Rich controls, and accessibility. The production run also passed all five CLI cases, real PTY acceptance, and Python persisted continuation.

Local evidence lives in `output/worktree-ui-acceptance`, `output/worktree-ui-final`, `output/worktree-ui-accepted`, and `output/worktree-motion-recheck-results`. Intermediate editor checks used a disposable development server; final acceptance used the production build. Each runner owned its database and loopback server, and preserved the shared preview. Logs, fixtures, screenshots and traces are not published source.

The worktree API/Git tests pass after rejecting reserved `HEAD` branch names, including a database-observed concurrent name collision. All five SDK application journeys pass, including 155 Python cases and its type checks. Migration preflight found zero duplicate names in the local preview; migration 030 was applied without replacing its data. Documentation generation and link checks pass. No paid inference or cloud execution was used.

## Motion and persistent copy feedback

The active browser reported `prefers-reduced-motion: reduce`; the previous global rule disabled every transition. That follow-up preserved quick color, border, shadow, and opacity fades while suppressing spatial/decorative motion. The subsequent worktree update adds explicit dashboard playback, enabled by default, and a persistent Pause/Play animations control in the account menu. Text fields use a muted border and faint halo; keyboard-only button/link outlines and forced-color outlines remain. Copy labels stay unchanged, successful checks persist for the same content, and clicking a checked control writes again.

All **60 distinct focused Chromium cases** have passing evidence across this follow-up. This is not a single full-suite invocation: the first run passed 42 of 45 cases; the second passed 37 of 39; the final production build passed all eight final motion/file cases. The two larger sets overlap. Clipboard units passed all five cases; `pnpm check`, a final TypeScript check, optimized builds, and `pnpm docs:check` passed.

The motion matrix captures browser-owned transitions after real hover and keyboard events, then checks distinct rendered start/intermediate/end values. It covers buttons, nested labels, dropdown options, workspace list/grid, table rows, and standalone/composite focus in both themes with and without reduced motion. A separate forced-colors case verifies system outlines. Copy cases verify actual clipboard writes, persistent checks and unchanged dimensions, opacity/drawn-path transitions, changed content, pending writes, failure, and unmount recovery. Sidebar cases verify finite animations, replay, stable layout, keyboard access, and live reduced-motion changes. Existing file, theme, assistant, onboarding, documentation, and public-site journeys also passed in the applicable runs.

The checks exposed an additional paused-marketing rule disabling copy fades, an undefined hover-color token in workspace/folder rows, clipboard-error toast contrast, and a stale expanded-logo locator. Shared CSS and that locator were corrected without disabling accessibility checks. Source review also caught and corrected the forced-colors selector's specificity. The final eight cases passed after the row-hover fix; they include both interpolation matrices, forced colors, and all five file journeys. The final build records unchanged TypeScript and CSS source inventories. Live inspection in the in-app browser confirmed the muted one-pixel field border, five-percent halo, and 160 ms transitions while reduced motion was enabled.

Ignored evidence lives in `coverage/dashboard-motion`, `coverage/dashboard-motion-final`, and `coverage/dashboard-motion-accepted`. Each build owns a disposable database and loopback server; browser runners execute serially. The original developer previews remain separate. No paid model or cloud sandbox execution was used.

## File worktree, sidebar, and workspace layouts

All **22 distinct focused browser cases** have passing evidence: five file journeys, five sidebar cases, four workspace-layout cases, one pagination case, five refresh cases, and two draft cases. The final five file journeys passed together against the unchanged reviewed production build, including Rich Markdown accessibility in both themes and a concurrent-edit/rename regression.

| Check                             | Actual result                                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File browser cases                | Five passed: nested folders and reload, Markdown Rich/Source and axe in both themes, rename/upload/delete, failure recovery, duplicate submission prevention, full-height resizing, and concurrent source edits                                          |
| Sidebar browser cases             | Five passed: collapse and width persistence, pointer/keyboard resizing, limits/reset/cancellation, account menus, both themes, and mobile behavior                                                                                                       |
| Workspace-layout browser cases      | Four passed: default list, remembered grid, actual persisted workspaces, navigation, search/status filters, empty states, mobile layout and axe                                                                                                            |
| File cache and presentation units | 11 cache tests and 19 presentation tests passed, covering confirmed mutation publication, folder hierarchy/keyboard navigation, Markdown links, metadata, heading anchors, and accessible task-list labels                                               |
| Backend file acceptance           | Final focused 26-test run and broader 47-test run passed; these sets overlap and are not additive. Coverage includes authorization, revision conflicts, busy worktrees, atomic rename, collisions, rollback, pagination, and checkpoint/Git persistence |
| Client compatibility              | All five SDK journeys passed; the preceding isolated run also passed five CLI cases, the real PTY journey, and Python continuation                                                                                                                       |
| Static and documentation checks   | `pnpm check` and `pnpm docs:check` passed                                                                                                                                                                                                                |

The browser journeys exercise the full-height file view, persistent explorer resizing, folder creation, file rename/upload/deletion and reload, Rich/Source switching, safe links/previews, and mutation failure recovery. Rich Markdown passes axe in both themes, including task-list labels. The concurrent rename regression holds destination reads and verifies that older source text never becomes editable under the new revision; it passed. [Worktree implementation](../workspaces/implementation.md) owns persistence semantics; [navigation layout](sidebar.md) describes the sidebar controls.

Mobile exclusion checks inspect Chromium's native accessibility tree and verify that closed navigation refuses focus and is skipped by Tab. Playwright 1.63 role locators do not account for `inert`. Drawer bounds are checked after its computed transform settles, preserving the opening transition. Trace-driven fixes also addressed file labels, copy feedback during remounts, contrast, and confirmed cache updates; assertions and axe rules remain enabled. The preceding combined run passed 11 of 12 cases: its repeated dark journey reached the shared fixture account’s rate limit. File journeys now use separate principals and request budgets; all five passed on rerun without changing application rate limits or the reviewed build.

Ignored evidence directories are `coverage/file-worktree-acceptance`, `coverage/file-worktree-final`, `coverage/file-worktree-verified`, `coverage/file-worktree-complete`, `coverage/file-worktree-reviewed`, and `coverage/file-worktree-accepted`. These runs use disposable local fixtures and production builds, without paid inference or changes to the shared developer preview. Earlier dashboard evidence below retains its own source and scope.

## Earlier dashboard polish result and scope

All **129 distinct enabled Chromium browser cases** have passing evidence across the broad run and final focused checks. Six opt-in video exports were skipped. This was **not a single green full-suite invocation**: the second broad run finished with 128 passed, one failed, and six skipped. The remaining mobile submenu overflow was fixed and passed in the final focused run. That focused run passed 28 of 29 cases; its dark loading-button case timed out while opening the workspace dialog, before reaching contrast assertions. All four interaction cases then passed against the same final production build after the test explicitly waited for the fetched workspace grid before opening the dialog.

The original developer preview was preserved. Acceptance used separate builds, loopback ports, disposable PostgreSQL databases, and simulator workers. The final preview uses the same production build as the final focused checks. No paid model, subscription, or native cloud sandbox execution was performed. The assistant remains a deterministic UI preview; its tests establish local replies and navigation, not hosted intelligence or account actions.

## Verification evidence

| Check                                                | Actual result                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Templates, assistant, branding, clipboard unit tests | 39 passed across four files                                                                                                |
| Strict TypeScript and TypeScript SDK build           | `pnpm check` passed                                                                                                        |
| Optimized Next.js standalone build                   | Passed; final checks served the built application and actual public assets                                                 |
| Broad browser acceptance                             | 128 passed, one mobile submenu failure, six opt-in exports skipped                                                         |
| Final focused browser acceptance                     | 28 passed, including the corrected mobile submenu; one navigation-readiness timeout before loading-button assertions       |
| Final interaction rerun                              | Four passed against the final build, including both loading-button themes                                                  |
| CLI integration                                      | Five passed against the local API and simulator                                                                            |
| Real terminal acceptance                             | Ink rendering, prompt submission, queued follow-up, persistence, status and detach passed                                  |
| Python SDK acceptance                                | Scoped identity, workspace/files, SSE and persisted session continuation passed                                              |
| Documentation                                        | Generation, publication and link checks passed                                                                             |
| Review                                               | Independent source review plus visual inspection of light/dark Home, company-mark selectors and the narrow account submenu |

The initial implementation run finished with 122 passed, five failed and six skipped. Review and traces identified the modal account menu's hidden-focus accessibility problem, the submenu's narrow-screen overflow, ambiguous input matching during Select exit, and test sequences that ran before Radix focus or the marketing chapter state had updated. The accessibility and layout issues were corrected in shared UI code. Test synchronization now observes actual focus, chapter and query states rather than adding sleeps or weakening assertions. The last navigation-readiness timeout and its successful rerun are reported separately above.

Ignored evidence directories are `coverage/dashboard-polish-acceptance`, `coverage/dashboard-polish-final`, `coverage/dashboard-polish-menu-final` and `coverage/dashboard-polish-preview`. Local screenshots, traces, logs, fixture credentials and generated builds are not published source. The standalone acceptance runner copies public assets so logo checks verify loaded images rather than markup alone.

## Behaviors exercised

- Bottom account menu, nested authorized worktree switching, compact Light/Dark/System controls, cross-tab updates, keyboard focus, narrow-screen placement and pointer selection.
- Theme persistence through navigation and reload, operating-system changes, unavailable preference storage and unsaved editor drafts.
- A gently alternating prompt-border angle; one focus indicator for composite and standalone text fields; hidden scrollbars with working scrolling; quick menu and toast transitions.
- Waiting sheen in real held-request states, including primary-button gradient contrast in both themes and solid text under reduced motion. Streaming and historical run output retain existing persistence/replay behavior.
- Inline checkmark/Copied feedback, repeated-copy timers, changed-content and pending-write invalidation, clipboard denial and manual recovery; successful copies do not emit toasts.
- Company marks in harness/model options and selected values, black-on-white Codex, correct subscription branding, no displayed Composio mark, and a non-authenticating Codex subscription entry.
- Five featured examples including Personal assistant, six ready library templates, planned placeholders, previews and persisted preset prefilling without implicit execution or connection grants.
- Existing authenticated workspace/file, draft conflict, run/replay, cancellation/recovery, organization isolation, connection, trigger, schedule, billing and security workflows, plus public/docs/marketing journeys.
- Desktop and mobile layouts, portaled dialogs and axe checks. Automated checks are not WCAG certification or a complete assistive-technology audit.

## Interaction reference research

The September 9 follow-up inspected the supplied Claude Platform, Claude chat, OpenAI Platform, Exa, Resend, and Vercel MHTML as design references, not instructions. Only general CSS/interaction observations were retained; no private account contents, prompts, credentials, or proprietary source were copied into the repository.

- Live Exa account-menu inspection confirmed the nested team menu, with a computed 100 ms opacity transition. Its DOM exposes Base UI identifiers.
- Live Claude Platform inspection confirmed the bottom account menu and Base UI identifiers. Saved Claude styles contain named shimmer-text, reveal, and skeleton keyframes, plus short duration/easing tokens. The live menu's computed animation was effectively disabled in the inspected environment, so it does not establish its normal-motion timing.
- Saved OpenAI Platform styles use short opacity/background transitions, streaming text fade rules, and a clipped text sheen. A new live OpenAI tab could not be inspected: browser control timed out and public HTTP access returned 403. The supplied screenshots/MHTML remain the evidence for its account layout.
- Saved Exa styles contain response-reveal and text-shimmer keyframes. Saved Resend assets contain Sonner markers, clipped text sheen, and an animated gradient-border angle. Saved Vercel CSS contains `data-sd-animate` selectors and shimmer rules. These markers identify observed implementations, not a verified dependency/version inventory.
- Linear's publicly served [app login shell](https://linear.app/login) and its [served client stylesheet](https://static.linear.app/client/assets/style-8UhoXWIK.css) expose 100 ms quick transitions, 150 ms highlight exits, 80 ms copy/checkbox transitions, and targeted reduced-motion rules. Browser control timed out before rendered Linear app inspection; authenticated product interaction was not verified. Its [design discussion](https://linear.app/now/behind-the-latest-design-refresh) provides additional public context.

### Library choice

| Candidate                                                                    | Relevant capability                                                           | Decision for this change                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Radix animation](https://www.radix-ui.com/primitives/docs/guides/animation) | CSS entry/exit animations with deferred unmount                               | Reuse the installed primitives and their focus lifecycle.                                                                                                                                                         |
| [Sonner](https://github.com/emilkowalski/sonner)                             | Toast lifecycle, stacking, dismissal, and transforms                          | Reuse the installed component; shorten CSS durations without replacing its state machine.                                                                                                                         |
| [AI Elements Shimmer](https://elements.ai-sdk.dev/components/shimmer)        | Gradient-clipped waiting text with a two-second default loop                  | Apply the same general visual technique in a small shared CSS primitive; no Motion dependency is needed.                                                                                                          |
| [Motion](https://motion.dev/docs/react-accessibility)                        | Animation orchestration and reduced-motion controls                           | Useful for larger coordinated layouts; current effects fit CSS and existing Radix controls.                                                                                                                       |
| [Streamdown](https://streamdown.ai/docs/animation.md)                        | Streaming Markdown with arrival-only word fades and incomplete-block handling | Keep the existing React Markdown renderer for this bounded change. Defer its live parse, fade new blocks once, and show final text immediately. No claim of word-by-word smoothing or incomplete-Markdown repair. |

### Animated navigation icons

[Lucide Animated](https://lucide-animated.com/) provides individually copied animated Lucide components backed by Motion; its [source license](https://github.com/pqoqubbw/icons/blob/main/LICENSE) is MIT. [Animate UI](https://animate-ui.com/docs/icons/get-started) also provides animated Lucide icons but requires its shared Motion wrapper and labels the icon collection beta; its current [license](https://github.com/imskyleen/animate-ui/blob/main/LICENSE.md) includes the Commons Clause in addition to MIT terms.

The dashboard retains its installed `lucide-react` package and uses original, finite CSS gestures through `SidebarIcon`. This fits the requested hover/focus effects without adding Motion or copying third-party animation code. Shape selectors were checked against the installed Lucide SVG definitions. The account menu’s Pause animations control suppresses gestures while shared color fades remain available. Explicit dashboard playback overrides system Reduce Motion.

## Reproduce

Use the disposable local prerequisites in [testing and CI](../../engineering/testing.md). Run one browser acceptance process at a time: separate databases alone do not isolate Playwright's default artifact directory.

```sh
pnpm check
pnpm exec vitest run tests/unit/agent-templates.test.ts tests/unit/dashboard-assistant.test.ts \
  tests/unit/provider-branding.test.ts tests/unit/clipboard.test.ts
pnpm docs:generate
pnpm docs:check

# Complete browser, CLI, terminal, and Python acceptance with a fresh fixture.
COVERAGE_DIR=coverage/dashboard-ui pnpm test:dashboard:isolated

# Focused acceptance also builds its own production server and owns its fixture.
COVERAGE_DIR=coverage/dashboard-ui-theme pnpm test:dashboard:isolated \
  tests/browser/dashboard-theme.spec.ts tests/browser/usage.spec.ts
```

When rerunning browser-only cases against an already owned simulator fixture, supply its `APP_ORIGIN` and a distinct Playwright `--output` directory. Do not point fixture tests at a customer account or the shared developer preview. Tests that directly import database helpers also require that fixture's database environment; a URL alone is insufficient.

## Remaining acceptance

Deployed Cloud and self-hosted origins, Safari, Firefox, physical mobile devices, and a screen-reader audit remain in the [maintainer checklist](../../maintainers/TODO.md). Deployed streaming, cross-instance delivery, authentication callbacks, and provider execution retain their existing release gates. The six opt-in video exports were not part of this acceptance.

Hosted account assistance, support delivery, and additional capabilities are proposals in [dashboard improvements](../../product/improvements.md#dashboard). The UI preview provides no evidence for those capabilities.
