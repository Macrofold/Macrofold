# Swarm Resonance verification

Local verification for the [Resonance collection](README.md) completed on 9 September 2026 with Chrome 152.0.7977.83 and ANGLE Metal on Apple M1 Pro. The [motion review](../../../../output/swarm-resonance/final-motion/review-report.json), [still captures](../../../../output/swarm-resonance/final-captures/capture-report.json), [renderer regression](../../../../output/swarm-resonance/renderer-report.json), and [UI report](../../../../output/swarm-resonance/ui-report.json) bind results to their source snapshots. The renderer SHA-256 is `f62809e7854b6d78c6cd1b826d7cc82ec0b5c6251f874a4e7e69e8759f70be76`; the shape definitions SHA-256 is `217b45cf79dc62ff082d342dbb495adef1aa485d2f94b155aa3144678a529fff`.

## Particle rendering and continuity

The [renderer verifier](../../../../output/swarm-resonance/verify-renderer.mjs) translated the completed particle positions by −500, zero, and +500 along camera depth while holding timestamp and other inputs constant. The preserved Emergence Quarry control produced three different nonempty images, reproducing its depth-dependent rendering. Each of the ten Resonance concepts produced identical nonempty RGBA hashes across all three translations. The test used temporary served copies and verified that source files remained unchanged.

The browser verifier recorded 291 draws through selection, playback, pause, scrubbing, and resizing. Every draw used exactly 40,000 points; no triangle draws or depth-test enabling calls occurred. This checks that hidden solid surfaces cannot occlude the particles and that resolution adaptation does not change the population. A soft surface-orientation cue remains, but camera distance supplies no sprite brightness or size multiplier. Projected overlap still changes visible density as geometry moves.

Fourteen nearby-frame comparisons covered all ten concepts at nine seconds plus Viscera and Tetrarch at twelve and fourteen seconds. Coarse alpha distributions changed by 4.60–6.54% over each 20 ms interval, below the verifier's 20% discontinuity bound. This detects large sampled visibility jumps; it does not prove continuity at every instant. Visual review also covered changing section boundaries and late dispersal. The final crystalline edge mapping relaxes toward a face when two candidate edges compete instead of jumping to another edge.

## Geometry and stills

All ten concepts were rendered at zero, three, five, seven, nine, twelve, fourteen, seventeen, nineteen, and twenty-one seconds: 100 transparent 960 × 640 frames with black composites. Every render completed without a WebGL error. Final nine-second stills were visually reviewed alongside selected formation, sustained-motion, and dispersal frames. The new collection retains two anatomical studies, adds three field-inspired patterns, and develops five crystalline assemblies. Hypercell is intentionally dense and has less immediately legible individual cells than Tetrarch or Coronet.

Ten 2880 × 1920 PNGs and ten 1440 × 960 WebPs decode with visible content and transparency. PNGs total 33,012,921 bytes; WebPs total 6,360,784 bytes. The [publication report](../../../../output/swarm-resonance/image-report.json) checks dimensions, alpha, metadata IDs, and current runtime hashes before publishing. The live animation loads shared code and particle data; it does not load all twenty images for playback.

## Interface and playback

The [browser verifier](../../../../output/swarm-resonance/verify-ui.mjs) passed sixteen check groups. Seven served source files matched the tested local hashes. All ten selections reused one WebGL context and produced different nine-second frames. No page or graphics errors were recorded.

- Play resumed the exact scrubbed positions 3.7, 12.34, and 17.5 seconds before advancing. Pause retained each position.
- Resumed-clock playback advanced from eleven to 12.88 seconds and changed rendered pixels. The short sample recorded 119 draws over 1,884 ms using the browser test clock; it is playback evidence, not a physical-device frame-rate benchmark.
- Playback stopped at twenty-two; the next Play restarted at zero. Formation restarted at zero and stopped at fifteen. Loop wrapped and remained active when switching concepts.
- Native selector groups contained five Organic and five Polyhedral entries. Keyboard navigation, accessible timeline updates, reference comparison, transparency grid, and selected PNG downloads passed.
- Desktop and 390-pixel mobile layouts had zero tested Axe violations. Mobile had no horizontal overflow and 15,146 visible alpha pixels after resizing. Reduced motion preserved the frame and suppressed pointer parallax.
- No-JavaScript and unavailable-WebGL fallbacks loaded the new posters. Fallback selection and downloads remained usable.

The [desktop](../../../../output/swarm-resonance/ui-desktop.png) and [mobile](../../../../output/swarm-resonance/ui-mobile.png) screenshots were visually inspected for readable controls, visible rendering, and overlap. JavaScript syntax and scoped Prettier checks passed. `pnpm docs:check` verified 46 public pages, 161 Markdown files, and 54 requirement evidence mappings. The local preview was restarted from `apps/web` using its existing isolated build to register new public files. Resonance, Emergence, Volumes, Manifolds, and the preserved surface collection returned HTTP 200. No application rebuild or video export was needed.

## Source and preservation

The [standalone source ZIP](../../../../output/swarm-resonance-source.zip) contains 36 files and is 41,880,252 bytes. Its SHA-256 is `0b568cc87b60ebc2f8c42a37bd678665063d18c0742d8fd072291405b9065d99`. The [package report](../../../../output/swarm-resonance/package-report.json) checks packaged runtime hashes against capture, renderer-regression, and UI evidence, and verifies exported PNG hashes. ZIP integrity and every packaged manifest hash were checked independently, including the standalone capture tool's paths. The [preservation report](../../../../output/swarm-resonance/preservation-after.json) confirms all 132 recorded earlier files and source archives remain byte-identical.

## Coverage boundary

Evidence applies to this local Chrome/Metal environment. It does not establish Safari/Firefox behavior, sustained frame pacing on physical devices, production hosting acceptance, or physical particle interactions. These are art-directed procedural structures with a shared field, not validated fluid, superconductivity, or neighbor-force simulations. Video remains deferred by user choice. The [marketing release checklist](../../../maintainers/TODO.md) retains final selection and deployed-device checks.
