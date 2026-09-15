# Marketing site and design libraries

Open **[/concepts](http://localhost:3210/concepts)** in the local app to compare ten complete landing pages. Each combines an original hero image, a different headline and visual direction, working code tabs, and a shared product walkthrough. Choose **Explore** to open a page; hover over its artwork or focus/tap **Animation concept** to read the proposed motion.

[Design Language](../design-language.md) owns the shared preferences, all 31 reference companies and their intended roles, and the rejected directions. This guide describes the current concept implementation.

**The final homepage uses Swarm, Foundation, and simple Fanout.** See the [marketing site](site/README.md) for current behavior and implementation. The [journey design library](journeys/README.md) at `/journeys` preserves ten earlier diagram treatments.

The new [homepage studies](homepages/README.md) develop it into ten full-page alternatives at `/homepages`, using that round’s headline, simpler code, and animated workspace explanations. The original gallery stays available for comparison.

## Original directions

| Direction | Composition          | Visual character                                    |
| --------- | -------------------- | --------------------------------------------------- |
| Aurum     | Split studio         | Obsidian and finely woven gold                      |
| Eigen     | Light split          | Graphite and cobalt point samples on cool white     |
| Tensor    | Cinematic            | Monumental violet-white fiber field                 |
| Flux      | Panoramic            | Cyan-silver fluid simulation                        |
| Strata    | Wide material study  | Graphite layers with gold-lit contours              |
| Lattice   | Light editorial      | Fine cobalt interference lattice                    |
| Phase     | Asymmetric editorial | Silver optical surface in black                     |
| Swarm     | Cinematic            | Emergent structure in a dense particle field        |
| Isotope   | Split studio         | Porous titanium with amber-lit cavities             |
| Aperture  | Panoramic            | Dark metallic fins and a silver computational field |

Use this gallery to revisit the original art and copy. Continue homepage selection in the [Swarm homepage studies](homepages/README.md).

The latest separate [Swarm Myriad collection](swarm-myriad/README.md) retains 80,000 particles and extends peak morphing to nine seconds, from eleven through twenty. Its eleven studies include farther-reaching crystalline families, fifteen fine-crystal clusters, earlier current formation, stormier waves, and an irregular interconnected network. Earlier collections remain available.

## Product story

Every direction describes the same implemented product: Claude Code, Codex, and OpenCode in cloud sandboxes, accessed through the API, CLI, and dashboard. Persistent project files, checkpoints, retained run history, optional GitHub synchronization, scoped integrations, and explicit limits are the foundation.

The abstract hero evokes possibility without turning its artwork into a literal product metaphor. The page then moves through an API example, an interactive request → execute → keep → continue walkthrough, a shared-project diagram, capabilities, integrations, and open-source setup. Setup details stay in a disclosure and linked guides. Examples use the actual `macrofold` SDK imports and source installation; they do not advertise unpublished registry packages.

## Implementation and motion

The current [Swarm particle collection](swarm-motion.md) is at `/swarm-proof/surfaces.html`: eight revised surface arrangements plus the preserved Crossed planes and Compressed folds favorites, using the approved 40,000-point continuous flow. The eight revisions change projected silhouettes and use broader exits and more divergent wind dispersal. One switcher reuses a single renderer. Every variation retains the twenty-two-second sequence, transparent 3:2 composition, restrained mouse parallax, and 2880 × 1920 still output. The approved V3 remains at `/swarm-proof/index.html`; the earlier five generic studies remain at `/concepts/swarm/motion`.

The [typed catalog](../../../apps/web/components/concepts/catalog.ts) supplies copy, art descriptions, composition, and motion notes. Shared [page components](../../../apps/web/components/concepts/site.tsx) render the product story on the server. Existing Radix tabs, clipboard handling, Lucide icons, and scoped CSS provide interaction. There are no added packages, remote embeds, font downloads, analytics experiments, or provider calls.

The ten [PNG originals](../../../apps/web/public/concepts) remain static generated concept frames. Next.js provides responsive image delivery; gallery images load lazily and an individual hero receives priority. The separate Swarm motion studio generates a procedural particle field; other hero descriptions remain proposals. The walkthrough has a small pausable CSS trace. Reduced-motion preferences disable automatic motion; content, initial examples, and animation descriptions remain available without JavaScript.

The gallery has separate navigation and animation controls, with no nested buttons inside links. Notes support hover, focus, tap, and Escape. Neither the artwork nor the walkthrough claims to display real customer activity or guaranteed capacity.

Concept routes remain `noindex, nofollow`, absent from the public sitemap, and separate from the canonical homepage. They are public design previews, not a protected administrative surface.

## Supporting material

- [Reference-site research](research.md): all twelve requested sites, explanatory/API patterns, and observed animation technology.
- [Image prompts](prompts.md): the exact built-in generation prompt set and asset ownership.
- [Verification](verification.md): actual checks, report scope, and remaining production work.
- [Release TODO](../../maintainers/TODO.md): deployed-host and physical-device acceptance.

## Changelog

- September 2026: replaced literal botanical, orbital, academic, and poster metaphors with computational/material studies. Hero art and product copy now have separate roles; explanatory diagrams remain tied to actual behavior.
