# Cloud and AI-assisted documentation design

Keep one product knowledge base, with two setup paths: connect to Macrofold Cloud or operate a self-hosted deployment. Put a copyable coding-agent brief beside the human quickstart. Teach one successful task before presenting the complete API.

This research extends the [documentation reference library](research.md). It covers every company requested for this review, selected open-source projects, current agent onboarding, and established usability guidance. Observations below describe published pages and source configuration; recommendations are our design judgments, not measured conversion improvements.

## Reference comparison

| Reference | Organization and first-success path | Cloud, self-hosting, and AI lessons |
| --- | --- | --- |
| [Merge](https://docs.merge.dev/home) | Product chooser, then getting started, implementation, and API reference. | Product-specific entry points keep a broad platform navigable. Page-level Markdown and indexes support retrieval. No general self-hosting offering was established from the reviewed docs; do not infer one from public SDKs. |
| [LiveKit](https://docs.livekit.io/intro/basics/connect/) | Shared connection concepts and SDKs, with explicit URL/token setup. | The connection guide addresses Cloud and self-hosting together. [Coding-agent support](https://docs.livekit.io/intro/coding-agents/) combines current docs, starter instructions, CLI/MCP retrieval, and skills; it recommends reading full pages and checking installed versions. |
| [Composio](https://docs.composio.dev/docs/quickstart) | Framework choice, one task, then an explanation of the result and links to adaptations. | Product integration comes before platform internals. Persistent sessions and user isolation are explained where the example becomes an application. Its public SDK/docs repository does not establish a self-hosted authentication service. |
| [Resend](https://resend.com/docs/introduction) | A short product statement and explicit prerequisites lead to language quickstarts. Guides and API reference have separate navigation. | [AI onboarding](https://resend.com/docs/ai-onboarding) offers copyable task prompts, skills, CLI, Markdown, and MCP. Account access and domain verification remain explicit prerequisites. The visual reference is restrained typography and spacing, not decorative landing-page animation inside technical guides. |
| [Firecrawl](https://docs.firecrawl.dev/introduction) | A concrete request/result comes first; API, CLI, and agent setup are alternative entries. | [Open source versus Cloud](https://docs.firecrawl.dev/contributing/open-source-or-cloud) separates using an API, contributing code, and operating a service, and names actual feature differences. [Build with AI](https://docs.firecrawl.dev/ai-onboarding) is a first-class guide. |
| [Daytona](https://www.daytona.io/docs/en/) | Getting started, capability guides, platform management, and language references are distinct. | Copy-for-LLM and Markdown links sit beside the guide. [Agent skills](https://www.daytona.io/docs/en/agent-skills/) keep a small entry point with scoped references. Bring-your-own-compute is labeled separately; it is not evidence that every managed feature can be self-hosted identically. |
| [Inngest](https://www.inngest.com/docs) | Learn and Reference are separate, with framework quickstarts and task guides. | [Self-hosting](https://www.inngest.com/docs/self-hosting) is a deployment topic. [AI development tools](https://www.inngest.com/docs/ai-dev-tools) distinguish instructions, operational CLI/MCP tools, and documentation retrieval rather than treating them as one thing. |
| [E2B](https://docs.e2b.dev/quickstart) | Account, key, SDK, first sandbox, and visible execution result form a short sequence. | The [infrastructure repository](https://github.com/e2b-dev/infra) carries a separate Terraform self-hosting path and supported-cloud boundaries. Our customer quickstart should similarly avoid requiring infrastructure deployment before the first API call. |
| [HarnessRouter](https://harnessrouter.ai/docs) | The first action is copying a coding-agent integration guide, followed by describing a product and securely supplying credentials. | Its [open-source page](https://www.harnessrouter.ai/open-source) distinguishes Community Edition, starter kits, and managed Cloud. Adopt the prominent prompt and product intent; avoid requiring a particular agent UI or claiming every agent offers a secure secret modal. Published competitor capabilities were not independently tested. |

All nine homepages and their linked documentation entry points were inspected. Deeper review focused on onboarding, shared concepts, hosting boundaries, and AI resources. Resend's rendered documentation was also visually inspected. This was not an exhaustive audit of each vendor's complete documentation or infrastructure.

## Additional open-source references

[Supabase's self-hosting guide](https://supabase.com/docs/guides/self-hosting) explicitly distinguishes local development from production operation and names responsibilities and differences. Its [AI prompts](https://supabase.com/docs/guides/ai-tools/ai-prompts) can be kept in the customer's repository and included with the coding agent's own file mechanism. The [public repository](https://github.com/supabase/supabase) separates application, documentation, and deployment material. Adopt the distinction without importing its much larger navigation inventory.

[Trigger.dev](https://trigger.dev/docs/self-hosting/overview) places the operating model, version alignment, feature comparison, and deployment choices in a dedicated guide. Its [repository](https://github.com/triggerdotdev/trigger.dev) keeps development and product usage discoverable. This supports explaining genuine differences instead of promising that changing an SDK URL migrates data or supplies equivalent infrastructure.

[OpenCode](https://opencode.ai/docs) progresses through installation, provider configuration, project initialization, and concrete work. Its agent instructions are project context, distinct from a full API reference. The useful pattern is a small reusable instruction file pointing to deeper material, not a giant prompt copied into every project.

## Verified documentation technology

| Site | Evidence | Implication |
| --- | --- | --- |
| Composio | Its [docs package manifest](https://github.com/ComposioHQ/composio/blob/next/docs/package.json) declares Next.js, Fumadocs, React Markdown, Shiki, and generated agent indexes. | Product-integrated docs can use established components and generated content rather than a separate hosted platform. Dependencies do not prove which library powers every visible effect. |
| Daytona | [Astro configuration](https://github.com/daytonaio/daytona/blob/main/apps/docs/astro.config.mjs) imports Starlight and defines custom CSS, components, and code themes. | A standard documentation structure leaves room for a distinctive product design. |
| OpenCode | [Astro configuration](https://github.com/anomalyco/opencode/blob/dev/packages/web/astro.config.mjs) imports Starlight and its documentation theme. | Shared navigation and accessible reading primitives matter more than bespoke page implementations. |
| Firecrawl and Trigger.dev | Their current [Firecrawl](https://docs.firecrawl.dev/introduction) and [Trigger.dev](https://trigger.dev/docs/self-hosting/overview) footers explicitly identify Mintlify. | Copy, search, Markdown, and good page hierarchy are useful patterns to reproduce with our existing tools. |

No current framework attribution is asserted for Merge, LiveKit, Resend, Inngest, E2B, or HarnessRouter without stronger evidence. A CDN hostname, similar appearance, or a public SDK is insufficient. Source observations are branch-specific and may change.

Macrofold keeps Next.js, React Markdown, Radix search/navigation, and the generated Scalar/OpenAPI reference. No new documentation framework, hosted search subscription, inference-backed assistant, or public MCP service is required for this change.

## Principles and decisions

### One short path, then useful depth

[Diátaxis](https://diataxis.fr/start-here/) distinguishes tutorials, how-to guides, reference, and explanation by reader need. We apply that separation without forcing its terminology into navigation: quickstart, task guides, concepts, and reference. The API overview becomes a small resource map; protocol details and the complete HTTP tutorial retain dedicated pages.

[Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) is an established usability principle rather than a new AI trend. Show the likely next action first, retain clear routes to advanced controls, and keep required prerequisites visible. Do not hide spending, authentication, persistence, or missing capability behind an apparently effortless example.

For Macrofold, the landing page gives equal visual weight to Cloud and self-hosting. Shared SDK examples use the same contract; origin and credentials select a deployment. Local development and cloud staging remain separate from the customer's Cloud setup. Account availability and enabled features stay truthful.

### Help the coding agent complete a feature

The [Build with AI brief](../../getting-started/agents.md) asks for a product goal and deployment, then directs the agent to current SDK installation, API behavior, and recovery guidance. It fits an existing application, keeps credentials server-side, reuses project IDs, preserves mutation identity, and tests a complete result. Optional workspace and connector guides are linked instead of embedded wholesale.

The recent [empirical study of coding-agent documentation use](https://arxiv.org/abs/2608.20195) examines discovery, reading, and writing as related activities, emphasizing actionability and verification. It is preliminary empirical evidence, not proof that a particular prompt or UI improves Macrofold outcomes. Our immediate evidence is executable examples and link/browser tests; user task success remains to be measured.

The prompt is owned by one Markdown page. Copy actions and the displayed prompt derive from that source. On the deployed site, links point to that deployment's raw Markdown pages. Localhost requires an agent on the same host; remote agents need accessible docs or attached source. The full docs export is optional, not the default context payload.

### Modern visual design should reduce work

Use clear hierarchy, readable line lengths, explicit language labels, individual copy actions, visible failure feedback, and keyboard/mobile navigation. Keep the reading surface calm. Decorative motion adds little to a technical quickstart; existing restrained hover transitions and reduced-motion behavior are sufficient.

No vendor-specific deep link is required: a copied prompt works across coding agents. No new account, docs chat, or opaque automation step stands between the user and the readable instructions. Preserve the manual path when JavaScript or clipboard access is unavailable.

### Search and machine access share one source

[Google's current AI-search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) prioritizes useful accessible content and rejects claims that special AI files or schema are required for ranking. Keep semantic HTML, meaningful titles, canonical URLs, internal links, and the sitemap. Markdown, OpenAPI, search JSON, and `llms.txt` help tools retrieve our docs; they do not guarantee indexing or AI citations.

## Evaluation and next decisions

[Documentation verification](verification.md) records actual tests. Before public launch, verify canonical origins, source links, package installation, and remote-agent access on the released deployment. Local tests cannot establish Cloud availability or that a coding agent autonomously builds an arbitrary customer's application.

Evaluate onboarding with a small set of real tasks: first run, file read, interrupted run recovery, and two-agent handoff. Record completion, wrong turns, and outdated method/installation assumptions without capturing secrets or customer prompts in analytics. Consider a distributed skill, section indexes, or docs MCP only if these tasks expose retrieval friction. Keep those potential improvements in the [maintainer backlog](../../maintainers/TODO.md).

## Changelog

- September 2026: moved from a local-first documentation entry to shared Cloud/self-hosting product guides and a first-class AI integration brief. Research used current official pages and public source; older usability principles are identified separately from recent agent tooling.
