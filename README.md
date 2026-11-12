# AERO

A frontend-only concept footwear studio. Thirteen shoes, one continuous dark-studio experience: a Three.js opening, three scroll-scrubbed 360 films, ten pseudo-3D still studies, an exploded anatomy section, materials films, a local bag, and a demo checkout.

No framework, no build step, no backend. GSAP, ScrollTrigger, Lenis, and Three.js are pinned and vendored under `public/vendor/`; Syne and Inter are self-hosted.

---

## Run it

The site must be served over HTTP. Opening `index.html` from the file system breaks ES modules, frame loading, and video seeking.

### Option A — VS Code Live Server

1. Install the **Live Server** extension.
2. Right-click `index.html`.
3. Choose **Open with Live Server**.
4. Open the URL it prints, usually `http://127.0.0.1:5500`.

### Option B — built-in preview server

```powershell
node scripts/serve.mjs
```

Then open `http://127.0.0.1:5500`.

`scripts/serve.mjs` is a zero-dependency static server with byte-range support. `<video>` seeking needs `206 Partial Content`.

> Do not use `python -m http.server` for preview. It answers range requests with `200`, so video seeking fails. Live Server and `scripts/serve.mjs` both work.

### Requirements

- A current Chrome, Edge, Firefox, or Safari.
- Node 20+ only for the preview server and verification harnesses.
- Python 3.10+ only to rebuild assets.

No `npm install`. No compile step.

---

## Stack

| Layer | Choice |
| --- | --- |
| Markup | Semantic HTML5 |
| Styles | Hand-written CSS, custom properties, `clamp()`, `color-mix()`, `svh` |
| Behaviour | ES modules |
| Motion | GSAP 3.12.5 + ScrollTrigger 3.12.5 + Lenis 1.1.20 (vendored) |
| Intro | Three.js 0.161.0 (vendored) |
| Routing | Hash router: `#home` and `#hangar` |
| 360 | WebP frame sequences drawn to `<canvas>` |
| Gallery | CSS 3D transforms, pointer drag, keyboard controls |
| Type | Syne for display, Inter for text (self-hosted WOFF2) |
| Bag | `localStorage`, drawer, native `<dialog>` for demo checkout |
| Backend | None |

If WebGL is unavailable, the intro falls back to a static title card and the showroom points to the collection grid. If a vendored library is missing, motion becomes static and the console reports the missing layer.

---

## Project structure

```
.
├─ index.html
├─ css/
│  ├─ styles.css       # base visual system and home view
│  ├─ views.css        # view swap, nav tabs, wipe
│  ├─ intro.css        # opening sequence
│  └─ hangar.css       # showroom, HUD, details panel
├─ js/
│  ├─ data.js          # 13 products, notes, sizes, prices
│  ├─ main.js          # shell, collection, study, anatomy, materials, dialogs
│  ├─ router.js        # #home / #hangar routing, nav tabs
│  ├─ hangar.js        # showroom: 3D wall, shelves, hover, teardown
│  ├─ hangar-focus.js  # showroom: camera states, HUD, details panel
│  ├─ wishlist.js      # saved shoes, localStorage
│  ├─ scrub.js         # frame loader + canvas scrub engine
│  ├─ gallery.js       # pseudo-3D still viewer
│  ├─ cart.js          # bag state, drawer, demo checkout
│  └─ intro.js         # Three.js opening sequence
├─ public/
│  ├─ fonts/           # syne.woff2, inter-var-latin.woff2
│  ├─ vendor/          # pinned three, gsap, lenis copies
│  ├─ shoes/<id>/      # stills, detail, posters, films, frames
│  ├─ showroom/        # transparent Hangar cutouts + manifest
│  ├─ favicon.svg
│  └─ _verification/   # scans, reports, screenshots
├─ scripts/
│  ├─ build_assets.py  # watermark scan, clean, encode, frame extraction
│  ├─ cutout.py        # Hangar cutouts and turntables
│  ├─ vendor_cdn.mjs   # refresh public/vendor/ from pinned versions
│  ├─ serve.mjs
│  ├─ verify_scrub.mjs
│  ├─ verify_site.mjs
│  ├─ verify_catalog.mjs
│  ├─ verify_polish.mjs
│  ├─ verify_routing.mjs
│  ├─ verify_site_hangar.mjs
│  ├─ verify_hangar.mjs
│  └─ shots.mjs
├─ assets/             # legacy STRATA output, read-only
├─ BLUE SHOE/          # original delivery, untouched
├─ BROWN_SHOE/
├─ BLACK_SHOE/
├─ Chelsea boot/
├─ High-top basketball sneaker/
├─ Trail running shoe/
└─ new shoes/
```

The original delivery folders stay as received. Nothing in them is modified.

---

## The page

Two views share one document. `#home` is the scrolling site; `#hangar` is the full-viewport showroom. The nav tabs, the hero CTA, browser back/forward, and deep links all use the hash. A section link such as `#materials` returns to home first and then scrolls.

**Home**

1. **Intro** — Three.js wireframe sole, studio rings, dust, a soft halo, and a skip control. Runs once per browser session (`sessionStorage["aero:intro"]`). Enter lands on the hero. Automated sessions (`navigator.webdriver` or a `HeadlessChrome` user agent) skip the film and boot straight to the hero; `?intro=1` cancels that skip, and the footer replay button always plays the film.
2. **Hero** — collection line, split headline, featured shoe, and three collection counts. The CTA leads to the showroom; the scroll cue leads to the collection.
3. **Collection** — thirteen cards with category filters. The first three open film studies; the other ten open still studies.
4. **Study** — a pinned scroll section with a 360 frame scrubber for Cirra, Terrae, and Onyx.
5. **Anatomy** — exploded film, four selectable parts, and a note that seeks the film.
6. **Materials** — close-up film, material caption, and three concept metrics.
7. **Notes** — three studio notes, labelled as development notes, not reviews.
8. **Letters** — validated demo newsletter with an explicit no-list state.
9. **Footer** — contact, navigation, credits, replay intro, back to top.

**Hangar** — the 3D showroom view. It keeps its camera state when you return home and come back.

**Overlays** — product study dialog, bag drawer, checkout dialog, mobile menu.

Selecting a shoe re-themes the interface accent and updates the product dialog, specs, metrics, materials, and media.

---

## The Hangar showroom

A dark gallery wall. Thirteen shoes float on glass shelves, each with a light
strip underneath in that shoe's accent colour.

**Two camera states.** OVERVIEW pulls back to the whole wall with a slow drift
and mouse parallax. FOCUS glides into one shoe over 1.4s, dims and hazes the
others, lights a soft backlight behind the subject, and slides in the details
panel. Clicking a shoe flies in; "Back to wall", Escape, or clicking empty
space pulls out. Arrow keys, the prev/next buttons, and a swipe move between
shoes through a short pull-back-and-in dolly rather than a cut.

**In focus**, Terrae and Onyx swap to a transparent 360 turntable you can drag
(with inertia) and which turns slowly on its own. The other eleven get a
pointer tilt, a sheen that travels across the shoe, and a zoom on hover.

**Controls**

| Input | Action |
| --- | --- |
| Click a shoe | Fly in |
| Click empty space, Escape, Back to wall | Return to the wall |
| Left / Right arrow | Previous / next shoe |
| Enter | Open the first shoe from the wall |
| Drag | Rotate the turntable (Terrae, Onyx) |
| Swipe left / right | Previous / next shoe |

**Opening it.** Use the Hangar tab, the hero CTA, or `http://127.0.0.1:5500/#hangar`. The wall boots on first open rather than at page load; returning to home and coming back keeps the camera where you left it. The collection grid stays as the no-WebGL fallback.

**Files.** `js/hangar.js` builds the scene, the layout and hover, and exposes the camera state plus teardown. `js/hangar-focus.js` owns the camera states, the HUD and the panel. `css/hangar.css` styles the view. Rendering pauses when the tab is hidden.

### Adding a shoe

1. Add the entry to `SHOES` in `js/data.js`. Nothing in the showroom is
   hardcoded, so a new entry becomes a new bay and the grid re-centres itself.
2. Run `python scripts/cutout.py --only <id>` to write
   `public/showroom/<id>.webp` and `<id>-800.webp` plus the manifest entry that
   carries the cutout's aspect ratio.
3. Reload. If step 2 is skipped the wall still works: it falls back to
   `public/showroom/<id>.webp` and measures the aspect from the image, but
   there will be a layout settle on first load.

To give a shoe a turntable, set `type: "video"`, point `assets.frames.desktop`
at its frame sequence, add its id to `TURNTABLES` in `scripts/cutout.py`, then
run `python scripts/cutout.py --frames-only --frames 4`. Only use a sequence
that is a real rotation.

### What is not there

Cirra has no turntable. Its 360 source is a flythrough reveal, not a rotation:
the first ~155 frames are underlit and full of particle effects, and the clean
tail barely turns. It falls back to the still treatment. A new source clip is
the only fix.

### Fallbacks

- **No WebGL** — the view says so and links to the collection grid, which is
  the same thirteen shoes.
- **Reduced motion** — no flights and no idle drift; focus cross-fades instead.
- **Mobile** — one column that pans with page scroll, 220 dust particles
  instead of 700, pixel ratio capped at 1.5, and the panel becomes a bottom
  sheet so the shoe keeps the upper half of the screen.

---

## Editing products

`js/data.js` is the source of truth. Each entry in `SHOES` supplies:

```js
{
  id, index, name, category, type: "video" | "gallery",
  style, featured, colorway, tagline, price,
  accent, accentInk, accentText, soft, swatch,
  description, shortDescription,
  specs, metrics, materials, materialCaption,
  source, assets,
  callouts, parts
}
```

- `category` is one of `Sneakers`, `Boots`, `Formal`, `Sandals`, `Casual`.
- `type: "video"` gets a 360 scrubber plus exploded and close-up films.
- `type: "gallery"` gets the pseudo-3D still viewer and a detail image.
- `assets` points at `public/shoes/<id>/`.
- `callouts` and `parts` belong to the three film shoes only.
- Legacy flat fields (`framePath`, `videoPath`, `posterPath`, `frameCount`, `frameStart`, `chips`, `notes`) remain for the old STRATA page; the new site reads `assets.frames` and the other `assets` paths.

Prices are INR concept values between ₹3,999 and ₹14,999. Sizes are EU 39–45.

### Add a shoe

1. Add the delivery set or generate assets under `public/shoes/<id>/`.
2. Add a `SHOES` entry with a unique `id` and the next `index`.
3. Choose `type`. A still-only shoe needs `still`, `stillMobile`, and `detail`; a film shoe also needs `poster`, `video360`, `exploded`, `closeup`, the WebM variants, and `frames`.
4. Add the category if it is new. Filters render from `CATEGORIES`.
5. Reload. Cards, counts, filters, and dialogs render from data; there is no card markup to hand-edit.

---

## Asset pipeline

Phase 1 is implemented in `scripts/build_assets.py`. It writes only to `public/` and never touches the original delivery folders.

### What it does

1. **Watermark scan** — samples the bottom-right 8% × 8% of every video and image. Only files that actually contain the Veo wordmark or Gemini sparkle are processed.
2. **Videos** — ffmpeg `delogo`, no audio, H.264 CRF 18, 1280×720, 24 fps, keyframe every 24 frames, `+faststart`, plus VP9 WebM and a WebP poster.
3. **Images** — OpenCV Telea or Pillow inpaint only the watermark corner. Desktop WebP 1600 px, mobile WebP 800 px, quality 85. Never crop or distort the shoe.
4. **360 frames** — WebP sequences at the native 24 fps for the three film shoes.
5. **Verification** — proof crops and scan data under `public/_verification/`.

Blue had no supplied 360 clip. One was rebuilt from the clean frame sequence, starting at the first fully lit frame, then the scrub frames were extracted.

### Outputs

| Set | Source folder | Type | Stills | Films |
| --- | --- | --- | --- | --- |
| Cirra | `BLUE SHOE` | video | 1 | 3 |
| Terrae | `BROWN_SHOE` | video | 1 | 4 |
| Onyx | `BLACK_SHOE` | video | 1 | 4 |
| Kestrel | `Chelsea boot` | gallery | 1 | 3 available |
| Vertex | `High-top basketball sneaker` | gallery | 1 | 3 available |
| Trace | `Trail running shoe` | gallery | 1 | 3 available |
| Covent, Cairn, Kerb, Alba, Ledger, Dune, Loom | `new shoes` | gallery | 7 | none |

Totals: 13 stills, 13 detail images, 21 clips in MP4 and WebM, 1,198 scrub frames. The public payload is about 100 MB, including verification screenshots.

### Rebuild

```powershell
python -m pip install pillow opencv-python-headless numpy imageio-ffmpeg
python scripts/build_assets.py
```

`imageio-ffmpeg` supplies the ffmpeg binary. A system `ffmpeg` on `PATH` also works.

After a rebuild, check `frameCount`/`frames.count` in `js/data.js` and clear the browser cache.

### Showroom cutouts

`public/showroom/` holds the transparent shoe cutouts and `manifest.json` that the Hangar wall uses. They are generated by `scripts/cutout.py`, not hand-made. Re-run it after adding a shoe; the wall falls back to measuring the image if a manifest entry is missing.

---

## Verification

The harnesses use Chrome DevTools Protocol. Start the preview server and a debuggable Chrome first.

Terminal 1:

```powershell
node scripts/serve.mjs
```

Terminal 2:

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  "--headless=new",
  "--remote-debugging-port=9222",
  "--user-data-dir=$env:TEMP\aero-verify",
  "--window-size=1440,900",
  "http://127.0.0.1:5500/index.html"
)
```

Terminal 3:

```powershell
node scripts/verify_scrub.mjs    # frame engine + study scrubber, 42 checks
node scripts/verify_site.mjs     # site shell and interactions, 108 checks
node scripts/verify_catalog.mjs  # all 13 products and filters, 72 checks
node scripts/verify_polish.mjs   # semantics, keyboard, contrast, targets, 32 checks
node scripts/verify_routing.mjs  # intro, routing, fallbacks, automation skip, 43 checks
node scripts/verify_site_hangar.mjs # Hangar in the real page, 31 checks
node scripts/verify_hangar.mjs --headless # scene + focus, 26 checks
node scripts/shots.mjs           # visual QA screenshots
```

The 9222 suites expect Chrome to already be on the site, not `about:blank` and not a failed-load error page: both are origin-less documents, and `verify_site.mjs` clears `sessionStorage` on the current document before it navigates. The routing, site-hangar, and scene harnesses launch their own throwaway Chrome on their own ports and need no manual browser.

Reports and screenshots land in `public/_verification/`:

- `phase2_scrub.json`
- `phase4_site.json`
- `phase5_catalog.json`
- `phase5_polish.json`
- `routing.json`, `hangar_h4.json`, `hangar_h2.json`
- `phase4-*.png`, `phase2-study.png`, `phase2-mobile-study.png`, `hangar-*.png`, `route-hangar.png`

The site harness covers boot, intro skip, filters, gallery and video dialogs, 360 frames, cart and checkout, study switching, anatomy, materials, newsletter, footer, mobile menu, a five-width overflow sweep, and reduced motion. The catalog harness opens every product and loads every still, detail image, film, and 360 set. The polish harness checks landmarks, headings, duplicate IDs, accessible names, skip link, dialog and bag focus traps, Escape behaviour, WCAG AA contrast, and 44 px touch targets. The routing harness covers the intro, `#home` / `#hangar`, back/forward, deep links, reduced motion, no WebGL, and the automation contract: a headless session boots straight to the hero, and `?intro=1` brings the film back. The showroom harnesses cover the wall, focus mode, mobile pan, the bottom sheet, theming, and teardown.

---

## Accessibility and motion

- Semantic landmarks, one `h1`, ordered headings, descriptive alt text.
- Skip link targets a focusable `<main>`.
- Product dialog, bag, and mobile menu trap focus; Escape closes them; focus returns to the trigger.
- Native `<dialog>` for the product study and checkout.
- Visible focus rings on dark panels; landmark focus is silent.
- All interactive targets are at least 44×44 px at 360 px wide.
- Videos are muted, decorative where appropriate, and paused offscreen.
- `prefers-reduced-motion: reduce` skips the intro and the Lenis/GSAP layer, shows all reveals immediately, and disables the custom cursor and magnetic movement.
- Text contrast was audited against the effective background; the quiet token was raised to `#8a867e` to clear WCAG AA on the darkest panels.

---

## Performance notes

- The hero still is preloaded; both fonts are preloaded.
- The first 20 scrub frames load before the study is considered ready; the rest fill in at 6 concurrent requests on desktop and 4 on mobile.
- Frames are fetched as blobs and decoded to `ImageBitmap` with an HTML image fallback.
- The study canvas caps DPR at 2 and the product orbit keeps a bounded frame cache.
- Posters cover every film before playback.
- `IntersectionObserver` pauses anatomy and materials films offscreen; `visibilitychange` pauses them when the tab is hidden.
- GSAP, ScrollTrigger, Lenis, and Three.js are vendored, so the page has no third-party network dependency.
- The showroom boots only when the Hangar view is first opened, pauses rendering on tab hide, and frees a turntable's frames when focus leaves that shoe.

### Measured Lighthouse, 2026-11-11

Desktop and mobile, Lighthouse 13.6.0, `--headless=new`, local server,
2026-11-11:

| Run | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Desktop | 77 | 100 | 100 | 100 |
| Mobile | 46 | 100 | 100 | 100 |

The desktop run is up from 55/53 before vendoring. Automated Chrome is
detected as a bot, so these traces skip the intro; a cold human first visit
still plays it and pays more TBT/TTI than the table shows. The mobile run
carried Lighthouse's "slower CPU than expected" warning, and its LCP was
11.3 s under simulated throttling, so treat 46 as a floor rather than a
stable score. The same trace's observed LCP is 0.83 s; the 11.3 s figure is
the simulator's projection, which re-queues the hero image behind ~255 local
requests. The pre-vendoring showroom delta was about two points, inside
noise.

---

## Known constraints and assumptions

- **Fictional brand.** AERO, the shoes, prices, copy, and studio notes are concept content.
- **Concept measurements.** Weight, flex, comfort, and material claims are presentation data, not certified lab results.
- **Notes are not reviews.** The notes section is labelled as studio notes and invents no customers or ratings.
- **Demo commerce.** Add to bag, quantities, and checkout work locally. Checkout takes no payment, sends no email, and has no backend.
- **Blue upper mark.** The supplied Cirra render carries a sportswear-like graphic. It is left intact; clear asset rights before publication.
- **Film resolution.** Supplied clips are 854×480. Exports are 1280×720 with light sharpening.
- **Three hero shoes.** Cirra, Terrae, and Onyx carry the full film treatment. The other ten are still studies, even where extra clips exist in the delivery folders.
- **No library CDN.** GSAP, ScrollTrigger, Lenis, and Three.js are vendored under `public/vendor/`; the page boots offline. WebGL is the only optional capability, and the showroom falls back to the grid without it.
- **Modern CSS.** `color-mix()`, `svh`, and `clamp()` are used. Very old browsers get a simpler but readable page.

---

## Post-run checklist

### Boot and layout

- [ ] Served over HTTP, not `file://`.
- [ ] Intro draws, can be skipped, and does not replay in the same session.
- [ ] No horizontal overflow at 360, 768, 1024, 1440, or 1920 px.
- [ ] Fonts load from `public/fonts/` with no Google Fonts request.
- [ ] No console errors or failed requests.

### Collection and studies

- [ ] All 13 cards render and every category filter shows the right count.
- [ ] A gallery card opens the still viewer; drag, arrow keys, zoom, and reset work.
- [ ] A film card opens the 360 viewer; the counter advances and the exploded and close-up films mount.
- [ ] The study scrubber switches between Cirra, Terrae, and Onyx.
- [ ] Anatomy parts seek the exploded film.
- [ ] Materials copy and metrics follow the active film shoe.
- [ ] All videos are muted and have no audio track.

### Commerce and forms

- [ ] Size selection is required by default state and add to bag updates the count.
- [ ] Quantity and remove update the subtotal.
- [ ] Reloading keeps the bag (`localStorage`).
- [ ] Checkout opens with an item summary and closes with Escape.
- [ ] No payment is requested or implied.
- [ ] Newsletter rejects an invalid address and accepts a valid one.
- [ ] The success state says the list is a demo.

### Mobile and keyboard

- [ ] Mobile menu opens, locks the page, traps focus, and closes with Escape.
- [ ] Bag fits inside 360 px and traps focus.
- [ ] Focus returns to the trigger after closing the bag or menu.
- [ ] Skip link moves focus to the main content.
- [ ] Tab order is logical through header, hero, collection, study, anatomy, materials, notes, letters, footer.
- [ ] Touch targets are at least 44×44 px.
- [ ] Reduced motion skips the intro and the motion layer.

### Metadata and delivery

- [ ] Title, description, OG image, and favicon are present.
- [ ] `public/favicon.svg` resolves.
- [ ] No console errors or failed requests in the final harness run.
- [ ] Files deploy as static assets with range requests enabled.
- [ ] Font licences and asset rights reviewed for the intended use.

---

## Manual test checklist — Hangar showroom

Run `node scripts/serve.mjs` and open `http://127.0.0.1:5500`.

**The wall**

- [ ] Open the Hangar tab (or `#hangar`). A loader counts up and all thirteen shoes appear on glass shelves.
- [ ] Each shelf has a light strip in that shoe's colour, and a faint reflection below.
- [ ] Hovering a shoe lifts it, brightens its strip, and the cursor becomes a pointer.
- [ ] The wall is still when nothing is hovered apart from a slow drift, and it follows the mouse a little.

**Focus**

- [ ] Click a shoe. The camera glides in over about 1.4s and the others dim and recede.
- [ ] The panel slides in from the right with the shoe's name, price, three specs, sizes, Add to bag and Save.
- [ ] The whole interface accent turns to that shoe's colour, including the bottom-left rules.
- [ ] Bottom-left reads HANGAR and TIER; bottom-right reads the position out of 13.
- [ ] The shoe is fully visible and not hidden behind the panel.
- [ ] Next / Prev pull back and push in rather than sliding sideways.
- [ ] Terrae and Onyx can be dragged to rotate, keep spinning after release, and turn slowly on their own.
- [ ] The other shoes tilt toward the pointer, catch a travelling sheen, and zoom slightly on hover.
- [ ] Back to wall, Escape, and clicking empty space all return to the wall.
- [ ] Dragging a turntable and releasing does **not** exit focus.

**Cart and saves**

- [ ] Pick a size, Add to bag, and the bag count goes up with the right shoe and size.
- [ ] Save toggles to Saved, survives a reload, and toggles back.

**Keyboard**

- [ ] Tab reaches the wall; it shows a focus ring.
- [ ] Enter opens the first shoe; Left and Right move between shoes; Escape returns.
- [ ] Every HUD and panel control is reachable by Tab and shows a focus ring.

**Mobile** (device toolbar, 390x844)

- [ ] One column; scrolling the page pans the wall vertically.
- [ ] No sideways scrolling anywhere.
- [ ] In focus the panel is a bottom sheet and the shoe keeps the upper half.
- [ ] Back to wall and the counter sit in a row under the site header, not behind the sheet.
- [ ] Every button is comfortable to hit with a thumb.
- [ ] Swiping left and right moves between shoes.

**Fallbacks**

- [ ] With `prefers-reduced-motion: reduce`, focus cross-fades with no flight and nothing drifts.
- [ ] With WebGL disabled (`chrome --disable-3d-apis`), the section explains itself and links to the grid, and the grid still shows thirteen shoes.
- [ ] Return home and reopen the Hangar: no console errors, and the frame rate holds.

Automated cover: `node scripts/verify_hangar.mjs --headless` (26 checks, the scene
and focus mode), `node scripts/verify_site_hangar.mjs` (31 checks, the showroom
inside the real page, mobile, reduced motion, no WebGL), and
`node scripts/verify_routing.mjs` (43 checks, the `#home` / `#hangar` flow and
the automation skip).

---

## Credits and licences

- **Syne** — Bonjour Monde, SIL Open Font License 1.1.
- **Inter** — Rasmus Andersson, SIL Open Font License 1.1.
- **GSAP / ScrollTrigger** — GreenSock, vendored under `public/vendor/` under GreenSock's licence.
- **Lenis** — Studio Freight, MIT, vendored under `public/vendor/`.
- **Three.js** — three.js authors, MIT, vendored under `public/vendor/`.
- Shoe renders, films, and stills were supplied by the project owner. Confirm rights before commercial publication.

The interface is original code written for this project. No UI kit, template, or stock layout was used.
