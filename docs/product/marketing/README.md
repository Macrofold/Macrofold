# Marketing concepts

Open **[/concepts](http://localhost:3210/concepts)** in the local app to compare ten complete landing pages. Each combines an original hero image, a different headline and visual direction, working code tabs, and a shared product walkthrough. Choose **Explore** to open a page; hover over its artwork or focus/tap **Animation concept** to read the proposed motion.

[Design Language](../design-language.md) owns the shared preferences, all 31 reference companies and their intended roles, and the rejected directions. This guide describes the current concept implementation.

## Choose a direction

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

Start with **Aurum** for tactile gold, **Tensor** for scale, **Eigen** for a light developer aesthetic, and **Flux** for a broad computational scene. These are design judgments, not conversion results.

## Product story

Every direction describes the same implemented product: Claude Code, Codex, and OpenCode in cloud sandboxes, accessed through the API, CLI, and dashboard. Persistent project files, checkpoints, retained run history, optional GitHub synchronization, scoped integrations, and explicit limits are the foundation.

The abstract hero evokes possibility without turning its artwork into a literal product metaphor. The page then moves through an API example, an interactive request → execute → keep → continue walkthrough, a shared-project diagram, capabilities, integrations, and open-source setup. Setup details stay in a disclosure and linked guides. Examples use the actual `macrofold` SDK imports and source installation; they do not advertise unpublished registry packages.

## Implementation and motion

The [typed catalog](../../../apps/web/components/concepts/catalog.ts) supplies copy, art descriptions, composition, and motion notes. Shared [page components](../../../apps/web/components/concepts/site.tsx) render the product story on the server. Existing Radix tabs, clipboard handling, Lucide icons, and scoped CSS provide interaction. There are no added packages, remote embeds, font downloads, analytics experiments, or provider calls.

The ten [PNG originals](../../../apps/web/public/concepts) are static generated concept frames. Next.js provides responsive image delivery; gallery images load lazily and an individual hero receives priority. **The proposed hero animations are not implemented.** Their descriptions distinguish a potential video/SVG/Three.js treatment from the current poster. The walkthrough has a small pausable CSS trace. Reduced-motion preferences disable motion and transitions; content, initial examples, and animation descriptions remain available without JavaScript.

The gallery has separate navigation and animation controls, with no nested buttons inside links. Notes support hover, focus, tap, and Escape. Neither the artwork nor the walkthrough claims to display real customer activity or guaranteed capacity.

Concept routes remain `noindex, nofollow`, absent from the public sitemap, and separate from the canonical homepage. They are public design previews, not a protected administrative surface.

## Supporting material

- [Reference-site research](research.md): all twelve requested sites, explanatory/API patterns, and observed animation technology.
- [Image prompts](prompts.md): the exact built-in generation prompt set and asset ownership.
- [Verification](verification.md): actual checks, report scope, and remaining production work.
- [Release TODO](../../maintainers/TODO.md): choose and promote a production direction separately.

## Changelog

- September 2026: replaced literal botanical, orbital, academic, and poster metaphors with computational/material studies. Hero art and product copy now have separate roles; explanatory diagrams remain tied to actual behavior.
