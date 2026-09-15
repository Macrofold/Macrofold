# Swarm Resonance

The separate collection at `/swarm-resonance/index.html` explores ten continuously changing particle structures. Two keep a primal anatomical character, three explore natural or alien field patterns, and five develop more intricate crystalline geometry. The earlier [Emergence collection](../swarm-emergence/README.md) and all previous studies remain preserved.

## Concepts

| Group      | Study      | Structure                                                                                         |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| Organic    | Viscera    | Muscular shoulders and deeply recessed skins form a changing anatomy.                             |
| Organic    | Chitin     | Oblique armor lobes breathe around a shared irregular spine.                                      |
| Organic    | Aeolian    | Thick neighboring wavefronts carry traveling crests and troughs.                                  |
| Organic    | Meissner   | Layered flux contours reshape a broad multipolar envelope.                                        |
| Organic    | Heterodyne | Two crossing families of ridged cells develop alternating crests and troughs.                     |
| Polyhedral | Tetrarch   | Tetrahedral chambers articulate at two recursive scales.                                          |
| Polyhedral | Dendrite   | A branching mineral skeleton carries movement into smaller offshoots.                             |
| Polyhedral | Hypercell  | Nested cells rotate through four-dimensional coordinates before projection into three dimensions. |
| Polyhedral | Coronet    | Broad pointed crystals carry paired smaller growths.                                              |
| Polyhedral | Aperiodic  | Interleaved rhombic growths change the recesses of a faceted rosette.                             |

## Rendering and continuous change

Only the visible particles contribute to the image. The [renderer](../../../../apps/web/public/swarm-resonance/renderer.mjs) uses one native WebGL point pass without invisible solid meshes or depth testing. Overlapping surfaces combine through transparent sprites, avoiding the hidden geometry that could clip the previous collection. Orthographic projection keeps particle diameter and brightness independent of camera distance. A soft surface-orientation cue distinguishes front and rear sprites without masking other layers. Overlap and changing geometry still affect projected density, but depth does not add a brightness or size multiplier.

All 40,000 particle identities remain in the draw population during playback. Performance adaptation changes canvas resolution rather than dropping and restoring batches of particles. The reference buffer supplies palette, sizes, and brightness; original image coordinates do not determine the new shapes. There are no runtime npm dependencies.

The [shape definitions](../../../../apps/web/public/swarm-resonance/shapes.mjs) retain stable section identities while proportions, orientations, centers, and shared spatial deformations evolve continuously. Broad overlapping waves replace narrow organization gates. Organic compartments blend into their neighbors through changing surfaces; crystalline assemblies carry related motion across parents and smaller sections. Edge particles relax toward a face where two edges compete, preventing an instantaneous jump to a different edge. Section motion does not use appearance or disappearance events.

The broad incoming stream still fades out of darkness, wanders, and gradually acquires structure over approximately nine seconds. Particles keep travelling through the changing form. Wind release begins at fifteen seconds, retains momentum, and disperses the population before two empty seconds at the end of the twenty-two-second loop.

These are art-directed procedural studies. Natural-field and crystalline language describes visual inspiration, not validated fluid, superconductivity, or neighbor-force physics. Points remain abstract rather than a count of real agents.

## Playback and delivery

The studio starts paused at nine seconds with Viscera selected. Choose a study, drag the timeline, and press **Play** to resume from that time. **Play formation** restarts at zero and stops at fifteen seconds; **Play 22 s loop** includes dispersal. Selection preserves playback and time. Pointer parallax, pause, reduced motion, transparency, original-artwork comparison, and static fallbacks remain available.

Ten transparent 2880 × 1920 PNG stills and 1440 × 960 WebP posters accompany the live collection. The [standalone source ZIP](../../../../output/swarm-resonance-source.zip) contains all runtime files, required data, stills, and the optional capture tool. [Tool instructions](../../../../output/swarm-resonance/README.md) explain capture and preservation; [verification](verification.md) records actual checks and coverage limits. Video remains deferred by user choice.
