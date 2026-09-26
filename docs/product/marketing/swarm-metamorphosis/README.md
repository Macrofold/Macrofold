# Swarm Metamorphosis

The separate collection at `/swarm-metamorphosis/index.html` develops the ten [Resonance concepts](../swarm-resonance/README.md) with stronger ongoing transformations, round particle sprites, and an ordered inlet that gradually becomes disorganized before gathering. Resonance and every earlier collection remain preserved.

## Motion and timing

The twenty-second sequence begins with evenly spaced columns and lanes fading in from darkness on the left. Shared wandering and individual drift gradually break the lattice apart. Organization becomes visible around three seconds and the structure is established by seven. From seven to fifteen, sections continue changing proportions and surface geometry, merging into neighboring regions, fading, and returning. Particles keep travelling through the evolving form.

Wind release begins at fifteen seconds with staggered attachment loss and retained momentum. All particles have faded by nineteen, leaving one empty second before the loop restarts. The studio starts paused at nine seconds. Drag the timeline and press **Play** to continue from that point. **Play formation** runs zero to seven; **Play 20 s loop** runs the complete sequence.

## Geometry and rendering

The five organic studies retain Viscera, Chitin, Aeolian, Meissner, and Heterodyne. The five crystalline studies retain Tetrarch, Dendrite, Hypercell, Coronet, and Aperiodic. Keeping their IDs makes comparison with Resonance straightforward. Their changing sections use stable particle identities; broad cycles connect shape contraction and mergers with gradual changes in visibility.

The [renderer](../../../../apps/web/public/swarm-metamorphosis/renderer.mjs) uses native WebGL and GLSL with no runtime package dependencies. Each of the 40,000 sprites has a circular silhouette, a soft rim, and shallow hemispheric shading. Orthographic projection keeps point size and brightness independent of camera distance. One transparent point pass and no depth test preserve the earlier clipping fix. Adaptive resolution retains the full particle population.

The [shape definitions](../../../../apps/web/public/swarm-metamorphosis/shapes.mjs) and shared movement field are art-directed procedural geometry, not a physical neighbor-force or superconductivity simulation. Their names describe visual inspiration; the points do not count real agents.

## Delivery and verification

The live studio retains selection, exact scrub-and-play behavior, pointer parallax, reduced motion, transparency preview, reference comparison, and static fallbacks. Ten transparent 2880 × 1920 PNG stills and 1440 × 960 WebP posters accompany the complete source ZIP (`../../../../output/swarm-metamorphosis-source.zip`, local historical evidence not included in this repository). Tool instructions (`../../../../output/swarm-metamorphosis/README.md`, local historical evidence not included in this repository) describe capture and packaging. [Verification](verification.md) records the actual source-bound checks and remaining browser/device coverage. Video remains deferred by user choice.
