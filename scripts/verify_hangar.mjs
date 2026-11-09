/* Hangar H2 verification: boots the scene test page, collects the probe
   results, console errors and failed requests, and writes two screenshots.

   Needs scripts/serve.mjs on :5500. Launches its own Chrome on :9223 with a
   throwaway profile, so it does not disturb the browser you are using.
   Run: node scripts/verify_hangar.mjs
*/
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://127.0.0.1:5500";
const PORT = 9223;
const OUT = "public/_verification";
const PAGE = `${BASE}/scripts/hangar-test.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Headful by default: the frame-rate assertions need the real GPU. Pass
   --headless when another Chrome is competing for window focus, which makes
   captures and evaluates stall; the fps checks are skipped there because
   SwiftShader cannot answer them honestly. */
const HEADLESS = process.argv.includes("--headless");
// SwiftShader renders this scene at roughly 27fps, so a single evaluate can
// queue behind a long frame. Headless needs a much longer leash.
const EVAL_MS = HEADLESS ? 60000 : 20000;
const PROBE_TRIES = HEADLESS ? 140 : 60;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
].find((p) => existsSync(p));
if (!CHROME) throw new Error("Chrome not found");

await mkdir(OUT, { recursive: true });
const profile = join(tmpdir(), `aero-hangar-${Date.now()}`);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,900",
  "--hide-scrollbars",
  // Without these an unfocused window is treated as occluded, the compositor
  // stops producing frames, and Page.captureScreenshot never resolves.
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--autoplay-policy=no-user-gesture-required",
  PAGE,
], { stdio: "ignore", detached: false });

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        (this.handlers.get(message.method) || []).forEach((h) => h(message.params));
      }
    });
  }
  async ready() {
    if (this.ws.readyState === 1) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
}

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((e) => e.type === "page" && e.url.includes("hangar-test"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* chrome still starting */ }
    await sleep(500);
  }
  throw new Error("hangar-test page target never appeared");
}

const target = await findTarget();
const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.ready();

const errors = [];
const failed = [];
cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
  errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
});
cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
  if (type === "error" || type === "warning") {
    errors.push(`${type}: ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
});
cdp.on("Network.loadingFailed", ({ errorText, type }) => failed.push(`${type} ${errorText}`));
cdp.on("Network.responseReceived", ({ response, type }) => {
  if (response.status >= 400) failed.push(`${type} ${response.status} ${response.url}`);
});

await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
await cdp.send("Page.enable");
await cdp.send("Page.reload", { ignoreCache: true });
// A backgrounded window throttles rAF, which makes the probe sample a
// partial frame and the pointer tests miss.
await cdp.send("Page.bringToFront").catch(() => {});

// A stalled CDP call would otherwise hang the whole run with no output.
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
]);

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await withTimeout(cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  }), EVAL_MS, expression.slice(0, 60));
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
};

let probe = null;
for (let i = 0; i < PROBE_TRIES; i += 1) {
  await sleep(500);
  probe = await evaluate("window.__hangar ? window.__hangar.results : null");
  if (probe) break;
}
if (!probe) throw new Error("scene never reported results");

console.log("probe in:", JSON.stringify(probe));

const shot = async (name) => {
  console.log("shot", name);
  // An unfocused window can stop producing frames, and the capture then never
  // resolves; bringing it forward first keeps the compositor awake.
  await cdp.send("Page.bringToFront").catch(() => {});
  const { data } = await withTimeout(cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }), HEADLESS ? 45000 : 25000, name);
  await writeFile(join(OUT, name), Buffer.from(data, "base64"));
};
await shot("hangar-overview.png");

// Hover the first bay through a real pointer move, then shoot again so the
// lift and the brighter strip are visible in the proof. The camera drifts, so
// re-project between attempts instead of trusting one stale coordinate.
const project = () => evaluate(`(() => {
  const h = window.__hangar.hangar;
  const b = h.bays[0];
  h.camera.updateMatrixWorld();
  const v = new h.THREE.Vector3(b.bay.position.x, b.bay.position.y + b.restY, 0).project(h.camera);
  return { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight) };
})()`);

let box = await project();
for (let i = 0; i < 12; i += 1) {
  box = await project();
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await sleep(180);
  const got = await evaluate("window.__hangar.results.hoverLog.length");
  if (got > 0) break;
}
console.log("hover point", JSON.stringify(box));
await sleep(700);
console.log("hovered");
const hover = await evaluate("window.__hangar.results.hoverLog.slice(-4)");
await shot("hangar-hover.png");

box = await project();
await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
await sleep(120);
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
await sleep(250);
const select = await evaluate("window.__hangar.results.lastSelect");

// Sampled before teardown: destroy() stops the loop this measures.
const fps = await evaluate("window.__measureFps(3000)");
const firstId = await evaluate("window.__hangar.hangar.bays[0].shoe.id");


// ---- H3: focus mode, HUD, panel, keyboard ----
await cdp.send("Page.bringToFront").catch(() => {});

const snap = () => evaluate(`(() => {
  const m = document.getElementById("hangar");
  const p = m.querySelector(".hangar-panel");
  const read = (s) => m.querySelector(s)?.textContent?.trim() ?? null;
  return {
    index: window.__focus.index,
    focused: window.__hangar.results.focused,
    panelHidden: p.hidden,
    name: read("[data-p-name]"),
    price: read("[data-p-price]"),
    specs: p.querySelectorAll("[data-p-specs] dt").length,
    sizes: p.querySelectorAll(".hangar-panel__size").length,
    bay: read("[data-hangar-bay]"),
    tier: read("[data-hangar-tier]"),
    counter: read("[data-hangar-index]"),
    total: read("[data-hangar-total]"),
    coordsHidden: m.querySelector("[data-hangar-coords]").hidden,
    backHidden: m.querySelector("[data-hangar-back]").hidden,
    accent: p.style.getPropertyValue("--accent").trim(),
    fov: window.__hangar.hangar.camera.fov,
    camZ: +window.__hangar.hangar.camera.position.z.toFixed(2),
    dimmed: window.__hangar.hangar.bays.filter((b) => b.dim > 0.5).length,
    focusedTex: window.__hangar.hangar.bays[window.__focus.index]?.mesh.material.map?.image?.width ?? 0,
    brownMap: !!window.__hangar.hangar.bays[1].mesh.material.map?.image?.width,
  };
})()`);

const overviewZ = await evaluate("+window.__hangar.hangar.overviewZ.toFixed(2)");

await evaluate("window.__focus.focus(3)");
await sleep(2200);
const f1 = await snap();
await shot("hangar-focus.png");

const key = async (k) => {
  await evaluate(`document.getElementById("hangar").focus()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: k === "ArrowRight" ? 39 : k === "ArrowLeft" ? 37 : 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k });
};

await key("ArrowRight");
await sleep(2200);
const f2 = await snap();

// A turntable shoe: brown is index 1 and has a real rotation sequence.
await evaluate("window.__focus.focus(1)");
await sleep(3200);
const spinA = await evaluate("window.__hangar.hangar.bays[1].mesh.material.map?.image?.currentSrc || ''");
await sleep(1400);
const spinB = await evaluate("window.__hangar.hangar.bays[1].mesh.material.map?.image?.currentSrc || ''");
await shot("hangar-turntable.png");

// Black on a near-black wall is the hardest separation case; shoot it on the
// real GPU rather than trusting the headless software renderer.
await evaluate("window.__focus.focus(2)");
await sleep(2600);
await shot("hangar-focus-black.png");
await evaluate("window.__focus.focus(1)");
await sleep(2200);

// Panel actions must drive the real cart and localStorage wishlist.
const actions = await evaluate(`(() => {
  const m = document.getElementById("hangar");
  m.querySelector(".hangar-panel__size:last-child").click();
  m.querySelector("[data-p-save]").click();
  const saved = JSON.parse(localStorage.getItem("aero:wishlist:v1") || "[]");
  const pressed = m.querySelector("[data-p-save]").getAttribute("aria-pressed");
  m.querySelector("[data-p-save]").click();
  const cleared = JSON.parse(localStorage.getItem("aero:wishlist:v1") || "[]");
  return { saved, pressed, cleared, size: window.__focus.size };
})()`);

await key("Escape");
await sleep(2000);
const back = await snap();
const after = await evaluate(`(() => {
  const h = window.__hangar.hangar;
  const i = h.renderer.info;
  return { calls: i.render.calls, tris: i.render.triangles, tex: i.memory.textures,
           geo: i.memory.geometries, visible: h.scene.children.filter((c) => c.visible).length };
})()`);
console.log("after session:", JSON.stringify(after), "| probe was", probe.drawCalls, "calls /", probe.textures, "tex");

// Teardown must release every GPU object it created.
const teardown = await evaluate(`(() => {
  const h = window.__hangar.hangar;
  const before = { ...h.renderer.info.memory };
  window.__focus.destroy();
  h.destroy();
  return { before, after: { ...h.renderer.info.memory }, canvas: !!document.querySelector('.hangar__canvas') };
})()`);

const checks = [
  ["focus enters a shoe", f1.index === 3 && f1.focused === "3:kestrel"],
  ["focus narrows the lens", f1.fov < 35 && f1.camZ < overviewZ / 2],
  ["other bays dim", f1.dimmed === 12],
  ["focus loads the 1600px texture", f1.focusedTex > 1200],
  ["panel shows name, price, 3 specs, sizes", !f1.panelHidden && f1.name === "Kestrel" && /\d/.test(f1.price) && f1.specs === 3 && f1.sizes === 7],
  ["panel takes the shoe accent", f1.accent.toLowerCase() === "#c87729"],
  ["hud shows bay, tier and counter", f1.bay === "04" && f1.tier === "1" && f1.counter === "04" && f1.total === "13"],
  ["back button and coords visible in focus", f1.backHidden === false && f1.coordsHidden === false],
  ["arrow key steps to the next shoe", f2.index === 4 && f2.counter === "05"],
  ["turntable frames advance", spinA !== "" && spinA !== spinB],
  ["size selector drives state", actions.size === 45],
  ["wishlist writes and clears localStorage", actions.saved.length === 1 && actions.pressed === "true" && actions.cleared.length === 0],
  ["leaving a turntable restores a live texture",
    back.brownMap === true],
  ["escape returns to overview", back.index === -1 && back.panelHidden && back.dimmed === 0 && Math.abs(back.camZ - overviewZ) < 1.5],
  ["all 13 shoes placed", probe.shoes === 13 && probe.loaded === 13],
  ["no missing cutouts", Array.isArray(probe.missing) && probe.missing.length === 0],
  ["2 rows on desktop", probe.rows === 2],
  ["7 columns", probe.cols === 7],
  // Two separate claims: the wall holds vsync, and a full focus session does
  // not degrade it. The second is measured on a desktop running other apps,
  // so it is a no-regression bar, not a vsync bar.
  ...(HEADLESS ? [] : [
    ["60fps steady on the wall", probe.fps >= 58],
    ["no fps regression after a focus session", fps >= 50],
  ]),
  ["pixel ratio capped at 2", probe.pixelRatio <= 2],
  ["no page errors", errors.length === 0],
  ["no failed requests", failed.length === 0],
  ["hover reports bay 0", Array.isArray(hover) && hover.includes(firstId)],
  ["click reports a shoe", typeof select === "string" && select.startsWith("0:")],
  // 22 textures before, 1 after, across a session touching three shoes and two
  // turntables: a per-shoe leak would leave several. The residual is internal
  // to three.js, like the shared Sprite geometry below.
  ["teardown frees textures", teardown.after.textures <= 1],
  // three.js holds one shared Sprite geometry for the module lifetime.
  ["teardown frees geometries", teardown.after.geometries <= 1],
  ["teardown removes canvas", teardown.canvas === false],
];

const report = {
  page: PAGE,
  probe, fps: Math.round(fps), hover, select, teardown, errors, failed,
  focus: { overviewZ, f1, f2, back, actions, spinA, spinB },
  checks: checks.map(([name, pass]) => ({ name, pass })),
  passed: checks.filter(([, p]) => p).length,
  total: checks.length,
};
await writeFile(join(OUT, "hangar_h2.json"), JSON.stringify(report, null, 2));

for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
console.log(`\n${report.passed}/${report.total} checks`);
if (errors.length) console.log("errors:", errors.slice(0, 6));
if (failed.length) console.log("failed requests:", failed.slice(0, 6));
console.log("probe:", JSON.stringify(probe));
console.log("settled fps:", Math.round(fps));

await cdp.send("Browser.close").catch(() => {});
chrome.kill();
await sleep(400);
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(report.passed === report.total ? 0 : 1);
