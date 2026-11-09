/* Phase 2 verification for the AERO frame engine.
   Needs scripts/serve.mjs on :5500 and Chrome with --remote-debugging-port=9222.
   Run: node scripts/verify_scrub.mjs
*/
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:5500";
const OUT = "public/_verification";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(OUT, { recursive: true });

const list = await fetch("http://127.0.0.1:9222/json/list").then((res) => res.json());
const target = list.find((entry) => entry.type === "page");
if (!target) throw new Error("No Chrome page target found");

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
        (this.handlers.get(message.method) || []).forEach((handler) => handler(message.params));
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

const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.ready();

const errors = [];
const warnings = [];
const failedRequests = [];
const frameResponses = [];
let loadResolvers = [];

cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
  errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
});
cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
  const text = args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
  if (type === "error") errors.push(`console.error: ${text}`);
  if (type === "warning") warnings.push(`console.warn: ${text}`);
});
cdp.on("Log.entryAdded", ({ entry }) => {
  if (entry.level === "error") errors.push(`log: ${entry.text}`);
});
cdp.on("Network.responseReceived", ({ response }) => {
  if (response.url.includes("/frames/")) {
    frameResponses.push({ url: response.url, status: response.status });
  }
  if (response.status >= 400 && !response.url.endsWith("/favicon.ico")) {
    failedRequests.push(`${response.status} ${response.url}`);
  }
});
cdp.on("Network.loadingFailed", (event) => {
  if (!event.canceled) failedRequests.push(`failed ${event.errorText} ${event.type}`);
});
cdp.on("Page.loadEventFired", () => {
  loadResolvers.forEach((resolve) => resolve());
  loadResolvers = [];
});

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Network.enable");
await cdp.send("Network.clearBrowserCache");
await cdp.send("Page.bringToFront");

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function navigate(url) {
  const loaded = new Promise((resolve) => loadResolvers.push(resolve));
  await cdp.send("Page.navigate", { url });
  await Promise.race([loaded, sleep(15000)]);
}

async function waitFor(expression, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(200);
  }
  return false;
}

async function setViewport(width, height, deviceScaleFactor = 1) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: width < 600,
    screenWidth: width,
    screenHeight: height,
  });
}

async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
}

const report = { checks: [], engine: null, page: null, network: null, console: {} };
const check = (name, pass, detail) => report.checks.push({ name, pass: Boolean(pass), detail });

/* Engine tests against the new public frames and the legacy assets. */
await setViewport(1440, 900, 1);
await navigate(`${BASE}/scripts/scrub-test.html?t=${Date.now()}`);
const harnessReady = await waitFor("Boolean(window.__scrubReady)");
check("harness: modules load", harnessReady);

const engine = await evaluate(`(async () => {
  const { FrameSequence, ScrubStage, SHOES } = window.__scrub;
  const blue = SHOES.find((shoe) => shoe.id === "blue");
  const out = {};

  const seq = new FrameSequence(blue, "desktop");
  out.desktop = {
    basePath: seq.basePath,
    count: seq.count,
    first: seq.first,
    span: seq.span,
    urlFirst: seq.url(0),
    urlLast: seq.url(seq.count - 1),
    frameAt0: seq.frameAt(0),
    frameAt1: seq.frameAt(1),
  };
  const progress = [];
  const started = performance.now();
  await seq.preloadFirst(20, (value) => progress.push(value));
  const firstImage = seq.images.get(0);
  out.desktop.load = {
    loaded: seq.images.size,
    ready: seq.ready,
    elapsed: Math.round(performance.now() - started),
    progressCount: progress.length,
    progressFirst: progress[0],
    progressLast: progress[progress.length - 1],
    bitmap: typeof ImageBitmap !== "undefined" && firstImage instanceof ImageBitmap,
    width: firstImage ? firstImage.width : 0,
    height: firstImage ? firstImage.height : 0,
  };
  seq.dispose();
  out.desktop.disposed = { disposed: seq.disposed, images: seq.images.size };

  const mobile = new FrameSequence(blue, "mobile");
  out.mobile = { basePath: mobile.basePath, count: mobile.count, urlFirst: mobile.url(0) };
  await mobile.preloadFirst(2);
  const mobileImage = mobile.images.get(0);
  out.mobile.load = {
    loaded: mobile.images.size,
    bitmap: typeof ImageBitmap !== "undefined" && mobileImage instanceof ImageBitmap,
    width: mobileImage ? mobileImage.width : 0,
    height: mobileImage ? mobileImage.height : 0,
  };
  mobile.dispose();

  const fallback = new FrameSequence(blue, "desktop", { maxWidth: 640 });
  const originalBitmap = window.createImageBitmap;
  window.createImageBitmap = undefined;
  try {
    await fallback.preloadFirst(1);
    const fallbackImage = fallback.images.get(0);
    out.fallback = {
      loaded: fallback.images.size,
      htmlImage: fallbackImage instanceof HTMLImageElement,
      complete: Boolean(fallbackImage && fallbackImage.complete),
      width: fallbackImage ? fallbackImage.naturalWidth : 0,
    };
  } finally {
    window.createImageBitmap = originalBitmap;
    fallback.dispose();
  }

  const legacy = new FrameSequence(
    { id: "legacy", framePath: "assets/blue/frames", frameCount: 240, frameStart: 24 },
    "desktop",
  );
  out.legacy = {
    count: legacy.count,
    first: legacy.first,
    span: legacy.span,
    urlFirst: legacy.url(legacy.first),
    urlLast: legacy.url(239),
  };
  await legacy.preloadFirst(2);
  const legacyImage = legacy.images.get(legacy.first);
  out.legacy.load = {
    loaded: legacy.images.size,
    width: legacyImage ? legacyImage.width : 0,
    height: legacyImage ? legacyImage.height : 0,
  };
  legacy.dispose();

  const small = new FrameSequence(
    {
      id: "small",
      assets: {
        frames: {
          desktop: "public/shoes/blue/frames/desktop",
          mobile: "public/shoes/blue/frames/mobile",
          count: 30,
        },
      },
    },
    "desktop",
    { maxCached: 24, maxWidth: 640 },
  );
  await small.preloadFirst(5);
  await small.startBackgroundLoad();
  out.cache = { loaded: small.images.size, complete: small.complete, maxCached: 24 };
  small.dispose();

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:300px;background:#000;";
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const counter = document.createElement("span");
  const name = document.createElement("span");
  document.body.append(host, counter, name);

  const stageSeq = new FrameSequence(blue, "desktop", { maxWidth: 640 });
  await stageSeq.preloadFirst(20);
  await stageSeq.load(128);
  const stage = new ScrubStage({
    canvas,
    stage: host,
    counter,
    name,
    poster: "public/shoes/blue/poster-360.webp",
    maxDpr: 2,
  });
  stage.setSequence(stageSeq);
  stage.setLabel("Cirra");
  stage.setProgress(0.6);
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  let samples = 0;
  for (let i = 0; i < pixels.length; i += 4 * 97) {
    samples += 1;
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) lit += 1;
  }
  out.stage = {
    canvas: {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    },
    counter: counter.textContent,
    label: name.textContent,
    frame: stage.frame,
    running: stage.running,
    exactFrameLoaded: stageSeq.has(128),
    lit,
    samples,
  };
  stage.dispose();
  out.stage.disposed = stage.disposed;
  host.remove();
  counter.remove();
  name.remove();

  return out;
})()`);

report.engine = engine;
check("new data: blue desktop count 215", engine.desktop.count === 215);
check("new data: blue starts at frame 1", engine.desktop.first === 0 && engine.desktop.urlFirst.endsWith("public/shoes/blue/frames/desktop/frame_001.webp"));
check("new data: last frame URL", engine.desktop.urlLast.endsWith("frame_215.webp") && engine.desktop.span === 214);
check("preload: first 20 frames", engine.desktop.load.loaded === 20 && engine.desktop.load.ready);
check("preload: progress reaches 1", engine.desktop.load.progressCount === 20 && engine.desktop.load.progressLast === 1);
check("preload: frames are ImageBitmaps", engine.desktop.load.bitmap && engine.desktop.load.width === 1280 && engine.desktop.load.height === 720);
check("dispose: clears sequence", engine.desktop.disposed.disposed && engine.desktop.disposed.images === 0);
check("mobile: uses mobile path", engine.mobile.basePath.endsWith("public/shoes/blue/frames/mobile") && engine.mobile.urlFirst.endsWith("frame_001.webp"));
check("mobile: frames are 720 wide", engine.mobile.load.bitmap && engine.mobile.load.width === 720);
check("fallback: HTMLImageElement path", engine.fallback.loaded === 1 && engine.fallback.htmlImage && engine.fallback.complete && engine.fallback.width === 1280);
check("legacy: keeps 240 frames and start 24", engine.legacy.count === 240 && engine.legacy.first === 23 && engine.legacy.urlFirst.endsWith("assets/blue/frames/desktop/frame_024.webp"));
check("legacy: loads and resizes frames", engine.legacy.load.loaded === 2 && engine.legacy.load.width === 1280);
check("cache: bounded background load", engine.cache.complete && engine.cache.loaded <= engine.cache.maxCached);
check("stage: lerp lands on frame 129", engine.stage.frame === 128 && engine.stage.counter === "129" && engine.stage.exactFrameLoaded);
check("stage: canvas is DPR aware", engine.stage.canvas.width === 480 && engine.stage.canvas.height === 300 && engine.stage.canvas.cssWidth === 480);
check("stage: canvas draws pixels", engine.stage.lit > engine.stage.samples * 0.2);
check("stage: label and dispose", engine.stage.label === "Cirra" && engine.stage.disposed);

/* DPR 2 check. */
await setViewport(1440, 900, 2);
await navigate(`${BASE}/scripts/scrub-test.html?t=${Date.now()}&dpr=2`);
await waitFor("Boolean(window.__scrubReady)");
const dpr = await evaluate(`(async () => {
  const { ScrubStage } = window.__scrub;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:300px;";
  const canvas = document.createElement("canvas");
  host.append(canvas);
  document.body.append(host);
  const stage = new ScrubStage({ canvas, stage: host, maxDpr: 2 });
  const out = {
    dpr: window.devicePixelRatio,
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
  };
  stage.dispose();
  host.remove();
  return out;
})()`);
report.dpr = dpr;
check("stage: DPR 2 backing store", dpr.dpr === 2 && dpr.width === 960 && dpr.height === 600 && dpr.cssWidth === 480 && dpr.cssHeight === 300);

/* Reduced motion jumps straight to the target frame. */
await cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
await navigate(`${BASE}/scripts/scrub-test.html?t=${Date.now()}&reduced=1`);
await waitFor("Boolean(window.__scrubReady)");
const reduced = await evaluate(`(async () => {
  const { FrameSequence, ScrubStage, SHOES } = window.__scrub;
  const blue = SHOES.find((shoe) => shoe.id === "blue");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:300px;";
  const canvas = document.createElement("canvas");
  host.append(canvas);
  document.body.append(host);
  const sequence = new FrameSequence(blue, "desktop", { maxWidth: 640 });
  await sequence.preloadFirst(1);
  const stage = new ScrubStage({ canvas, stage: host, maxDpr: 2 });
  stage.setSequence(sequence);
  stage.setProgress(0.5);
  const out = {
    reduced: stage.reduced,
    frame: stage.frame,
    expected: sequence.frameAt(0.5),
    running: stage.running,
    progress: stage.progress,
  };
  stage.dispose();
  host.remove();
  return out;
})()`);
report.reduced = reduced;
check("reduced motion: jumps to target frame", reduced.reduced && reduced.frame === reduced.expected && reduced.progress === 0.5 && !reduced.running);
await cdp.send("Emulation.setEmulatedMedia", { features: [] });

/* Live page integration on the legacy STRATA shell. */
await setViewport(1440, 900, 1);
const harnessConsole = { errors: errors.splice(0), failedRequests: failedRequests.splice(0) };
report.harnessConsole = harnessConsole;
check("harness: no runtime errors", harnessConsole.errors.length === 0);
check("harness: no failed requests", harnessConsole.failedRequests.length === 0);

frameResponses.length = 0;
await navigate(`${BASE}/index.html?phase2=${Date.now()}`);
const booted = await waitFor(`Boolean(
  document.getElementById("orbitCanvas") &&
  (document.body.classList.contains("is-ready") || !document.body.classList.contains("is-loading"))
)`, 20000);
check("page: boot completes", booted);
const pinReady = await waitFor("document.documentElement.classList.contains('has-pin')", 12000);
check("page: ScrollTrigger pin initializes", pinReady);
await sleep(800);

const pageBefore = await evaluate(`(() => {
  const canvas = document.getElementById("orbitCanvas");
  return {
    shoe: document.documentElement.dataset.shoe,
    counter: document.getElementById("orbitCounter")?.textContent,
    canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null,
    preloaderHidden: Boolean(document.getElementById("preloader")?.hidden),
  };
})()`);

await evaluate(`window.scrollTo(0, document.getElementById("orbit").offsetTop + 900)`);
await sleep(2200);
const pageAfter = await evaluate(`(() => {
  const canvas = document.getElementById("orbitCanvas");
  const ctx = canvas?.getContext("2d");
  let lit = 0;
  let samples = 0;
  if (ctx) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4 * 997) {
      samples += 1;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) lit += 1;
    }
  }
  return {
    counter: document.getElementById("orbitCounter")?.textContent,
    name: document.getElementById("orbitName")?.textContent,
    pinned: document.documentElement.classList.contains("has-pin"),
    callout: document.querySelector(".orbit__callout.is-active h3")?.textContent || null,
    lit,
    samples,
  };
})()`);
report.page = { before: pageBefore, after: pageAfter };
check("page: canvas has a backing store", pageBefore.canvas && pageBefore.canvas.width > 0 && pageBefore.canvas.height > 0);
check("page: scroll changes the frame counter", pageBefore.counter !== pageAfter.counter);
check("page: ScrollTrigger pin active", pageAfter.pinned);
check("page: canvas draws the shoe", pageAfter.lit > pageAfter.samples * 0.2);
await shot("phase2-orbit");

/* Video playback stays muted, inline, and observer-driven. */
const videoAttrs = await evaluate(`["heroVideo", "techVideo", "materialVideo", "collectionVideo"].map((id) => {
  const video = document.getElementById(id);
  return video ? {
    id,
    muted: video.muted,
    playsInline: video.playsInline,
    preload: video.preload,
    poster: Boolean(video.poster),
  } : null;
})`);
report.videoAttrs = videoAttrs;
check("video: muted, inline, metadata, poster", videoAttrs.every((video) => video && video.muted && video.playsInline && video.preload === "metadata" && video.poster));
await evaluate(`document.getElementById("materials").scrollIntoView()`);
await sleep(1600);
const videoVisible = await evaluate(`(() => {
  const video = document.getElementById("materialVideo");
  return { paused: video.paused, time: video.currentTime, readyState: video.readyState };
})()`);
await evaluate(`window.scrollTo(0, 0)`);
await sleep(1200);
const videoHidden = await evaluate(`document.getElementById("materialVideo").paused`);
report.videoPlayback = { visible: videoVisible, hiddenPaused: videoHidden };
check("video: plays when visible", !videoVisible.paused && videoVisible.readyState >= 2);
check("video: pauses offscreen", videoHidden === true);
await evaluate(`window.scrollTo(0, document.getElementById("orbit").offsetTop + 900)`);
await sleep(500);

const frameNames = frameResponses.map((entry) => entry.url.split("/").slice(-3).join("/"));
report.network = {
  count: frameResponses.length,
  first: frameNames.slice(0, 5),
  last: frameNames.slice(-5),
  statuses: [...new Set(frameResponses.map((entry) => entry.status))],
};
check("network: frame requests succeed", frameResponses.length > 20 && frameResponses.every((entry) => entry.status === 200));
check("network: public blue frames used", frameResponses.some((entry) => entry.url.includes("/public/shoes/blue/frames/desktop/frame_001.webp")));

/* Switch shoes on the live page. */
await evaluate(`document.querySelector('.swatch[data-shoe="brown"]').click()`);
await sleep(1800);
const brown = await evaluate(`({
  shoe: document.documentElement.dataset.shoe,
  name: document.getElementById("orbitName")?.textContent,
  counter: document.getElementById("orbitCounter")?.textContent,
})`);
check("page: switch to brown updates stage", brown.shoe === "brown" && brown.name === "Terrae");
check("network: brown frames requested", frameResponses.some((entry) => entry.url.includes("/public/shoes/brown/frames/desktop/frame_001.webp")));

await evaluate(`document.querySelector('.swatch[data-shoe="black"]').click()`);
await sleep(1800);
const black = await evaluate(`({
  shoe: document.documentElement.dataset.shoe,
  name: document.getElementById("orbitName")?.textContent,
})`);
check("page: switch to black updates stage", black.shoe === "black" && black.name === "Onyx");
check("network: black frames requested", frameResponses.some((entry) => entry.url.includes("/public/shoes/black/frames/desktop/frame_001.webp")));

/* Mobile page uses the 720 px frame set. */
await setViewport(390, 844, 1);
frameResponses.length = 0;
await navigate(`${BASE}/index.html?phase2=mobile&t=${Date.now()}`);
const mobileBooted = await waitFor(`Boolean(
  document.getElementById("orbitCanvas") &&
  (document.body.classList.contains("is-ready") || !document.body.classList.contains("is-loading"))
)`, 20000);
const mobilePin = await waitFor("document.documentElement.classList.contains('has-pin')", 12000);
await sleep(800);
const mobileBefore = await evaluate(`(() => {
  const canvas = document.getElementById("orbitCanvas");
  return {
    counter: document.getElementById("orbitCounter")?.textContent,
    canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null,
  };
})()`);
await evaluate(`window.scrollTo(0, document.getElementById("orbit").offsetTop + 600)`);
await sleep(2000);
const mobileAfter = await evaluate(`(() => {
  const canvas = document.getElementById("orbitCanvas");
  const ctx = canvas?.getContext("2d");
  let lit = 0;
  let samples = 0;
  if (ctx) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4 * 997) {
      samples += 1;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) lit += 1;
    }
  }
  return {
    counter: document.getElementById("orbitCounter")?.textContent,
    name: document.getElementById("orbitName")?.textContent,
    canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null,
    lit,
    samples,
  };
})()`);
report.mobilePage = { before: mobileBefore, after: mobileAfter };
check("mobile page: boot and pin", mobileBooted && mobilePin);
check("mobile page: 720 px frames requested", frameResponses.some((entry) => entry.url.includes("/public/shoes/blue/frames/mobile/frame_001.webp")));
check("mobile page: scroll changes counter", mobileBefore.counter !== mobileAfter.counter);
check("mobile page: canvas draws", mobileAfter.lit > mobileAfter.samples * 0.2);
await shot("phase2-mobile-orbit");

report.console = { errors, warnings, failedRequests };
check("console: no runtime errors", errors.length === 0);
check("network: no failed requests", failedRequests.length === 0);

await writeFile(`${OUT}/phase2_scrub.json`, JSON.stringify(report, null, 2));

const failed = report.checks.filter((entry) => !entry.pass);
console.log(`\nChecks: ${report.checks.length - failed.length}/${report.checks.length} passed`);
failed.forEach((entry) => console.log(`  FAIL ${entry.name}${entry.detail ? ` — ${JSON.stringify(entry.detail)}` : ""}`));
console.log(`Engine: ${JSON.stringify(report.engine, null, 2)}`);
console.log(`Page: ${JSON.stringify(report.page)}`);
console.log(`Network: ${JSON.stringify(report.network)}`);
console.log(`Errors: ${errors.length}`);
errors.forEach((error) => console.log(`  ${error}`));
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 8).forEach((warning) => console.log(`  ${warning}`));
console.log(`Failed requests: ${failedRequests.length}`);
failedRequests.slice(0, 8).forEach((failure) => console.log(`  ${failure}`));
process.exit(failed.length ? 1 : 0);
