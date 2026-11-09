/* The Hangar tab inside the real index.html.

   Routing itself is covered by verify_routing.mjs. This covers what the
   hangar does once it is open: theming, accessibility, the mobile layout,
   reduced motion, and the no-WebGL fallback.

   Needs scripts/serve.mjs on :5500. Run: node scripts/verify_site_hangar.mjs
*/
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:5500";
const OUT = "public/_verification";
await mkdir(OUT, { recursive: true });

const checks = [];
const add = (name, pass, note) => checks.push({ name, pass: Boolean(pass), note });

async function session({ port, mobile = false, reduced = false, noWebGL = false }) {
  const { cdp, close } = await launch({
    port,
    url: "about:blank",
    headless: true,
    width: mobile ? 420 : 1440,
    height: mobile ? 880 : 900,
    extraArgs: noWebGL ? ["--disable-3d-apis"] : [],
  });

  const errors = [];
  const failed = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") errors.push(args.map((a) => a.value ?? a.description ?? "").join(" "));
  });
  cdp.on("Network.responseReceived", ({ response, type }) => {
    if (response.status >= 400) failed.push(`${type} ${response.status} ${response.url}`);
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
  });
  if (mobile) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  // Skip the opening sequence: this suite is about the hangar, not the intro.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { sessionStorage.setItem("aero:intro", "seen"); } catch {}`,
  });

  await cdp.send("Page.navigate", { url: `${BASE}/index.html` });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }, 60000);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const safe = (expr, fallback = null) => evaluate(expr).catch(() => fallback);

  const waitFor = async (expr, tries = 90) => {
    for (let i = 0; i < tries; i += 1) {
      await sleep(400);
      if (await safe(expr, false)) return true;
    }
    return false;
  };

  const shot = async (name) => {
    try {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, 45000);
      await writeFile(join(OUT, name), Buffer.from(data, "base64"));
    } catch (e) { console.warn(`screenshot ${name} skipped: ${e.message}`); }
  };

  // Everything here starts the same way: open the tab, wait for the wall.
  const openHangar = async () => {
    // Clicking before boot finishes would fall through to a plain hash jump.
    await waitFor("window.__aeroReady === true");
    await safe(`document.querySelector('#primaryNav [data-route="hangar"]').click()`);
    return waitFor(`document.documentElement.dataset.view === "hangar"`);
  };

  return { cdp, close, errors, failed, evaluate, safe, waitFor, shot, openHangar };
}

/* ---- desktop ---- */
{
  const s = await session({ port: 9231 });
  add("hangar tab opens the wall", await s.openHangar());
  const loaded = await s.waitFor(`!!window.__aeroShowroom && window.__aeroShowroom.hangar.bays.every(b => b.loaded)`);
  add("all 13 bays load", loaded);
  await sleep(700);
  await s.shot("hangar-site-desktop.png");

  const chrome = await s.safe(`({
    brand: !!document.querySelector('#hangarStage .hangar-hud__corner--tl'),
    nav: !!document.querySelector('#hangarStage .hangar-hud__corner--tr'),
    counter: document.querySelector('#hangarStage [data-hangar-index]')?.textContent.trim(),
    home: !!document.querySelector('.hangar__home'),
  })`);
  add("hangar does not duplicate the site header", chrome && !chrome.brand && !chrome.nav);
  add("counter is blank until a shoe is chosen", chrome?.counter === "--", chrome?.counter);
  add("back to home control is present", chrome?.home);

  const before = await s.safe(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
  await s.safe("window.__aeroShowroom.focus.focus(5)");
  await sleep(2300);
  const after = await s.safe(`({
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    shoe: window.__aeroShowroom.hangar.bays[5].shoe.accent,
    panel: !document.querySelector('.hangar-panel').hidden,
    fov: window.__aeroShowroom.hangar.camera.fov,
  })`);
  add("page accent follows the focused shoe",
    after?.accent.toLowerCase() === after?.shoe.toLowerCase() && after?.accent !== before,
    `${before} -> ${after?.accent}`);
  add("details panel opens", after?.panel);
  add("focus narrows the lens", after?.fov < 35, String(after?.fov));

  const a11y = await s.safe(`(() => {
    const m = document.getElementById('hangarStage');
    const c = m.querySelector('canvas');
    const back = m.querySelector('[data-hangar-back]');
    return {
      canvasFocusable: c.tabIndex === 0 && !!c.getAttribute('aria-label'),
      backVisible: back && !back.hidden && back.offsetWidth > 0,
      labelled: !!document.getElementById('showroom').getAttribute('aria-labelledby'),
      radiogroup: !!m.querySelector('[role="radiogroup"]'),
      pressed: m.querySelector('[data-p-save]')?.getAttribute('aria-pressed') !== null,
    };
  })()`);
  add("canvas is focusable and labelled", a11y?.canvasFocusable);
  add("back to wall is visible in focus", a11y?.backVisible);
  add("section is labelled and controls carry roles", a11y?.labelled && a11y?.radiogroup && a11y?.pressed);

  const grid = await s.safe(`(() => {
    document.querySelector('.hangar__home').click();
    return null;
  })()`);
  await s.waitFor(`document.documentElement.dataset.view === "home"`);
  const cards = await s.safe(`document.querySelectorAll('#collectionGrid .card').length`);
  add("back to home returns to the grid page", cards === 13, `${cards} cards`);

  add("no console errors", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  add("no failed requests", s.failed.length === 0, s.failed.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- mobile ---- */
{
  const s = await session({ port: 9232, mobile: true });
  add("mobile hangar tab opens", await s.openHangar());
  add("mobile wall loads", await s.waitFor(`!!window.__aeroShowroom && window.__aeroShowroom.hangar.bays.every(b => b.loaded)`));
  await sleep(700);
  await s.shot("hangar-site-mobile.png");

  const m = await s.safe(`(() => {
    const h = window.__aeroShowroom.hangar;
    return {
      cols: h.grid.cols,
      rows: h.grid.rows,
      dpr: h.renderer.getPixelRatio(),
      panSpan: +h.panRange.span.toFixed(2),
      camY: +h.cam.y.toFixed(2),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  add("mobile is a single column", m?.cols === 1, `${m?.cols} col, ${m?.rows} rows`);
  add("mobile pixel ratio capped at 1.5", m?.dpr <= 1.5, String(m?.dpr));
  add("mobile wall has room to pan", m?.panSpan > 0, `span ${m?.panSpan}`);
  add("no horizontal scroll at 390px", m?.overflow <= 0, `${m?.overflow}px`);

  // A full-screen view has no page scroll, so the wall pans by gesture.
  await s.safe(`(() => {
    const el = document.getElementById('hangarStage');
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 900, bubbles: true, cancelable: true }));
    return null;
  })()`);
  await sleep(500);
  const panned = await s.safe(`+window.__aeroShowroom.hangar.cam.y.toFixed(2)`);
  add("wheel pans the mobile wall", Math.abs(panned - m.camY) > 0.2, `${m?.camY} -> ${panned}`);

  await s.safe("window.__aeroShowroom.focus.focus(2)");
  await sleep(2300);
  const sheet = await s.safe(`(() => {
    const p = document.querySelector('.hangar-panel');
    const r = p.getBoundingClientRect();
    const targets = [...document.querySelectorAll('.hangar-panel__size, .hangar-panel__add, .hangar-panel__save, .hangar-hud__step, .hangar__home')];
    return {
      fullWidth: r.width >= innerWidth - 2,
      atBottom: Math.abs(r.bottom - innerHeight) < 2,
      small: targets.filter((el) => {
        const b = el.getBoundingClientRect();
        return b.height < 44 || b.width < 44;
      }).length,
      count: targets.length,
    };
  })()`);
  add("panel becomes a bottom sheet", sheet?.fullWidth && sheet?.atBottom);
  add("every tap target is at least 44px", sheet?.small === 0, `${sheet?.small} of ${sheet?.count} too small`);
  await s.shot("hangar-site-mobile-focus.png");

  add("no console errors on mobile", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- reduced motion ---- */
{
  const s = await session({ port: 9233, reduced: true });
  await s.openHangar();
  await s.waitFor(`!!window.__aeroShowroom && window.__aeroShowroom.hangar.bays.every(b => b.loaded)`);

  const r = await s.safe(`(() => {
    const h = window.__aeroShowroom.hangar;
    window.__aeroShowroom.focus.focus(4);
    return { reduced: h.reduced, z: +h.cam.z.toFixed(2), overviewZ: +h.overviewZ.toFixed(2) };
  })()`);
  add("reduced motion is detected", r?.reduced === true);
  add("reduced motion cross-fades instead of flying", r?.z < r?.overviewZ / 2, `z ${r?.z} of ${r?.overviewZ}`);
  add("no console errors with reduced motion", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- no WebGL ---- */
{
  const s = await session({ port: 9234, noWebGL: true });
  await s.openHangar();
  await sleep(1500);
  const f = await s.safe(`(() => {
    const sec = document.getElementById('showroom');
    const fb = document.getElementById('hangarFallback');
    return {
      unavailable: sec.classList.contains('is-unavailable'),
      shown: !fb.hidden && fb.offsetWidth > 0,
      link: fb.querySelector('a')?.getAttribute('href'),
      cards: document.querySelectorAll('#collectionGrid .card').length,
    };
  })()`);
  add("no-WebGL marks the section unavailable", f?.unavailable);
  add("no-WebGL shows the fallback pointing at the grid", f?.shown && f?.link === "#collection");
  add("collection grid is intact without WebGL", f?.cards === 13);
  add("no console errors without WebGL", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.shot("hangar-site-nowebgl.png");
  await s.close();
}

const passed = checks.filter((c) => c.pass).length;
await writeFile(join(OUT, "hangar_h4.json"), JSON.stringify({ checks, passed, total: checks.length }, null, 2));
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.note ? `  (${c.note})` : ""}`);
console.log(`\n${passed}/${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
