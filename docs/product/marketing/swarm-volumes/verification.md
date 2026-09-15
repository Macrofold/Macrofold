# Swarm volume verification

Local verification for the [volume collection](README.md) completed on 9 September 2026 with Chrome 152.0.7977.83 and ANGLE Metal on Apple M1 Pro. The [capture report](../../../../output/swarm-volumes/final-captures/capture-report.json), [motion review](../../../../output/swarm-volumes/final-motion-review/review-report.json), and [UI report](../../../../output/swarm-volumes/ui-report.json) bind their results to the delivered source. The renderer SHA-256 is `f6ab2d4db0118ab63959a47a0b9fe742a51c5d99f016b5690dff7db9665647f3`.

## Geometry and image checks

All ten studies were rendered at four, eight, eleven, fourteen, and seventeen seconds: fifty transparent 960 × 640 review frames with black composites. Visual review compared the organic bodies and polygonal solids across formation, sustained morphing, and dispersal. Cumulus changes its shoulders and clefts; Aperture and Vesicles change thick walls and openings; Sinew rearranges connected bulges. The polygonal studies change actual dimensions, face areas, intersections, and cap heights. These are sampled visual judgments, not a physical neighbor-force simulation or an all-pairs perceptual test.

The final ten nine-second stills were rendered and reviewed. All ten 2880 × 1920 PNGs and ten 1440 × 960 WebPs decode with visible content and alpha spanning zero to 255. PNGs total 18,391,641 bytes; WebPs total 4,686,678 bytes. [Publication verification](../../../../output/swarm-volumes/image-report.json) checked every asset and the four source hashes before copying the images into the new public folder. Live playback uses the shared particle data and renderer; the full still collection is not loaded for animation.

Depth-only geometry prevents rear and intersecting surfaces from showing through every foreground point gap. Polygonal edge particles follow actual support-plane intersections. Basalt received wider column spacing and a steeper view to expose its caps; it remains the sparsest geometric treatment. Organic surface brightness was increased after review so Vesicles' rear chambers and the incoming lattice remain visible.

## Playback and interface checks

The browser checks passed with no page errors, no WebGL errors, and one WebGL context across all ten selections. Both the particle pass and depth pass were exercised. Native selector groups contain five Organic and five Polyhedral studies, with ten different rendered nine-second frames.

- Play retained the exact scrubbed times 3.7, 12.34, and 17.5 seconds before advancing. Pause held the resulting frame.
- Real-clock playback advanced from eleven to 13.16 seconds with a changed pixel hash. Endpoint playback stopped at twenty-two; the next Play restarted at zero.
- Formation restarted at zero and stopped at fifteen. The loop wrapped at twenty-two and remained active when changing variations.
- Keyboard navigation, accessible timeline values, original-artwork comparison, transparency grid, and selected PNG links passed.
- Desktop and 390-pixel mobile layouts had zero tested Axe violations. Mobile had no horizontal overflow and rendered visible alpha after resize. Reduced motion preserved the frame and suppressed pointer parallax.
- No-JavaScript and unavailable-WebGL fallbacks loaded the new posters. Fallback selection and downloads remained usable.

The [desktop](../../../../output/swarm-volumes/ui-desktop.png) and [mobile](../../../../output/swarm-volumes/ui-mobile.png) screenshots were visually inspected. An initially blank mobile test capture was traced to fake-clock/ResizeObserver scheduling: ordinary real-clock resizing rendered correctly. The test now uses actual animation frames and requires nonempty alpha, preventing blank-frame equality from producing a false pass. No runtime workaround was needed.

JavaScript syntax, formatting, public documentation generation, and local documentation-link checks passed. The local preview was restarted from `apps/web` with the existing isolated build so Next could register the new static assets. The new collection and both preserved collections returned HTTP 200. No application build, provider execution, database action, or video export was needed.

## Source preservation

The [standalone source ZIP](../../../../output/swarm-volumes-source.zip) contains 35 files and is 25,493,748 bytes. Its SHA-256 is `b84128adf21b4159e284645c11c3872e076eaec59fabbf0641c6cbd2be3e1545`. ZIP integrity and every packaged manifest hash were checked. The [package report](../../../../output/swarm-volumes/package-report.json) verifies that the packaged runtime matches the capture and UI source hashes and that the PNGs match the rendered exports. The [preservation check](../../../../output/swarm-volumes/preservation-after.json) confirms that all 74 recorded earlier files, including previous runtime folders and source archives, remain byte-identical.

## Coverage boundary

Evidence applies to the tested local Chrome/Metal environment. It does not establish Safari/Firefox behavior, physical-device performance, production hosting acceptance, or a physical interaction simulation. Video remains deferred by user choice. The [marketing release checklist](../../../maintainers/TODO.md) retains those checks.
