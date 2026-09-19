# Swarm homepage studies

Open **[/homepages](http://localhost:3210/homepages)** in the local application. Ten complete homepage compositions develop the selected Swarm direction. Choose **Explore** to open a version, then use **Next version** to compare. The [original ten designs](../README.md) remain at `/concepts`.

These preserve the earlier headline and subtitle for comparison. The current direction is in the [journey design library](../journeys/README.md), with preferences owned by [Design Language](../../design-language.md#selected-homepage-direction). Code comes immediately after the hero; product explanations follow it. These are public, noindexed previews. Choosing a production composition and replacing the canonical homepage are separate decisions.

## Compare the versions

| Version    | Opening                                | Product explanation                   | Useful comparison                                             |
| ---------- | -------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Foundation | Quiet split hero                       | One scrolling branch diagram          | The most direct interpretation of the requested sequence      |
| Immersion  | Full-width particle field              | Scrolling layered worktrees          | A more expansive first impression                             |
| Precision  | Framed, compact composition            | Selectable circuit diagram            | Fast scanning and deliberate exploration                      |
| Chapters   | Large editorial typography             | Five alternating illustrated chapters | Reading each feature without a shared sticky panel            |
| Workbench  | Compact developer opening              | File-and-terminal explorer            | Familiar developer controls and less page travel              |
| Panorama   | Broad computational horizon            | Scrolling horizontal execution lanes  | Making independent worktrees easy to distinguish             |
| Atlas      | Offset composition                     | Alternating layered diagrams          | A less conventional rhythm with complete visible explanations |
| Relay      | Split product opening                  | Selectable routing diagram            | Understanding which interface targets which worktree         |
| Sequence   | Typographic opening                    | Previous/next feature sequence        | A guided explanation without scroll-driven changes            |
| Synthesis  | Expansive, left-aligned particle field | Scrolling terminal-style diagram      | Combining a grand hero with a precise working environment     |

Start with **Foundation**, **Immersion**, and **Relay** to compare a balanced page, a cinematic page, and an interactive explanation. These are design judgments, not measured conversion results.

## One coherent product story

The five stages keep the same workspace visible: files and instructions; independent worktrees with native agents; checkpoint history and optional GitHub sync; API, CLI, and dashboard access; then requests routed to particular worktrees. Choose an interface in the final diagram to highlight its example destinations.

The illustrations preserve actual boundaries. A workspace groups worktrees; each worktree has one active writer. Independent work uses independent worktrees within account limits. Saved checkpoints and optional GitHub synchronization are distinct; synchronization never promises to resolve conflicts automatically. CLI linking selects remote context rather than silently uploading a local folder.

Additional animated panels introduce streaming, granted tools, and execution/spending limits. Supported harnesses, model providers, tools, search integrations, open-source availability, and deeper guides finish the page. All diagrams are illustrations, not customer telemetry.

## Code before detail

The example panel separates **Run**, **Stream**, and **Continue**, with TypeScript, Python, cURL, and CLI tabs. New API runs show the five required values: workspace, harness, model, billing mode, and prompt. Optional budgets, timeouts, and defensive setup checks stay out of the main snippet. A disclosure explains credentials, source installation, model selection, funding, and CLI linking.

Continuation uses the returned session ID after the current run finishes. The API contract and SDK remain unchanged. Python examples use explicit clients and closure, without `with`. cURL exposes its idempotency key; the SDK owns mutation identities and stream reconnection. The [API quickstart](../../../features/api/quickstart.md) and [SDK guides](../../../features/api/sdks/README.md) remain authoritative for full setup.

## Reference decisions

The complete reference set and each company's intended role remain in [Design Language](../../design-language.md#reference-library). The [focused research](../research.md) covers the twelve sites specifically requested for visuals, explanation, and API presentation. The homepage phase applies those observations as follows:

- **Resend, Firecrawl, Daytona, E2B, and LiveKit:** a concrete operation, language choice, short example, then progressive explanation. Resend is the strongest copy-restraint reference.
- **Neon, Modal, Exa, and Unkey:** computational atmosphere, technical materials, deliberate framing, and readable infrastructure presentation. Swarm supplies original artwork rather than copying reference assets.
- **Inngest:** coherent capability progression and selectable feature panels. Its Flow Control presentation informed the explorer variants; the scrolling versions develop the specifically requested persistent-diagram idea.
- **Composio and Merge:** a broad integration surface explained through a coherent interface. Routes and authorized tools appear below the hero, where they explain concrete behavior.

The broader references inform hierarchy, developer onboarding, source availability, and documentation links. Individual version labels name the strongest influences, not the only references considered. No reference site's performance claims, customer logos, scientific results, or integration guarantees are borrowed.

## Implementation

The [catalog](../../../../apps/web/components/homepages/catalog.ts) owns layout choices and shared stages. [Server components](../../../../apps/web/components/homepages/site.tsx) render hero copy, sections, navigation, and the gallery. Small [client controls](../../../../apps/web/components/homepages/controls.tsx) handle existing Radix tabs, clipboard copying, scroll observation, and motion controls. The shared [SVG diagram](../../../../apps/web/components/homepages/diagram.tsx) supports branch, lane, layer, circuit, and terminal treatments; [scoped CSS](../../../../apps/web/components/homepages/homepages.css) owns composition and motion.

There are no added dependencies, provider calls, databases, analytics experiments, or remote embeds. Next.js delivers the existing Swarm image responsively. Its light and camera-like drift are CSS treatments of a static poster, not a live particle simulation. Packet traces, commit pulses, transitions, and interface routing are implemented SVG/CSS illustrations.

Scroll observation changes stages without taking control of browser scrolling. On narrow screens, scrolling stories become selectable feature panels so a sticky diagram cannot obscure the explanation. Inactive tabs keep the interface compact; JavaScript-free summaries preserve the remaining feature descriptions. Motion pauses explicitly, in hidden tabs, and when an animated section is offscreen. Reduced-motion preferences disable animation and transitions. Desktop/mobile checks and remaining device/deployment acceptance are recorded in [verification](verification.md).

The presentation catalog names these previews Macrofold. Application branding and deployment configuration remain independent; these studies do not rewrite `PRODUCT_NAME` or the canonical homepage.
