# Swarm manifold studies

The newer [volume studies](../swarm-volumes/README.md) explore five organic bodies and five polygonal solids with more mass. This manifold collection remains preserved.

This independent iteration lives at `/swarm-manifolds/index.html`. It explores more defined three-dimensional particle surfaces whose curvature, fold depth, and orientation change throughout the animation. The [earlier surface collection](../swarm-motion.md) and its source archives remain unchanged.

The ten treatments keep their familiar selection names, but each has a new moving surface. Crossed planes changes the junction between oblique faces; Compressed folds deepens and opens its pleats; Open vault keeps rolling throughout its body while its opening changes. Other treatments explore changing saddle curvature, distributed torsion, diagonal hinges, opposing folds, a returning edge, and traveling bends. None has a timed stationary hold after formation.

## Playback

The preview starts paused at nine seconds. Drag the timeline and press **Play** to continue from that exact position through the twenty-two-second sequence. At the endpoint, Play starts again at zero. **Play formation** explicitly restarts and stops at fifteen seconds. **Play 22 s loop** explicitly restarts and repeats the entire sequence. Pause, keyboard scrubbing, selection changes, reference comparison, and transparency controls remain available.

Particles continue traveling independently while the underlying surface bends. Formation occupies roughly eight seconds; the living body keeps changing until staggered release begins at fifteen seconds. Wind carries each released particle's instantaneous velocity into dispersal, with an empty frame from twenty to twenty-two seconds. The camera remains fixed with restrained mouse parallax. Reduced motion suppresses parallax and automatic motion; explicit playback remains available.

## Implementation and preservation

The self-contained [runtime folder](../../../../apps/web/public/swarm-manifolds) holds the [renderer](../../../../apps/web/public/swarm-manifolds/renderer.mjs), [variation catalog](../../../../apps/web/public/swarm-manifolds/variations.mjs), [material builder](../../../../apps/web/public/swarm-manifolds/material.mjs), point buffer, reference image, controls, and posters. It uses native WebGL point sprites and no runtime npm dependencies. A single GPU program, shared buffers, and textures serve all ten variations.

Forty thousand points retain the reference palette and density-driven brightness. The reference chart retains uneven point spacing and open pockets inside the material coordinates, so that detail bends with the broader geometric surfaces. Ordered rows, restrained individual jitter, perspective, and depth testing provide definition. Large independent temporal deformation modes change the geometry even at a fixed surface coordinate; incoming particles do not determine the body's morph phase. These are art-directed three-dimensional embeddings, not recovered hidden geometry or physical neighbor-force simulation.

The earlier `swarm-proof` files and existing source ZIPs are fingerprinted before this iteration and checked again at delivery. All new animation files, stills, capture tools, and source packaging use separate folders. Capture tools (`../../../../output/swarm-manifolds/capture.mjs`, local historical evidence not included in this repository) freeze runtime inputs and render serially in one browser. [Verification](verification.md) records actual results and remaining device coverage. Video remains deferred.
