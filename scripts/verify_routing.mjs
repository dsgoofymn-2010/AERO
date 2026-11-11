/* Verification for the intro and the view router.

   Needs scripts/serve.mjs on :5500. Run: node scripts/verify_routing.mjs
   Runs headless, so it never steals focus and captures cannot stall.
   Headless sessions skip the film by contract (navigator.webdriver or a
   HeadlessChrome UA), so every session here passes ?intro=1 to force it,
   except the automation block, which asserts the skip itself.
*/
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:5500";
const OUT = "public/_verification";
await mkdir(OUT, { recursive: true });

const checks = [];
const add = (name, pass, note) => checks.push({ name, pass: Boolean(pass), note });

async function session({ port, reduced = false, noWebGL = false, seen = false, hash = "", forceIntro = true }) {
  const { cdp, close } = await launch({
    port, url: "about:blank", headless: true, width: 1440, height: 900,
    extraArgs: noWebGL ? ["--disable-3d-apis"] : [],
  });

  const errors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") errors.push(args.map((a) => a.value ?? a.description ?? "").join(" "));
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
  });
  if (seen) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { sessionStorage.setItem("aero:intro", "seen"); } catch {}`,
    });
  }
  await cdp.send("Page.navigate", { url: `${BASE}/index.html${forceIntro ? "?intro=1" : ""}${hash}` });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };

  // A thrown evaluate should fail one check, not abort the whole run.
  const safe = async (expr, fallback = null) => evaluate(expr).catch((e) => {
    console.warn(`eval failed: ${String(e.message).slice(0, 90)}`);
    return fallback;
  });

  const waitFor = async (expr, tries = 150) => {
    for (let i = 0; i < tries; i += 1) {
      await sleep(400);
      if (await evaluate(expr).catch(() => false)) return true;
    }
    return false;
  };

  const shot = async (name) => {
    try {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, 15000);
      await writeFile(join(OUT, name), Buffer.from(data, "base64"));
    } catch (e) { console.warn(`screenshot ${name} skipped: ${e.message}`); }
  };

  return { cdp, close, errors, evaluate, safe, waitFor, shot };
}

/* ---- intro, first visit ---- */
{
  const s = await session({ port: 9241 });
  const up = await s.waitFor(`!!document.querySelector("#intro .intro__canvas canvas")`);
  add("intro builds a WebGL scene on first visit", up);

  const ready = await s.waitFor(`document.getElementById("intro").classList.contains("is-ready")`);
  add("intro reaches ready", ready);

  const hud = await s.evaluate(`({
    count: document.getElementById("introCount").textContent.trim(),
    letters: document.querySelectorAll("#introWord .intro__letter").length,
    enter: !!document.getElementById("introEnter"),
    skipVisible: document.getElementById("introSkip").getBoundingClientRect().width > 0,
    heroHidden: document.getElementById("intro") !== null,
  })`);
  add("loading counter reaches 100", hud.count === "100", hud.count);
  add("wordmark is split into letters", hud.letters === 4, `${hud.letters} letters`);
  const skipUp = hud.skipVisible
    || await s.waitFor(`document.getElementById("introSkip")?.getBoundingClientRect().width > 0`, 60);
  const skipW = await s.evaluate(`document.getElementById("introSkip")?.getBoundingClientRect().width ?? -1`);
  add("enter and skip are both present", hud.enter && skipUp, `skip width ${skipW}`);
  // The fly-in runs 2.6s and the cards fade in over it; shooting earlier
  // catches a near-empty frame. Poll the ring for up to 12s: low fps climbs
  // fades slowly, and a poll can tell "climbing" from "stalled" by fade0/t.
  let scene = null;
  let ringUp = false;
  for (let i = 0; i < 16 && !ringUp; i += 1) {
    scene = await s.evaluate(`({
      cards: document.querySelector("#intro .intro__canvas canvas") ? 1 : 0,
      lit: window.__introCards ? window.__introCards() : "none",
    })`);
    const lit = scene.lit ?? {};
    ringUp = lit.visible === 13 && lit.opaque >= 13 && lit.drawn > 0.05;
    if (!ringUp) await sleep(800);
  }
  // Risen means translateY is back to ~0; they start at 104% below the mask.
  const letters = await s.evaluate(`[...document.querySelectorAll("#introWord .intro__letter > span")]
    .every(n => Math.abs(new DOMMatrix(getComputedStyle(n).transform).m42) < 2)`);
  scene.letters = letters;
  add("wordmark letters have risen into view", scene.letters);
  // The sweep must park its light span over the glyphs: a dark stop anywhere
  // in the gradient, or a final position off 0%, paints the letters silently
  // invisible. Checked via computed style, so no screenshot is needed.
  const word = await s.evaluate(`(() => {
    const cs = getComputedStyle(document.querySelector("#introWord .intro__letter > span"));
    const stops = [...cs.backgroundImage.matchAll(/rgba?\\(([^)]+)\\)/g)]
      .map((m) => m[1].split(",").slice(0, 3).reduce((a, v) => a + Number(v), 0) / 3);
    return { end: cs.backgroundPosition, darkest: Math.min(...stops) };
  })()`);
  add("wordmark gradient stays legible at the end of the sweep",
    /^0%/.test(word.end) && word.darkest > 150, JSON.stringify(word));
  add("the ring of shoes is rendering",
    scene.lit?.visible === 13 && scene.lit?.opaque >= 13 && scene.lit?.drawn > 0.05,
    JSON.stringify(scene.lit));
  await s.shot("intro-ready.png");

  await s.evaluate(`document.getElementById("introEnter").click()`);
  // The handoff contract: the copy carries is-revealed while the intro is
  // still on screen, because the entrance starts under the exit flash rather
  // than after the stage has emptied. Both sides are class state, so the
  // assertion holds even where the headless renderer runs seconds behind.
  await sleep(800);
  const handoff = await s.evaluate(`({
    introStillThere: !!document.getElementById("intro"),
    heroEntering: [...document.querySelectorAll("[data-hero]")].every((n) => n.classList.contains("is-revealed")),
  })`);
  add("hero entrance starts while the intro is still on screen",
    handoff.introStillThere && handoff.heroEntering, JSON.stringify(handoff));
  const gone = await s.waitFor(`!document.getElementById("intro")`);
  add("enter removes the intro and disposes it", gone);

  const after = await s.evaluate(`({
    view: document.documentElement.dataset.view,
    hero: !!document.getElementById("top"),
    heroOnScreen: document.getElementById("top").getBoundingClientRect().top < 200,
    scrollY: window.scrollY,
    seen: sessionStorage.getItem("aero:intro"),
  })`);
  add("hero is the first thing seen after enter", after.view === "home" && after.heroOnScreen && after.scrollY < 50,
    `view ${after.view}, scrollY ${after.scrollY}`);
  add("intro is marked seen for the session", after.seen === "seen");
  // The rise outlives the overlay: the longest title line starts 0.24s after
  // the handoff and runs 1.15s, so settling happens after the intro is gone.
  await sleep(1400);
  const settled = await s.evaluate(`[...document.querySelectorAll(".hero__line > span[data-hero]")]
    .every((n) => Math.abs(new DOMMatrix(getComputedStyle(n).transform).m42) < 2)`);
  add("the hero title rise completes after the flash", settled);
  add("no console errors during the intro", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.shot("intro-to-hero.png");
  await s.close();
}

/* ---- routing ---- */
{
  const s = await session({ port: 9242, seen: true });
  await s.waitFor("window.__aeroReady === true");

  const home = await s.safe(`({
    view: document.documentElement.dataset.view,
    hangarHidden: document.getElementById("viewHangar").hidden,
    hangarInert: document.getElementById("viewHangar").inert,
    tabs: [...document.querySelectorAll("#primaryNav .nav__link")].map(n => n.textContent.trim()),
    booted: !!window.__aeroShowroom,
  })`);
  add("home is the default view", home.view === "home" && home.hangarHidden);
  add("hidden view is inert", home.hangarInert === true);
  add("nav has the six named tabs",
    home.tabs.join("|") === "Home|Hangar|Technology|Materials|Collection|Contact", home.tabs.join("|"));
  add("hangar is not initialised until opened", home.booted === false);

  await s.safe(`document.querySelector('#primaryNav [data-route="hangar"]').click()`);
  const opened = await s.waitFor(`document.documentElement.dataset.view === "hangar" && !!window.__aeroShowroom`);
  add("hangar tab opens the hangar view", opened);

  const inHangar = await s.safe(`({
    hash: location.hash,
    homeHidden: document.getElementById("viewHome").hidden,
    homeInert: document.getElementById("viewHome").inert,
    back: !!document.querySelector(".hangar__home"),
    active: document.querySelector("#primaryNav .nav__link.is-active")?.textContent.trim(),
    indicator: document.getElementById("navIndicator").style.width,
  })`);
  add("hangar updates the url hash", inHangar.hash === "#hangar", inHangar.hash);
  add("home view is hidden and inert while in the hangar", inHangar.homeHidden && inHangar.homeInert);
  add("back to home control is present", inHangar.back);
  add("active tab follows the route", inHangar.active === "Hangar", inHangar.active);
  add("nav indicator has been positioned", /\d/.test(inHangar.indicator || ""), inHangar.indicator);

  await s.waitFor(`window.__aeroShowroom.hangar.bays.every(b => b.loaded)`);
  await sleep(600);
  await s.shot("route-hangar.png");

  // Focus a shoe, leave, come back: the view keeps what it had.
  await s.safe(`window.__aeroShowroom.focus.focus(4)`);
  await sleep(2200);
  const handle = await s.safe(`window.__aeroShowroom.hangar.bays.length`);

  await s.safe(`history.back()`);
  const backHome = await s.waitFor(`document.documentElement.dataset.view === "home"`);
  add("browser back returns to home", backHome);

  const paused = await s.safe(`({
    rendering: !!window.__aeroShowroom,
    hangarHidden: document.getElementById("viewHangar").hidden,
  })`);
  add("hangar stays instantiated while closed", paused.rendering && paused.hangarHidden);

  await s.safe(`history.forward()`);
  const reopened = await s.waitFor(`document.documentElement.dataset.view === "hangar"`);
  await sleep(900);
  const kept = await s.safe(`({
    bays: window.__aeroShowroom.hangar.bays.length,
    focus: window.__aeroShowroom.focus.index,
    visible: document.documentElement.dataset.view === "hangar" && !document.getElementById("viewHangar").hidden,
  })`);
  add("browser forward reopens the hangar", reopened);
  add("hangar keeps its state when reopened", kept?.visible && kept?.bays === handle && kept?.focus === 4, `focus ${kept?.focus}, visible ${kept?.visible}`);

  // A section tab must send you home and then scroll.
  await s.safe(`document.querySelector('#primaryNav [data-section="materials"]').click()`);
  // The wipe, then a smooth scroll: poll rather than guess a sleep.
  await s.waitFor(`document.documentElement.dataset.view === "home"
    && Math.abs(document.getElementById("materials").getBoundingClientRect().top) < 400`, 25);
  const section = await s.safe(`({
    view: document.documentElement.dataset.view,
    nearMaterials: Math.abs(document.getElementById("materials").getBoundingClientRect().top) < 400,
  })`);
  add("a section tab returns home and scrolls there", section.view === "home" && section.nearMaterials,
    `view ${section.view}, near ${section.nearMaterials}`);

  add("no console errors while routing", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- deep link ---- */
{
  const s = await session({ port: 9243, seen: true, hash: "#hangar" });
  await s.waitFor("window.__aeroReady === true");
  const deep = await s.waitFor(`document.documentElement.dataset.view === "hangar"`);
  add("deep link to #hangar opens the hangar", deep);
  add("no console errors on a deep link", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- reduced motion ---- */
{
  const s = await session({ port: 9244, reduced: true });
  const ready = await s.waitFor(`document.getElementById("intro")?.classList.contains("is-static")`);
  add("reduced motion gets the fade intro, not the scene", ready);
  const noCanvas = await s.evaluate(`!document.querySelector("#intro .intro__canvas canvas")`);
  add("reduced motion builds no WebGL scene", noCanvas);
  await s.evaluate(`document.getElementById("introEnter").click()`);
  add("reduced motion intro can be entered", await s.waitFor(`!document.getElementById("intro")`));
  add("no console errors with reduced motion", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- no WebGL ---- */
{
  const s = await session({ port: 9245, noWebGL: true });
  const ready = await s.waitFor(`document.getElementById("intro")?.classList.contains("is-static")`);
  add("no-WebGL falls back to the static intro", ready);
  await s.evaluate(`document.getElementById("introEnter").click()`);
  await s.waitFor(`!document.getElementById("intro")`);
  await s.waitFor("window.__aeroReady === true");
  await s.evaluate(`document.querySelector('#primaryNav [data-route="hangar"]').click()`);
  await s.waitFor(`document.documentElement.dataset.view === "hangar"`, 25);
  const f = await s.evaluate(`({
    view: document.documentElement.dataset.view,
    fallback: !document.getElementById("hangarFallback").hidden,
    cards: document.querySelectorAll("#collectionGrid .card").length,
  })`);
  add("hangar tab shows the grid fallback without WebGL", f.view === "hangar" && f.fallback, JSON.stringify(f));
  add("collection grid intact without WebGL", f.cards === 13);
  add("no console errors without WebGL", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

/* ---- automated tooling ---- */
{
  const s = await session({ port: 9246, forceIntro: false });
  const booted = await s.waitFor("window.__aeroReady === true");
  add("an automated session boots without the film", booted);
  const hero = await s.safe(`({
    introGone: !document.getElementById("intro"),
    view: document.documentElement.dataset.view,
    heroRevealed: [...document.querySelectorAll("[data-hero]")].every((n) => n.classList.contains("is-revealed")),
  })`);
  add("automation sees the hero, not the film",
    hero?.introGone && hero.view === "home" && hero.heroRevealed, JSON.stringify(hero));
  add("no console errors on the automation path", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.close();
}

const passed = checks.filter((c) => c.pass).length;
await writeFile(join(OUT, "routing.json"), JSON.stringify({ checks, passed, total: checks.length }, null, 2));
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.note ? `  (${c.note})` : ""}`);
console.log(`\n${passed}/${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
