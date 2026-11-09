# AERO — status report

**Date:** 2026-11-09
**Commit:** `48cb2e9` on `main`, pushed to `github.com/dsgoofymn-2010/AERO`
**Scope:** the tabbed-Hangar restructure and the new 3D intro

---

## Done and verified

### Routing — `js/router.js`, `css/views.css`

Home and Hangar are two real views. The Hangar is a navigation tab, not a
scroll section.

- `#home` / `#hangar` hashes drive everything, so browser back and forward work
  with no extra bookkeeping
- Deep links (`/#hangar`) open the right view after the intro finishes
- The hangar is built the first time its tab is opened, pauses rendering when
  covered, and keeps its state — including the focused shoe — when reopened
- The hidden view is `inert`, so nothing in it is reachable by Tab or a screen
  reader
- Lenis is stopped inside the hangar and resized on the way out, because while
  the hangar is open the document is only one viewport tall and a cached scroll
  limit would clamp any jump to a section
- Navigation requested during a transition is queued rather than dropped, so a
  fast back-then-forward is not swallowed

### Navigation

Six tabs: Home, Hangar, Technology, Materials, Collection, Contact. Glass pill
with a sliding indicator, hide-on-scroll header, updated mobile menu. The active
tab follows the route, or the section in view while on home.

### Intro — `js/intro.js`, `css/intro.css`

Rewritten as a full cinematic scene: fragment-shader backdrop with animated
noise and vignette, exponential fog, mirrored floor, spotlight cone, a ring of
all thirteen transparent cutouts each floating on its own phase with an accent
rim glow, particles, light streaks, `EffectComposer` with `UnrealBloomPass` and
a grain plus chromatic-aberration pass, camera fly-in with mouse parallax and
gyro tilt, hover labels, a real 000-to-100 counter tied to texture preloading,
dive-through-the-ring exit with a flash, and full resource disposal.

Three.js and its addons resolve through an importmap but are imported
dynamically, so a return visit that skips the intro never pays for them.

### Fallbacks

| Condition | Behaviour |
| --- | --- |
| `prefers-reduced-motion` | Fade intro: wordmark, line, Enter. No scene, no flights. |
| No WebGL | Static intro; the Hangar tab shows the collection grid instead of the wall. |
| Mobile | 260 particles instead of 900, pixel ratio capped at 1.5, single-column wall panned by gesture. |
| Under 40fps in the first second | Bloom pass removed automatically. |

### Test suites

| Suite | Result |
| --- | --- |
| `node scripts/verify_routing.mjs` | 36 / 36 |
| `node scripts/verify_site_hangar.mjs` | 31 / 31 |
| `node scripts/verify_hangar.mjs --headless` | 26 / 26 |

---

## Broken

### 1. The intro's 3D ring does not render — NOT DIAGNOSED

Confirmed by eye in two screenshots (`public/_verification/intro-ready.png`).
The canvas exists, the cutout textures return HTTP 200, and the loading counter
reaches 100, but no shoes appear on screen.

The cause is unknown. Work stopped while adding an instrumentation hook
(`window.__introCards`) to report how many cards are visible and opaque.

**Every suite passes despite this, because none of them assert that the ring is
actually drawn.** That gap is the main lesson: the intro was verified by
assertion and never by eye until late.

### 2. The AERO wordmark is invisible in the intro — DIAGNOSED, NOT FIXED

The letters rise into position correctly (asserted), but `.intro__letter > span`
uses `background-clip: text` with `color: transparent`, and the sweep
animation's final `background-position` parks the gradient off the glyphs, so
they paint transparent.

Fix: make every stop in the gradient light (so the text is legible at any
offset) and end the sweep at `background-position: 0% 0` instead of `-60%`.
Written, not applied.

**Both defects are present in the pushed commit.**

---

## Not started

- Hero entrance sequence continuing from the intro dive
- Lighthouse re-check after the restructure (last measured: 53 with the
  showroom, 55 without, before this session's changes)
- README: how routing and tabs work, run, swap assets, add a shoe
- `AGENTS.md` update for the new architecture
- Final folder tree
- Manual test checklist for the new flow
- Assumptions list

---

## Risks and notes

- **Intermittent CDN failure.** One run had the intro fall back to the static
  variant because the `three/addons` import failed. The code degrades cleanly
  with no console errors, but on a slow connection real visitors may hit it.
- **`verify_hangar.mjs` headful is unreliable** while another Chrome competes
  for window focus; captures and evaluates stall. Use `--headless` for
  correctness and headful only when the frame-rate assertions matter.
- **The repository is public** and contains the Cirra render with a visible
  sportswear swoosh, plus the original source footage (~300 MB). `AGENTS.md`
  already flags that asset rights need clearing before publication.
- Cirra still has no turntable: its 360 source is a flythrough reveal, not a
  rotation. Unchanged from earlier phases.

---

## Resume here

Diagnose the intro ring first — it is the one blocking defect. The
instrumentation hook to add:

```js
window.__introCards = () => ({
  visible: cards.filter((c) => c.mesh.visible).length,
  opaque: cards.filter((c) => c.mesh.material.opacity > 0.9).length,
  z: +camera.position.z.toFixed(1),
});
```

Then apply the wordmark gradient fix, add an assertion that the ring is drawn,
and work through the "Not started" list.
