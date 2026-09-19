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

Speak to developers building applications and automations. The product makes native coding agents available in the cloud through an API, CLI, and dashboard, with persistent sandbox files and version control. Make Claude Code, Codex, and OpenCode recognizable early. Explain the difference between an agent run and the workspace it can return to.

The emotional promise is greater capability: developers can build things that would be awkward or impossible with an agent confined to one laptop. Cloud access, many independent executions, persistent context, and integration into a developer's own product make that promise concrete. This is a direction for storytelling, not a guarantee of unlimited concurrency or instant capacity.

The desired experience resembles the useful continuity of local coding agents and coworking tools. Public copy must name the harnesses actually supported; that aspiration does not establish a separate Claude Cowork integration. Verify capability claims against the [product model](README.md) and [feature guides](../features/README.md).

## Visual character

### Precision with ambition

Aim for a serious developer product with visual confidence: deliberate typography, strong hierarchy, negative space, precise surfaces, and a small number of well-chosen accents. The first screen should feel expansive and futuristic while making the product understandable.

Dark surfaces, physical highlights, foil, and subtle holographic effects can distinguish the largest marketing moments. Use metallic material sparingly. The dashboard must support light, dark, and system appearance with the same clear hierarchy. Avoid turning lightness into a soft consumer aesthetic, or scientific inspiration into a beige academic publication.

### Product interface system

Use the supplied Macrofold UI system's cyan/graphite foundation for the dashboard. The existing Saddle mark and outlined wordmark take precedence over replacement marks in reference assets. Keep the application cleaner and more direct than the marketing site: ordinary forms, tables, navigation, and titles use flat surfaces and plain text. A welcome composer can have a fine cyan-to-ember border, subtle field texture, and deliberate geometry without becoming a marketing hero.

- **Color:** cyan is primary, ember is the warm secondary accent, and restrained lilac can distinguish examples. Status colors carry consistent meanings alongside text or icons. Avoid a wash of cyan on every element.
- **Surfaces:** dark uses near-black graphite with lightly elevated panels; light uses a cool near-white canvas and white panels. Use fine borders, restrained shadows, and modest radii. Do not nest a card around every line of content.
- **Typography:** sentence-case sans-serif headings, labels, navigation groups, and table headers throughout the application and marketing site. Remove the all-caps monospace eyebrow treatment. Reserve monospace for code, paths, IDs, and other technical values. Acronyms such as API, SDK, and AI retain their normal capitalization.
- **Material:** reserve metallic treatment for the largest, most prominent marketing elements or one deliberately emphasized hero action. Dashboard headings, navigation, cards, secondary buttons, and status badges stay plain.
- **Theme:** semantic tokens must cover portals, menus, charts, editors, empty/loading/error states, and focus indicators. System follows the operating system; explicit preference persists locally. Preserve readable contrast in both modes and avoid a flash of the opposite theme.
- **Account menu:** group organization switching and the compact three-icon Light/Dark/System control inside the bottom user menu. Keep the current organization visible in its trigger.
- **Worktree layout:** default Workspaces to a compact list with an optional remembered grid. Allow desktop navigation to collapse to labeled icons with tooltips or resize by dragging, while keeping the bottom account menu reachable. Give files the remaining page height, a resizable folder explorer, breadcrumbs, and clear Rich/Source controls for Markdown. Preserve usable mobile stacking and keyboard alternatives to dragging.
- **Feedback:** successful copy buttons animate the copy icon into a green checkmark while keeping their original label and width. Show the check for three seconds, then return to the copy icon; clicking again must copy again and restart the timer after success. Never emit a success toast. Fade all hover color changes and use a muted, smoothly fading text-field border with a faint halo. Sidebar icons make a small, brief gesture on hover or keyboard focus. Use brief control/menu/toast transitions, a slow left-to-right text sheen during waiting, and slow continuous reflected-light movement around the welcome prompt border. Text arrivals should remain readable without repeatedly fading prior content. Hide browser scrollbars while retaining normal scrolling and keyboard access. Dashboard motion defaults to playing, with an explicit persistent Play/Pause control in the account menu that can override the device’s Reduce Motion preference. Pausing stops decorative loops and gestures; gentle color and opacity fades remain. Marketing has its own independent playback control.
- **Provider identity:** show company marks beside harness/model options and selected values. Codex always uses a black mark on white; Claude subscriptions use Claude. Never display the Composio broker logo.
- **Interaction:** every visible action works or is explicitly a non-actionable planned entry. Use mature dialog/menu primitives, clear focus, keyboard access, reduced motion, responsive layouts, and truthful asynchronous feedback.

The user-supplied Exa, Claude, OpenAI, Resend, and Origami dashboard screenshots inform the arrangement: persistent navigation, compact account menus, purposeful empty states, progressive configuration, small setup checklists, and prompt-copy actions alongside code. Learn those patterns without copying artwork, customer information, credentials, feature claims, or proprietary prompts. Their products' options are not requirements for Macrofold.

Home should combine an easy first task, a short setup path, five curated examples including a personal consumer assistant, current work, and useful guides. The library can expand through search without overwhelming the first screen. Preview instructions and an illustrative output before configuration. Offer copyable briefs for a customer's coding agent, including current documentation URLs and a verifiable result, without putting account secrets in the prompt.

The bottom-right account assistant currently has an explicitly labeled UI preview. Sample guidance must never imply that it inspected the account, completed an action, contacted support, or ran a model. Current workflows belong in the [dashboard guide](../features/dashboard/README.md); unimplemented opportunities belong in [dashboard improvements](improvements.md#dashboard).

Favor computational physics, computational biology, AI, machine learning, emergence, fluid simulation, point fields, interference, and intricate material structures as visual starting points. These are a vocabulary to explore, not required motifs or scientific claims. Fractals can be beautiful without making branching the product's organizing idea.

### Separate hero art from copy

The hero image may be abstract, inspirational, grand, and futuristic. Its copy does not need to explain or name the visual. Avoid a one-to-one metaphor in which every heading, feature, and CTA repeats the artwork's theme.

The idea of freeing agents from a laptop is promising: a compact local capability becomes more powerful, available, and connected. It can inform a visual transition without requiring a literal laptop, thousands of icons, or a headline that narrates the animation.

Below the hero, explanatory visuals should represent actual behavior: a request reaches a harness, work happens in a sandbox, files persist, events return, and another interface continues the same workspace. The control plane belongs naturally here. Keep aspiration in the first impression and operational clarity in the explanation.

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

Choose the simplest suitable medium. A compressed video can convey physical materials; CSS/SVG can explain flow; an interactive renderer is justified when interaction adds something useful. Prefer reputable, maintained, widely adopted libraries and existing components to rebuilding primitives or relying on an obscure workspace. Popularity alone does not establish fit or safety. Do not add an animation framework just because a reference site uses it, and do not infer a library from appearance alone. Observed technologies and candidate approaches belong in the [research record](marketing/research.md#observed-rendering-and-animation-technology).

Performance and accessibility are part of the aesthetic. Preserve static content and readable posters, support reduced motion and pause, avoid scroll hijacking and distracting loops, and test desktop/mobile loading. Decorative particles are not live agents or measurements. Do not present fake telemetry, invented capacity, or unverified performance numbers as product evidence.

For the [Swarm hero proof](marketing/swarm-motion.md), preserve the source image's irregular porous folds and fine filaments. Brightness should come mainly from uneven particle density, with flat cyan-white and warm amber color, rather than broad bloom or surface lighting. The selected composition is 3:2 with transparency, approximately 40,000 points, a fixed camera with restrained mouse parallax, and adaptive performance. The earlier frame fidelity was approved. Motion should continuously carry particles from dark off-left lanes into a growing manifold: earlier cohorts move farther right, and the layers fold and breathe together. Use 1.5× the prior inlet speed, gradual organization without a transition point, and continuous particle travel off the right edge even after the shape has formed. Growth takes roughly eight seconds; flow and folding continue until fifteen seconds. A five-second wind release should progressively loosen the moving structure, retain particle momentum, and disperse unevenly before two empty seconds. Avoid particles easing into preset slots or a static mold. The V3 motion is approved. Develop ten variations with more cohesive curved planes and surfaces, less liquid motion, and clear three-dimensional depth. Keep points moving independently along the surfaces while broad folds remain coordinated. Use geometry and motion as the main differences; preserve the reference palette and fine point treatment. Present one variation at a time. Preserve Crossed planes and Compressed folds as selected favorites, including their existing motion. The other eight must differ visibly in projected silhouette and surface arrangement; subtle depth warps of the same holes are insufficient. Keep their outgoing flow broad instead of converging into a suction-like outlet, and use varied momentum-preserving directions in the final breakup.

The [Swarm manifold iteration](marketing/swarm-manifolds/README.md) preserves the earlier studies in a separate folder and adds a Play control that resumes from any scrubbed timeline position. Its increased movement and three-dimensionality were approved. The next [volume collection](marketing/swarm-volumes/README.md) should emphasize heft and mass rather than thin sheets folding over themselves: five organic, curving, breathing structures and five well-defined polygonal solids or mixtures of solids. Use entirely new concepts and names. Preserve substantial continuous morphing, independently moving particles, the existing playback controls, and all earlier collections. Formation is secondary to the character and changing geometry of the resulting body.

The volume collection's increased definition was approved. The next [Swarm Emergence collection](marketing/swarm-emergence/README.md) keeps all earlier outputs and uses a broad, initially disorganized stream that gradually becomes a structure. Avoid a visible attachment point or a completed form revealed from left to right. Organic studies should feel primal and anatomically complex, with irregular cavities, ridges, and connected sections rather than one smooth body. Vesicles and Tetrahedral core are useful references for multiple parts developing at different angles. Keep several substantial regions defined while other sections form, unform, change shape, and reform. Independent particle movement and changing regional geometry should jointly convey continual emergence.

Emergence's changing regional structures were approved. The [Swarm Resonance iteration](marketing/swarm-resonance/README.md) should eliminate interference from invisible solids and keep particle size and brightness independent of camera distance. Preserve the particle population rather than changing density in abrupt batches. Favor gradual, continuous changes: surfaces morph, meet, blend into neighboring regions, and reconfigure instead of appearing and disappearing on narrow timed gates. Keep some primal anatomy while adding natural wavefronts, magnetic-field-inspired forms, and alien interaction patterns. Geometric studies should develop intricate crystalline, recursive, or nested dimensional structures rather than simple block clusters. Preserve every earlier collection under its own name.

The [Swarm Metamorphosis iteration](marketing/swarm-metamorphosis/README.md) preserves Resonance and strengthens its mature motion. Keep large, repeated changes in shape, proportions, mergers, and gradual section visibility after formation; independently travelling particles alone do not establish sufficient morphing. Use small rounded orbs rather than flaky sprites. The far-left inlet should be a visible grid that gradually loses order before developing the structure. Use a twenty-second sequence: formation becomes visible around three seconds, the structure is established by seven, strong morphing continues until fifteen, wind dispersal finishes by nineteen, and one empty second resets the loop.

The [Swarm Continuum iteration](marketing/swarm-continuum/README.md) preserves Metamorphosis and expands the assemblies with additional outer sections, targeting roughly one-and-a-half times the occupied space rather than merely scaling each shape. Curve and tilt the incoming mathematical plane, with unequal edges and a broad continuous transition from readable rows into disorder. Use more particles to retain surface definition, particularly in Hypercell, and reduce collective contraction toward the center. Replace Aeolian and Meissner with new organic concepts. Shorten formation by one second: organization begins around two seconds and reaches full form by six, with the existing fifteen-to-nineteen-second release and twenty-second loop retained. Add a 1.0–2.0× playback slider in 0.1 increments without resetting the selected time.

The separate [Swarm Confluence iteration](marketing/swarm-confluence/README.md) increases the population to 80,000 and uses the additional particles to define full surfaces rather than concentrating on sharp edges. Let noise settle and surface definition build continuously toward the moment before dispersal, while larger forms keep morphing. Fade the inlet from darkness across roughly the first 70% of its curved grid. Replace Dendrite with many small crystals in changing layers, and replace Rhizome and Heterodyne with two widening currents: one calm and graceful, one a violent torrent or vortex. Preserve the earlier collections and the existing playback controls.

The separate [Swarm Efflorescence iteration](marketing/swarm-efflorescence/README.md) doubles the inlet fade distance and brings peak definition forward to eleven seconds, with five seconds of fully defined morphing before release. Keep the 80,000-particle population. Develop Aperiodic into many connected, layered crystals radiating from a common core, including long spires; double Druse's smaller crystals. Let Thalassa widen directly into varied waves without first congregating, and strengthen Maelstrom's curved surfaces. Add a continuously growing branching network that approaches the frame edges. Preserve prior versions and playback controls.

The separate [Swarm Myriad iteration](marketing/swarm-myriad/README.md) adds four seconds entirely to the mature stage, retaining buildup speed: peak definition lasts from eleven to twenty in a twenty-five-second loop. Give Tetrarch greater full-surface definition and outward reach. Extend Aperiodic's connected crystals roughly fifty percent farther and distribute Druse across fifteen clusters. Move the defined portions of both current studies farther left; make Maelstrom feel like stormy water. Plexus should develop substantial roots sooner, with irregular branch points, unequal tendrils, and connecting paths that create a complex organic network instead of a uniform tree. Its segments should have a random-walk character, with uneven directional changes rather than smooth arcs. Favor a delicate mycelial web with fine branching filaments and numerous local reconnections; avoid thick, swelling tubes or a worm-like appearance. Keep the Myriad name and leave all other studies unchanged for this Plexus adjustment. Preserve the earlier versions.

Prioritize a compact, lossy website delivery of Myriad's eleven studies. Lossless masters and editing formats are deferred; preserve the earlier files and editable source. Keep the full twenty-five-second motion and 3:2 composition, using one pre-rendered video over black with a clear loading background, explicit pause, and restrained responsive resolution. Choose compression by measured file size and visible quality: some softening of fine particles is acceptable, while cohesive surfaces should remain readable without conspicuous block-shaped patches. Retain the live source for mouse parallax or changing geometry. The [export tools and delivery guide](../../output/swarm-myriad/README.md#video-export-and-delivery) own file formats, reproduction, and completion evidence; a successful pilot does not establish the full collection's completion or performance on every device.

## Copy, onboarding, and developer experience

### Selected homepage direction

**Swarm is the visual foundation, Foundation is the hero composition, and simple Fanout is the selected product animation.** The [final marketing site](marketing/site/README.md) develops one polished page. Preserve `/concepts`, `/homepages`, and `/journeys` as earlier design libraries.

Use this headline exactly: **Run Agent Harnesses in the Cloud**

Use this subtitle exactly: **Invoke Claude Code, Codex, and OpenCode via API, CLI, or UI. Run them in isolated sandboxes with persistent filesystems, parallel worktrees, and Git-native version control.**

Extend the hero’s desaturated cyan and white light throughout the dark technical surfaces. Only the hero headline and large section headings use clearly visible cyan-to-white metallic reflections. Scrolling feature headings and copy, benefit-tile text, and small pricing-card titles stay plain, without ambient or pointer-driven gleam; preserve the scrolling copy’s fade transitions. The approved primary-button treatment stays more restrained. Both use softly metallic cyan reflections, with pale highlights and restrained cool shadow. Use broad, diffuse reflections whose angle and balance respond to both pointer coordinates, like a surface tilting under light. Shift the reflection gently against pointer movement for depth; avoid visible ovals, circular spotlights, or concentric light/dark rings. Fade smoothly on entry and exit. A slow ambient field gently morphs even with a stationary cursor or no hover; primary buttons stay in place instead of lifting. Keep the cyan material visible rather than making it purely silver metal. Diagram accents should use washed-out cyan close to the Start building button, with neutral graphite surfaces; avoid saturated cyberpunk or video-game styling. Avoid one-shot hover sweeps or abrupt highlights. Keep the sheen clearly visible but diffuse, and clip it strictly to the heading letters. Preserve the original hero image in the codebase only; never render it in the homepage hero, including during loading or failure. The homepage may play the approved Myriad collection sequentially at 1.3× using compressed video; position the video on the right with a soft entrance overlapping approximately the rightmost quarter of the text width, leave breathing room at the right edge on desktop, and retain the shared Play/Pause control. On mobile, center the video below the copy without horizontal cropping; overlap and fade only its top quarter, leaving the lower three quarters visible and removing excess vertical padding. Start the muted hero video automatically, including with reduced motion or data saving enabled; data saving selects the smaller video. Keep the shared Pause control and do not add a separate moving dot overlay. Pricing continues the same dark cyan surfaces and gleaming headings; it must not switch to a light theme. **Use company logos in diagrams, visuals, and integration lists, not inside sentences.** Every agent card should identify its harness with its name and logo. Do not imply endorsement or an authenticated connection.

Keep the main navigation sticky at the top throughout the page. The story selector sits below it; preserve the centered diagram and usable controls on short screens.

The hero’s primary action is **Start building**, linking to sign-up; its secondary action is **View docs**. Below them, use this order: clickable **GitHub icon → Star → View contributor guide.** Star links to the repository; direct starring would require the visitor’s GitHub authorization. Remove the harness strip and the slogans “AI developer infrastructure,” “A new unit of possibility,” “Built to fit into your system,” and “Your stack, connected.” Contribution and self-hosting remain official links; the principal onboarding path serves the hosted product.

Center **Start with a few lines of code.**, followed by “Choose a workspace, harness, and model. Give it a task. Let it work.” and the API quickstart link. Show run and stream together in each language, including Go and Rust. Use one parameter per line, no operation picker, no optional billing field, and no redundant result-status caption. Lead with a new run and its harness, provider/model, and prompt, never a prerequisite session or saved agent ID. Keep any fields still required by the API explicit: today these include a workspace and billing mode, with provider determined by the model catalog. Do not invent unsupported fields or hide required setup. Retain required cURL idempotency and the actual hosted API origin. Keep syntax highlighting clearly legible with distinct, moderately bright colors.

After code, use **An entire agent harness as one unit of execution.** Use **Everything agents can do on your computer available in your product or internal tool, with thousands of available app connectors.** as one paragraph with the same type treatment and color. Do not force a separate line or add a count or link.

Offer **Per-Customer Agent Worktrees**, **Self-improving Agents**, **Shared Team Agents**, and **Personal Agent** beneath **Example use cases:**. Keep the selector sticky with padding during the story, on black with one restrained cyan border. Changing an example replays the current step without jumping the page. Text, filenames, prompts, and tool selections belong in data, separate from the animation.

The sales prompt is **Write a cold sales email to Alex at Northstar. Refer to enterprise pitch guidance.** The personal prompt is **Find me a new restaurant I'd like, for 2 at 6pm tonight.** Other examples illustrate simulations and strategy evaluation, or team debugging with a product repository. Parallel tasks can include nontechnical questions such as “What did Sam say on our last feedback call?” with a meetings directory. Examples illustrate possible applications, not prebuilt products or promised results.

Use the five pillars **Workspace → Worktrees → Checkpoints and Git Sync → API, CLI, UI → Connectors**:

- Type the incoming prompt letter by letter at the vertical center. Then shrink it into a left-hand input port as the Workspace context outline appears behind it; draw a dotted feed toward the worker.
- Put the harness name in the worker header and its logo inside. Draw straight branches from the logo into five small folders. Type all five filenames at the same time beside their folders: for example `product_info.md`, `pitch_guidance.md`, `brand_voice.md`, and relevant directories. No large root folder or hidden filename footer.
- Shrink the first prompt/worker structure into the top row. Two more appear below, each with its own typed prompt, harness logo, drawing file branches, and typed filenames. Preserve complete readable prompts; do not add a shared root filesystem at the left.
- Reveal a checkpoint/save and Git mark beside each worker, then draw straight connections that converge on one shared filesystem and Git main branch. Use brief, restrained confirmation pulses for a slightly sci-fi feel. Copy must explain review/merge and optional synchronization rather than imply automatic conflict-free merging.
- Show API inputs for two agents, a CLI input for another, and a fourth UI-invoked agent. Avoid redundant captions or a repeated “01 / 05” counter; retain the selected step and clickable numbered 01–05 buttons in the top-right navigation, rather than illuminated progress lines.
- Return to the first agent surrounded by approximately ten relevant tool logos on a perfect rotating circle. Use each connector’s normal brand colors, including multicolor artwork; naturally monochrome marks use a legible dark-surface variant. Keep logos upright, without containing cards or radial connection lines. Link the accompanying explanation to the complete connector directory.

On desktop, the diagram scrolls into the exact vertical center of the browser viewport and stays there while the section heading and left-hand text continue scrolling. Base the sticky offset on the diagram’s height, not the selector or an arbitrary top margin. Leave clear breathing room between the sticky selector, numbered controls, and first canvas. The first text starts below the diagram and aligns after further scrolling. Each explanation rises into focus from below, becomes fully readable near the center, and fades as it approaches the top. Text continues moving with native scrolling rather than freezing until a chapter changes. Use real HTML/SVG animation, not image stand-ins. Trigger short, independently timed sequences as scrolling crosses chapter boundaries; do not require every animation frame to be tied to scroll position. Preserve native scrolling, readable mobile layouts, reduced motion, and explicit pause. On the marketing site, playback starts enabled and remains enabled unless the visitor explicitly selects Pause, independently of system motion settings. Suspend unseen work and resume or replay it when it returns to view. Play/Pause controls decorative animation only; it must never remove the scroll-driven text fades. Keep the short-screen static reading alternative and accessible pause control. Avoid “Start with a prompt,” “Separate files. Independent work,” and status-summary captions that repeat what the diagram already shows.

Leave clear responsive breathing room after the final canvas and before the next section’s divider. Below the journey, use **Everything you need to go live.** above **six benefits**: **BYOK or Use Credits**, Slack/webhook/scheduled triggers, session continuation, streaming progress and tool activity, task-scoped access with a shield/checkmark, and substantiated sandbox/credential protection. Describe implemented security boundaries precisely; do not imply certification, guaranteed isolation against every threat, or zero model/tool/storage charges.

Keep the lower integration section with logos for all native harnesses, model providers, search, version control, **Custom MCP**, and **Built-in Connectors (1,000+).** Do not feature Composio in that section. Close with **Let’s build.** and official contribution/self-hosting links.

### Pricing

Continue the homepage’s dark cyan surfaces, material headings, and restrained CTA treatment. Present each tier’s price, included usage credits, concurrency, maximum execution, storage, and history clearly. Include a $1,000/month Business offer and an Enterprise contact option; distinguish sales-assisted capacity from implemented self-serve entitlements. Never invent guaranteed capacity, discounts, certification, or included credits.

Use [HarnessRouter’s pricing](https://harnessrouter.ai/pricing) as an additional reference for making features and limits explicit, not as a template to copy. Its density and calculator complexity were specifically disliked. Our calculator belongs near the bottom: total execution hours per month and expected model spend in dollars, with sandbox memory shown in GB. Explain fixed memory when no size selection exists. Show subscription, usage, applied credits, and any direct provider bill separately; no GB-hour arithmetic for users. The [pricing implementation](marketing/site/pricing.md) owns rates, calculation, and activation boundaries.

### Explain the product quickly

Use concise, concrete language. An ambitious headline can coexist with a direct description of the product underneath it. Avoid extended metaphors, vague grandeur, and taglines that could describe any AI product.

The preferred page flow is:

1. A memorable hero, a clear product description, and an obvious way to start.
2. A meaningful operation, language selection, and a compact, executable example.
3. A visual explanation of execution, persistent files, and continuation.
4. API, CLI, and dashboard access to the same workspaces, with control and visibility explained.
5. Supported integrations, open-source availability, and links to deeper guides.

Resend is the strongest clarity benchmark: very little copy, an immediately understandable purpose, code, and a visible next step. Firecrawl's operation → language → executable-looking snippet is another explicit model. Do not conceal prerequisites or invent a shorter API to imitate either site.

### Make the API and terminal feel ordinary

Present familiar imports, clear resource names, useful examples, and explicit outputs. Examples use the public `macrofold` package names, `Macrofold` constructors/imports, the installed `macrofold` CLI command, and verified installation paths. Reserve `pnpm cli` for contributor instructions that explicitly run the CLI from source. Python examples should use straightforward client calls and explicit lifecycle handling rather than `with` syntax. Keep advanced configuration out of the first example when it is genuinely optional; link necessary setup and limitations.

Treat creating a workspace/key, configuring a model or connection, starting a run, streaming progress, retrieving results, checking status, and cancellation as one understandable journey. MCP discovery, authorization, addition, and management should have clear dashboard and API entry points. Logos must not imply an authorized connection or an integration the product does not support.

The CLI should make hosted work feel natural from a terminal: link a workspace, select a worktree or worktree, send work, and stream results. Explain remote state and the effect of an operation before users risk changing local files. Detailed behavior remains owned by the [API](../features/api/README.md) and [CLI](../features/cli/README.md) guides.

### Make the dashboard useful and polished

The dashboard should let people operate their work: see workspaces and files, active agents, historical runs, outputs and tool activity, connections, credentials, Git status, and usage. Show the reasoning summaries the provider makes available; do not promise hidden model reasoning.

Use a coherent component system for dropdowns, tabs, dialogs, tables, editors, and charts. The criticized harness dropdown looked like an unstyled system control; ordinary app selectors should feel integrated with the visual system. Reuse mature primitives and charting libraries rather than hand-building them.

The usage view should include a **bar chart**, with readable units and context. Preserve selection, scroll position, and work in progress during refreshes. Make waiting, errors, retries, interrupted operations, and recovery understandable without exposing implementation noise.

Saving should require little effort: the preferred editor behavior is an approximately **two-second debounced autosave**, with an icon and truthful **Saved** status after persistence succeeds. Editing should replace that status, and a stale manual “Save Document” action should not compete with autosave. Never imply unsaved content is safe. The [dashboard](../features/dashboard/README.md) and [worktree](../features/workspaces/README.md) guides describe current behavior and limits.

## Documentation and brand

### Logo direction

The selected logo is the original **Saddle**: one continuous mathematical plane lifting in opposing directions. Keep its silhouette simple, abstract, and recognizable at logo size. Preserve the original reference and earlier variation studies. Filled treatments retain clear fold edges by cutting separation gaps into the rear surfaces only, keeping the foreground plane complete. Use shared Bézier edges with smooth tangent joins; separation cuts must continue through the silhouette without visible caps or short tails. Outline treatments leave the interiors empty.

The dark marketing header and footer use the supplied solid-white Saddle lockup, with the compact white mark as the site icon. Documentation navigation follows its selected appearance: a light header and black lockup in light mode, a graphite header and white lockup in dark mode. Keep the symbol and wordmark uniformly monochrome, without gradients or gleam, and preserve the outlined letterforms rather than recreating the wordmark in browser text.

The wordmark is **Macrofold**, with a capital M, in **Space Grotesk, weight 400, tracking −0.015em**. Outlined-letter exports preserve the selected font geometry and spacing. Use deliberate proportions and golden-ratio relationships as a compositional guide. Preserve the earlier logo color/finish variations and structured ten-dot studies for comparison; dense organic swarms and generic geometric monograms were rejected as logo treatments. The Swarm hero remains the broader visual foundation.

### Public documentation and naming

In light mode, documentation uses a predominantly white canvas and navigation. Reuse the original pale canvas color (`--app-bg`, `#f4f8f9`) for code snippets, inline code, selected navigation and supporting accents rather than mixing a stronger cyan tint. Use darker cyan for text links and code labels to preserve contrast. Keep the existing graphite dark mode and appearance controls.

Public documentation and the repository README should feel official, welcoming, beautiful, and ready for real users. Give Macrofold Cloud and self-hosting clear, equally discoverable setup paths; shared API, SDK, CLI, and feature guides serve both. Put a copyable coding-agent integration brief beside the human quickstart, with direct current documentation links and a verifiable first result. Always provide a simple, high-level path before detailed references. Use a short quickstart, expected results, task-oriented navigation, reasonable headings, search, and links into progressively deeper explanations.

Write public pages to users, not as a private handoff to the owner. Keep temporary badge instructions, unfinished release chores, and internal acceptance notes in their authoritative maintainer records. Necessary product limits still belong in user guides. Use ordinary local setup commands; reserve frozen-lockfile installation for reproducibility contexts, and use the actual `pnpm run setup` script.

Humans and agents should be able to navigate the same knowledge base. Favor well-organized Markdown, meaningful headings, feature indexes, source-of-truth links, search, and appropriate sitemap/agent discovery surfaces. A documentation platform is optional; adopt useful patterns without adding a second system merely for prestige. Do not claim an SEO or AEO guarantee. [Documentation rules](../../.agents/rules/documentation.md) own publication and hierarchy policy.

Names should be elegant and identifiable, with room for historical, scientific, or abstract associations. Avoid contrived compound words and literal feature names. Public examples use Macrofold; design-study names are labels for alternatives, not chosen brand identities. Keep internal domain architecture independent of branding. See [naming](naming.md) for the separate naming exploration.

## Reference library

All **32 distinct company/product references** are included below. The first table records explicitly requested areas of attention. The second preserves the broader reference set: those companies were selected as benchmarks for modern, polished products, clear documentation, public repositories where available, and established developer experience. No particular palette or animation was individually endorsed for that second group; the listed study angles organize the existing research rather than inventing personal preferences.

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
| [E2B](https://e2b.dev/)                 | Cool visuals, clear product/install/usage explanation, API design              | A close subject reference for making agent sandbox execution and its API understandable. Do not reduce this product's persistent-workspace story to ephemeral execution.                       |
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

[Marketing research](marketing/research.md) records observations from the twelve focused sites, including page flow and evidence about animation technology. [Documentation research](../engineering/documentation/research.md) records documentation and public-repository patterns from the broader set. Do not claim every vendor's hosted product is open source, that every effect has been inspected, or that an observed library is mandatory for this workspace.

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

Swarm was selected from the replacement gallery; Foundation and simple Fanout now define the final homepage. Rejection of a particular treatment does not imply that all dark, light, abstract, or computational alternatives have been ruled out.

## Applying this language

Before presenting a design, check that a new visitor can identify the product, see a credible example, and find the next action. Check that the hero is compelling without forcing its metaphor into the copy; explanatory diagrams are accurate; integrations and open-source positioning are clear; and the interface remains usable on mobile and with a keyboard.

Consider the complete reference library when developing a direction, then choose a coherent set of techniques. Do not combine every site's style or repeatedly study the entire list for a minor UI edit. Reuse established components, keep the change proportional, and validate the selected implementation. Preserve one authoritative preference document by updating this file when feedback changes.
