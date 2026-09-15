# Journey design library

Open **[/journeys](http://localhost:3210/journeys)** in the local application. Start with **Fanout**, then compare the other nine treatments. Each page has the selected Foundation hero, a desaturated cyan and white palette, that round’s approved copy, and three selectable use cases. The earlier libraries remain at `/concepts` and `/homepages`; the [final homepage](../site/README.md) now develops the selected Fanout direction separately.

## Compare the explanations

| Treatment     | Composition                      | Diagram emphasis                                             |
| ------------- | -------------------------------- | ------------------------------------------------------------ |
| Fanout        | Text beside a sticky diagram     | One agent and its folders become three independent worktrees |
| Terraces      | Diagram first                    | Stepped translucent planes separate working contexts         |
| Matrix        | Wide diagram                     | A grid makes independent work and interface routing legible  |
| Lanes         | Text beside a sticky diagram     | Requests and saved work travel through parallel lanes        |
| Strata        | Diagram first                    | Layered contexts emphasize persistence                       |
| Switchboard   | Wide diagram                     | Angular routing connects interfaces to working units         |
| Aperture      | Alternating illustrated chapters | Framed close-ups and project-wide views                      |
| Ledger        | Text beside a sticky diagram     | Independent executions sit alongside saved revisions         |
| Constellation | Wide diagram                     | Sparse, distributed workspaces with explicit connections     |
| Assembly      | Alternating illustrated chapters | Separate execution tiles assemble into a system              |

These names identify presentation treatments, not product features or capacity guarantees. The third supporting capability varies between retained history, budgets, scoped permissions, results, and continued sessions.

## Three use cases, five pillars

**Per-Customer Agent Workspaces** starts with a cold-email request and the customer's product, audience, and voice files. **Self-improving Agents** starts with a simulation and a strategy revision governed by the user's evaluation instructions. **Shared Team Agents** starts with a debugging request and the team's code, issue, and incident context. They illustrate possible applications rather than prebuilt autonomous products.

Every story follows Project → Worktrees → Checkpoints and Git Sync → API, CLI, UI → Connectors. Worktrees receive separate tasks. Checkpoint indicators stay attached to their files; Git synchronization remains a separate action. The interface stage shows two API requests, a CLI request, and another workspace accessed through the UI. The connector stage returns to one working unit and shows relevant tools, including database access through custom MCP for the team example.

Diagrams use straight connections, compact folders, real harness marks, and short task labels. The main explanation stays in adjacent text. Desktop scrolling updates the diagram without intercepting scrolling; narrow screens use accessible feature tabs. Reduced motion, explicit pause, hidden-tab handling, and offscreen observation control animation. Study-to-study links use ordinary document navigation, avoiding eager prefetch of ten complete previews and resetting each composition for comparison. The hero is the existing original Swarm poster with CSS drift; no live particle renderer or customer telemetry is involved.

## Hosted onboarding and accurate claims

The hero links **Start building** to registration and **View docs** to documentation. Its source row contains the repository icon, contributor guide, and **Star** link. Starring happens on GitHub after the visitor chooses Star; the preview neither uses a GitHub account nor claims that following a link has starred the repository.

The centered code panel combines run and stream in TypeScript, Python, Go, Rust, cURL, and CLI examples. The example starts a new run directly with a project, harness, model, billing mode, and prompt. The catalog determines the provider. There is no prerequisite session or saved preset. Setup is disclosed below the example; required fields remain explicit. Public imports use `Macrofold`, and terminal examples use the installed `macrofold` command. Go and Rust examples are function bodies with documented context, not complete source files. Python uses explicit closure and no context manager.

SDKs use their actual hosted default, `https://app.macrofold.ai`; cURL spells out the same origin. It retains the required idempotency key, uses `jq` to capture the returned ID, and only streams after a nonempty successful extraction. Registry publication and a root-domain API alias are not implied. Self-hosting instructions remain linked documentation rather than the main onboarding story.

The public directory uses the existing catalog: **1,467 applications and 51,240 tools** in the current snapshot, plus **11 native integration entries**. The hero page derives its application count from that snapshot. It does not claim several thousand distinct apps. Public discovery does not mean an application is enabled, authenticated, or granted to an agent.

Billing copy distinguishes compute from model, tool, and storage charges. These archived studies describe an external message handler, webhook, or scheduler invoking the API. The current product also implements [native triggers and schedules](../../../features/triggers/README.md), which the final site describes.

## Implementation and references

[Catalog and copy](../../../../apps/web/components/journeys/catalog.ts), [server-rendered pages](../../../../apps/web/components/journeys/site.tsx), [interactive controls](../../../../apps/web/components/journeys/controls.tsx), [SVG diagrams](../../../../apps/web/components/journeys/diagram.tsx), and [scoped CSS](../../../../apps/web/components/journeys/journeys.css) form one presentation module. Existing Next.js, React, Radix, Lucide, clipboard, and image handling are reused; no new dependency or service is added.

The [public connector guide](../../../features/identity-integrations/catalog.md) is part of the normal documentation hierarchy. It offers search, bounded incremental rendering, retry, native integrations, and a static JSON export derived from the same bundled metadata. Only this guide loads the full catalog in the browser. Public requests do not call Composio, expose account readiness, or read operator credentials. The dashboard's live catalog remains separate.

[Design Language](../../design-language.md) remains the single preference record, including all reference companies and their roles. This round follows Resend's immediate code/CTA clarity, Neon and Modal's computational material palette, LiveKit/Firecrawl/Daytona/E2B's concrete usage progression, Inngest's capability narrative, and Composio/Merge's coherent connector presentation. These are design influences, not claims that a reference site's animation framework is used here. [Research](../research.md) distinguishes verified technology from visual inference.

[Verification](verification.md) records the actual checks. Production publication, device acceptance, and live trigger acceptance stay in [maintainer TODO](../../../maintainers/TODO.md#marketing-publication).
