# Swarm Emergence

The separate collection at `/swarm-emergence/index.html` explores ten structures that develop from a dispersed moving field. Different regions gain definition, loosen, change their geometry, and reform while neighboring regions remain cohesive. The approved [volume collection](../swarm-volumes/README.md), [manifolds](../swarm-manifolds/README.md), and earlier [surface studies](../swarm-motion.md) remain unchanged.

## Concepts

The next [Swarm Resonance collection](../swarm-resonance/README.md) removes invisible-mesh clipping, keeps particle appearance independent of camera depth, and explores more continuous natural and crystalline forms in a new folder. This Emergence collection remains preserved.

| Group      | Study      | Structure                                                             |
| ---------- | ---------- | --------------------------------------------------------------------- |
| Organic    | Chimera    | Asymmetric chambers, ridges, and buckled skins around deep openings.  |
| Organic    | Branchiae  | Gill-like chambers and bowed ribs with different breathing rhythms.   |
| Organic    | Carapace   | Thick curved skins overlap and separate around recessed pockets.      |
| Organic    | Colony     | A changing network of cavities, bridges, and irregular chambers.      |
| Organic    | Primordium | Cleft lobes and internal openings gather and lose definition locally. |
| Polyhedral | Tessera    | Unequal blocks tilt and change their shoulders and relationships.     |
| Polyhedral | Fracture   | Substantial tetrahedral wedges reshape their tips and junctions.      |
| Polyhedral | Accretion  | Tilted crystal chambers change their caps and relative positions.     |
| Polyhedral | Assemblage | Interwoven blocks and triangular chambers rearrange together.         |
| Polyhedral | Quarry     | Oblique faceted chambers open and close a changing central cleft.     |

## Formation and motion

The stream fades into view from the left, spreads through a shared wandering field, and gradually acquires structure. Gathering grows over approximately the first nine seconds; its entry interval varies across the particle population. Shared movement and individual drift weaken gradually as local order increases. This replaces the previous narrow attachment region and immediate left-to-right reveal.

Each anatomical or geometric section has its own organization rhythm. Several sections retain clear surfaces while others lose their skin into the moving field and rebuild. Centers, orientations, proportions, and openings also change, so regional breakup is accompanied by changing anatomy. Particles continue travelling through the structure and leave varied locations. Staggered wind release begins at fifteen seconds and carries momentum into dispersal; twenty to twenty-two seconds are empty.

The [runtime](../../../../apps/web/public/swarm-emergence) uses native WebGL and 40,000 point sprites without runtime dependencies. The supplied particle buffer contributes colors, sizes, and brightness; its original image coordinates are unused. The [shape definitions](../../../../apps/web/public/swarm-emergence/shapes.mjs) create compound organic and polyhedral geometry. An invisible depth pass follows the gathering transformation and writes coverage only in highly organized regions, preserving readable foreground surfaces without exposing an opaque finished shape during formation.

These are art-directed procedural rules with a shared motion field, not a physical neighbor-force simulation or recovered hidden geometry from the reference artwork. Points remain abstract rather than a count of real agents.

## Playback and source

The studio starts paused at nine seconds with Chimera selected. Its grouped selector shows one of ten studies at a time and preserves playback when changing selection. Scrub the timeline and press **Play** to continue from that time. Formation restarts at zero and stops at fifteen; Loop includes the full twenty-two-second sequence. Pointer parallax, reduced motion, pause, transparency, adaptive rendering, original-artwork comparison, and static fallbacks remain available.

Ten transparent 2880 × 1920 PNG stills and 1440 × 960 WebP posters accompany the live collection. The standalone source package (`../../../../output/swarm-emergence-source.zip`, local historical evidence not included in this repository) contains all runtime files, required data, stills, and a capture tool. Capture and packaging instructions (`../../../../output/swarm-emergence/README.md`, local historical evidence not included in this repository) explain deterministic replay and source preservation. Video remains deferred by user choice. The [verification record](verification.md) owns actual checks and device-coverage limits.
