# Swarm Confluence verification

The [Confluence collection](README.md) was checked locally in Chrome 152.0.7977.83 with ANGLE Metal on Apple M1 Pro. The final reviews (`../../../../output/swarm-confluence/review-final/review-report.json`, local historical evidence not included in this repository), still captures (`../../../../output/swarm-confluence/final-captures/capture-report.json`, local historical evidence not included in this repository), browser report (`../../../../output/swarm-confluence/ui-report.json`, local historical evidence not included in this repository), and renderer regression (`../../../../output/swarm-confluence/renderer-report.json`, local historical evidence not included in this repository) bind the delivered source. Renderer SHA-256 is `8414877acc98233cd01e2e78aef277da81d8cf3e831b35ed6d4d70bd6fa7162b`; geometry SHA-256 is `bdb50551372ae5984cbe2982cdd5f1b774adfee7d8483e13d60067cc42988557`.

## Visual review

All ten concepts were captured at one, two, four, six, ten, fourteen, 14.8, seventeen, nineteen, and 19.5 seconds: 100 transparent review frames with black composites. All passed graphics and alpha checks; nineteen and 19.5 seconds are empty. Mature poses and formation were inspected alongside earlier captures.

Fuller skins and quieter late scatter improve surface continuity. Thalassa has broad traveling curves; Maelstrom has more pronounced overlapping crests and a disrupted silhouette. The corrected material clock removes the dominant stationary inlet knot. Druse shows many small terminated crystals and layered facets; Hypercell exposes populated planes as well as boundaries. Viscera, Chitin, and Alveoli retain porous anatomical surfaces. Transparent overlapping layers can still soften interior detail, and some organic poses extend outside the composition. These are visual limits rather than evidence of an invisible clipping mesh.

The material mapping is smooth and bounded, and its exit derivative matches the same mapping. Departing particles fade to zero before recycling. Druse uses a continuous parent orientation that avoids its former near-pole turn. Definition strengthens without stopping independent travel or macrogeometry changes. The construction remains art-directed procedural geometry, not a neighbor-force simulation.

## Rendering and interaction

All nineteen browser check groups pass. The verifier observes 418 draws, each using exactly 80,000 POINTS, with no depth testing or triangle pass. The ten selections produce distinct fourteen-second frames using one WebGL context. No JavaScript or graphics errors were recorded. Depth translations of −500, zero, and +500 produce identical nonempty images for every new concept; the preserved Emergence control still reproduces the earlier distance-dependent defect.

Eighteen adjacent-frame comparisons cover all ten studies at nine seconds and both groups at two, six, twelve, and fourteen. Coarse alpha-distribution change over 20 ms ranges from 4.30% to 8.08%, below the unchanged 20% bound. This detects sampled visibility jumps; it does not prove every instant is perceptually smooth on every device.

The speed slider passes all eleven keyboard settings and both endpoint clamps. A live 1× to 2× change preserves position, then advances approximately 0.77 animation seconds over 400 ms. Play resumes 5.4 seconds exactly at 1.5× and reaches 5.98 after 400 ms. Selection, scrub, pause, Formation, and Loop retain speed. Formation stops at six; the sequence stops or wraps at twenty. Blank endpoints, reference comparison, transparency, selected PNG download, reduced motion, and no-JavaScript/no-WebGL fallbacks pass.

Desktop and 390-pixel mobile checks report zero tested Axe violations and no horizontal overflow. The desktop screenshot (`../../../../output/swarm-confluence/ui-desktop.png`, local historical evidence not included in this repository) and native mobile screenshot (`../../../../output/swarm-confluence/mobile-native-full-page.png`, local historical evidence not included in this repository) were visually inspected. A separate native-clock compositor check (`../../../../output/swarm-confluence/mobile-compositor-report.json`, local historical evidence not included in this repository) confirms visible particles in viewport, full-page, and stage captures, with 24,457 visible framebuffer alpha pixels and no graphics errors. Callback timing in the UI report is not a native GPU performance benchmark.

## Delivery and preservation

Ten transparent 2880 × 1920 PNGs total 46,583,254 bytes; ten 1440 × 960 WebPs total 9,053,866 bytes. Publication (`../../../../output/swarm-confluence/image-report.json`, local historical evidence not included in this repository) verifies dimensions, alpha, capture identity, and source hashes. The live renderer loads approximately 1.98 MB of shared geometry, renderer, metadata, and palette before UI/poster assets; it does not load the entire still collection. The extra particle identities reuse the existing palette asset.

The source archive (`../../../../output/swarm-confluence-source.zip`, local historical evidence not included in this repository) contains 36 files and is 57,026,875 bytes, with SHA-256 `9e28f16d02d4c008065f9db0d7799f408ab7b7ba3b1a5b0dc3e2bac749998b0f`. Its package report (`../../../../output/swarm-confluence/package-report.json`, local historical evidence not included in this repository) binds runtime, capture, and test evidence. Independent ZIP integrity and all 35 manifest entries pass, including portable capture-tool paths. The preservation report (`../../../../output/swarm-confluence/preservation-after.json`, local historical evidence not included in this repository) confirms all 220 recorded earlier public files and source archives remain byte-identical.

The existing isolated preview on port 3336 serves the new collection after a restart. Ten JavaScript entrypoints pass syntax checks; scoped source formatting passes. Documentation checks verify 46 public pages, 168 Markdown files, and 54 requirement evidence mappings. No application rebuild, paid provider call, or video export was required.

## Remaining coverage

Safari, Firefox, sustained physical-device frame pacing with 80,000 particles, and deployed hosting remain separate checks in the [marketing release checklist](../../../maintainers/TODO.md). The recorded results apply to the local Chrome/Metal environment. Video remains deferred by user choice.
