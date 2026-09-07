# Dashboard product and interaction design

Contributor reference. Start with the [feature guide](README.md) for user workflows.

The implemented launch dashboard uses Next.js/React, Radix dialogs and controls, TanStack Query for remote state, CodeMirror 6 for editing, and Lucide icons. Shared CSS defines a dark navigation rail, bright content surfaces, readable typography, restrained blue accents and status text/icons. The responsive sidebar becomes a drawer. The product uses one light content theme; a selectable dark content theme is future work.

Navigation and content density take inspiration from Linear, Vercel and Stripe. Their assets and branding are not copied. [Linear design discussion](https://linear.app/now/behind-the-latest-design-refresh).


## Implemented navigation

| Surface                                        | What a user can operate                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public home, pricing, quickstart and reference | Understand persistent hosted work, inspect configured prices, read examples and browse the full OpenAPI reference                                       |
| Overview                                       | Aggregate project/run counts, recent projects and runs, credits and terminal onboarding                                                                 |
| Projects                                       | Server search and cursor pagination, persistent/ephemeral creation, archive and pending-deletion views                                                  |
| Project/workspace                              | Switch independent branches; files, runs, checkpoints, Git and settings tabs; new run and terminal handoff                                              |
| Runs                                           | Paged history, status filtering, status/harness/model/cost rows and run drilldown                                                                       |
| Run detail                                     | Live output, activity and tool-call tabs, exposed reasoning summaries, input, cancellation, same-session follow-up, persistence and usage summary       |
| Connections                                    | Model BYOK, remote MCP, reviewed stdio MCP, Composio and web-search connection configuration; discovery, authorization, explicit tool grants and revoke |
| API keys                                       | Generate a scoped/project-restricted key, copy the secret once, inspect metadata and revoke                                                             |
| Usage and billing                              | Recorded requests and usage, prepaid balance/debt, Stripe checkout/subscription controls, storage observation/allowance and explicit overage budget     |
| Account, security and team                     | Profile/password, MFA/recovery, sessions/OAuth grants, organization switching, invitations, role changes and access audit                               |
| Webhooks                                       | Register destinations/events, reveal or rotate signing secret, inspect delivery attempts and retry                                                      |
| Developers                                     | CLI setup, curl example, downloadable OpenAPI and Scalar interactive reference                                                                          |
| Operations                                     | Privileged growth/cohorts, usage, request activity, stored reports, infrastructure health and account drilldown                                         |

All configuration-dependent actions call real domain/provider boundaries. Missing production credentials produce setup errors. Local execution is prominently labeled as simulation and records zero model tokens. There is no synthetic successful payment or connector authorization.

## Onboarding and developer UX

A verified account receives an organization. The user configures funding or a BYOK connection, creates a project, optionally grants tools, then starts a run. API users generate a scoped key; terminal users can authorize a public OAuth client through device consent instead of creating a long-lived key. Examples must use actual published operation/command names and configured model IDs.

The project header offers **Open in CLI**. Its dialog copies login, link and catalog/chat commands with the selected project/workspace IDs and approved service origin. No credential appears in the copied text. Linking does not upload local files. The install command remains source-based until the operator publishes their chosen package namespace.

The CLI is a client of these same sessions, workspaces and history. Explicit push/pull and Git review checkout are documented in [CLI guide](../cli/README.md). The dashboard is not a filesystem mount or a local synchronization daemon.

## Files and persistence

File creation and selection stay disabled while a save and its query refresh are pending. A save only closes the creation dialog when it belongs to that creation, and browser journeys wait for the pending interaction to finish before editing.

A workspace selector stays visible above the file view. A searchable, paged path list shows checkpoint-backed files beside a CodeMirror text editor. Binary files download as bytes; symlinks are represented safely. This is a path browser, not an unbounded recursive tree rendered in one request. Selecting a file never starts inference or a sandbox.

Create checks the authoritative path and refuses an existing file, including one outside the visible listing. Save and delete carry the observed revision. Conflicting edits fail with a visible error and preserve the unsaved editor buffer and original revision. Background refreshes cannot replace a dirty draft. Save or explicitly discard before switching workspace context; normal link navigation and unloading prompt before discarding. Busy workspaces expose the last verified checkpoint, with writes disabled or rejected by the authoritative workspace lease. Uploads use staged transfer plans and progress; downloads verify the authorized object route. The preview never executes customer HTML or scripts.

Checkpoint rows expose time, size, consistency and pin state, with export and restore. Restore confirms that current files will be preserved first and requires an idle workspace. Native session history remains independently visible. Git has a dedicated status/configuration view with explicit synchronization, incoming/outgoing auto-sync opt-ins and conflict/protection diagnostics. Failed Git publication does not turn verified file persistence into a failure.

## Runs and streaming

The persistent shell uses one [shared dashboard refresh stream](live-refresh.md) for best-effort run, workspace/checkpoint and Git invalidations across API clients, workers, users and tabs. It refreshes active query data and reconciles periodically. This channel has no event history or agent output; detailed run streaming below remains separate.

The composer selects an authorized project/workspace, harness and compatible model; it exposes managed/BYOK funding, connection grants, timeout and a maximum budget. Advanced controls stay out of the primary prompt area. The server catalog determines available combinations; UI selection cannot expand permissions or spend limits.

The run page begins with assistant output. Activity and tool-call tabs show normalized event payloads; exposed reasoning summaries are collapsible. A details panel identifies harness/model, session/workspace, status, usage and persistence outcome. Required input has its own form, distinct from submitting a queued follow-up. Historical runs preserve outputs and partial recovery context within the plan's retention period. Expired detailed history has an explicit notice; terminal/accounting records remain.

SSE uses durable cursors and reconnects across the server's 55-second stream rotation. A healthy stream disables frequent status polling; disconnected clients fall back to bounded polling. Commands remain ordinary authenticated HTTP mutations. WebSockets are unnecessary for the launch's one-way output transport. They become a separate design decision for collaborative editing, voice or a raw remote terminal.

A terminal disconnect does not cancel the run. Cancellation and persistence are separate states, and each queued follow-up owns its own run ID and cancellation. Workspace files and checkpoint exports remain reachable through the workspace view; the launch does not claim a separate artifact gallery or full visual diff/review product.

## Connection UX

Connection types expose distinct fields and explanations. Model keys are write-only secrets. Remote MCP accepts a public HTTPS endpoint and supported auth method, performs discovery and provides explicit tool selection. OAuth returns to the grant view. Stdio uses an operator-reviewed catalog entry and structured configuration, rather than arbitrary package installation in a control-plane function. Composio brokers app authorization while the domain retains ownership and grants. GitHub installation/repository selection belongs to the project's Git view.

Errors identify missing configuration, authentication, ownership, discovery or grant problems. A failed grants read blocks permission editing until a successful retry. Shared clipboard actions confirm success only after the browser accepts the text and retain a manual-copy path when access is denied. Test/discover actions inspect the protocol; invoking a metered provider tool remains subject to the execution budget and paid-execution guard. [tool security](../identity-integrations/tools-security.md) describes the provider boundaries.

## Operations and growth

One Operations page groups growth, activation/cohorts, usage, stored daily-report downloads, queue/storage/financial health, searchable accounts and request activity. Account details are read-only. Contact PII requires an additional scope. The same reporting services back admin REST and ten read-only MCP tools; no tool automatically changes infrastructure or accesses customer prompts/files.

Request tables load 25 rows at a time. Their quick filter explicitly filters loaded rows; broader interval/route/status filters are available in the API. Growth separates verified humans, foreground human activity and automation, excludes marked internal organizations, and excludes simulator runs from real activation. Mature cohort denominators and missing data sources are visible.

Provider CPU/quota/invoice readers, arbitrary BI dashboards, MRR accounting and a one-click account-closure wizard are outside the launch. Account closure has a documented operator procedure. These limits are visible in the evidence/launch documents rather than represented by inactive product buttons.

## Acceptance and remaining platform limits

Playwright covers dashboard journeys, including daily usage charts, keyboard dropdowns, interrupted mutation recovery and denied-stream handling, plus account/device authorization, security, team administration, connectors, file upload/download, run streaming and persistence, webhooks, storage budgeting, project deletion/undo, larger-history pagination, public pages and operator reporting. Journey assertions include desktop axe WCAG A/AA checks and mobile overflow checks; screenshots are inspected. Automated checks are not a WCAG certification or a complete assistive-technology audit.

Collections page on the server and show loading, retry and empty states. Radix owns modal focus behavior, the actual editor input is labeled, controls include visible error feedback, and reduced-motion preferences are honored. Production latency, very large histories and multiple browsers require the operator's staged pilot. The current fixture evidence is recorded in [implementation status](../../status/README.md).

## Reviewed control and chart system

Every dashboard selector uses the shared Radix Select component. Recharts renders daily runs, input/output tokens and run charges from `group_by=day`, with 7/30/90-day UTC windows, missing-data states, keyboard-accessible interaction and a daily-values table. The request audit remains independently paginated. View bundles load on demand; common cards/tables do not import the router. Motion respects reduced-motion preferences. [Code and UI review](../../engineering/code-review.md) records the design standards, tradeoffs and evidence.
