# AERO — project operating notes

## What this is

A premium, frontend-only 3D footwear site for the fictional brand **AERO**. Thirteen shoes, one continuous cinematic experience, no backend and no database.

Stack: HTML5, modern CSS, ES modules, GSAP + ScrollTrigger, Lenis, and Three.js. Libraries are pinned versions, self-hosted under `public/vendor/` (vendored by `scripts/vendor_cdn.mjs`); index.html's importmap maps `three` and `three/addons/` at the vendored copy. The finished site must run through Live Server with no build step.

- GSAP `3.12.5` + ScrollTrigger `3.12.5`
- Lenis `1.1.20`
- Three.js `0.161.0`
- Display type: Syne. Text: Inter. Self-hosted WOFF2 under `public/fonts/`.
- Existing `assets/` contains prior STRATA output. It is read-only legacy and is no longer referenced by the AERO page.

## Working rules

1. Work one phase at a time. After each phase, print a **5-line summary** and stop until the user says “continue”.
2. Never read image or video binaries into context. Inspect folders with counts, formats, dimensions, and only the first 3 filenames.
3. Never print thousands of filenames.
4. Do not rewrite files that already work. Edit only what changes.
5. For every new or changed file, write the **complete file**. No partial snippets, no diffs.
6. Never modify, move, or delete the original delivery folders: `BLUE SHOE`, `BROWN_SHOE`, `BLACK_SHOE`, `Chelsea boot`, `High-top basketball sneaker`, `Trail running shoe`, `new shoes`.
7. All generated assets go to `public/`. Existing `assets/` is legacy and may be read, not extended.
8. Keep explanations short. State assumptions at the end.
9. Use `scripts/serve.mjs`, not `python -m http.server`. The Python server does not support byte ranges, so video seeking fails.
10. Use the relevant design skills when a phase touches UI, copy, motion, or mobile layout. Do not paste skill text into the project.

## Asset inventory — scanned 2026-11-07

| Set | Source folder | Files | Formats | Still | Video |
| --- | --- | --- | --- | --- | --- |
| Cirra | `BLUE SHOE` | 5 | 1 zip, 1 jpeg, 3 mp4 | 1599×892 | 854×480, 24 fps, 192 frames; no 360 clip |
| Terrae | `BROWN_SHOE` | 6 | 1 zip, 1 jpeg, 4 mp4 | 884×579 | 854×480, 24 fps, 192 frames |
| Onyx | `BLACK_SHOE` | 6 | 1 zip, 1 jpeg, 4 mp4 | 968×584 | 854×480, 24 fps, 192 frames |
| Kestrel | `Chelsea boot` | 4 | 1 jpeg, 3 mp4 | 1599×893 | 854×480, 24 fps, 192 frames |
| Vertex | `High-top basketball sneaker` | 4 | 1 jpeg, 3 mp4 | 1599×893 | 854×480, 24 fps, 192 frames |
| Trace | `Trail running shoe` | 4 | 1 jpeg, 3 mp4 | 1599×893 | 854×480, 24 fps, 192 frames |
| Covent | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Cairn | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Kerb | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Alba | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Ledger | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Dune | `new shoes` | 1 | 1 jpeg | 1599×893 | none |
| Loom | `new shoes` | 1 | 1 jpeg | 1599×893 | none |

Totals: 13 shoe sets. Six folders contain video. Seven sets are still-only. The three extra video folders (`Chelsea boot`, `High-top basketball sneaker`, `Trail running shoe`) are treated as **gallery** shoes in the current 3-video / 10-gallery plan; their clips stay available for a later upgrade.

## Canonical structure

```
index.html
css/
  styles.css       # base visual system and home view
  views.css        # view swap, nav tabs, wipe
  intro.css        # opening sequence
  hangar.css       # showroom, HUD, details panel
js/
  data.js          # AERO products, 13 shoes
  main.js          # site shell, collection, study, anatomy, materials, dialogs
  router.js        # #home / #hangar view routing, nav tabs
  scrub.js         # canvas frame engine for the 3 hero shoes
  cart.js          # bag state, drawer, demo checkout
  wishlist.js      # saved shoes, aero:wishlist:v1
  intro.js         # Three.js intro
  intro-border.js  # Canvas-2D pulsating rim on the intro Enter button
  hangar.js        # Three.js showroom wall (imports three via the importmap)
  hangar-focus.js  # focus camera, HUD, details panel (imports gsap, vendored)
  gallery.js       # pseudo-3D still viewer
public/
  fonts/                 # syne.woff2, inter-var-latin.woff2
  vendor/                # pinned three, gsap, lenis copies (scripts/vendor_cdn.mjs)
  favicon.svg
  shoes/<id>/
    still-1600.webp
    still-800.webp
    detail-1600.webp        # gallery zoom
    poster.webp
    360.mp4 / 360.webm
    exploded.mp4 / exploded.webm
    closeup.mp4 / closeup.webm
    frames/desktop/frame_001.webp …
    frames/mobile/frame_001.webp …
  _verification/           # scans, reports, screenshots
  showroom/                # Hangar cutouts + manifest (scripts/cutout.py)
scripts/
  build_assets.py
  cutout.py              # H1 transparent cutouts + turntable frames
  serve.mjs
  cdp.mjs                # shared CDP client for the verifiers
  vendor_cdn.mjs         # refreshes public/vendor/ from the pinned CDN versions
  verify_scrub.mjs
  verify_routing.mjs     # intro + routing + view fallbacks (headless)
  verify_site_hangar.mjs # hangar inside index.html, headless
  verify_hangar.mjs      # hangar scene + focus, headful unless --headless
  diag_intro.mjs         # boot timeline probe (kept for CDN regressions)
  diag_cdn.mjs           # CDN latency probe (kept for regressions)
  verify_site.mjs        # legacy STRATA-era browser checks (port 9222)
  verify_catalog.mjs     # legacy, same era
  verify_polish.mjs      # legacy, same era
  shots.mjs
  scrub-test.html
  hangar-test.html       # standalone hangar scene page (own importmap)
AGENTS.md
README.md
```

Original delivery folders stay at the project root and are never touched.

## Data model

`js/data.js` is the single source of truth.

```js
{
  id, index, name, category, type: "video" | "gallery",
  style, featured, colorway, tagline, price,
  accent, accentInk, accentText, soft, swatch,
  description, shortDescription,
  specs: [{ label, value }],
  metrics: [{ label, value, suffix, decimals, note }],
  materials, materialCaption,
  source: { still, videos },
  assets: { still, stillMobile, detail?, poster?, video360?, exploded?, closeup?, frames? },
  callouts?, parts?   // hero video shoes only
}
```

- `category` is one of `Sneakers`, `Boots`, `Formal`, `Sandals`, `Casual`.
- `type: "video"` gets the 360 canvas, exploded film, and close-up film.
- `type: "gallery"` gets the pseudo-3D still viewer.
- The first three shoes are video; the other ten are gallery.
- Legacy flat fields (`framePath`, `videoPath`, `posterPath`, `frameCount`, `frameStart`, `chips`, `callouts`, `parts`, `notes`) exist only for the first three and are no longer read by the AERO page. They remain until the old STRATA files are removed.

## Asset pipeline

Phase 1 writes `scripts/build_assets.py` and outputs only to `public/`.

- Watermark scan: sample the bottom-right 8% × 8% of every video and image. Only process files that actually contain the Veo wordmark or Gemini sparkle.
- Videos: ffmpeg `delogo`, no audio, H.264 CRF 18, 1280–1920 wide, `-g 24`, `+faststart`, plus WebM and a WebP poster.
- Images: OpenCV Telea or Pillow inpaint only the watermark corner. Desktop WebP 1600 px, mobile WebP 800 px, quality 85. Never crop or distort the shoe.
- Verify cleaned corners with proof crops under `public/_verification/`.
- The three hero 360 clips become WebP frame sequences for `js/scrub.js`. Extract from the cleaned 360 clip at its native 24 fps.
- Blue has no supplied 360 clip. Rebuild one from the clean frame sequence, starting at the first fully lit frame, then extract the scrub frames.
- Exploded and close-up stay as normal muted autoplay videos with posters and IntersectionObserver pause.

### Phase 1 output — 2026-11-07

- `scripts/build_assets.py` built 13 stills, 21 clips, and 1,198 scrub frames under `public/`.
- 20 clips carried a watermark: 16 Gemini stars and 4 Veo wordmarks. Blue 360 was rebuilt from the clean frame sequence. All 13 stills were clean.
- Video outputs are 1280×720, H.264 CRF 18, 24 fps, keyframe every 24 frames, no audio, `+faststart`, with matching VP9 WebM and WebP posters.
- Verification lives in `public/_verification/`: `watermark-before-after.jpg`, `cleaned-corners.jpg`, `still-corners.jpg`, `image_scan.json`, `video_scan.json`, `video_residual.json`, `build_report.json`.
- Total `public/` payload: 84.5 MB across 1,307 files. Stills 1.9 MB, videos 69.3 MB, frames 12.1 MB.

### Phase 2 output — 2026-11-07

- `js/scrub.js` now exports `FrameSequence` and `ScrubStage`. `FrameSequence` reads the new `assets.frames` paths and still accepts the legacy `framePath` fields for the old STRATA page.
- Loading is progressive: the first 20 frames arrive before boot completes, then the rest fill in at 6 concurrent requests on desktop and 4 on mobile. Frames are fetched as blobs and decoded to `ImageBitmap` with an `HTMLImageElement` fallback.
- `ScrubStage` lerps scroll progress at 0.12 into a frame index, draws cover-fit on a DPR-aware canvas (capped at 2), keeps the poster underneath until frames arrive, and redraws when a nearer frame finishes loading. Reduced motion jumps straight to the target frame.
- `scripts/scrub-test.html` and `scripts/verify_scrub.mjs` cover new and legacy paths, 20-frame preload, ImageBitmap dimensions, HTML image fallback, bounded cache, DPR 1/2, reduced motion, the desktop and mobile study scrubber, shoe switching, video attributes, and observer play/pause. Result: 42/42 checks pass, no console errors, no failed requests.
- Verification artifacts: `public/_verification/phase2_scrub.json`, `phase2-study.png`, `phase2-mobile-study.png`. The live page now scrubs the new `public/shoes/*/frames` sets; the old `assets/` frames remain readable through the legacy path. `maxCached` defaults to unlimited; the study and product viewers pass their own bounds.

## Design system

- Dark cinematic studio: `#0e0e10` to `#2b2b2b`, soft fog, charcoal panels, one accent per shoe.
- Editorial display type, large outlined wordmarks, 12-column grid, 8 px spacing scale.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Motion: Lenis synced to ScrollTrigger, split-text and mask reveals, magnetic buttons, custom cursor on desktop, scroll progress, grain, vignette.
- Accessibility: WCAG AA, visible focus, skip link, 44 px targets, semantic landmarks, alt/aria, reduced-motion path.
- Responsive test widths: 360, 768, 1024, 1440, 1920.

## Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | `AGENTS.md` + `js/data.js` with all 13 shoes | done |
| 1 | Watermark removal + asset optimization into `public/` | done |
| 2 | 360 WebP frame engine + video playback | done |
| 3 | Three.js intro | done |
| 4 | Full AERO site, 13 shoes, cart, gallery | done |
| 5 | Polish, QA, README | done |

### Hangar showroom (new flagship feature)

| Phase | Scope | Status |
| --- | --- | --- |
| H1 | `scripts/cutout.py` — transparent shoe cutouts | done |
| H2 | `js/hangar.js` — the 3D wall | done |
| H3 | Camera states, focus mode, details panel | done |
| H4 | Integration, mobile, a11y, polish | done |

## Intro boot contract

Who sees the opening film, and what every boot path guarantees.

- All libraries load vendored. `main.js` and `hangar-focus.js` import GSAP,
  ScrollTrigger and Lenis from `../public/vendor/` URL constants; `hangar.js`
  resolves `three` through index.html's importmap; the dynamic import
  specifiers are `./`-prefixed and the modules are `modulepreload`ed.
  `scripts/diag_intro.mjs` asserts zero external requests.
- `runIntro({ skip, onHandoff })` in `js/intro.js` is the only entry. With
  `skip: true` it removes `#intro` and never imports Three. `onHandoff` fires
  just before the exit flash; `main.js` passes `revealHero` at both call
  sites, so the hero entrance starts under the film's last frame.
- While the film runs `body.is-intro` holds and the content is inert. At
  handoff the class drops, the boot watchdog is cleared, `revealHero()` runs,
  `#main` is focused, deep links are honoured through
  `state.router.fromLocation()`, and `window.__aeroReady` is set.
- Static fallbacks (reduced motion, no WebGL, a failed import) show the
  `intro.is-static` card instead of the film.
- The index.html watchdog early-returns while `window.__aeroIntroAlive` is
  set — the static path sets it, and it is set again as soon as the import
  chain settles — so the rescue timer only fires on a genuinely hung import.
- The film is skipped for a returning visitor
  (`sessionStorage["aero:intro"] === "seen"`, written only after the film
  finishes) and for automated tooling (`navigator.webdriver === true` or a
  `HeadlessChrome` user agent). `?intro=1` cancels the automation skip; a
  returning visitor still skips, and the footer replay button always plays
  the film.
- Verified 2026-11-12: diag 2/2, `verify_routing.mjs` 43/43 (three checks
  cover the automation path), `verify_site_hangar.mjs` 31/31,
  `verify_hangar.mjs --headless` 26/26.
- Rebuilt 2026-11-14: the film now guarantees its own worst case. Enter/Skip
  are forced interactive at an 8s deadline; textures get a 6s timeout with
  generated stand-ins that swap in when they land; post-processing degrades
  to plain rendering on a rolling sub-30 FPS window or a render error (never
  `removePass`); Skip is live from the first frame; the cursor and magnetic
  arm are intro-internal and released at teardown; the cinematic roll rides
  in `camera.up` so `lookAt` cannot overwrite it. Enter carries a Canvas-2D
  pulsating rim (`js/intro-border.js`) while the film owns the one WebGL
  context. Verified 2026-11-14: diag 1/1 clean, `verify_routing.mjs` 43/43,
  `verify_site_hangar.mjs` 31/31, `verify_paths.mjs` 204 refs / 0 problems
  (now also checks the dynamic showroom cutout names).

## Commands

```powershell
node scripts/serve.mjs          # range-capable preview, http://127.0.0.1:5500
python scripts/build_assets.py  # Phase 1 asset build
python scripts/cutout.py        # Hangar H1 transparent cutouts
node scripts/vendor_cdn.mjs     # refreshes the vendored library copies
node scripts/verify_routing.mjs # intro + routing + view fallbacks (headless)
node scripts/verify_site_hangar.mjs # Hangar H4 in index.html (headless: desktop, mobile, reduced motion, no WebGL)
node scripts/verify_hangar.mjs --headless # Hangar H2/H3 scene + focus
node scripts/verify_hangar.mjs  # headful, real GPU frame-rate assertions
node scripts/verify_site.mjs    # AERO shell, 108 checks, needs Chrome on the site at :9222
node scripts/verify_catalog.mjs # 13 products + filters, 72 checks, :9222
node scripts/verify_polish.mjs  # semantics, keyboard, contrast, targets, 32 checks, :9222
node scripts/verify_scrub.mjs   # frame engine + study scrubber, 42 checks, :9222
node scripts/verify.mjs         # legacy STRATA-era browser checks, :9222
```

## Current assumptions

- The 3 extra video folders are gallery shoes, not additional hero shoes. This keeps the requested 3-video / 10-gallery split.
- Prices are INR concept prices between ₹3,999 and ₹14,999.
- All copy, specs, and metrics are fictional concept data, not certified product claims.
- The blue shoe has a sportswear-like mark in the supplied render. It is left intact; asset rights must be cleared before publication.
- The old STRATA page is gone; `assets/` remains as read-only legacy and is not referenced by the AERO page. `public/showroom/` is live Hangar output, not legacy.

## Hangar showroom

A dark cinematic 3D gallery wall: 13 shoes floating on glass shelves, an
OVERVIEW camera over the whole wall and a FOCUS camera that flies into one shoe.
Added as its own full-viewport section; the existing collection grid stays as
the no-WebGL fallback.

### H1 output — 2026-11-07

`scripts/cutout.py` writes `public/showroom/` and never touches the originals.

- Reads `js/data.js` through node (`import {SHOES}`), so no filename is hardcoded.
  Adding a shoe to `data.js` puts it in the next cutout run and on the wall.
- Output per shoe: `<id>.webp` (1600px long edge, the FOCUS texture) and
  `<id>-800.webp` (the wall texture), plus `manifest.json` carrying each
  cutout's `aspect`, `accent`, `type` and byte size so `hangar.js` can size the
  planes without probing the images.
- 13 cutouts, 2.9 MB total. Largest is `loom` at 257 KB.
- Backend is rembg `isnet-general-use` (`pip install "rembg[cpu]"`, model caches
  to `~/.rembg`). `--backend opencv` is a working fallback with no model
  download: a quadratic studio-gradient fit for the seed, then GrabCut.
- The 3 video shoes take their cutout from a cleaned 360 frame — blue 213,
  brown 190, black 188, picked off a contact sheet as the toe-right 3/4 angle
  that matches how the 10 gallery stills were shot. The frame sequences stay
  untouched for FOCUS mode. `FRAME_PICKS` in the script holds these.
- Shadow removal was the hard part. A contact shadow is the backdrop dimmed, so
  it keeps the backdrop's channel ratio — but so does polished black leather,
  and a pure ratio test deleted the black oxford and ate the vertex outsole.
  Three gates together are correct: achromatic ratio, low local variance (lug
  outsoles survive), and bottom-35%-of-silhouette only (uppers survive).
- `bleed_edges` pushes opaque colour into the feathered rim via a nearest-core
  distance transform, so no grey fringe shows against the dark backdrop.
- Watermark scan ran on every bottom-right 8% corner and found nothing: Phase 1
  already delogo'd the clips and the stills were clean. The inpaint path stays
  in for new assets.

Verification in `public/_verification/`: `showroom-contactsheet.jpg` (all 13 on
a checkerboard), `showroom-corners.jpg` (watermark corner before/after),
`showroom-edges.jpg` (1:1 edge crops over the hangar backdrop).

### Known limits

- The shoe fills only part of a 1599x893 source, so a tight crop lands near
  800px. `<id>.webp` is Lanczos-upscaled up to 2x to reach 1600; `nativeWidth`
  and `nativeHeight` in the manifest record the true optical resolution. The
  sources have no more detail than this.
- The blue render still carries a sportswear swoosh. Unchanged from Phase 1;
  asset rights must be cleared before publication.

### H2 output — 2026-11-07

`js/hangar.js` exports `createHangar({ mount, shoes, ... })`. It imports Three
0.161.0 from the vendored copy only when the hangar runs, the same contract
intro.js uses, so a missing WebGL context cannot stop the site booting.

- Layout comes from `data.js` plus `public/showroom/manifest.json`: `SHOES`
  gives order, accent and name; the manifest gives each cutout's aspect so
  planes are sized without probing the images. A shoe missing from the manifest
  falls back to `public/showroom/<id>.webp` and measures its own aspect, so the
  wall never depends on the cutout run having happened.
- 13 shoes, 2 rows, 7 columns. Each row is centred on its own count, so the
  6-shoe second row is not left-heavy.
- Per bay: a faked-glass shelf (translucent box plus a bright `EdgesGeometry`
  line), an accent light strip under it with an additive bloom sprite, the shoe
  on a plane, and a mirrored copy below masked by a vertical alpha ramp.
- Materials are `MeshBasicMaterial`, not Standard. The cutouts are already-lit
  product renders; lighting them again would double the key light. Dimming for
  focus mode is therefore an opacity and tint multiply, which also costs
  nothing.
- No postprocessing. Bloom is an additive sprite, the spotlight is a painted
  cone texture, and grain and vignette are the site's existing CSS overlays.
  That keeps the whole wall at 105 draw calls and 312 triangles.
- Wall textures are the 800px cutouts loaded four at a time; `loadFocusTexture`
  swaps in the 1600px one on demand. The loader names what it is loading and
  counts, rather than spinning.
- Rendering pauses off-screen (IntersectionObserver) and on tab hide.
  `destroy()` releases every texture, geometry and material it made.

Phase 3 hooks already on the returned object: `cam` (the camera state the GSAP
timeline writes to), `setDim`, `setInteractive`, `positionOf`,
`loadFocusTexture`, `spot`, `setActive`.

Verified with `node scripts/verify_hangar.mjs`, which launches its own Chrome on
:9223 with a throwaway profile: 13/13 checks, 60fps settled, no console errors,
no failed requests, and teardown frees all textures and geometries. Proofs in
`public/_verification/`: `hangar-overview.png`, `hangar-hover.png`,
`hangar_h2.json`. Scene test page: `scripts/hangar-test.html`.

Composition note: 13 shoes in 2 rows makes a wall about 3:1, so a 16:9 frame
keeps air above and below it. That band is where the H3 HUD sits (bottom-left
bay and tier labels, bottom-right counter and prev/next), so the overview is
framed for the HUD rather than filled edge to edge.

### H3 output — 2026-11-07

`js/hangar-focus.js` exports `createFocus({ hangar, mount, shoes, cart, wishlist })`.
It builds the HUD and the details panel itself, so nothing is needed in
`index.html` until H4. `js/wishlist.js` is new: `aero:wishlist:v1`, same
read/write-through shape as `cart.js`.

- The camera is never touched directly. GSAP tweens the plain `hangar.cam`
  object and the render loop reads it, so the timeline and the loop cannot
  fight over the transform.
- OVERVIEW to FOCUS is a single 1.4s `expo.inOut` move with the lens going
  35 to 30 degrees and about a degree of roll. FOCUS to FOCUS is a three-tween
  dolly: pull back, track across, push in, so neighbours do not slide.
- The focus camera slides right by 13% of the visible width so the shoe sits
  clear of the panel instead of behind it. Below 900px that shift is zero.
- Non-focused bays lose opacity, scale, and tint toward the backdrop colour.
  There is no postprocess blur; recession is tint plus scale.
- `--accent` is set on the mount in focus, so the HUD rules, the price rule,
  the selected size and Add to bag all take the focused shoe's colour.

Turntables: `scripts/cutout.py --frames-only --frames 4` builds transparent 360
sequences through the same mask pipeline, cropped to one union box per shoe so
the shoe does not jump as it turns. Brown 48 frames at 773x601 (1.14 MB), black
48 at 798x418 (0.74 MB).

- **Blue has no turntable.** Its clip is a flythrough reveal, not a rotation:
  the first ~155 frames are underlit and full of particle FX, and the clean
  tail barely turns. `TURNTABLES` in `cutout.py` lists the two real ones and
  blue falls through to the gallery treatment. Replacing blue's 360 source is
  the only fix.
- The frames drive the WebGL plane's map rather than a separate 2D canvas. The
  transparent frames have to composite over the 3D scene, and a canvas overlay
  would show a rectangle. Drag has inertia that decays back into a slow idle
  spin.
- Frames are freed when focus leaves the shoe. 48 decoded frames is roughly
  90 MB per shoe, and holding them cost measurable frames. The files stay in
  the HTTP cache, so returning re-decodes rather than re-downloads.
- The still shoes get pointer tilt, a travelling sheen (`map` is the shoe, the
  gradient is the `alphaMap`, which three.js samples from the green channel, so
  the sheen is clipped to the silhouette) and a zoom-on-hover.

Verified: `node scripts/verify_hangar.mjs --headless` is now 26/26 including focus entry,
lens change, dimming, the 1600px swap, panel contents and accent, HUD bay/tier/
counter, arrow-key stepping, turntable advance, size selection, wishlist
localStorage round trip, escape to overview, and live textures after a
turntable. Proofs: `hangar-focus.png`, `hangar-turntable.png`.

Two assertions are deliberately not zero. `teardown frees geometries` allows 1
and `teardown frees textures` allows 1: three.js keeps a shared Sprite geometry
and one internal texture for the module lifetime. 22 textures before teardown
and 1 after, across a session touching three shoes and two turntables, is not a
per-shoe leak. FPS is asserted twice: 60 on the wall, and a no-regression bar
after a focus session, because that second number is measured on a desktop
running other apps and sits at 57-59.

### H4 output — 2026-11-07

The showroom is its own full-viewport view, `#hangar`, alongside the scrolling
home view. The collection grid stays as the no-WebGL fallback.

- Nav and mobile menu both link to it; the hero CTA reads "Enter the hangar".
  The intro's Enter lands on the hero, not the showroom.
- The wall boots on first open of the Hangar view, not at page load. Verified:
  `window.__aeroShowroom` is absent until the tab is opened.
- Focusing a shoe writes `--accent` on `:root`, so the whole page re-themes.
- Mobile is a designed state, not an override: one column, the view is
  280svh with a sticky stage so the wall pans on ordinary page scroll rather
  than fighting the touch gesture, 220 dust particles, pixel ratio 1.5, the
  panel becomes a bottom sheet, and the HUD moves to a row under the site
  header because the bottom belongs to the sheet. There is a third state
  between 901 and 1200px where the panel narrows before it moves.
- The focus camera fits the shoe on **both** axes. Fitting by height alone was
  wrong in portrait, where the visible width is under half the height, and the
  shoe was cropped off both sides.
- The backlight behind the focused shoe is separation, not decoration: Onyx is
  black on a near-black wall and reads as a silhouette without it.

`scripts/cdp.mjs` is a shared CDP client. `verify_site_hangar.mjs` runs
headless, which never depends on window focus, so captures cannot stall and it
does not steal focus from the browser you are using. `verify_hangar.mjs` stays
headful because its frame-rate assertions need the real GPU. Note that headless
SwiftShader flattens additive blending, so judge the lighting from the headful
proofs (`hangar-focus-black.png`), not the headless ones.

### Lighthouse, measured 2026-11-11

Lighthouse 13.6.0, local server: desktop performance 77, mobile 46, with
accessibility, best practices and SEO at 100 on both. The desktop score is up
from 55/53 before vendoring. Automated Chrome is detected as a bot, so these
traces skip the intro; a cold human first visit still pays the intro's
TBT/TTI. The mobile run carried Lighthouse's slower-CPU warning and an 11.3 s
LCP under simulated throttling, so treat 46 as a floor. The pre-vendoring
showroom delta was about two points, inside noise.
