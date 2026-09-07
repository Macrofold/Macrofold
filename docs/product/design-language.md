# Design Language

The shared design direction for Macrofold's marketing, dashboard, developer experience, and documentation. Read this before proposing visual directions or changing those experiences. Keep preferences here; [marketing studies](marketing/README.md) explore implementations, and feature guides own actual product behavior.

Specific preferences take precedence over broad reference lists. A reference is permission to learn from a company, not an instruction to copy its entire aesthetic, product, claims, or technology stack. Research observations are not automatically approved preferences.

## At a glance

- **Identity:** sleek, performant, reliable AI developer infrastructure that unlocks new possibilities.
- **Hero:** ambitious, intriguing computational artwork with calm, direct product copy.
- **Product explanation:** show what happens, how to invoke it, and what the developer gets back.
- **Interaction:** polished components, restrained transitions, useful feedback, and accessible controls.
- **Learning:** a very short first-success path, with comprehensive detail available through progressive disclosure.
- **Restraint:** avoid cute metaphors, consumer styling, generic startup decoration, and complexity added only for spectacle.

## Product and audience

Speak to developers building applications and automations. The product makes native coding agents available in the cloud through an API, CLI, and dashboard, with persistent sandbox files and version control. Make Claude Code, Codex, and OpenCode recognizable early. Explain the difference between an agent run and the project it can return to.

The emotional promise is greater capability: developers can build things that would be awkward or impossible with an agent confined to one laptop. Cloud access, many independent executions, persistent context, and integration into a developer's own product make that promise concrete. This is a direction for storytelling, not a guarantee of unlimited concurrency or instant capacity.

The desired experience resembles the useful continuity of local coding agents and coworking tools. Public copy must name the harnesses actually supported; that aspiration does not establish a separate Claude Cowork integration. Verify capability claims against the [product model](README.md) and [feature guides](../features/README.md).

## Visual character

### Precision with ambition

Aim for a serious developer product with visual confidence: deliberate typography, strong hierarchy, negative space, precise surfaces, and a small number of well-chosen accents. The first screen should feel expansive and futuristic while making the product understandable.

Dark surfaces, silver, gold, physical highlights, foil, and subtle holographic effects are welcome. Resend's material treatment is a particularly strong reference. A light theme can work when it feels technical and precise; dark mode is not mandatory. Avoid turning lightness into a soft consumer aesthetic, or scientific inspiration into a beige academic publication.

Favor computational physics, computational biology, AI, machine learning, emergence, fluid simulation, point fields, interference, and intricate material structures as visual starting points. These are a vocabulary to explore, not required motifs or scientific claims. Fractals can be beautiful without making branching the product's organizing idea.

### Separate hero art from copy

The hero image may be abstract, inspirational, grand, and futuristic. Its copy does not need to explain or name the visual. Avoid a one-to-one metaphor in which every heading, feature, and CTA repeats the artwork's theme.

The idea of freeing agents from a laptop is promising: a compact local capability becomes more powerful, available, and connected. It can inform a visual transition without requiring a literal laptop, thousands of icons, or a headline that narrates the animation.

Below the hero, explanatory visuals should represent actual behavior: a request reaches a harness, work happens in a sandbox, files persist, events return, and another interface continues the same project. The control plane belongs naturally here. Keep aspiration in the first impression and operational clarity in the explanation.

### Composition and variety

Explore genuinely different compositions, visual treatments, and taglines. Include both familiar layouts that are easy to navigate and more unusual, memorable directions. Variation should extend beyond changing an accent color or renaming the same hero.

Every direction needs a compelling focal element. Unusual composition must preserve clear navigation, readable copy, discoverable actions, and responsive behavior. Do not interpret the preference for creativity as permission to make the interface playful, loud, or difficult to use.

## Motion and visual implementation

Treat motion according to its role:

| Role                | Intended behavior                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero atmosphere     | Subtle material, light, field, or camera motion that adds presence without demanding attention or moving the copy. It need not literally model the product. |
| Product explanation | An abstract but accurate representation of cause and effect: submit, execute, stream, save, inspect, and continue. Let users understand a concrete step.    |
| Interface feedback  | Small transitions that clarify selection, loading, saving, success, failure, or a change of state.                                                          |

For concept exploration, a generated image with an explanation of the proposed animation is sufficient. Make that explanation available on hover and through keyboard focus or touch. Clearly distinguish a static concept from implemented motion.

Choose the simplest suitable medium. A compressed video can convey physical materials; CSS/SVG can explain flow; an interactive renderer is justified when interaction adds something useful. Prefer reputable, maintained, widely adopted libraries and existing components to rebuilding primitives or relying on an obscure project. Popularity alone does not establish fit or safety. Do not add an animation framework just because a reference site uses it, and do not infer a library from appearance alone. Observed technologies and candidate approaches belong in the [research record](marketing/research.md#observed-rendering-and-animation-technology).

Performance and accessibility are part of the aesthetic. Preserve static content and readable posters, support reduced motion and pause, avoid scroll hijacking and distracting loops, and test desktop/mobile loading. Decorative particles are not live agents or measurements. Do not present fake telemetry, invented capacity, or unverified performance numbers as product evidence.

## Copy, onboarding, and developer experience

### Explain the product quickly

Use concise, concrete language. An ambitious headline can coexist with a direct description of the product underneath it. Avoid extended metaphors, vague grandeur, and taglines that could describe any AI product.

The preferred page flow is:

1. A memorable hero, a clear product description, and an obvious way to start.
2. A meaningful operation, language selection, and a compact, executable example.
3. A visual explanation of execution, persistent files, and continuation.
4. API, CLI, and dashboard access to the same projects, with control and visibility explained.
5. Supported integrations, open-source availability, and links to deeper guides.

Resend is the strongest clarity benchmark: very little copy, an immediately understandable purpose, code, and a visible next step. Firecrawl's operation → language → executable-looking snippet is another explicit model. Do not conceal prerequisites or invent a shorter API to imitate either site.

### Make the API and terminal feel ordinary

Present familiar imports, clear resource names, useful examples, and explicit outputs. Examples use the public `macrofold` package names and verified installation paths. Python examples should use straightforward client calls and explicit lifecycle handling rather than `with` syntax. Keep advanced configuration out of the first example when it is genuinely optional; link necessary setup and limitations.

Treat creating a project/key, configuring a model or connection, starting a run, streaming progress, retrieving results, checking status, and cancellation as one understandable journey. MCP discovery, authorization, addition, and management should have clear dashboard and API entry points. Logos must not imply an authorized connection or an integration the product does not support.

The CLI should make hosted work feel natural from a terminal: link a project, select a workspace or worktree, send work, and stream results. Explain remote state and the effect of an operation before users risk changing local files. Detailed behavior remains owned by the [API](../features/api/README.md) and [CLI](../features/cli/README.md) guides.

### Make the dashboard useful and polished

The dashboard should let people operate their work: see projects and files, active agents, historical runs, outputs and tool activity, connections, credentials, Git status, and usage. Show the reasoning summaries the provider makes available; do not promise hidden model reasoning.

Use a coherent component system for dropdowns, tabs, dialogs, tables, editors, and charts. The criticized harness dropdown looked like an unstyled system control; ordinary app selectors should feel integrated with the visual system. Reuse mature primitives and charting libraries rather than hand-building them.

The usage view should include a **bar chart**, with readable units and context. Preserve selection, scroll position, and work in progress during refreshes. Make waiting, errors, retries, interrupted operations, and recovery understandable without exposing implementation noise.

Saving should require little effort: the preferred editor behavior is an approximately **two-second debounced autosave**, with an icon and truthful **Saved** status after persistence succeeds. Editing should replace that status, and a stale manual “Save Document” action should not compete with autosave. Never imply unsaved content is safe. The [dashboard](../features/dashboard/README.md) and [workspace](../features/workspaces/README.md) guides describe current behavior and limits.

## Documentation and brand

Public documentation and the repository README should feel official, welcoming, beautiful, and ready for real users. Always provide a simple, high-level path before detailed references. Use a short quickstart, expected results, task-oriented navigation, reasonable headings, search, and links into progressively deeper explanations.

Write public pages to users, not as a private handoff to the owner. Keep temporary badge instructions, unfinished release chores, and internal acceptance notes in their authoritative maintainer records. Necessary product limits still belong in user guides. Use ordinary local setup commands; reserve frozen-lockfile installation for reproducibility contexts, and use the actual `pnpm run setup` script.

Humans and agents should be able to navigate the same knowledge base. Favor well-organized Markdown, meaningful headings, feature indexes, source-of-truth links, search, and appropriate sitemap/agent discovery surfaces. A documentation platform is optional; adopt useful patterns without adding a second system merely for prestige. Do not claim an SEO or AEO guarantee. [Documentation rules](../../.agents/rules/documentation.md) own publication and hierarchy policy.

Names should be elegant and identifiable, with room for historical, scientific, or abstract associations. Avoid contrived compound words and literal feature names. Public examples use Macrofold; design-study names are labels for alternatives, not chosen brand identities. Keep internal domain architecture independent of branding. See [naming](naming.md) for the separate naming exploration.

## Reference library

All **31 distinct company/product references** are included below. The first table records explicitly requested areas of attention. The second preserves the broader reference set: those companies were selected as benchmarks for modern, polished products, clear documentation, public repositories where available, and established developer experience. No particular palette or animation was individually endorsed for that second group; the listed study angles organize the existing research rather than inventing personal preferences.

### References with explicit design priorities

| Reference                               | Requested focus                                                                | Why it matters to this direction                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Resend](https://resend.com/)           | Visuals, product/install/usage clarity, API design                             | Strongest specific endorsement: physical highlights, gold foil/holographic material, restrained dark presentation, simple examples in each language, very little copy, and an obvious start. |
| [Exa](https://exa.ai/)                  | Cool design, animation, and visuals; also documentation/repository inspiration | Computational visual interest with a clear developer proposition. Detailed observations are in the marketing research; no specific renderer is required.                                     |
| [Neon](https://neon.com/)               | Cool design, animation, and visuals; also documentation/repository inspiration | Ambitious infrastructure presentation and computational atmosphere are relevant to the desired first impression.                                                                             |
| [Composio](https://composio.dev/)       | Cool visuals and API design; also documentation/repository inspiration         | Study both the visual presentation and how tools, connections, and authorization become an understandable developer experience.                                                              |
| [Modal](https://modal.com/)             | Cool design, animation, and visuals; broader product/docs inspiration          | A relevant visual reference for ambitious developer compute infrastructure. Learn how graphics support the explanation without borrowing performance claims.                                 |
| [LiveKit](https://livekit.com/)         | Cool visuals, clear product/install/usage explanation, API design              | Study the entire path from first impression to code and understandable operation, rather than the hero alone.                                                                                |
| [Firecrawl](https://www.firecrawl.dev/) | Cool visuals, clear product/install/usage explanation, API design              | Explicitly liked operation → language → executable-looking snippet. This sequence is a strong model for making capabilities tangible.                                                        |
| [Inngest](https://www.inngest.com/)     | Cool visuals, clear product/install/usage explanation, API design              | A reference for all three layers: visual interest, practical onboarding, and explaining infrastructure behavior.                                                                             |
| [E2B](https://e2b.dev/)                 | Cool visuals, clear product/install/usage explanation, API design              | A close subject reference for making agent sandbox execution and its API understandable. Do not reduce this product's persistent-project story to ephemeral execution.                       |
| [Unkey](https://www.unkey.com/)         | Cool design, animation, and visuals                                            | Study visual precision and the feel of developer infrastructure; no separate API endorsement was specified.                                                                                  |
| [Daytona](https://www.daytona.io/)      | Clear product/install/usage explanation and API design                         | Study how an execution environment becomes a short setup path and a concrete request/result sequence.                                                                                        |
| [Merge](https://www.merge.dev/)         | API design; broader product/docs inspiration                                   | A model for presenting a broad integration surface through a coherent developer interface.                                                                                                   |

### Broader product, documentation, and repository references

| Reference                                    | Study angle within the broader request                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenClaw](https://openclaw.ai/)             | Agent-product onboarding, a short first-success path, and open-source repository/documentation organization.                                                                                    |
| [Ably](https://ably.com/)                    | Developer-facing communication, language-specific starts, and separation of usage guides from reference material.                                                                               |
| [Parallel](https://parallel.ai/)             | Agent-oriented tools, background work, examples, and clear capability organization.                                                                                                             |
| [Stripe](https://stripe.com/)                | API/documentation clarity, progressive technical depth, and understandable testing, recovery, and versioning guidance.                                                                          |
| [Vercel](https://vercel.com/)                | Modern developer-product polish, task-oriented onboarding, and organized framework/deployment documentation. Repeated mentions reinforce its importance.                                        |
| [Orca / onorca.dev](https://www.onorca.dev/) | Agent/worktree mental models, visual product explanation, keyboard navigation, and open-source onboarding.                                                                                      |
| [OpenAI](https://openai.com/)                | Clear capability navigation, a short first API response, and SDK documentation that expands into streaming and operational detail.                                                              |
| [Anthropic](https://www.anthropic.com/)      | Agent/developer communication, recommended setup paths, and concise SDK examples with deeper guide links.                                                                                       |
| [OpenRouter](https://openrouter.ai/)         | An approachable API entry point before routing, model choice, and advanced configuration.                                                                                                       |
| [OpenCode](https://opencode.ai/)             | A recognizably developer-oriented agent product, install/configure/use progression, and open-source documentation.                                                                              |
| [CodeRabbit](https://www.coderabbit.ai/)     | Clear paths for different developer surfaces, onboarding, configuration, and review guidance.                                                                                                   |
| [Clerk](https://clerk.com/)                  | Polished developer onboarding, framework selection, and clear integration setup.                                                                                                                |
| [WorkOS](https://workos.com/)                | Product-oriented developer documentation and explicit prerequisites, authentication callbacks, sessions, and usage.                                                                             |
| [Supabase](https://supabase.com/)            | An open-source developer-platform experience spanning quickstarts, feature guides, local development, and self-hosting.                                                                         |
| [ElevenLabs](https://elevenlabs.io/)         | Capability-led product organization, understandable API entry points, and documentation for streaming interactions.                                                                             |
| [Orb](https://www.withorb.com/)              | Clear infrastructure concepts, learning paths, and SDK guidance for reliable usage.                                                                                                             |
| [Pinecone](https://www.pinecone.io/)         | Organized technical capabilities, guides, examples, integrations, and troubleshooting.                                                                                                          |
| [Replicate](https://replicate.com/)          | Immediate language examples followed by lifecycle and streaming detail.                                                                                                                         |
| [PostHog](https://posthog.com/)              | Strong product identity, approachable product-level navigation, and public website/documentation organization. Its inclusion does not override the preference against a playful aesthetic here. |

The separate [Ponytail repository](https://github.com/DietrichGebert/ponytail/tree/main) was supplied as an implementation and coding-agent guidance reference, not as an endorsed visual style. Keep that distinction when consulting it.

[Marketing research](marketing/research.md) records observations from the twelve focused sites, including page flow and evidence about animation technology. [Documentation research](../engineering/documentation/research.md) records documentation and public-repository patterns from the broader set. Do not claim every vendor's hosted product is open source, that every effect has been inspected, or that an observed library is mandatory for this project.

## Rejected directions and useful exceptions

These names identify rejected treatments from the earlier concept set, not permanent bans on a color, word, or mathematical idea.

| Direction       | Feedback to preserve                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canopy          | Too literally about branching; the metaphor does not explain the product and feels cheesy. Avoid making fractal art dictate branching-themed copy.                  |
| Field notes     | Visually attractive, but the tan palette and mathematics feel academic. Computational inspiration should feel like developer infrastructure.                        |
| Blueprint       | Looks like a construction company. Avoid construction-drawing identity.                                                                                             |
| Continuum       | Its aesthetic was disliked; no more specific reason was supplied. Do not invent one or repeat the same treatment under a new name.                                  |
| Parallel Garden | Conceptually understandable, but too bold and playful.                                                                                                              |
| Signal          | The concept does not fit and the bold treatment resembles a media company.                                                                                          |
| Orbit           | The aesthetic is acceptable, but the orbital metaphor is a stretch. Prefer a more computational visual vocabulary.                                                  |
| Mission control | The control-plane concept is useful in product explanation below the hero. The first screen should communicate greater possibility, not just an operations console. |
| Foil            | Dark styling and gold are appealing. “Give your agents another dimension” does not resonate; keep the material possibilities without that concept.                  |
| Prism           | Clean, but too consumer-oriented. Precision and polish must still read as a developer product.                                                                      |

The replacement gallery is an exploration, not an approval of a final visual identity. Rejection of a particular treatment does not imply that all dark, light, abstract, or computational alternatives have been ruled out.

## Applying this language

Before presenting a design, check that a new visitor can identify the product, see a credible example, and find the next action. Check that the hero is compelling without forcing its metaphor into the copy; explanatory diagrams are accurate; integrations and open-source positioning are clear; and the interface remains usable on mobile and with a keyboard.

Consider the complete reference library when developing a direction, then choose a coherent set of techniques. Do not combine every site's style or repeatedly study the entire list for a minor UI edit. Reuse established components, keep the change proportional, and validate the selected implementation. Preserve one authoritative preference document by updating this file when feedback changes.
