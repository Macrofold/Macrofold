/** Art directions share the real product contract; names never become product branding. */
export const concepts = [
  {
    slug: 'aurum',
    name: 'Aurum',
    category: 'Material / split',
    layout: 'split',
    title: 'Powerful agents.\nEntirely in your hands.',
    eyebrow: 'Open infrastructure for coding agents',
    description:
      'Obsidian, fine gold mesh, and a quiet developer studio. Tactile precision without a literal metaphor.',
    art: 'A folded gold computational membrane made of fine metallic threads against black.',
    animation:
      'A grazing light travels slowly across the gold mesh. Its folds flex almost imperceptibly; a narrow spectral edge appears as the light passes. The camera stays still and the copy never moves.',
    technique: 'Pre-rendered 8-second WebM loop with a static poster. No 3D runtime needed.',
  },
  {
    slug: 'eigen',
    name: 'Eigen',
    category: 'Point cloud / light',
    layout: 'split',
    title: 'Your next product\ncan do more.',
    eyebrow: 'Native agents. One developer API.',
    description:
      'Graphite point samples on cool white, precise typography, and a spare technical composition.',
    art: 'A silver and cobalt point-sampled manifold on an off-white background.',
    animation:
      'Sparse samples resolve into a coherent surface, then hold. A slow change in viewing angle reveals the depth. On pointer movement the surface shifts by a few pixels, with no continuous motion on touch.',
    technique: 'Short pre-rendered reveal; optional instanced Three.js points after a direction is selected.',
  },
  {
    slug: 'tensor',
    name: 'Tensor',
    category: 'Latent space / cinematic',
    layout: 'cinematic',
    title: 'Build what comes\nafter the chatbot.',
    eyebrow: 'The infrastructure for software that acts',
    description: 'An immense violet-white fiber field, cinematic scale, and disciplined white-on-black copy.',
    art: 'Thousands of fine violet-white fibers form a folded vertical surface in black space.',
    animation:
      'Fine fibers bend together in a slow continuous deformation. A restrained band of light reveals local structure without making the whole scene flash. The composition settles before the next loop.',
    technique: 'WebM poster loop, paused outside the viewport. Text stays ordinary server-rendered HTML.',
  },
  {
    slug: 'flux',
    name: 'Flux',
    category: 'Fluid simulation / panoramic',
    layout: 'panoramic',
    title: 'Your best agents.\nBeyond your machine.',
    eyebrow: 'From a local workflow to your application',
    description:
      'Silver-cyan tracer lines across a broad black field. A panoramic hero with a compact, direct promise.',
    art: 'Precise cyan and silver fluid-simulation tracer lines sweeping across a black field.',
    animation:
      'Individual tracers advance through a stable velocity field. Small vortices form and dissolve at the edge while the broad flow remains calm. Nothing follows the pointer or competes with reading.',
    technique: 'Pre-rendered simulation loop; an optional canvas implementation must cap its particle count.',
  },
  {
    slug: 'strata',
    name: 'Strata',
    category: 'Engineered material / wide',
    layout: 'wide',
    title: 'Give ambitious ideas\nthe infrastructure.',
    eyebrow: 'Coding agents, ready to integrate',
    description:
      'Thin graphite layers with gold-lit edges. A wide sculptural stage above a concise product introduction.',
    art: 'Suspended graphite plates with computational contour surfaces and warm gold edges.',
    animation:
      'Closely spaced plates separate a little, exposing the lit contours between them. They settle into alignment as the camera makes a tiny oblique movement. This is a material study, not a storage diagram.',
    technique: 'One pre-rendered reveal, replayable on demand. Static artwork for reduced motion.',
  },
  {
    slug: 'lattice',
    name: 'Lattice',
    category: 'Interference / light',
    layout: 'editorial',
    title: 'Coding agents,\ninside your product.',
    eyebrow: 'An API for work that goes further',
    description:
      'Cobalt interference patterns, cool white space, square controls, and an explicit developer entry point.',
    art: 'A topological interference lattice of fine cobalt strands and black samples on white.',
    animation:
      'Two sampling fields move by a fraction of a cell, producing a larger interference pattern. The effect is slow and precise, with a brief pause at alignment. It never resembles a loading indicator.',
    technique: 'Two lightweight SVG layers with CSS transforms; no canvas or animation dependency required.',
  },
  {
    slug: 'phase',
    name: 'Phase',
    category: 'Optical surface / editorial',
    layout: 'editorial',
    title: 'Start with an agent.\nBuild something bigger.',
    eyebrow: 'Developer infrastructure for agentic software',
    description:
      'A sharply folded silver wavefront in deep black. Asymmetric framing with an unusually spare introduction.',
    art: 'An ultrathin silver diffractive surface with icy-blue grazing light against black.',
    animation:
      'A wave travels through the metallic surface, changing the reflected light rather than moving the entire object. One cool highlight crosses the fold and fades. The framing remains deliberately still.',
    technique: 'Baked material animation in video. Avoid a live shader until its interaction has a purpose.',
  },
  {
    slug: 'swarm',
    name: 'Swarm',
    category: 'Emergence / cinematic',
    layout: 'cinematic',
    title: 'A new kind of software\nstarts with you.',
    eyebrow: 'Put coding agents to work in the cloud',
    description:
      'A vast, coherent particle volume. Emergent complexity and scale, anchored by calm, concrete product copy.',
    art: 'An intricate emergent volume of ivory and cyan point samples in deep black.',
    animation:
      'Sparse points acquire local order and gather into a complex volume. The camera gradually reveals its scale; individual points stay subtle. The field is abstract and never pretends to count real agents.',
    technique:
      'Pre-rendered point simulation first. An interactive version could use instanced Three.js geometry.',
  },
  {
    slug: 'isotope',
    name: 'Isotope',
    category: 'Microstructure / split',
    layout: 'split',
    title: 'Real agents.\nReady for your stack.',
    eyebrow: 'Persistent cloud execution, by API',
    description:
      'Machined titanium, tiny amber-lit chambers, and a strong technical silhouette. Compact and assured.',
    art: 'A porous machined titanium microstructure with amber light inside its nested chambers.',
    animation:
      'The artifact turns through a very small angle, revealing the cavities in its structure. Warm light moves through the interior without becoming a literal request-flow diagram. The silhouette remains crisp.',
    technique: 'A short baked turntable video with a sharp static poster and modest playback rate.',
  },
  {
    slug: 'aperture',
    name: 'Aperture',
    category: 'Computational field / panoramic',
    layout: 'panoramic',
    title: 'Build beyond\nwhat seemed possible.',
    eyebrow: 'Open infrastructure. Native intelligence.',
    description:
      'A monumental field of dark metallic fins and a restrained silver opening. Severe, futuristic, spacious.',
    art: 'Dark metallic fins open onto a fine computational texture with a silver-white edge.',
    animation:
      'A narrow highlight expands just enough to reveal the structure behind the fins, then holds. A subtle change in parallax supplies depth. No portal, space-travel, or unlocking animation is implied by the copy.',
    technique: 'A single WebM reveal. Keep its final frame visible instead of repeatedly restarting it.',
  },
] as const;
export type Concept = (typeof concepts)[number];
export const productDescription =
  'Run Claude Code, Codex, and OpenCode in the cloud through one API. Persistent sandbox files, version control, and the same workspace in your CLI and dashboard.';
