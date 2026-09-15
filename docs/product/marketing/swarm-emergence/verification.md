# Swarm Emergence verification

Local verification for the [Emergence collection](README.md) completed on 9 September 2026 with Chrome 152.0.7977.83 and ANGLE Metal on Apple M1 Pro. The [motion review](../../../../output/swarm-emergence/final-motion/review-report.json), [still captures](../../../../output/swarm-emergence/final-captures/capture-report.json), and [UI report](../../../../output/swarm-emergence/ui-report.json) bind results to their source snapshots. The renderer SHA-256 is `3e29d2dc9b4557e6d6ac0e41a175ff17d140a06467473449f14607bbd27c89f4`; the shape definitions SHA-256 is `4695ff543c8180adc69be8ca27cc835b8d4d0af9df9a658e33bc512585fff873`.

## Formation, geometry, and images

All ten concepts were rendered at zero, three, five, seven, nine, twelve, fourteen, seventeen, nineteen, and twenty-one seconds: 100 transparent 960 × 640 frames with black composites. Every render completed without a WebGL error. All ten frames have different pixel hashes at each nonempty sampled time. Zero and twenty-one seconds are fully transparent. These checks establish rendered differences, not a perceptual claim that every pair is equally distinct.

Sampled visual review found a broad unsettled field during formation, with no visible narrow attachment seam. The mature organic studies retain curved skins, cavities, and oblique compartments while different regions become diffuse. Polygonal studies retain several changing faces and edges. Late breakup leaves uneven structural fragments within broadly dispersing dust. Fracture at fourteen seconds is comparatively sparse; the collection intentionally permits selected regions to lose definition while neighboring ones remain organized. These are art-directed forms and sampled visual judgments, not evidence of a physical neighbor-force simulation.

All ten final nine-second stills were visually reviewed. Ten 2880 × 1920 PNGs and ten 1440 × 960 WebPs decode with visible content and alpha spanning zero to 255. PNGs total 25,012,599 bytes; WebPs total 5,580,558 bytes. The [publication report](../../../../output/swarm-emergence/image-report.json) checks dimensions, transparency, metadata IDs, and current runtime hashes before publishing. Live animation loads shared particle data and code; the still collection is not loaded for playback.

## Interface and playback

The [browser verifier](../../../../output/swarm-emergence/verify-ui.mjs) passed fourteen check groups. Seven served source files matched local hashes before testing and remained unchanged afterward. All ten selections reused one WebGL context; no page or graphics errors were recorded.

- Play resumed the exact scrubbed positions 3.7, 12.34, and 17.5 seconds before advancing. Pause retained each resulting position.
- Real-clock playback advanced from eleven to 12.89 seconds and changed rendered pixels.
- Playback stopped at twenty-two; the next Play restarted at zero. Formation restarted at zero and stopped at fifteen. Loop wrapped and remained active when switching concepts.
- Native selector groups contained five Organic and five Polyhedral entries. Keyboard navigation, accessible timeline updates, reference comparison, transparency grid, and selected PNG downloads passed.
- Desktop and 390-pixel mobile layouts had zero tested Axe violations. Mobile had no horizontal overflow and 10,849 visible alpha pixels after resizing. Reduced motion preserved the frame and suppressed pointer parallax.
- No-JavaScript and unavailable-WebGL fallbacks loaded the new posters. Fallback selection and downloads remained usable.

The [desktop](../../../../output/swarm-emergence/ui-desktop.png) and [mobile](../../../../output/swarm-emergence/ui-mobile.png) screenshots were visually inspected for readable controls, overlap, and visible rendering. JavaScript syntax and formatting passed. `pnpm docs:check` verified all 46 public documentation pages, then reported one unrelated untracked document, `docs/engineering/documentation/api-documentation-principles.md`, as unreachable from the documentation index. It reported no Emergence link or reachability failures; that unrelated document was left unchanged. The local preview was restarted from `apps/web` using its existing isolated build, registering the new public files. Emergence, Volumes, Manifolds, and the preserved surface collection returned HTTP 200. No application rebuild or video export was needed.

## Source and preservation

The [standalone source ZIP](../../../../output/swarm-emergence-source.zip) contains 35 files and is 33,133,694 bytes. Its SHA-256 is `507d81c0c22eae7b9bb546ca665cf1c4ebe4d2504d53033de7681e3911267519`. ZIP integrity and every packaged manifest hash were checked, including the standalone capture tool's paths. The [package report](../../../../output/swarm-emergence/package-report.json) binds the packaged runtime to capture and UI evidence and checks the exported PNG hashes. The [preservation report](../../../../output/swarm-emergence/preservation-after.json) confirms all 103 recorded earlier files and source archives remain byte-identical.

## Coverage boundary

Evidence applies to this local Chrome/Metal environment. It does not establish Safari/Firefox behavior, sustained frame pacing on physical devices, production hosting acceptance, or physical particle interactions. Video remains deferred by user choice. The [marketing release checklist](../../../maintainers/TODO.md) retains final selection and deployed-device checks.
