# Swarm Continuum verification

The [Continuum collection](README.md) was checked locally in Chrome 152.0.7977.83 with ANGLE Metal on Apple M1 Pro. The review captures (`../../../../output/swarm-continuum/review-final/review-report.json`, local historical evidence not included in this repository), final stills (`../../../../output/swarm-continuum/final-captures/capture-report.json`, local historical evidence not included in this repository), renderer regression (`../../../../output/swarm-continuum/renderer-report.json`, local historical evidence not included in this repository), and browser report (`../../../../output/swarm-continuum/ui-report.json`, local historical evidence not included in this repository) bind the delivered source hashes. Renderer SHA-256 is `6bde6892e2bc520bd209e3e0ceb8f402eba0d6149fbebcf77755935c908d7a45`; geometry SHA-256 is `ee267210c96805fa782756b2dbad9a0877935c5fc6366a535571faa66044bd7b`.

## Visual changes

All ten concepts were captured at one, two, four, six, nine, twelve, fourteen, seventeen, nineteen, and 19.5 seconds: 100 transparent 960 × 640 frames with black composites. Every capture passed graphics checks; the last two timestamps are fully transparent. Mature-frame review covers all ten concepts across six to fourteen seconds and their earlier Metamorphosis counterparts.

The inlet has curved columns, uneven projected edges, and a broad transition in which some rows remain readable while others loosen. Added outer chambers, branches, and cell families broaden the mature structures. Viscera, Chitin, and Heterodyne retain recognizable curved skins; Alveoli develops recessed chambers and Rhizome develops thick branching arms. Organic tips sometimes extend beyond the top or bottom of the frame. The visible footprint varies by pose and cropping; the increased section counts are not evidence of an exact 1.5× screen-area increase.

The polyhedral group retains continuing changes in proportions and arrangement. Hypercell now covers more of each cell after gathering, separates three families, and allocates 44% of its particles to edges with quieter face interiors. Its outer boundaries are clearer; intersecting interior cells remain visually dense. The release stays broad rather than converging into a narrow outlet. The construction remains art-directed procedural geometry.

## Rendering and interaction

All nineteen browser check groups passed. The verifier observed 420 draws, each with exactly 60,000 POINTS, no depth testing, and no triangle pass. All ten selections reuse one WebGL context and produce distinct nine-second frames. The depth regression translates the population by −500, zero, and +500 camera-depth units: all ten images remain identical and nonempty. The preserved Emergence control still reproduces the original depth-dependent differences.

Eighteen adjacent-frame comparisons span all ten concepts at nine seconds and both groups at two, six, twelve, and fourteen. Coarse alpha-distribution change over 20 ms ranges from 5.37% to 11.82%, below the unchanged 20% bound. This detects large sampled visibility jumps; it does not prove every instant or perceptual smoothness on every device.

The speed slider passes all eleven keyboard settings from 1.0× to 2.0× and clamps at both ends. A live 1× to 2× change preserves position and advances approximately 0.77 animation seconds over the following 400 ms. At 1.5×, Play resumes exactly from 5.4 seconds and reaches 5.98 after 400 ms. Selection, scrubbing, pause, Formation, and Loop retain the rate. Formation stops at six; the full sequence stops or wraps at twenty. Blank frames at zero, nineteen, 19.5, and twenty and exact scrub-and-play behavior remain covered.

Desktop and 390-pixel mobile layouts have zero tested Axe violations and no horizontal overflow. Reference comparison, transparency preview, selected PNG download, keyboard selection, reduced motion, and no-JavaScript/no-WebGL fallbacks pass. The desktop screenshot (`../../../../output/swarm-continuum/ui-desktop.png`, local historical evidence not included in this repository) and native mobile screenshot (`../../../../output/swarm-continuum/mobile-native-full-page.png`, local historical evidence not included in this repository) were visually inspected. A separate native-clock compositor check (`../../../../output/swarm-continuum/mobile-compositor-report.json`, local historical evidence not included in this repository) confirms visible particles in viewport, full-page, and stage screenshots, with no graphics errors. Its framebuffer contains 19,322 visible alpha pixels. The UI verifier's wall-paced callback measurements are not a native GPU or physical-device performance benchmark.

## Delivery and preservation

Ten transparent 2880 × 1920 PNGs total 36,456,186 bytes; ten 1440 × 960 WebPs total 8,105,440 bytes. Publication (`../../../../output/swarm-continuum/image-report.json`, local historical evidence not included in this repository) checks dimensions, alpha, source hashes, and capture identity before publishing. The live renderer loads shared code and the 1.92 MB palette; it does not load the whole still collection.

The source archive (`../../../../output/swarm-continuum-source.zip`, local historical evidence not included in this repository) contains 36 files and is 45,933,596 bytes, with SHA-256 `1c3cfb603cca4f85c3f242119a8d9dbcf1205c513c450323bf7f8f482fc3cdbf`. Its package report (`../../../../output/swarm-continuum/package-report.json`, local historical evidence not included in this repository) binds runtime, capture, renderer, and UI evidence. Independent ZIP integrity and all 35 manifest entries pass; the optional capture tool resolves its assets within the extracted package. The preservation report (`../../../../output/swarm-continuum/preservation-after.json`, local historical evidence not included in this repository) confirms all 191 recorded earlier public files and source archives remain byte-identical, including Metamorphosis and the selected favorites.

The existing isolated preview on port 3336 serves the new collection after a restart. No application rebuild, paid provider call, or video export was required. JavaScript syntax, scoped formatting, and documentation checks complete the local verification.

## Remaining coverage

These results apply to the recorded local Chrome/Metal environment. Safari, Firefox, sustained physical-device frame pacing, and deployed hosting remain separate checks in the [marketing release checklist](../../../maintainers/TODO.md). Video remains deferred by user choice.
