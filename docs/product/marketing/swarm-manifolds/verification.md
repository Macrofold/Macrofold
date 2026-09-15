# Swarm manifold verification

The [manifold study](README.md) is a separate static animation iteration. Verification covers its own renderer and controls; earlier collection evidence does not establish the new geometry's visual quality.

Local verification completed on 9 September 2026 with Chrome 152.0.7977.83 and ANGLE Metal on Apple M1 Pro. The [capture report](../../../../output/swarm-manifolds/final-captures/capture-report.json) and [UI report](../../../../output/swarm-manifolds/ui-report.json) bind their results to the delivered source hashes. The renderer hash is `eaa269d374760daec4f37fbf8e9da0799935239eeeff3fab3201234884c3cf06`; the variation catalog hash is `1badd7ac9c42796a17ea7dc004ca2d05254cbcf4fdd46ff5c41cdfe5685e67f9`.

## Visual and asset checks

All ten nine-second frames were rendered serially in one browser and visually reviewed. Ten 2880 × 1920 PNGs and ten 1440 × 960 WebPs decode with transparency and visible content. The PNGs total 23,213,653 bytes; the WebPs total 5,147,208 bytes. Live playback loads the shared point buffer and renderer, not the full still collection.

Crossed planes, Compressed folds, and Open vault were compared at eight, eleven, and fourteen seconds in the [geometry review](../../../../output/swarm-manifolds/review-v2/review-report.json). After removing unused configuration fields, the other seven received [final-source temporal captures](../../../../output/swarm-manifolds/final-temporal/review-report.json) at the same times. The reviewed poses show changing silhouette, curvature, and overlapping faces. Open vault retains full-body rotation; Compressed folds keeps separated tiers; Crossed planes changes its over/under junction.

Some transient views remain similar: Saddle and Diagonal fold have comparable rounded faces at nine seconds, and Twisted plane passes through a narrow edge-on pose before opening into an arch. These are design judgments from sampled frames, not evidence of an all-pairs perceptual test or a fluid/neighbor-force simulation.

## Playback and interface checks

The browser test passed with no page errors and one WebGL context across all ten selections. Each selection rendered a different nine-second frame while preserving the paused timestamp.

- Play immediately retained scrubbed positions of 3.7, 12.34, and 17.5 seconds, then advanced from each. Pause retained the resulting position.
- Real-clock playback advanced from eleven to 12.88 seconds with a changed pixel hash. Endpoint playback stopped at twenty-two seconds, and the next Play restarted at zero.
- Formation restarted at zero and stopped at fifteen; loop playback wrapped at twenty-two and remained active during selection changes.
- Keyboard selection, timeline scrubbing, Play, reference comparison, transparency grid, and selected PNG links passed.
- Desktop and 390-pixel mobile layouts had zero tested Axe violations. Mobile had no horizontal overflow. Reduced motion suppressed pointer parallax and retained a still frame.
- No-JavaScript and unavailable-WebGL fallbacks loaded the new posters; fallback selection and downloads remained usable.

The [desktop](../../../../output/swarm-manifolds/ui-desktop.png) and [mobile](../../../../output/swarm-manifolds/ui-mobile.png) screenshots were visually inspected. Syntax checks, the public documentation generator check, and local documentation-link validation passed. The existing local preview was restarted from its web-app directory so Next could register the new static folder; the new preview returned HTTP 200.

## Source preservation

The [new source archive](../../../../output/swarm-manifolds-source.zip) contains 35 files and is 30,797,713 bytes. Its SHA-256 is `3f32082c2a86f017900cfbea19de785d6cbcf8048a5a451ba854e45b29fec6a5`. ZIP integrity and every packaged manifest hash passed. The [package report](../../../../output/swarm-manifolds/package-report.json) verifies that source, images, and control evidence agree. The [preservation check](../../../../output/swarm-manifolds/preservation-after.json) confirms all 45 tracked earlier files, including four source archives, remain byte-identical.

Video remains deferred. No application build or provider/database execution was needed for these separate static files.

## Remaining coverage

Browser evidence applies only to the tested local graphics backend. It does not establish physical simulation, Safari/Firefox behavior, physical-device performance, or production hosting acceptance. The existing [marketing release TODO](../../../maintainers/TODO.md) retains those boundaries.
