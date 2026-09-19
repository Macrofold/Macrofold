# Documentation experience: research and proposed principles

The strongest documentation makes the first useful result easy, then gives readers a direct route to precise answers. For Macrofold, that means explaining how to run an agent and retrieve its result before asking someone to understand deployment infrastructure, execution internals, or every API parameter.

This document records findings from all 14 requested providers and proposes principles for a future documentation update. It is research, not an implementation specification or a statement that these recommendations have been adopted. Existing public documentation, navigation, application UI, and coding-agent rules are unchanged by this research.

Related context: [engineering documentation](../README.md), [earlier documentation research](research.md), and [Cloud and agent onboarding](cloud-and-agent-onboarding.md). The recommendations below should inform a later scoped proposal, with the implemented product and API contract remaining authoritative.

## Reading paths

- For the main recommendations, read [the principles](#the-principles) and [adoption priorities](#adoption-priorities).
- For examples and comparisons, read [provider findings](#provider-findings) and [visual design](#visual-design-and-interaction).
- For API authors, read [page templates](#page-templates) and [API reference requirements](#api-reference-requirements).
- For agent tooling, read [AI-first documentation](#ai-first-documentation) and [discovery and search](#discovery-search-and-seo).
- For implementation choices and verification, read [documentation technology](#documentation-technology), [quality checks](#quality-checks-and-measurement), and [sources and evidence](#sources-and-evidence).

## The principles

These are recommendations synthesized from the research, rather than claims that every provider follows every practice.

1. **Lead with a completed task.** State what the reader will accomplish, what is required, and what success looks like. Show the shortest supported route to that result.
2. **Give human and agent users equally visible entry points.** Put a copyable implementation brief beside the quickstart. Neither route should require installing optional tools just to read the documentation.
3. **Separate learning from lookup.** Quickstarts teach one workflow; guides solve specific tasks; conceptual pages explain behavior; references describe the complete contract.
4. **Make depth discoverable.** Keep advanced material reachable through descriptive links, contextual navigation, search, and stable anchors. Progressive disclosure must not become hidden information.
5. **Use the same product vocabulary everywhere.** SDK resources, API operations, dashboard labels, examples, and conceptual diagrams should reinforce the same mental model.
6. **Share usage documentation across Cloud and self-hosting.** Separate account setup and deployment operations. Explain actual capability differences explicitly.
7. **Treat examples as product behavior.** Examples should use the real SDK, compile or execute against supported versions, show expected results, and handle relevant failures.
8. **Generate repeated contract information.** OpenAPI, SDK documentation, examples, search records, Markdown exports, and agent indexes should have clear sources and automated consistency checks.
9. **Design for reading and working.** Legible typography, predictable navigation, useful code panels, and responsive layouts matter more than decorative effects.
10. **Make agent context small and reliable.** Offer a concise index, focused pages, exact identifiers, explicit defaults, and task-specific references. A full corpus is an optional export.
11. **Separate knowledge from authority.** Reading documentation requires no account-management permission. Running code, connecting accounts, spending money, and deploying are distinct actions.
12. **Measure successful outcomes.** Test whether people and coding agents can finish real tasks, recover from errors, and find the correct contract. Page views and assistant usage alone do not establish quality.

## Provider findings

Each provider was reviewed for entry paths, technical depth, layout, and agent support. The profiles describe representative pages, not an exhaustive audit of every page or a ranking of the companies. Visual observations come from direct browser inspection or the supplied screenshots; technical documentation features are linked to official sources.

### OpenAI

**Structure and depth.** The developer experience separates major API topics into contextual navigation, including models, agents, tools, production, and reference. The quickstart offers a first request; the reference describes operations, schemas, streaming events, authentication, and shared behavior. The supplied reference screenshot shows expandable parameter structures alongside scenario examples and request/response panels. [Developer quickstart](https://developers.openai.com/api/docs/quickstart).

**Visual design.** The supplied dark-mode screenshots use a strong two-level header, a contextual left sidebar, restrained borders, and a prominent first-request card. The model catalog uses comparable cards and specification rows. Reference pages allocate substantially more space to code and schemas than introductory pages.

**AI-first development.** OpenAI documents a public, read-only Docs MCP that searches and fetches documentation without calling the application API. Its documentation also advertises Markdown pages and an index. [Docs MCP](https://developers.openai.com/learn/docs-mcp).

**Apply to Macrofold.** Pair a first-run example with an equally accessible reference. Keep documentation retrieval separate from authenticated run creation. Use scenario tabs for materially different operations, such as waiting for a result versus consuming structured events.

### Claude / Anthropic

**Structure and depth.** Claude provides an explicit recommended learning path, distinguishes API surfaces early, and links to detailed authentication, capabilities, SDKs, and platform-specific guidance. Its API overview covers prerequisites before lower-level protocol concerns. [Introduction](https://platform.claude.com/docs/en/intro), [API overview](https://platform.claude.com/docs/en/api/overview).

**Visual design.** The supplied screenshots combine a warm neutral surface, expressive serif titles, quiet body typography, generous spacing, and compact language tabs. A beginner callout on a technical reference page provides an escape route back to the quickstart. The Ask Docs modal gives example questions instead of presenting an unexplained empty chat box.

**AI-first development.** The Claude API skill selects documentation by language, API surface, and task. Anthropic explicitly describes this as progressive disclosure to limit unnecessary context. [Claude API skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/claude-api-skill).

**Apply to Macrofold.** Explain workspace, worktree, agent preset, and run relationships before presenting configuration choices. A future integration skill should route to focused references instead of embedding every SDK and feature in one large instruction file.

### Exa

**Structure and depth.** Exa explicitly offers separate Search entry points for humans and coding agents. The agent-oriented page combines a minimal example, typed parameter tables, defaults, nested options, operational advice, and common pitfalls. The HTTP reference provides a separate precise endpoint view. [Human guide](https://exa.ai/docs/reference/search-api-guide), [coding-agent guide](https://exa.ai/docs/reference/search-api-guide-for-coding-agents), [Search reference](https://exa.ai/docs/reference/search).

**Visual design.** The supplied screenshots show Documentation/API Reference/Changelog tabs, grouped navigation, a right-hand table of contents for guides, and a right-hand request/response column for endpoints. HTTP method badges make operations easier to scan. Copy-page actions sit near the title.

**AI-first development.** Exa promotes dashboard onboarding that produces a task-specific integration prompt. Its documentation advertises a Markdown index, SDK specifications, and cheat sheets.

**Apply to Macrofold.** A copyable implementation brief should include exact contract links and a verifiable result. Keep the brief and reference consistent through shared sources. Avoid placing every optional parameter in the introductory request: completeness belongs in the reference.

### Resend

**Structure and depth.** Resend separates Documentation, Guides, and API Reference. The supplied introduction identifies prerequisites and then routes readers by framework. Its Send Email reference provides language-specific examples and detailed parameters. [Introduction](https://resend.com/docs/introduction), [Send Email reference](https://resend.com/docs/api-reference/emails/send-email).

**Visual design.** The supplied screenshots show a light neutral frame around a spacious content surface, strong headings, modest rounded corners, clear selected navigation, and simple framework cards. The documentation relies on typography and spacing rather than the elaborate visual treatments associated with its marketing site.

**AI-first development.** Resend has a dedicated AI onboarding page covering operational MCP, CLI, Markdown, full-text documentation, a documentation MCP, skills, and copyable task prompts. It identifies account creation and domain configuration prerequisites. [AI onboarding](https://resend.com/docs/ai-onboarding).

**Apply to Macrofold.** Use a simple first-run journey with prerequisites visible. Explain what the human must configure and what an agent can implement. Give each documented integration a short path to success and an adjacent troubleshooting path.

### Neon

**Structure and depth.** The inspected landing page separates quick setup, a guided backend quickstart, and a fuller tour. Framework, language, and ORM guides are grouped separately. The API overview distinguishes HTTP management operations and links to an endpoint index, OpenAPI, and Markdown context. [Documentation](https://neon.com/docs/introduction), [API overview](https://neon.com/docs/reference/api).

**Visual design.** The browser view uses global product/platform/reference navigation and a contextual sidebar. Setup cards communicate the depth of each path. The API article returns to a conventional main column and table of contents. A modest accent color highlights selection and actions.

**AI-first development.** Neon's index begins with common tasks, then links to topic indexes for large sections. It documents both `.md` URLs and Markdown content negotiation. [Documentation index](https://neon.com/docs/llms.txt).

**Apply to Macrofold.** Offer quick setup and a guided explanation without forcing every reader through both. Use hierarchical agent indexes when the documentation grows. Distinguish application-facing APIs from infrastructure management APIs. Neon's article pages were inspected in the browser because the research fetcher could not retrieve several of them.

### Supabase

**Structure and depth.** The docs home offers framework quickstarts, product guides, client libraries, migrations, and self-hosting. The JavaScript reference is method-oriented, with signatures and task-specific examples. Its self-hosting guide explains responsibilities and differences from the managed platform, including the distinction between development and production deployment. [Docs home](https://supabase.com/docs), [select reference](https://supabase.com/docs/reference/javascript/select), [self-hosting](https://supabase.com/docs/guides/self-hosting).

**Visual design.** The inspected home uses an uncluttered header, a short introduction opposite an AI Prompt/CLI panel, and grouped framework icons. The SDK reference exposes language/version context and examples for different query needs.

**AI-first development.** The AI tools page distinguishes MCP, reusable skills, plugins, and static prompts, and links to task evaluations. It also distinguishes using AI to develop from building AI capabilities into a product. [AI tools](https://supabase.com/docs/guides/ai-tools).

**Apply to Macrofold.** Treat “build with your coding agent” as an onboarding path. Keep Cloud and self-hosting visible without duplicating the usage reference. Explain authentication context and deployment responsibilities at their owning pages.

### Vercel

**Structure and depth.** The docs home provides several task entries, including deployment and coding-agent setup, while the sidebar groups work into building, shipping, observing, securing, and managing. The REST API overview has its own navigation and explains authentication, team resources, rate limits, and endpoints. [Docs home](https://vercel.com/docs), [REST API](https://vercel.com/docs/rest-api).

**Visual design.** The inspected page pairs a large outcome-led heading with a compact tabbed terminal example. It distinguishes a primary action from secondary paths. Technical pages retain the visual system while changing the content layout.

**AI-first development.** Vercel documents Markdown access, indexes, a site-wide link graph, and per-page related-link maps. Agent setup includes prompts, plugins, skills, and MCP. [Agent resources](https://vercel.com/docs/agent-resources), [Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access).

**Apply to Macrofold.** Show a useful result and setup prompt early. Start with clean links and a compact index; a graph export is an optional later enhancement if retrieval tests show a need.

### Merge

**Structure and depth.** Merge first asks readers to choose a product. Within Unified, navigation separates getting started, implementation guidance, and API reference. The HRIS reference then groups shared models and integration details within its own category. [Docs home](https://docs.merge.dev/home), [HRIS reference](https://docs.merge.dev/merge-unified/hris/overview).

**Visual design.** The inspected home uses a small number of large product cards. Inside a product, a top-level product switcher, secondary navigation, and category selector communicate location. The reference overview brings base URLs and authentication into the article rather than leaving them implicit.

**AI-first development.** The retrieved docs advertise a root index, page-level indexes, and Markdown representations. Search and Ask AI are visible entry points.

**Apply to Macrofold.** Use separate navigation levels only when they represent meaningful choices. Macrofold does not need a multi-product chooser merely because Merge does. Integration-specific behavior should sit beneath a consistent connection model. Shared SDK examples should come from the same contract as the API reference.

### LiveKit

**Structure and depth.** LiveKit separates introductions, building agents, frontends, transport, deployment, and references. Its Room service API explains authentication and protocol behavior, then describes methods, required permissions, return types, and parameters. [Room service API](https://docs.livekit.io/reference/other/roomservice-api/).

**Visual design.** The inspected pages use contextual left navigation, a right-hand table of contents, and a restrained accent. Page-level actions include copying, Markdown viewing, and asking about the current page. The coding-agent page includes a video, with written guidance below it.

**AI-first development.** LiveKit documents equivalent documentation retrieval through its CLI and Docs MCP, raw Markdown, indexes, and starter repositories containing agent instructions. The retrieval interface supports finding pages and reading their full context. [Coding-agent support](https://docs.livekit.io/intro/coding-agents/).

**Apply to Macrofold.** Treat documentation lookup as a complete browse/search/read journey. Include narrowly scoped integration instructions in starter workspaces. Keep essential steps available in text even when videos or chat are provided.

### Composio

**Structure and depth.** Composio's quickstart lets readers select a framework, perform the integration, then understand the result through a short explanation. Further links lead to session configuration and authentication. The reference begins with base URL, credentials, and API/SDK entry points. [Quickstart](https://docs.composio.dev/docs/quickstart), [reference](https://docs.composio.dev/reference).

**Visual design.** Browser inspection showed framework cards and numbered steps with language tabs. The site distinguishes Docs, Knowledge Base, Examples, Toolkits, and Reference. Copy actions and the table of contents remain close to the article.

**AI-first development.** The machine-readable index routes readers by intent and provides direct Markdown URLs. The quickstart explicitly connects identity, stored sessions, and account authorization to the example. [Documentation index](https://docs.composio.dev/llms.txt).

**Apply to Macrofold.** Put a brief explanation after a working example, especially where a resource must be reused. Make the difference between named connections and agent presets clear. Validate that framework-selected examples survive Markdown export: a text extraction of the quickstart did not expose all the interactive content visible in the browser.

### Firecrawl

**Structure and depth.** Firecrawl separates introductory guidance, SDKs, API reference, and building with AI. Its navigation groups core operations, additional capabilities, integrations, webhooks, and contribution/self-hosting guidance. [Introduction](https://docs.firecrawl.dev/introduction), [Cloud and open source](https://docs.firecrawl.dev/contributing/open-source-or-cloud).

**Visual design.** The inspected page uses a dark neutral surface with orange accents, a version/language header, a contextual sidebar, and a table of contents. A visible setup chooser tailors instructions to the reader's coding agent. The Scrape reference places request/response examples beside the operation and links to a capability explanation covering deployment differences. [Scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

**AI-first development.** The AI onboarding guide describes skills, CLI/MCP setup, Markdown exports, indexes, and page actions that transfer documentation into an assistant. The inspected reference also advertised browser-level WebMCP tools for documentation search and skill opening; these were observed, not invoked. [Build with AI](https://docs.firecrawl.dev/ai-onboarding), [inspected reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

**Apply to Macrofold.** Match onboarding to the user's tool while retaining a universal copyable brief. Make rendered and exported instructions equivalent. Keep capability and operating differences discoverable beneath a shared product explanation. A setup widget should not be required to obtain the basic API instructions.

### Daytona

**Structure and depth.** Daytona separates introduction, concepts, sandbox capabilities, agent/human tools, and operational topics. The reference menu distinguishes SDKs, HTTP API, and CLI. Its API page offers multiple OpenAPI specifications rather than conflating platform and toolbox surfaces. [Documentation](https://www.daytona.io/docs/en/), [API reference](https://www.daytona.io/docs/en/tools/api/).

**Visual design.** The inspected guides use monospace headings and navigation details, with a conventional three-column reading layout. Copy for LLM and View as Markdown are explicit actions near the title. The embedded API reference uses a different layout optimized for schemas and request examples.

**AI-first development.** Daytona publishes an agent skill with references for API, CLI, and SDK tasks, plus installation and scope guidance. [Agent skills](https://www.daytona.io/docs/en/agent-skills/).

**Apply to Macrofold.** Name distinct interfaces clearly and expose the underlying contract. An API renderer can coexist with authored conceptual guides. Use a recognizable visual identity without sacrificing readable prose or hiding lifecycle details behind infrastructure terminology.

### Inngest

**Structure and depth.** Inngest separates Learn from Reference and exposes language/version context. Concepts such as execution, errors, cancellation, and flow control sit apart from deployment and platform guidance. The REST reference explicitly lists hosted and development base URLs, authentication, OpenAPI, and agent exports. [Docs home](https://www.inngest.com/docs), [REST API overview](https://api-docs.inngest.com/).

**Visual design.** The inspected docs use a persistent learning/reference switch and language selector above the sidebar. The REST reference is a focused surface with copy-Markdown actions and a short table of contents.

**AI-first development.** Inngest explains how skills, operational MCP, CLI debugging, and LLM documentation fit together. It links these tools to testing and inspecting actual local or cloud execution. [AI development tools](https://www.inngest.com/docs/ai-dev-tools).

**Apply to Macrofold.** Document the whole asynchronous journey: submit, inspect, wait or stream, cancel, and recover. Show local verification as a real feedback loop. Preserve a clear route between conceptual execution behavior and its exact API contract.

### E2B

**Structure and depth.** E2B starts with a small sandbox example and introduces the core building blocks. It explicitly explains where to find quickstarts, examples, and SDK reference. Navigation also separates sandbox guidance, use cases, SDK reference, HTTP reference, changelog, and FAQs. [Documentation](https://docs.e2b.dev/).

**Visual design.** The inspected pages use a restrained dark layout, strong orange accents, language tabs, and clearly separated content regions. The HTTP reference places parameters beside request and response panels. The inspected list operation had visible deprecation labels and a replacement route. [List sandboxes reference](https://docs.e2b.dev/api-reference/sandboxes/list-sandboxes).

**AI-first development.** The page advertises a documentation index and copy-page actions, while the browser shows an assistant entry point. The index fetch failed during this review, so its contents and availability were not independently validated.

**Apply to Macrofold.** Define the small set of resources a developer actually uses. Make lifecycle changes and replacements visible where readers encounter an operation. Do not let an index or search result silently route new users to an obsolete entry point.

## Information architecture

### Organize around reader intent

Use distinct content types even if the navigation uses simpler labels. Diátaxis distinguishes tutorials, how-to guides, reference, and explanation; its central benefit is avoiding a tutorial that becomes an exhaustive reference halfway through. [Diátaxis overview](https://diataxis.fr/start-here/).

| Reader intent | Recommended entry | Required outcome |
| --- | --- | --- |
| Understand the product | Overview | Know what runs remotely, what persists, and how to invoke it |
| Get a first result | Quickstart | Complete one supported run and retrieve a result |
| Ask a coding agent to integrate | Build with AI | Give the agent a scoped brief, exact references, and success criteria |
| Implement a specific workflow | Task guide | Finish a concrete task using existing resources |
| Look up a method or field | API/SDK reference | Find exact syntax, types, defaults, permissions, and errors |
| Understand a behavior | Concept page | Explain the resource relationships and lifecycle |
| Operate a deployment | Hosting/operations | Configure, monitor, recover, and upgrade a supported installation |
| Contribute a harness or feature | Contributor documentation | Find the interface, extension points, and validation expectations |

For a future Macrofold navigation, use a small set of recognizable groups such as **Start**, **Guides**, **API & SDKs**, **Hosting**, and **Resources**. “Build with AI” should be visible under Start and reachable from the quickstart. Final labels should follow a navigation test rather than a fixed number of categories.

Do not mirror every source-code directory in user navigation. A codebase map serves contributors; a customer generally wants to create a run, read a file, or connect Slack. Provide links between those views without mixing their audiences.

### Keep the first journey narrow

A first-run guide should introduce only the resources required by that path. For example, a saved-agent journey can explain that the preset determines execution configuration and the workspace identifies persistent files. It should then show submission and one result-reading method.

Link to alternate harnesses, advanced event processing, Git workflows, pricing rules, and deployment internals after the first result. Necessary prerequisites, permissions, and spending implications must remain visible before the relevant action. Progressive disclosure is about ordering complexity, not removing material facts. [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

Finish the guide with a short explanation of what was created, how to find it again, how to clean up any disposable resources, and a few next tasks. Avoid a long undifferentiated “related links” catalog.

### Cloud, self-hosting, and contributor development

Maintain a shared conceptual model and operation reference. Explain origin and credential selection once, then link to setup instructions for the chosen environment. Do not duplicate every SDK example into Cloud and self-hosted editions.

| Path | Documentation should explain | Documentation should not assume |
| --- | --- | --- |
| Macrofold Cloud | Account/workspace setup, API credentials, enabled capabilities, billing, first run | That the customer operates workers or databases |
| Self-hosted Macrofold | Supported deployment, origin, identity configuration, providers, storage, operating responsibilities | That a local development server is a hardened deployment |
| Contributor simulation | Disposable services, fixtures, expected simulated behavior, test commands | That a free local pass establishes live provider or cloud acceptance |

Use an explicit capability comparison when differences exist. Keep those differences near affected features as well as on the hosting overview. Supabase's deployment documentation is a useful example of separating local development, self-hosting, and managed-platform responsibilities. Inngest similarly documents how SDKs connect to a self-hosted endpoint. [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting), [Inngest self-hosting](https://www.inngest.com/docs/self-hosting).

Open-source code, an open-source SDK, a bring-your-own-compute option, and a fully self-hostable service are different claims. Verify each independently. Do not infer deployment parity from a GitHub link or a vendor's product category.

### Navigation and cross-linking

- Give every feature a short overview and a clear route to its task guides and contract.
- Use stable, descriptive URLs and headings that make sense in a search result or copied excerpt.
- Keep the selected product, language, API version, and section visible where applicable.
- Preserve language selection across related pages when equivalent examples exist; clearly identify unavailable examples.
- Link from task guides to relevant operations and from operations back to their task guides.
- Provide prerequisites and next steps explicitly. A previous/next pager alone does not explain why a page is useful.
- Keep troubleshooting searchable by symptoms, error codes, and operation names.
- Give current, deprecated, preview, and unsupported behavior distinguishable labels. Only introduce version machinery for versions actually supported.

## Visual design and interaction

### Use layouts appropriate to the page

The references do not share one universal layout. Their recurring pattern is a consistent site shell with different content arrangements for different jobs.

| Page | Useful arrangement | Avoid |
| --- | --- | --- |
| Documentation home | Short product explanation, first action or example, a few task paths | Marketing-length hero, exhaustive feature inventory before onboarding |
| Quickstart | Readable main column, numbered steps, contextual examples, modest TOC | Multiple competing setup tracks interleaved in every step |
| Concept or task guide | Contextual sidebar, focused article, right-hand TOC where useful | Permanent code column with no relevant code |
| API operation | Resource navigation, purpose and parameters, adjacent request/response examples | A narrow schema squeezed beside oversized navigation |
| SDK reference | Language/version context, signature, examples, types, relevant behavior | Raw generated type dumps as the only explanation |

The supplied OpenAI and Exa endpoint screenshots are strong references for side-by-side contract and examples. Claude and Resend are useful references for spacious reading. Merge demonstrates product/category navigation at a much larger information scale. These are design references, not instructions to reproduce their brands.

### Typography, spacing, and visual hierarchy

Use a small type hierarchy: page title, section title, body, label, and code. Keep paragraph measure comfortable; roughly 60–80 characters is a reasonable initial design target to test, not a measurement of the surveyed sites. Use monospace for identifiers and code; avoid turning explanatory prose into a terminal aesthetic.

Use whitespace to identify groups and transitions. Subtle borders can separate navigation, code, and examples without enclosing every paragraph in a card. Give one primary action prominence. Treat secondary actions—copy, Markdown, feedback, assistant—as a consistent quiet toolbar.

Color should communicate selection, status, or emphasis. HTTP badges should include method text, and warning states should include labels. Test contrast in both themes rather than assuming a subdued gray palette is readable. Reserve elaborate motion, textures, and decorative graphics for places where they explain the product; reference pages should remain stable while readers compare fields and code.

### Code and response panels

- Label language, filename or command context, and purpose where relevant.
- Keep installation, configuration, executable code, and expected output distinguishable.
- Prefer the official typed SDK for the shortest supported happy path; keep HTTP available for interoperability.
- Use a small initial request and named examples for advanced scenarios.
- Keep copy controls keyboard-accessible and announce successful copying without moving focus.
- Preserve intentional whitespace. Do not copy shell prompts, line numbers, hidden optional content, or unrelated tabs into runnable examples.
- Show meaningful responses, including the fields the next step reads. Label illustrative IDs and fixture outputs.
- Offer wrapping or horizontal scrolling for code without making the whole page scroll sideways.
- Make request, response, and error-state selection obvious. A “200” tab should not imply that all operations are synchronous.
- Keep installed SDK examples distinct from generated generic HTTP snippets. A language label alone does not establish that a sample uses the official SDK.

### Disclosure, search, and assistant controls

Use tabs for alternative languages or scenarios, accordions for genuinely secondary detail, and headings for primary content. Required parameters, prerequisites, charges, destructive behavior, and decisive limitations should not require opening an unlabeled accordion.

An expanded parameter should have a linkable location and enough parent context to identify its object path. Search results should be able to reveal the target even when it is inside a collapsed group. The Markdown representation must retain all relevant tab and disclosure content with explicit labels.

Keep ordinary search available when an assistant exists. Search is useful for exact identifiers; an assistant can explain a task or route to several pages. Distinguish their actions and keyboard behavior. Offer example questions, source links, a cancel action, and recovery from unavailable answers. Do not make chat the only way to navigate.

Floating question bars appeared in supplied or inspected pages. They warrant testing at narrow sizes because they consume reading space; this review did not establish an accessibility defect in those sites. For Macrofold, verify that overlays cannot hide code, focused controls, the last paragraph, or error messages.

### Accessibility and responsive behavior

Use WCAG 2.2 AA as the acceptance baseline, including semantic structure, contrast, keyboard access, visible focus, reflow, and appropriate control targets. The suggestions here are design requirements for future work, not a claim that the surveyed sites passed an accessibility audit. [WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

At narrow widths, place examples in reading order beneath the relevant explanation. Collapse navigation into an accessible drawer and provide an optional on-page contents control. Ensure deep links, browser Back, text selection, copy actions, and search still work. Do not silently remove advanced content on mobile.

Respect reduced-motion preferences. Keep navigation transitions brief, avoid layout shifts during code loading, and preserve reading position when changing an example. Validate with keyboard-only use, a screen reader, zoom, long method names, large schemas, and mobile layouts.

## Page templates

These are proposed content templates, not new files to create automatically. Short pages should omit irrelevant sections rather than filling a template mechanically.

| Template | Recommended sequence |
| --- | --- |
| Overview | What the product does → principal resources → first task → learning paths |
| Quickstart | Result → prerequisites → short sequence → expected output → verification → next tasks |
| Task guide | Goal → required state/permissions → steps → result → likely failures → related operations |
| Concept | Definition → relationships or lifecycle → concrete example → guarantees and limits → guides |
| API overview | Origin and SDK setup → authentication → first operation → shared conventions → resource index |
| API operation | Purpose and method/path → authorization → minimal request → inputs → outputs → errors → lifecycle notes |
| SDK guide | Install → credentials/origin → typed resources → wait/stream → errors/retries → deeper reference |
| Integration guide | What it enables → ownership/authentication → setup → verification → disconnect/recovery → limitations |
| Hosting guide | Supported topology → prerequisites → deployment → verification → operation/recovery → upgrade |
| Troubleshooting | Observable symptom → likely causes → safe checks → resolution → escalation evidence |
| Build with AI | Intended result → copyable brief → human setup → verification → focused references |

For Macrofold, the main API overview should remain much shorter than its operation reference. It should answer how to authenticate, where to send requests, how to submit a run, and how to retrieve a result. Financial settlement, scheduling fairness, transport details, and provider behavior should have precise linked owners.

## API reference requirements

### Inputs and authentication

Every public operation needs a clear purpose, stable operation identifier, method/path, resource relationship, and authorization requirements. Distinguish organization-level permissions, workspace/resource access, API-key scopes, and dashboard cookie authentication where relevant.

Document required versus optional separately from nullable versus non-nullable. For each field, supply its type, accepted values, units, bounds, default, and omission behavior. Explain cross-field constraints, mutually exclusive fields, and configuration inherited from an agent preset. Avoid relying solely on generated schema syntax for rules spanning multiple fields.

Show where path, query, header, and body parameters belong. SDK examples should present idiomatic typed methods rather than asking users to assemble a generic operation dictionary. HTTP examples should remain complete enough to reproduce the operation independently.

### Outputs, asynchronous work, and errors

For each response, identify status code, response schema, IDs, timestamps, pagination where applicable, and the fields a caller should store. Explain whether returned data describes an accepted request, active execution, completed execution, or persisted result.

Macrofold needs particularly clear explanations of:

- Submission versus execution start, and queue deadline versus execution timeout.
- Completion of agent work versus completion of persistence.
- Full-result retrieval versus plain-text streaming versus structured historical events.
- Detaching from a stream or timing out a wait versus explicitly cancelling execution.
- Worktree sharing and serialization, including how a caller observes blocked work.
- Persistent files, checkpoint visibility, and when programmatic reads see saved changes.
- Funding method, accepted prices, reservations, usage, and terminal settlement.

These are topics a future documentation update must verify against implementation; this list does not redefine their current semantics.

Describe typed SDK errors and the corresponding HTTP error structure. Give an actionable distinction between invalid input, missing credentials, insufficient permission, conflicts, budget failures, throttling, temporary failure, and terminal execution failure. Include a request or run ID where the implementation provides one, with advice about safe diagnostic reporting.

### Reliability and integration behavior

Document automatic SDK retries, configurable timeouts, idempotency support, cancellation, stream reconnects, replay cursors, and duplicate handling at their real ownership boundaries. Do not imply that retrying a network request safely repeats an arbitrary agent side effect.

For webhooks, document signatures, timestamp/replay checks, delivery retries, duplicate delivery, ordering guarantees or their absence, and how to test handlers. For connections, distinguish creating authorization, selecting a named account, revocation, and reconnecting. Keep shared explanations linked from individual operations.

Expose the OpenAPI contract and use it to generate repeated endpoint details. Add authored explanations for behaviors the schema cannot express. Verify that generated request samples use the same naming, origin, versions, and response wrappers as the SDK examples.

### Interactive API explorers

A playground can shorten learning, but displaying a request must not execute it. Use a clearly labeled fixture mode by default when demonstrating agent execution. A live action should identify its destination, authentication context, expected side effects, and spending implications before the user invokes it.

Keep credentials out of URLs, shared examples, telemetry, exported snippets, and server-rendered public pages. Do not persist keys in browser storage merely to make a playground convenient. Reading and copying documentation should require no credentials. A robust copyable request is more valuable than an unreliable “Try it” experience.

## AI-first documentation

### Provide a goal-oriented implementation brief

The most useful addition is a brief a customer can give their existing coding agent. Resend, Supabase, Exa, and Vercel make this route visible in onboarding; it should be a supported way to start, not an experimental appendix.

The proposed Macrofold brief should specify:

| Element | What it should communicate |
| --- | --- |
| Goal | The application behavior to implement and the observable first result |
| Existing workspace | Inspect the user's language, framework, conventions, and existing integration before editing |
| Environment | Use the chosen Cloud, staging, local, or self-hosted origin; do not invent it |
| Credentials | Identify the required credential and where the user configures it securely; never request it in a prompt |
| Resources | Reuse or create the intended workspace and agent preset; record returned IDs |
| Contract | Read direct links to the quickstart, SDK guide, relevant operations, and lifecycle behavior |
| Implementation | Use the official SDK and a small complete change consistent with the application |
| Verification | Run the supported free simulation or fixtures; check the returned result and saved file |
| Authority | Do not infer permission to spend, deploy, connect third-party accounts, or broaden access |
| Handoff | Explain what works, what was tested, and which manual setup remains |

Keep one authoritative prompt source and derive copy actions from it. Publish concrete current links when implementing it. Avoid placeholder links presented as working documentation and avoid embedding a repository-wide contributor policy in a customer's workspace.

Offer a universal copy action first. Tool-specific “Open in…” actions are conveniences; they should preserve the same brief and explain what is transmitted. Do not silently include account identifiers, prompts, files, or credentials in an external assistant URL.

### Build a layered machine-readable experience

The following is a proposed architecture for documentation delivery. It does not add a new application API or change the existing management MCP.

| Layer | Purpose | Recommended property |
| --- | --- | --- |
| Public HTML | Human reading and broad crawlability | Semantic, linkable, meaningful without executing a complex app |
| Page Markdown | Focused agent context | Same facts as HTML; labeled alternatives and resolvable links |
| `llms.txt` | Discover the right pages | Short task-oriented index with descriptions and API-contract links |
| Topic indexes | Navigate larger feature families | Bounded indexes linking to leaf pages and parent context |
| OpenAPI | Exact HTTP contract | Current, downloadable, stable operation IDs, reusable schemas |
| Full-text export | Offline or deliberate bulk context | Generated, clearly identified, optional rather than the default input |
| Documentation MCP or CLI | Search, browse, fetch current references | Public read-only scope, bounded results, canonical source links |
| Integration skill | Repeatable implementation guidance | Small router with focused references and a documented version |

Browser-exposed documentation tools, such as the WebMCP discovery observed on Firecrawl, are another possible convenience. Treat them as optional: verify client support, scope, and actual behavior before adoption. They should not replace ordinary links, page exports, or a tool-independent onboarding route.

OpenAI demonstrates the documentation-only MCP boundary; LiveKit demonstrates multiple retrieval interfaces; Neon demonstrates hierarchical indexes; Vercel documents optional graph-based discovery. These are complementary patterns, not a requirement to build every mechanism immediately. [OpenAI Docs MCP](https://developers.openai.com/learn/docs-mcp), [LiveKit coding-agent support](https://docs.livekit.io/intro/coding-agents/), [Neon index](https://neon.com/docs/llms.txt), [Vercel discovery](https://vercel.com/docs/agent-resources/markdown-access).

### Make exported pages complete and unambiguous

Export the article rather than the entire navigation shell. Include the title, purpose, prerequisites, language/version context, complete labeled examples, field descriptions, important limitations, and next references. Convert relative links to resolvable canonical links for remote consumption, or retain a clearly specified base.

Keep tabs and accordions in the export with their labels. Render diagrams into a textual relationship or explanation as well as the human visual. Include table headers and object paths so a retrieved row remains meaningful. Test that a page reached directly from search contains enough context to use correctly.

Support one documented Markdown URL convention. If content negotiation is offered, serve the correct content type and configure caches to distinguish representations. A 404 should be a real error response with a helpful index link, not a success response containing the homepage.

Use deliberate topic scope. Do not require an agent to fetch the entire API reference to learn how to wait for a run. Conversely, avoid tiny fragments that omit the authorization or lifecycle rule needed to use an operation safely.

### Keep assistants grounded

A documentation assistant should retrieve current pages, cite stable links, preserve version context, and state when a capability is unsupported or unclear. It should not invent methods, packages, fields, or guarantees to produce an answer.

Keep documentation assistance separate from operational agents that inspect accounts or launch runs. If operational tools are offered, document their permissions and consent separately. Public page text and retrieved examples are information, not authorization to act on a customer's systems.

Evaluate answers about difficult cases as well as happy paths: ambiguous timeouts, revoked access, stream interruption, failed persistence, an unsupported harness/model combination, and attempts to use another organization's resource. Check both correctness and whether the assistant asks for unnecessary secrets or proposes paid work without approval.

## Discovery, search, and SEO

### Human search and navigation

Index titles, summaries, headings, API paths, SDK methods, error codes, and common user vocabulary. Return a useful excerpt and the resource's location. Separate guides, reference, troubleshooting, and internal research in search results; public search must not include maintainer-only material.

Exact identifiers should work without a natural-language query. Synonyms should connect common terms to the product vocabulary without renaming the contract. A user searching for “stop agent” should find cancellation; “download output file” should lead to the relevant persisted-file guide.

Track no-result searches and repeated failed queries without collecting secrets or application payloads. Search suggestions should lead to useful pages, not only frequently visited pages.

### Search engines and answer engines

Provide useful public HTML, descriptive titles and summaries, stable canonical URLs, internal links, a sitemap, correct status codes, and crawlable content. Keep redirects, publication indexes, and Markdown representations aligned. Use structured data only where it describes the real visible content and has a supported purpose.

Do not treat `llms.txt` as a guaranteed SEO or answer-engine ranking improvement. Google explicitly states that its AI search features require no special AI text file or special schema beyond the established search requirements. Machine-readable documentation is valuable for retrieval even without a ranking promise. [Google Search guidance for AI features](https://developers.google.com/search/docs/appearance/ai-features).

Publish an honest freshness signal based on meaningful changes. Avoid fabricated update dates, repetitive keyword headings, duplicate question pages, or automatically generated prose that competes with the authoritative reference. The goal is an answer that can be found and verified.

## Documentation technology

### What was verified

Visual similarity is insufficient to identify a platform. A site's public repository can establish implementation ingredients but does not prove the exact deployed revision. Historical customer stories need their dates preserved.

| Provider | Evidence | Conclusion and limit |
| --- | --- | --- |
| Firecrawl | Live documentation footer links to Mintlify | Mintlify is explicitly identified as its documentation platform. [Introduction footer](https://docs.firecrawl.dev/introduction) |
| Composio | Public docs package lists Next.js, Fumadocs UI/core/MDX, and Fumadocs OpenAPI | A customizable React/Next.js documentation stack is present in the reviewed branch. [Package manifest](https://github.com/ComposioHQ/composio/blob/next/docs/package.json) |
| Daytona | Public Astro configuration imports Starlight and overrides layout components | Astro/Starlight with custom styling and components is present in source; the reference has a distinct embedded UI. [Configuration](https://github.com/daytonaio/daytona/blob/main/apps/docs/astro.config.mjs) |
| Supabase | Public documentation app package and contributor guidance | A repository-owned Next.js docs application with an explicit authoring guide is present. [Package manifest](https://github.com/supabase/supabase/blob/master/apps/docs/package.json), [authoring guide](https://github.com/supabase/supabase/blob/master/apps/docs/CONTRIBUTING.md) |
| Merge | Fern's 2024 customer account describes SDK generation and dynamically supplied examples within Merge's then-custom docs | Evidence of a contract-driven SDK/example workflow, not proof of the current site's hosting technology. [Fern case study](https://buildwithfern.com/post/merge) |
| OpenAI, Claude, Exa, Resend, Neon, Vercel, LiveKit, Inngest, E2B | Public pages and visual inspection | This review did not establish the exact current documentation platform. Their observed UX can be adopted independently of that platform. |

Do not interpret “not established” as “custom-built” or “unsupported.” Likewise, an Ask AI button does not identify its model, retrieval system, cost, or answer quality.

### Choices to evaluate later

| Approach | Why consider it | What to validate before choosing |
| --- | --- | --- |
| Retain and improve the current renderer | Smallest scope; preserves integration and existing sources | Whether templates, search, exports, and reference presentation can meet the task requirements cleanly |
| Managed documentation platform | Bundled publishing, navigation, API rendering, search, and agent features | Pricing, exportability, preview workflow, custom domains, private-content boundaries, source ownership, accessibility |
| Maintained open-source documentation framework | Reusable components with more hosting and design control | Runtime/build complexity, Markdown export quality, OpenAPI integration, upgrades, and maintenance cost |
| Separate API renderer beside authored guides | Specialized schema and request/response UX | Shared navigation, theme, search, links, SDK examples, and avoiding two conflicting contracts |

Mintlify documents automatic agent indexes and Markdown-related discovery. Fern documents combining API specifications, authored Markdown, and configuration into a hosted site. The verified Composio and Daytona source examples show that framework-based customization is another viable approach. None of these findings by itself justifies a Macrofold migration. [Mintlify agent indexes](https://www.mintlify.com/docs/ai/llmstxt), [Fern documentation workflow](https://buildwithfern.com/learn/docs/getting-started/how-it-works).

Prefer a small prototype using the same three pages—a first-run guide, a complex operation, and a persistence concept—before choosing a platform. Compare human task completion, exported content, maintenance effort, and total operating cost. A visually polished demo is insufficient if its generated SDK examples or agent exports are inaccurate.

## Authoring and maintenance

Use plain language, active verbs, explicit actors, and descriptive headings. Define a term when first needed. Cut promises such as “effortless” or “perfect” when a concrete result would be more informative. Supabase's public authoring guide is a useful reference for clear conversational writing and distinct document types. [Supabase authoring guidance](https://github.com/supabase/supabase/blob/master/apps/docs/CONTRIBUTING.md).

Keep one authoritative owner for each fact. Reuse snippets and structured data where duplication would otherwise create drift. Generated material should point back to its source; authored guides should explain intent and behavior rather than restating every generated field.

Review documentation in the same change as affected behavior. Verify commands against the actual package manager and package scripts. Keep examples aligned with published package availability, supported versions, and real defaults. Do not use a command just because it looks shorter.

Keep operational handoffs, acceptance gaps, and research separate from the public happy path. Actual user-impacting limitations still belong in the relevant public page. A maintainer TODO should record unresolved work without making the public documentation misleading.

Do not require every page to accumulate a changelog. Record consequential decisions and historical reasons at the bottom of the relevant document; update the main explanation to the current state. This research remains background material until recommendations are accepted in a later change.

## Quality checks and measurement

### Automated checks

| Check | Failure it should catch |
| --- | --- |
| Links, anchors, and publication graph | Orphaned pages, broken source links, inaccessible next steps |
| Contract/reference consistency | Stale fields, wrong defaults, mismatched required/nullable semantics |
| SDK example compilation or fixture execution | Invented methods, obsolete imports, wrong response wrappers |
| Human/Markdown equivalence | Missing tab content, omitted warnings, broken diagrams or relative links |
| Agent index generation | Stale links, private pages, missing descriptions, duplicate content |
| Accessibility and responsive checks | Unlabeled controls, trapped focus, unreadable contrast, clipped content |
| Safe example validation | Embedded credentials, unintended production origins, paid calls in ordinary CI |
| Search fixtures | Failure to find operation IDs, error codes, or common task wording |

Use deterministic simulation for routine documentation examples. Live acceptance should remain a separate opt-in activity with its own authorization, budget, and evidence. Documentation generation succeeding does not establish that an SDK or provider integration works live.

### Representative human and agent tasks

Test the documentation using realistic tasks without providing undocumented hints:

1. Explain the product and choose an appropriate setup path.
2. Invoke a saved agent against a workspace and retrieve the completed output.
3. Stream plain text, then explain how detaching differs from cancellation.
4. Read a file written during a completed run.
5. Reuse a worktree for another run and identify why a run is waiting.
6. Select the intended named connection without changing another agent's account.
7. Handle invalid credentials, insufficient scope, a budget failure, and throttling.
8. Recover from an interrupted stream without confusing replay with duplicate execution.
9. Configure a self-hosted origin without changing the application workflow.
10. Find the Unified Harness Interface and its contribution requirements.

For coding agents, begin in a small disposable customer-style repository with the advertised documentation entry point. Record the pages retrieved, unsupported assumptions, compile/test failures, unnecessary context, and any request for secrets or unauthorized spending. Run repeatable fixtures against selected supported coding tools; report the tool/version and task scope with the result.

### Measures worth tracking

Track first-result completion, time and steps to complete a task, search success, broken-link rate, example failures, recurring confusion, and documentation freshness after API changes. For agents, also track invented symbols, wrong environment selection, missing lifecycle handling, and excessive retrieval.

Segment by language, setup path, and experience level where practical. Treat suggested time estimates and success targets as hypotheses until measured. Do not optimize for raw page count, chatbot engagement, or a synthetic “AI-ready” badge at the expense of correct integrations.

## Adoption priorities

This is a proposed order for later work, not a list of changes made in this research task.

| Priority | Proposed work | Completion evidence |
| --- | --- | --- |
| First | Agree on the small vocabulary, onboarding path, and shared Cloud/self-hosted structure | A new reader can select a path and explain the resources involved |
| First | Improve the quickstart and API overview; provide one canonical implementation brief | Human and coding-agent first-result tasks pass using only linked instructions |
| First | Bring critical operation examples, errors, lifecycle rules, and file-reading guidance into agreement | SDK/contract checks and deterministic customer-style journeys pass |
| First | Ensure useful HTML, complete Markdown, stable links, and a focused agent index | Export, link, publication, and retrieval checks pass |
| Next | Refine guide/reference layouts, code panels, language selection, search, and mobile access | Keyboard, responsive, readability, and search tasks pass |
| Next | Add a small integration skill or read-only documentation retrieval interface if it improves measured tasks | Fewer unsupported assumptions without added account permissions |
| Later, if justified | Documentation assistant, graph exports, more framework recipes, or platform migration | A measured benefit that exceeds maintenance, operating, and migration cost |

Avoid starting with a custom retrieval platform, a mandatory plugin install, extensive animation, or a wholesale docs-framework rewrite. The first test is whether the current system can present accurate, navigable, complete content with a small change.

## Sources and evidence

### Scope and limitations

The review covered all 14 distinct requested companies; Resend appeared twice in the request and was reviewed once. It used official documentation, selected public source repositories, direct desktop-browser inspection, and all 13 supplied screenshots. Representative introductory and reference layouts were inspected for each provider, with the supplied screenshots providing the detailed visual evidence for OpenAI, Claude, Exa, and Resend.

This was a documentation research task. No provider API operations, model executions, account provisioning, plugin installations, deployments, or paid assistant queries were performed. No claim is made about conversion rates, accessibility conformance, mobile behavior, assistant answer quality, or live integration correctness. Those require the separate tests described above.

Several Neon article fetches failed in the research tool but rendered in the browser; their structure was inspected there. E2B advertised an index, but the attempted index fetch failed. Dynamic browser content and extracted text differed on some pages, especially framework/setup selectors; this limits conclusions based solely on text extraction. Repository manifests establish source-level ingredients, not the exact production build.

Findings about layout and navigation are observations. Recommendations, priority order, target reading widths, and the proposed Macrofold structure are judgments to validate. Provider marketing claims were not independently benchmarked. Current links may redirect or change; the evidence date is recorded in the bottom changelog.

### Provider reference map

These links offer a compact route back to the evidence. More specific citations appear beside the findings they support.

| Provider | Entry or guide | Technical reference | Agent-oriented evidence |
| --- | --- | --- | --- |
| OpenAI | [Quickstart](https://developers.openai.com/api/docs/quickstart) | [API documentation](https://developers.openai.com/api/docs/) and supplied reference screenshots | [Docs MCP](https://developers.openai.com/learn/docs-mcp) |
| Claude | [Introduction](https://platform.claude.com/docs/en/intro) | [API overview](https://platform.claude.com/docs/en/api/overview) | [Claude API skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/claude-api-skill) |
| Exa | [Search guide](https://exa.ai/docs/reference/search-api-guide) | [Search](https://exa.ai/docs/reference/search) | [Coding-agent guide](https://exa.ai/docs/reference/search-api-guide-for-coding-agents) |
| Resend | [Introduction](https://resend.com/docs/introduction) | [Send Email](https://resend.com/docs/api-reference/emails/send-email) | [AI onboarding](https://resend.com/docs/ai-onboarding) |
| Neon | [Documentation](https://neon.com/docs/introduction) | [API overview](https://neon.com/docs/reference/api) | [Hierarchical index](https://neon.com/docs/llms.txt) |
| Supabase | [Documentation](https://supabase.com/docs) | [JavaScript select](https://supabase.com/docs/reference/javascript/select) | [AI tools](https://supabase.com/docs/guides/ai-tools) |
| Vercel | [Documentation](https://vercel.com/docs) | [REST API](https://vercel.com/docs/rest-api) | [Agent discovery](https://vercel.com/docs/agent-resources/markdown-access) |
| Merge | [Docs home](https://docs.merge.dev/home) | [HRIS reference](https://docs.merge.dev/merge-unified/hris/overview) | Index and Markdown discovery advertised on [Docs home](https://docs.merge.dev/home) |
| LiveKit | [Coding-agent guide](https://docs.livekit.io/intro/coding-agents/) | [Room service API](https://docs.livekit.io/reference/other/roomservice-api/) | [CLI, Markdown, and MCP guidance](https://docs.livekit.io/intro/coding-agents/) |
| Composio | [Quickstart](https://docs.composio.dev/docs/quickstart) | [Reference](https://docs.composio.dev/reference) | [Documentation index](https://docs.composio.dev/llms.txt) |
| Firecrawl | [Introduction](https://docs.firecrawl.dev/introduction) | [Scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape) | [Build with AI](https://docs.firecrawl.dev/ai-onboarding) |
| Daytona | [Documentation](https://www.daytona.io/docs/en/) | [API reference](https://www.daytona.io/docs/en/tools/api/) | [Agent skills](https://www.daytona.io/docs/en/agent-skills/) |
| Inngest | [Documentation](https://www.inngest.com/docs) | [REST API](https://api-docs.inngest.com/) | [AI development tools](https://www.inngest.com/docs/ai-dev-tools) |
| E2B | [Documentation](https://docs.e2b.dev/) | [List sandboxes](https://docs.e2b.dev/api-reference/sandboxes/list-sandboxes), inspected as a deprecation/discoverability example | Index advertised on [Documentation](https://docs.e2b.dev/); fetch unverified |

### Supplied visual references

The supplied screenshots were reviewed locally and are not copied into the repository or required to read this document. This preserves the research without publishing incidental account UI or personal filesystem paths. All filenames share the prefix `Screenshot 2026-09-09 at` and the `.png` extension; the capture times below identify them within the supplied collection.

| Capture time | Page | Principal visual evidence |
| --- | --- | --- |
| 7.58.09 PM | Exa Search human guide | Human/agent navigation, article TOC, copy action, progressive detail |
| 7.58.18 PM | Exa Search API reference | Method badges, parameter column, request/response examples |
| 8.15.55 PM | Claude docs landing | Warm typography, first actions, compact multilingual example |
| 8.16.00 PM | Claude Ask Docs modal | Suggested questions and scoped assistant entry |
| 8.16.07 PM | Claude API overview | Beginner callout, prerequisites, deep TOC |
| 8.20.36 PM | OpenAI API home | Contextual navigation, first-request card, deeper product paths |
| 8.20.46 PM | OpenAI model catalog | Comparison layout and default recommendation |
| 8.20.52 PM | OpenAI API overview | Resource navigation and ordered start path |
| 8.21.08 PM | OpenAI response operation | Expandable parameters, scenario tabs, request/response panels |
| 8.22.17 PM | Resend API introduction | Shared protocol conventions and clear reference navigation |
| 8.22.22 PM | Resend documentation introduction | Prerequisites and framework quickstart cards |
| 8.22.33 PM | Resend sending guide | Concept-first article, selected subnavigation, related capabilities |
| 8.22.46 PM | Resend AI onboarding | Human prerequisites and several agent entry mechanisms |

### Supporting standards and implementation references

- [Diátaxis](https://diataxis.fr/start-here/): separate document types by reader need.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): an established usability principle, not a new AI-specific benchmark.
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): accessibility criteria for future implementation validation.
- [Google Search AI features](https://developers.google.com/search/docs/appearance/ai-features): distinguish crawlability and useful content from unsupported AEO promises.
- [Supabase authoring guide](https://github.com/supabase/supabase/blob/master/apps/docs/CONTRIBUTING.md): public writing and content-organization guidance.
- [Composio docs package](https://github.com/ComposioHQ/composio/blob/next/docs/package.json), [Daytona docs configuration](https://github.com/daytonaio/daytona/blob/main/apps/docs/astro.config.mjs), and [Supabase docs package](https://github.com/supabase/supabase/blob/master/apps/docs/package.json): source evidence for framework-based documentation.
- [Mintlify agent indexes](https://www.mintlify.com/docs/ai/llmstxt) and [Fern documentation workflow](https://buildwithfern.com/learn/docs/getting-started/how-it-works): maintained platform capabilities to evaluate, without assuming every customer enables them.
- [Fern's Merge case study](https://buildwithfern.com/post/merge): historical evidence about SDK generation and shared code examples, not a current hosting attribution.

## Changelog

- 2026-09-09: Researched all 14 requested providers and the 13 supplied screenshots. Recorded proposed documentation principles separately from existing public guides and active coding-agent policy. The Merge/Fern workflow evidence is a 2024 historical account; other observations reflect the pages available during this review.
