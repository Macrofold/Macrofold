# Homepage Swarm playlist

The marketing hero can play all eleven approved Myriad videos sequentially at 1.3×. A native video player selects 960 × 640 for phones, smaller placements or reported slow connections, and 1440 × 960 for larger desktop placements. Each 25-second animation plays in about 19.2 seconds. The complete collection repeats after about three minutes and 32 seconds.

The original `apps/web/public/concepts/swarm.png` is preserved. It is archived in the codebase only and is never rendered or requested by the homepage. Loading, no-JavaScript, unavailable-media and blocked-autoplay states show the clear dark hero background. With no valid `MARKETING_MEDIA_BASE_URL`, the page remains static and makes no video requests. No MP4 files belong in Git or the normal app deployment.

## Prepared assets and storage

The dedicated R2 Standard bucket is `macrofold-marketing-media`. It is separate from the application's private worktree buckets. The approved MP4s and WebP posters use the immutable prefix `swarm/myriad/v1`: 22 videos and 22 posters, about 488 MB combined. Uploading assets does not enable public access or deploy the homepage.

The [media command](../../../../scripts/swarm-media.ts) reads the existing compressed export under `output/swarm-myriad-deploy`, hashes every file, and prepares an asset manifest. It uploads sequentially with MIME types, immutable cache headers and hash metadata, then verifies stored length and hash metadata. Re-running skips matching objects and refuses to overwrite different content under the same versioned key. It never modifies the private worktree buckets. A new media revision needs a new prefix.

```sh
# Inspect the local delivery; no remote changes.
pnpm media:swarm

# Upload or safely resume. Reads an ignored .env.swarm-media file.
pnpm media:swarm --upload
```

For another machine, provide `SWARM_R2_ENDPOINT`, `SWARM_R2_ACCESS_KEY_ID`, and `SWARM_R2_SECRET_ACCESS_KEY` in `.env.swarm-media`. Use a token restricted to Object Read & Write on the marketing bucket. These credentials are only for the upload command; the serving application needs only the public media URL. The local export files must also be available on that machine.

## Domain and deployment setup

1. Make the intended media domain's zone available in the same Cloudflare account as the bucket. If DNS is elsewhere, complete the appropriate Cloudflare zone setup while preserving all existing web and email records. The proposed host is `media.macrofold.ai`; any HTTPS media host can be configured instead.
2. In Cloudflare R2, open `macrofold-marketing-media` → Settings → Custom Domains → Add. Connect the media host and wait for it to become Active. Use this production custom-domain connection rather than an `r2.dev` development address.
3. In Cloudflare Cache Rules, ensure requests for this host under `/swarm/myriad/v1/` are eligible for caching and respect the uploaded Cache-Control headers. Keep the rule limited to these public assets. Verify cache hits after warming a file; do not apply public caching to app or customer endpoints.
4. Validate the actual public files with the command below. It checks all 44 files' MIME type, length and immutable cache policy, and actual 206 byte-range responses on all 22 MP4s. Results go to `output/swarm-site/public-verification.json`.
5. Set `MARKETING_MEDIA_BASE_URL` in the marketing site's Vercel project for the desired environments, then redeploy the reviewed application revision. Use the URL below with the final hostname. Next.js prerenders `/site`, so changing the environment setting alone is insufficient without a new build. No further source changes are necessary.

```sh
pnpm media:swarm --verify --base-url https://media.macrofold.ai/swarm/myriad/v1
```

```dotenv
MARKETING_MEDIA_BASE_URL=https://media.macrofold.ai/swarm/myriad/v1
```

For a dedicated marketing deployment without the application's database and identity configuration, also set `MARKETING_HOMEPAGE=true` and `APP_ORIGIN` to the marketing site's canonical HTTPS origin (`https://macrofold.ai` for the hosted site, with `www` redirected to the apex). This build-time setting rewrites `/` to the existing static `/site` page and enables its indexing, avoiding the dashboard's session lookup. Leave it unset on application and staging deployments so their signed-in homepage continues to work. It does not enable registration or application services; those need their own completed launch setup. Rebuild after changing these settings.

Public URLs go directly to the media host, without an application API proxy, database lookup, signing service or runtime bucket credentials. If a Content Security Policy is introduced, allow the media host in `media-src`. Plain cross-origin video playback does not require canvas access or a CORS-enabled fetch pipeline.

Official references: [R2 custom domains and caching](https://developers.cloudflare.com/r2/buckets/public-buckets/) and [video performance](https://web.dev/learn/performance/video-performance).

## Playback and integration

The [server page](../../../../apps/web/components/landing/site.tsx) passes the public media base into the [playlist component](../../../../apps/web/components/landing/swarm-playlist.tsx). [Playlist configuration](../../../../apps/web/components/landing/swarm-media.ts) owns order and speed. The order is Tetrarch, Hypercell, Aperiodic, Alveoli, Druse, Plexus, Coronet, Viscera, Thalassa, Chitin and Maelstrom, then it repeats from Tetrarch.

The [native controller](../../../../apps/web/components/landing/swarm-player.ts) keeps two reusable video elements and plays only one. It waits for current playback and sufficient buffering before preparing the next video; later studies have no assigned source. The outgoing black frame remains until the next video plays. The complete exported fade and reset interval are retained. There is no frame-by-frame React state update or live particle simulation.

The existing marketing Play/Pause control also controls the videos. Offscreen and hidden-tab playback pauses automatically, while explicit Pause survives return. Speculative next-video loading is cancelled while inactive; browsers may finish buffering already-requested portions of the active video. Muted inline playback starts automatically even when reduced motion or data saving is enabled; data saving selects the 960-pixel video. There is no hero Play prompt. If the browser itself refuses autoplay, the hero background stays clear. An ordinary tap, click, or keypress retries playback directly within that user gesture; the same path recovers from temporary media delivery failures. Explicit Pause remains respected. Browser restrictions such as Low Power Mode cannot be overridden by the page, so immediate autoplay still depends on the device policy. A failed desktop video retries at 960 pixels; unavailable studies are skipped with a bounded pass through the collection. An entirely unavailable collection clears both video layers.

The 3:2 videos use `object-fit: contain`; a gradual mask and light shading restrict the visible entrance to roughly the rightmost quarter of the copy width. The desktop artwork sits on the right with a 4% right inset and a soft right edge; the mobile composition centers the entire video width below the copy. Its top 25% overlaps the copy and fades from the page background; the lower 75% remains unshaded and supplies the additional hero height. Videos retain their encoded colors. Earlier live studios and all original artwork remain untouched.

## Local preview and checks

```sh
# Stages ignored copies of the compressed assets and opens a separate dev server.
pnpm preview:swarm
# Visit http://localhost:3347/site

pnpm exec vitest run tests/unit/swarm-media.test.ts
APP_ORIGIN=http://localhost:3347 MARKETING_MEDIA_BASE_URL=/swarm-media/myriad/v1 \
  pnpm exec playwright test tests/browser/swarm-hero.spec.ts
```

The existing preview on another port is preserved. Staged files are under ignored `apps/web/public/swarm-media/`; do not include them in a production deployment when using the CDN. Media-specific browser tests require this explicit fixture; ordinary application fixtures leave the hero background clear.

Watching the entire uncached collection transfers approximately 315 MB at desktop resolution or 171 MB at mobile resolution. At 1.3× the desktop average is about 12 Mbps; mobile averages about 6.5 Mbps. One-video-ahead loading improves startup and transitions but cannot remove this transfer cost. Check the deployed page on physical iPhone Safari, Android Chrome and a constrained connection. [Site verification](verification.md) distinguishes completed local checks from hosted acceptance.
