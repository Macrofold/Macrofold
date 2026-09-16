# Dashboard product and interaction design

Contributor reference. Start with the [feature guide](README.md) for user workflows.

The dashboard uses Next.js/React, Radix dialogs and controls, TanStack Query for remote state, CodeMirror 6 for editing, and Lucide icons. Shared semantic tokens define light and dark graphite/cyan surfaces, an ember secondary accent, thin borders, and sentence-case sans-serif labels. The existing Saddle assets identify the product. The responsive sidebar becomes a drawer. Product controls remain quieter than the marketing artwork; see the [design language](../../product/design-language.md).

Navigation and content density take inspiration from Linear, Vercel and Stripe. Their assets and branding are not copied. [Linear design discussion](https://linear.app/now/behind-the-latest-design-refresh).

## Implemented navigation

| Surface                                        | What a user can operate                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public home, pricing, quickstart and reference | Understand persistent hosted work, inspect configured prices, read examples and browse the full OpenAPI reference                                       |
| Home                                           | Task composer, real setup checklist, five starters, integration prompt, recent projects/runs and activity                                               |
| Templates                                      | Search ready/planned examples, inspect instructions/results, copy prompts and prefill the existing preset form                                          |
| Projects                                       | Default list or remembered grid layout, server search and cursor pagination, persistent/ephemeral creation, archive and pending-deletion views          |
| Project/workspace                              | Switch independent branches; files, runs, checkpoints, Git and settings tabs; new run and terminal handoff                                              |
| Runs                                           | Paged history, status filtering, status/harness/model/cost rows and run drilldown                                                                       |
| Run detail                                     | Live output, activity and tool-call tabs, exposed reasoning summaries, input, cancellation, same-session follow-up, persistence and usage summary       |
| Connections                                    | Model BYOK, remote MCP, reviewed stdio MCP, Composio and web-search connection configuration; discovery, authorization, explicit tool grants and revoke |
| API keys                                       | Generate a scoped/project-restricted key, copy the secret once, inspect metadata and revoke                                                             |
| Usage and billing                              | Recorded requests and usage, prepaid balance/debt, Stripe checkout/subscription controls, storage observation/allowance and explicit overage budget     |
| Account, security and team                     | Profile/password, MFA/recovery, sessions/OAuth grants, organization switching, invitations, role changes and access audit                               |
| Webhooks                                       | Register destinations/events, reveal or rotate signing secret, inspect delivery attempts and retry                                                      |
| Developers                                     | AI integration brief, CLI setup, curl example, downloadable OpenAPI and Scalar interactive reference                                                    |
| Operations                                     | Privileged growth/cohorts, usage, request activity, stored reports, infrastructure health and account drilldown                                         |

All configuration-dependent actions call real domain/provider boundaries. Missing production credentials produce setup errors. Local execution is prominently labeled as simulation and records zero model tokens. There is no synthetic successful payment or connector authorization.

The persistent shell supports a collapsed icon rail and a resizable expanded sidebar, retaining accessible labels, tooltips, independent navigation scrolling, and the bottom account menu. Mobile retains the full drawer. [Navigation layout](sidebar.md) owns dimensions, keyboard controls, and browser preference behavior. Projects defaults to list rows; `macrofold.projects.layout` remembers an explicit grid selection. Both layouts share the same query, filtering, pagination, actions, and empty states.

## Onboarding and developer UX

A verified account receives an organization. The user configures funding or a BYOK connection, creates a project, optionally grants tools, then starts a run. API users generate a scoped key; terminal users can authorize a public OAuth client through device consent instead of creating a long-lived key. Examples must use actual published operation/command names and configured model IDs.

API-key creation uses [permission presets](../../../apps/web/lib/key-permissions.ts) and a [shared picker](../../../apps/web/components/key-permissions.tsx) with a collapsed individual-permission panel. Read & write is the default; billing, key/team administration and permanent project deletion require Full access or explicit customization. Each customer API scope has an explicit classification checked against the OpenAPI scope names. OAuth-only `offline_access` and operator scopes are excluded. Selection is resolved against the identity's current scope ceiling and submitted as concrete scopes through the typed `createApiKey` operation; no preset role or new backend authorization path is persisted. The server retains its scope, project and role checks. Loading failures block submission and offer retry. [Browser acceptance](../../../tests/browser/key-permissions.spec.ts) exercises real key creation and use, restrictions, custom selection and responsive/keyboard operation; [preset tests](../../../tests/unit/key-permissions.test.ts) cover mappings and authority intersection.

Home reads project, successful-run, funding, usage, and identity data from the existing authenticated queries. The successful-run check is independently filtered so it is not limited to the recent-history page. Missing metrics remain unknown. Submitting the welcome prompt opens the existing composer; it never bypasses configuration, reservations, or authorization. The checklist represents current readiness and can become incomplete after resources or funding change.

Six ready starter definitions (five featured, including Personal assistant) own their instructions, illustrative outputs, categories, and search terms. A ready template's stable slug can prefill name and instructions in the existing agent-preset dialog. Unknown or planned slugs cannot prefill it. Funding, harness/model compatibility, connection ownership, grants, and preset creation stay with existing forms and APIs. Choosing a template never schedules or executes work.

Setup-copy actions load the canonical [Build with AI brief](../../getting-started/agents.md) on demand and resolve documentation links to the current origin. The displayed manual-copy text matches clipboard content. Example-specific prompts use the same published guide paths and retain explicit credential and spending instructions. None contain credentials or imply a connection has been authorized.

## Shared interactions

`app/interaction.css` provides default 160 ms control transitions, 180 ms entrances, 120 ms exits, hidden scrollbars, and single focus indicators. Established controls can retain their more specific short durations. Use `input-surface` on a composite field: its wrapper owns focus and its inner text input has no second outline. Standalone fields fade to a muted one-pixel border and faint halo; buttons and links retain keyboard outlines. Forced colors uses an explicit system outline. Scrolling itself remains enabled. Radix exit animations preserve its unmount/focus lifecycle; Sonner retains its own stacking, dismissal, and swipe transforms.

`WaitingText` applies a readable left-to-right sheen only to truthful active states. Owners provide status/live-region semantics. Primary buttons derive the sheen from their own foreground and keep busy labels opaque, preserving contrast on the accent fill. The welcome composer animates a registered gradient angle gently in alternating directions. `MarkdownOutput` uses deferred React rendering during live Markdown updates so editing/navigation remain responsive; newly mounted blocks fade in once, existing blocks remain mounted, and final output is immediate. There is no artificial token delay or change to stored output, cursors, or replay. Reduced motion suppresses spatial animation and decorative loops and restores ordinary waiting text. The shared reduced-motion rule allows only color, background color, border color, shadow, and opacity transitions; menus and dialogs use opacity-only entrances/exits. It must not blanket-disable all transitions, including hover and focus feedback.

`CopyButton` and `useCopyFeedback` share clipboard lifecycle across dashboard, docs, and marketing. After a successful write, the original copy icon crossfades into a green drawn checkmark without changing the label or button width. The check returns to the copy icon three seconds after success. A repeated click writes again, keeps the check while pending, and restarts the timer after success. Timers are cleared on a new attempt, content change, or unmount. Content changes, a failed latest write, or unmount invalidate feedback; stale asynchronous completions cannot mark different content as copied. When dashboard playback is paused, reduced motion keeps an opacity-only icon crossfade. Clipboard denial retains manual-copy feedback; successful copies never emit a toast.

`SidebarIcon` keeps the installed Lucide artwork and applies finite CSS gestures to its SVG shapes. The containing link or button owns the label and hover/focus interaction; the decorative icon adds no listeners or timers. Icons settle without moving their control bounds and replay after leaving and re-entering. The account menu owns an explicit Play/Pause animations control, persisted as `macrofold.dashboard.motion` and independent of marketing. Dashboard playback defaults to playing, including on reduced-motion devices per the requested product behavior; pausing suppresses icon gestures and stops the decorative loops. Color and focus fades remain available. The root attribute reaches portalled controls and is removed when leaving the dashboard.

`lib/provider-branding.ts` owns harness, publisher/model, and connection mappings. Both Select options and selected values render the same decorative ProviderLabel with accessible plain text. Codex uses the black-on-white local mark; Composio never renders its broker logo. Unknown services have a safe image/fallback path. Brand mapping does not change domain IDs, funding, or credentials. The Codex subscription entry is a non-authenticating unavailable panel, not a new connection kind.

Reference research and verification are recorded in [UI verification](ui-verification.md).

## Theme and assistant boundaries

[Product tokens](../../../apps/web/app/product-theme.css) apply at the document root so Radix portals inherit the selected theme. A small static first-paint script reads the non-sensitive `macrofold.theme` browser preference. The React provider tracks Light, Dark, System, operating-system changes, and other-tab preference changes. If storage is unavailable, selection still works for the current page. The editor consumes the resolved theme; charts use semantic color tokens. Marketing retains its independently styled presentation.

The bottom account menu contains the compact Light/Dark/System switcher and a nested authorized organization selector. The non-modal Radix menu retains keyboard navigation; below 520px the readable submenu overlaps its parent instead of overflowing the viewport. Switching organizations preserves server authorization, cache clearing, cross-tab notification, and navigation. Project worktree/branch selection stays within its project view. A separate CreateWorktree component provides optional Name and Branch fields, saved-ref suggestions, debounced advisory validation, and advanced new/existing branch modes. All navigation and mutations use IDs.

The bottom-right assistant uses an existing Radix modal and deterministic, local guidance. It is explicitly a UI preview: no inference, support delivery, account reads, or account mutations. A changed organization remounts the conversation. Help links and manually copyable setup text work now. An eventual hosted account agent requires a separately authorized implementation with scoped tools, reviewable writes, budgets, cancellation, and durable history; see [dashboard improvements](../../product/improvements.md#dashboard).

The project header offers **Open in CLI**. Its dialog copies login, link and catalog/chat commands with the selected project/workspace IDs and approved service origin. No credential appears in the copied text. Linking does not upload local files. The install command remains source-based until the operator publishes their chosen package namespace.

The CLI is a client of these same sessions, workspaces and history. Explicit push/pull and Git review checkout are documented in [CLI guide](../cli/README.md). The dashboard is not a filesystem mount or a local synchronization daemon.

## Files and persistence

Existing file edits use a two-second trailing debounce. The timer resets on typing, stops on unmount, and pauses while the workspace is busy or a save is in flight. New files still require explicit creation. An accessible icon/status reports Unsaved changes, Saving…, Saved, or Not saved. Errors retain the draft and require Retry save instead of repeating failed writes automatically.

File creation and selection stay disabled while a save and its query refresh are pending. The editor keeps its draft until the saved revision has refreshed successfully, including when the refresh is delayed or fails. Typing during a save is preserved and schedules another debounced save afterward. A confirmed mutation updates the revision and seeds the file query before invalidation; Saved cannot be shown for newer unsaved text. A save only closes the creation dialog when it belongs to that creation.

A workspace selector stays visible above the file view. `components/files/file-browser.tsx` owns a folder tree, directory listing, breadcrumbs, and viewer; directory expansion and search use paged authorized reads. The Files tab fills the remaining page height, with internal scrolling and a readable minimum height on short screens. Desktop explorer resizing shares `useResizablePanel` with the sidebar; mobile stacks the explorer above the viewer. Selecting a file never starts inference or a sandbox.

Markdown defaults to a Tiptap Rich editor with an adjacent Source CodeMirror editor, safe reading Preview, and rich/source Changes since the last confirmed save. The toolbar follows Orca’s text controls and adds table and history commands. Front matter stays outside serialization; unsupported HTML or footnotes fall back to Preview with Source editing. The preview uses the existing `react-markdown` and GFM dependencies, with heading anchors/outline, front matter disclosure, tables, and copyable code blocks. The shared Markdown accessibility transform labels task-list checkboxes in file previews and agent output. Raw HTML is not interpreted. Relative file links resolve inside the workspace and use its authorized file callback; unsupported URL schemes and traversal above the workspace root are blocked. Images are explicit links instead of automatic remote fetches. External links use a separate tab with no opener or referrer. Symlinks are represented without following their targets; detected binary files and files over 4 MiB offer downloads.

New file/folder dialogs, hover menus, inline rename, duplication, and folder drop targets call the public workspace operations, preserve revision preconditions, and refresh the tree and selected path only after a confirmed result. Rename applies to files; folder creation also supports empty folders. The shared query helpers keep post-mutation revisions and cached listings coherent. After rename, the destination read establishes both content and revision before editing resumes; a pre-rename buffer is never relabeled with the new revision. [Workspace implementation](../workspaces/implementation.md) owns authorization, leases, checkpoints, and mutation semantics.

Create checks the authoritative path and refuses an existing file, including one outside the visible listing. Save and delete carry the observed revision. Conflicting edits fail with a visible error and preserve the unsaved editor buffer and original revision. Background refreshes cannot replace a dirty draft. Save or explicitly discard before switching workspace context; normal link navigation and unloading prompt before discarding. Busy workspaces expose the last verified checkpoint, with writes disabled or rejected by the authoritative workspace lease. Uploads use staged transfer plans and progress; downloads verify the authorized object route. The preview never executes customer HTML or scripts.

Checkpoint rows expose time, size, consistency and pin state, with export and restore. Restore confirms that current files will be preserved first and requires an idle workspace. Native session history remains independently visible. Git has a dedicated status/configuration view with explicit synchronization, incoming/outgoing auto-sync opt-ins and conflict/protection diagnostics. Failed Git publication does not turn verified file persistence into a failure.

## Runs and streaming

The persistent shell uses one [shared dashboard refresh stream](live-refresh.md) for best-effort run, workspace/checkpoint and Git invalidations across API clients, workers, users and tabs. It refreshes active query data and reconciles periodically. This channel has no event history or agent output; detailed run streaming below remains separate.

The composer selects an authorized project/workspace, harness and compatible model; it exposes managed/BYOK funding, connection grants, timeout and a maximum budget. Advanced controls stay out of the primary prompt area. The server catalog determines available combinations; UI selection cannot expand permissions or spend limits.

The run page begins with assistant output. Activity and tool-call tabs show normalized event payloads; exposed reasoning summaries are collapsible. A details panel identifies harness/model, session/workspace, status, usage and persistence outcome. Required input has its own form, distinct from submitting a queued follow-up. Historical runs preserve outputs and partial recovery context within the plan's retention period. Expired detailed history has an explicit notice; terminal/accounting records remain.

SSE uses durable cursors and reconnects across the server's 55-second stream rotation. A healthy stream disables frequent status polling; disconnected clients fall back to bounded polling. Commands remain ordinary authenticated HTTP mutations. WebSockets are unnecessary for the launch's one-way output transport. They become a separate design decision for collaborative editing, voice or a raw remote terminal.

A terminal disconnect does not cancel the run. Cancellation and persistence are separate states, and each queued follow-up owns its own run ID and cancellation. Workspace files and checkpoint exports remain reachable through the workspace view; the launch does not claim a separate artifact gallery or full visual diff/review product.

## Connection UX

Connection types expose distinct fields and explanations. Model keys are write-only secrets. Remote MCP accepts a public HTTPS endpoint and supported auth method, performs discovery and provides explicit tool selection. OAuth returns to connection management; provider authorization does not approve tools or grant execution access. Stdio uses an operator-reviewed catalog entry and structured configuration, rather than arbitrary package installation in a control-plane function. Composio brokers app authorization while the domain retains ownership and grants. GitHub installation/repository selection belongs to the project's Git view.

Errors identify missing configuration, authentication, ownership, discovery or grant problems. A failed access read blocks permission editing until a successful retry. Tools and Access share one revision cache; stale drafts survive a 412, display current state, and require explicit retry. URL project/preset filters clear independently and reset cursor pages. Rule editors reuse server-search selectors and the existing modal/table controls. Run previews use the same query cache and clear one-run exceptions when context changes. Shared clipboard actions confirm success only after the browser accepts the text and retain a manual-copy path when access is denied. Test/discover actions inspect the protocol; invoking a metered provider tool remains subject to the execution budget and paid-execution guard. [tool security](../identity-integrations/tools-security.md) describes the provider boundaries.

## Operations and growth

One Operations page groups growth, activation/cohorts, usage, stored daily-report downloads, queue/storage/financial health, searchable accounts and request activity. Account details are read-only. Contact PII requires an additional scope. The same reporting services back admin REST and ten read-only MCP tools; no tool automatically changes infrastructure or accesses customer prompts/files.

Request tables load 25 rows at a time. Their quick filter explicitly filters loaded rows; broader interval/route/status filters are available in the API. Growth separates verified humans, foreground human activity and automation, excludes marked internal organizations, and excludes simulator runs from real activation. Mature cohort denominators and missing data sources are visible.

Provider CPU/quota/invoice readers, arbitrary BI dashboards, MRR accounting and a one-click account-closure wizard are outside the launch. Account closure has a documented operator procedure. These limits are visible in the evidence/launch documents rather than represented by inactive product buttons.

## Acceptance and remaining platform limits

The [UI verification record](ui-verification.md) owns the redesign's browser, unit, build, and CLI/SDK evidence, including focused reruns and remaining acceptance gaps.

Playwright covers dashboard journeys, including daily usage charts, keyboard dropdowns, interrupted mutation recovery and denied-stream handling, plus account/device authorization, security, team administration, connectors, file upload/download, run streaming and persistence, webhooks, storage budgeting, project deletion/undo, larger-history pagination, public pages and operator reporting. Journey assertions include desktop axe WCAG A/AA checks and mobile overflow checks; screenshots are inspected. Automated checks are not a WCAG certification or a complete assistive-technology audit.

Collections page on the server and show loading, retry and empty states. Radix owns modal focus behavior, the actual editor input is labeled, controls include visible error feedback, and reduced-motion preferences are honored. Production latency, very large histories and multiple browsers require the operator's staged pilot. The current fixture evidence is recorded in [implementation status](../../status/README.md).

## Reviewed control and chart system

Every dashboard selector uses the shared Radix Select component. Recharts renders daily runs, input/output tokens and run charges from `group_by=day`, with 7/30/90-day UTC windows, missing-data states, keyboard-accessible interaction and a daily-values table. The request audit remains independently paginated. View bundles load on demand; common cards/tables do not import the router. Motion respects reduced-motion preferences. [Code and UI review](../../engineering/code-review.md) records the design standards, tradeoffs and evidence.

## Data and document ownership

`lib/dashboard-data.ts` provides `request`, `useData`, and `useDataPages`, inferred from the generated OpenAPI operation types. The TypeScript SDK owns route encoding and methods; the dashboard retains its same-origin session transport and recovery key after an uncertain mutation. Query functions consume TanStack cancellation signals. Generated URL keys share the existing SSE invalidation and organization-switch cache. File and project views and the run composer use this interface; older private/admin endpoints still use the low-level transport. New public calls should use operation names instead of caller-asserted response types and handwritten URLs.

`files/use-file-document.ts` owns the selected document's buffer, baseline, revision, autosave, conflicts, failed saves and navigation guard. `file-browser.tsx` owns tree selection, menus and layout. Source and rich editors share one document controller. The content's ETag travels with the content response; a later tree refresh cannot advance an unsaved buffer's revision. Confirmed mutations update relevant file caches without refreshing unrelated account data.

`app/interaction.css` is the single owner of global focus defaults, hover transitions, hidden scrollbars and reduced-motion behavior. Component styles own layout and component-specific motion. Do not reintroduce broad focus outlines or blanket reduced-motion rules in `globals.css`.

The shared permission editor appears in project/worktree settings, worktree creation and new-run advanced settings. It edits one policy layer and leaves inherited restrictions intact. See [agent permissions](../execution/permissions.md) for supported harnesses and enforcement.

## Changelog

- File sorting, visible tree rows/keyboard navigation, Markdown front matter, and preview composition adapt MIT-licensed Orca source. The [retained license and source provenance](../../../apps/web/components/files/ORCA-LICENSE.txt) identify the upstream commit and files. The adaptation uses Macrofold's authorized file APIs; it does not include Orca's desktop runtime or filesystem access.
