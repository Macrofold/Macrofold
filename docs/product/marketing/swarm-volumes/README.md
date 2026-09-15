# Swarm volume studies

The collection at `/swarm-volumes/index.html` explores ten substantial three-dimensional particle structures. Five organic bodies change their anatomy and openings; five polygonal studies change the proportions and facets of closed solids. The earlier [manifold collection](../swarm-manifolds/README.md) and [surface studies](../swarm-motion.md) remain separate and unchanged.

## Concepts

The next [Swarm Emergence collection](../swarm-emergence/README.md) explores diffuse formation and regional reorganization in a new folder. This volume collection remains preserved.

| Group      | Study            | Form and motion                                                             |
| ---------- | ---------------- | --------------------------------------------------------------------------- |
| Organic    | Cumulus          | A lobed body changes its shoulders, clefts, and proportions.                |
| Organic    | Confluence       | Connected masses exchange volume across thick necks.                        |
| Organic    | Aperture         | A thick annular body changes its opening and asymmetry.                     |
| Organic    | Vesicles         | Interconnected chambers form a changing porous mass.                        |
| Organic    | Sinew            | Substantial braided volumes change their alignment and cross-section.       |
| Polyhedral | Cut crystal      | Corner cuts grow and recede across a solid block.                           |
| Polyhedral | Cubic growth     | Intersecting blocks change their dimensions and relationships.              |
| Polyhedral | Basalt           | A compact cluster of hexagonal columns changes cap heights and proportions. |
| Polyhedral | Tetrahedral core | Interlocking tetrahedral solids change their vertices and clipped tips.     |
| Polyhedral | Rhombic mass     | A twelve-face body changes facet areas and develops square truncations.     |

## Playback and delivery

The selector groups the five organic and five polyhedral concepts, showing one at a time. Selection changes preserve time and playback. Drag the timeline, then press **Play** to continue from that point. Formation explicitly restarts at zero and stops at fifteen seconds; the loop includes the complete twenty-two-second sequence. Pointer parallax, Pause, reduced motion, transparent rendering, original-artwork comparison, and static fallbacks remain available.

Particles stream from dark off-left lanes into a moving body and leave different locations on its far side. Geometry changes continuously while particles travel. Staggered wind release begins at fifteen seconds, carrying particle momentum into dispersal; twenty to twenty-two seconds are empty. The preview starts paused at nine seconds.

The [runtime folder](../../../../apps/web/public/swarm-volumes) is self-contained. It uses 40,000 native WebGL point sprites without runtime npm dependencies. The original point buffer supplies palette and sprite sizes; new stratified material coordinates and the [shape definitions](../../../../apps/web/public/swarm-volumes/shapes.mjs) produce the volumes. This collection does not deform the old image-derived sheet. Closed geometry also supplies an invisible depth pass so rear or intersecting surfaces do not obscure foreground faces through gaps between dots. A subset of the polygonal particles follows actual moving facet intersections to define edges while the remaining particles fill the faces and volume.

The bodies are procedural, art-directed forms with changing geometry, not recovered hidden geometry or a physical neighbor-force simulation. Points are abstract and do not count real agents. Rendering adapts resolution and point count to observed frame pacing, restores full detail when paused, and suspends unseen work.

Ten transparent 2880 × 1920 stills and 1440 × 960 WebP posters accompany the live collection. [Capture and packaging tools](../../../../output/swarm-volumes/README.md) record source hashes and preserve previous artifacts. The [standalone source ZIP](../../../../output/swarm-volumes-source.zip) contains the complete runtime and data; video remains deferred. [Verification](verification.md) records actual local checks and remaining device coverage.
