# Swarm motion studies

The newer [manifold iteration](swarm-manifolds/README.md) explores stronger geometric definition and continuous changes to the whole surface in a separate folder, with a Play control that resumes from the scrubbed position. The collection and source archives described below remain preserved.

The current collection is at `/swarm-proof/surfaces.html`: eight revised surface arrangements plus the two preserved favorites, Crossed planes and Compressed folds. The approved continuous-flow version remains at `/swarm-proof/index.html`. It preserves the source artwork's 3:2 composition, irregular porous folds, fine filaments, and 40,000 points. Flat cyan-white and warm amber color combine with local particle density to create luminous regions. The live canvas is transparent; the preview offers black and a transparency grid.

The preview opens paused at nine seconds. The twenty-two-second sequence grows over roughly eight seconds, sustains continuous flow and folding until fifteen seconds, then disperses in a passing wind over five seconds. Two empty seconds precede the restart. **Play formation** runs through the first fifteen seconds and pauses; **Play 22 s loop** includes dispersal and restart. The timeline can inspect every phase. Mouse movement produces restrained parallax with a fixed camera. Reduced-motion preferences suppress parallax and automatic motion.

## Ten curved-surface variations

The [surface studio](../../../apps/web/public/swarm-proof/surfaces.html) presents one variation at a time. The selector, previous/next controls, and `?variation=<id>` links select Folded sheet, Saddle, Open vault, Twisted plane, Diagonal fold, Counterfold, Lifted edge, Crossed planes, Compressed folds, or Long arc. Switching preserves the current time and play state and reuses one canvas, point buffer, and WebGL context. Each variation has its own transparent still and poster; the original artwork and approved V3 remain available for comparison.

The [renderer](../../../apps/web/public/swarm-proof/surface-renderer.mjs) gives the eight revised studies different embeddings in all three axes. Their projected silhouettes change through sweeping folds, a saddle waist, an open arch, torsion, a diagonal crease, counter-curves, a returned edge, and a long rising arc. Local irregularity, density, palette, and fine particle rows come from the reference chart; its large holes no longer fix every silhouette. Neighboring rows share the surface deformation while each particle keeps its own travel phase, speed, and small tangent offsets. Perspective, depth testing, and restrained mouse parallax carry the depth cues. [Design notes](../../../output/swarm-lookdev/surface-design.md) describe the arrangements.

**Crossed planes and Compressed folds are preserved favorites.** Their original geometry, timing, point treatment, exit motion, and wind equations remain active through an original shader program, whose [GLSL source](../../../apps/web/public/swarm-proof/favorite-shaders.mjs) is preserved verbatim. Both programs share one context, point buffer, material chart, and textures. The eight revisions continue each surface section along its own endpoint tangent and retain its width and depth through the exit. They do not converge toward a shared outlet. Their longer offscreen travel interval avoids speeding particles into a short recycling corridor. Final wind release retains instantaneous velocity while adding divergent individual drift with a small shared bias.

These are art-directed three-dimensional deformations of a reference-derived chart. They do not recover the image's hidden geometry or simulate neighbor forces. Fine rows, stable curvature, and coherent fold motion supply the intended organization; no particle settles at a destination. The [configuration table](../../../apps/web/public/swarm-proof/surfaces.mjs) retains the names and selection links.

## Continuous flow and changing folds

The [preparation script](../../../output/swarm-lookdev/prepare.mjs) detects luminous point features in the artwork and fits their positions, colors, sizes, and local filament directions. The 1.92 MB point buffer remains the source geometry. The [material builder](../../../apps/web/public/swarm-proof/material.mjs) derives a geometric chart from the point distribution and parameterizes its paths by arc length. Density-weighted transport preserves the uneven visual distribution while uniformly spaced emission phases replenish the field. The [WebGL renderer](../../../apps/web/public/swarm-proof/renderer.mjs) continuously advances every identity through this shared field. Earlier emission cohorts travel farther along their paths; they do not ease to a final destination. A continuation beyond the reference crop lets particles leave the screen before recycling.

Incoming lanes fade fully into darkness at the left edge. Their geometry gradually blends into the folding field across most of the image width. Individual speed differences and transverse motion remain active throughout the sequence, while broad coordinated rotations, shears, and expansion modes change the folds and silhouette together. Inlet speed is calibrated to 1.5 times the prior early inflow; there is no timed slowdown or hold at ten seconds. Nine seconds is a crossing of the broad deformation modes near the reference pose.

From fifteen seconds, a staggered wind front releases neighboring layers at different times. Each released particle inherits its instantaneous flow and fold velocity, then bends toward the wind with individual dispersal. Layers that have not released continue flowing and folding. Staggered fades follow release age, with the canvas fully empty from twenty seconds until the twenty-two-second reset.

This is an art-directed **2.5D flow reconstruction**, not a physical particle-interaction simulation. A single image cannot reveal hidden surfaces or recover the true three-dimensional object. The material chart guides the paths and topology; it is not a sampled color image. No reference image texture is loaded by the particle draw. Its textures contain geometry, transport, and palette values derived from the fitted points. The source artwork remains available for comparison, and the earlier approved pose is preserved in `output/swarm-lookdev/approved-v1`.

## Rendering and delivery

The standalone [surface preview](../../../apps/web/public/swarm-proof/surfaces.html) uses the existing local web server without application or provider calls. Animation stops when paused, hidden, outside the viewport, or comparing the reference. Resolution adapts to measured frame intervals; pausing restores full detail. Deterministic exports use all 40,000 points. A still and readable notice remain available without JavaScript or WebGL. No package was added.

The live renderer is the preferred transparent web delivery. The [capture script](../../../output/swarm-lookdev/capture.mjs) produces 2880 × 1920 transparent and black-composited stills at nine seconds. A 1440 × 960 black H.264 review clip is configured for the full twenty-two-second sequence: 660 frames at 30 fps, with fast-start metadata and no audio. The V3 video export was interrupted during severe host memory pressure. The user selected delivery of the live animation and source package with video export deferred. Current public still assets use `current-v3-*` names. Earlier seven- and twenty-second videos remain separate and are not presented as this motion.

Capture settings are explicit:

```sh
node output/swarm-lookdev/capture.mjs --still-only --still-time 9 --prefix flow-v3 --backend metal
node output/swarm-lookdev/capture.mjs --video-only --black-only --width 1440 --height 960 --duration 22 --fps 30 --prefix flow-v3 --backend metal
node output/swarm-lookdev/verify-ui.mjs --backend metal
```

Capture requires the repository's installed Chromium/Playwright, Sharp, and local FFmpeg. These commands select the verified Metal backend on this Mac; omit `--backend metal` on other platforms. The capture checks that Metal is actually available instead of silently using software rendering. Omit `--black-only` for a transparent VP9 WebM alongside the black MP4. Alpha video is expensive to encode and transfer; the current motion review uses the transparent live renderer and PNG while video export remains incomplete. [Export notes](../../../output/swarm-lookdev/README.md) identify the current outputs and preserve prior masters.

The surface collection has its own [still capture script](../../../output/swarm-lookdev/capture-surfaces.mjs). It captures nine-second frames at 2880 × 1920 with alpha, plus 1440 × 960 WebP posters, using one Metal browser/context and serial PNG readback. It freezes and hashes the renderer, preserved shaders, configurations, material builder, and scene for the whole set. Run `node output/swarm-lookdev/capture-surfaces.mjs --ids 0,1,2,3,4,5,6,9` on this Mac to refresh the eight revisions while preserving the favorite image files. Omitting `--ids` captures all ten. Surface assets live in `apps/web/public/swarm-proof/surfaces/`. Video remains deferred; no movie is presented as a new surface variation.

## Source package

The ten studies have a separate [standalone source ZIP](../../../output/swarm-surfaces-source.zip) and [README](../../../output/swarm-surfaces-source/README.md). They run from a static HTTP server without Three.js, Next.js, or runtime npm dependencies. The renderer uses JavaScript, GLSL shaders, and native WebGL point sprites. The approved V3 package below remains unchanged.

The [standalone source package](../../../output/swarm-source/README.md) and [ZIP](../../../output/swarm-source.zip) include the WebGL renderer, material builder, point buffer, preview, reference, current still/poster, and portable preparation/export tools. It excludes the incomplete V3 video and older motion clips. Exact original preparation/export scripts and preview files are preserved alongside the portable copies. The package runs from a static HTTP server without Next.js or runtime npm dependencies. Its README explains the GLSL point-sprite pipeline, embedding API, dependencies for offline tools, and the web-video compression command.

The package preserves the extractor and point buffer verified during the previous packaging pass. Current packaging checks verify copied source bytes and archive hashes; [verification](verification.md) distinguishes available browser evidence from incomplete video export.

## Verification and acceptance

The user approved the V3 continuous-flow study and selected Crossed planes and Compressed folds as favorites. The other eight now form the revised review set, emphasizing clearly different surface arrangements and broader, less convergent exits. [Marketing verification](verification.md) owns measured results and remaining visual/device acceptance.

The earlier five procedural studies remain at `/concepts/swarm/motion`; their generic surface geometry did not meet the reference-fidelity target. Their [browser suite](../../../tests/browser/swarm-motion.spec.ts) and [real-time export suite](../../../tests/browser/swarm-motion-export.spec.ts) apply to that earlier implementation, not this proof.

Select a treatment and test it on the hosting deployment and representative Safari, Firefox, and physical mobile devices before promotion, as tracked in the [release TODO](../../maintainers/TODO.md).
