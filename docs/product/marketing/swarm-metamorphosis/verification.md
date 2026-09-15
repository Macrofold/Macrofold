# Swarm Metamorphosis verification

The [Metamorphosis collection](README.md) was checked locally with Chrome 152.0.7977.83 and ANGLE Metal on Apple M1 Pro. The [motion captures](../../../../output/swarm-metamorphosis/review-v1/review-report.json), [final stills](../../../../output/swarm-metamorphosis/final-captures/capture-report.json), [renderer regression](../../../../output/swarm-metamorphosis/renderer-report.json), and [UI report](../../../../output/swarm-metamorphosis/ui-report.json) record their exact source hashes. The renderer SHA-256 is `528ac4fcb1e7bef0166b23b35ee5476fa6bfe067f56de71111de96b1e0f79a8c`; the shape definitions SHA-256 is `e2356c3ea288d493a5779a049506bff74d3152c54d1cd340e4a08c3c305894d4`.

## Shape change and particle treatment

All ten concepts were captured at three, five, seven, nine, eleven, thirteen, fifteen, seventeen, nineteen, and 19.5 seconds: 100 transparent 960 × 640 frames and black composites. Every frame completed without a WebGL error. The last two times are fully transparent. Visual review of every concept at seven through fifteen seconds found substantial changes in proportions, section arrangement, and openings. Coronet trades broad chambers for different spires; Aperiodic changes between tall and broad envelopes; Viscera changes from a compact mass into divided lobes and a tall arch. Hypercell remains the densest and least immediately legible study. Sampled dispersal spreads broadly without a narrow outlet.

The [morph diagnostic](../../../../output/swarm-metamorphosis/morph-report.json) evaluates the actual geometry shaders at 1,024 fixed material coordinates for each concept at seven, nine, eleven, thirteen, and fifteen seconds. It compares 2,048 fixed point-pair distances between adjacent poses. A fitted uniform scale is removed, so the residual measures deformation beyond translation, rigid rotation, uniform scaling, particle transport, or opacity-only fading. Mean deformation residuals were 2.46–3.75 times the corresponding Resonance values for the organic group and 5.71–11.14 times for the crystalline group. All samples were finite and inside the encoding bounds. This bounded diagnostic supports stronger geometric change; it is not a measure of perceived quality or physical simulation accuracy.

The inlet review shows evenly spaced leftmost lanes and columns gradually breaking into the wandering field. A [native-resolution detail](../../../../output/swarm-metamorphosis/orb-detail.png) from the final Coronet still shows circular particles with soft rims and shallow highlights. Depth-only translations of −500, zero, and +500 produced identical nonempty rendered images for all ten concepts; the preserved Emergence control still reproduced depth-dependent differences. The clipping fix remains intact.

## Timing and interface

The [browser verifier](../../../../output/swarm-metamorphosis/verify-ui.mjs) checks the served files against local hashes, reuses one context through all ten selections, and covers both geometry groups through the sequence. It verifies full transparency at zero, nineteen, 19.5, and twenty seconds; visible particles during inlet, formation, morphing, and dispersal; Formation ending at seven; and the full loop ending at twenty. Play resumes the exact scrubbed positions 1.5, 5.4, 12.34, and 17.5 seconds before advancing. Pause, keyboard controls, selection, reference comparison, transparency preview, downloads, reduced motion, and static fallbacks are covered.

All seventeen check groups passed without page or graphics errors. The verifier recorded 339 draws, each with exactly 40,000 points and no depth testing. Desktop and 390-pixel mobile layouts had zero tested Axe violations; mobile had no horizontal overflow. The [desktop screenshot](../../../../output/swarm-metamorphosis/ui-desktop.png) was visually inspected.

The first mobile screenshot taken under the test clock was black despite a nonempty framebuffer. A focused [native-clock compositor check](../../../../output/swarm-metamorphosis/mobile-compositor-report.json) repeated the same reduced-motion view without Playwright's clock and confirmed visible particles in viewport, full-page, and stage screenshots. Their image crops contained 5,674, 5,981, and 5,669 bright pixels respectively, with 14,501 visible framebuffer alpha pixels and no graphics errors. The [native mobile screenshot](../../../../output/swarm-metamorphosis/mobile-native-full-page.png) is the visual acceptance image. No animation change was made to accommodate the test-clock capture artifact.

Eighteen nearby-frame comparisons cover all concepts at nine seconds and both groups at three, seven, twelve, and fourteen. Coarse alpha distributions change by 6.23–14.07% over 20 ms, below the unchanged 20% discontinuity bound. This checks for large sampled visibility jumps, not every possible instant. The recorded playback callback timing uses Playwright's wall-paced clock and is not a native GPU or physical-device benchmark.

## Delivery and preservation

Ten transparent 2880 × 1920 PNGs total 26,037,718 bytes; ten 1440 × 960 WebPs total 6,323,048 bytes. The [publication report](../../../../output/swarm-metamorphosis/image-report.json) validates dimensions, alpha, current source hashes, metadata IDs, and PNG capture hashes before publishing. The live renderer loads shared code and particle data rather than the full still collection.

The [standalone source ZIP](../../../../output/swarm-metamorphosis-source.zip) includes all runtime files, required data, stills, the optional capture tool, and source-bound verification reports. The [package report](../../../../output/swarm-metamorphosis/package-report.json) records its size and SHA-256. ZIP integrity, manifest hashes, and standalone capture paths are checked independently. The [preservation report](../../../../output/swarm-metamorphosis/preservation-after.json) confirms all 161 recorded earlier public files and source archives remain byte-identical.

The archive contains 36 files and is 34,830,343 bytes, with SHA-256 `2cd4cfc55741aa421222c88cc83741fea422f400ba42e28794db07bcba44572f`. All 35 manifest entries passed independent byte-length and hash checks. JavaScript syntax and scoped formatting checks passed.

The local preview serves Metamorphosis and all five earlier collections on port 3336. It was restarted from the existing isolated build after new public assets were published. No application rebuild, paid provider call, or video export was required.

## Coverage boundary

Evidence applies to the recorded local Chrome/Metal environment. It does not establish Safari/Firefox behavior, sustained physical-device frame pacing, or deployed hosting acceptance. The structures remain art-directed procedural geometry with a shared movement field. Video stays deferred by user choice; final selection and deployed-device checks remain in the [marketing release checklist](../../../maintainers/TODO.md).
