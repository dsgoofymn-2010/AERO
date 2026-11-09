/* Headless Chrome verification for STRATA.
   Run a local server on :5500 and Chrome with --remote-debugging-port=9222,
   then: node scripts/verify.mjs
*/
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:5500";
const OUT = "assets/_verification/browser";
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
  if (response.status >= 400) failedRequests.push(`${response.status} ${response.url}`);
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

async function waitForBoot(timeout = 16000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const done = await evaluate(`Boolean(
      document.getElementById("preloader")?.hidden ||
      document.body.classList.contains("is-fallback") ||
      !document.body.classList.contains("is-loading")
    )`);
    if (done) return true;
    await sleep(250);
  }
  return false;
}

async function setViewport(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
    screenWidth: width,
    screenHeight: height,
  });
}

async function shot(name, fullPage = false) {
  const params = { format: "png", captureBeyondViewport: fullPage };
  if (fullPage) {
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize;
    params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
  }
  const { data } = await cdp.send("Page.captureScreenshot", params);
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
}

async function shotSection(selector, name, maxHeight = 2600) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  })()`);
  if (!box) return;
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(box.width, 2000),
      height: Math.min(box.height, maxHeight),
      scale: 1,
    },
  });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
}

async function waitForLibraries(timeout = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(window.gsap && window.Lenis)`)) return true;
    await sleep(200);
  }
  return false;
}

const report = { viewports: [], checks: [], console: {}, screenshots: [] };

async function layoutCheck(label) {
  const metrics = await evaluate(`({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    preloaderHidden: Boolean(document.getElementById("preloader")?.hidden),
    isFallback: document.documentElement.classList.contains("is-fallback"),
    shoe: document.documentElement.dataset.shoe,
    heroSplit: Boolean(document.querySelector(".hero__title.split-ready")),
    words: document.querySelectorAll(".hero__title .word__inner").length,
    heroOpacity: getComputedStyle(document.querySelector(".hero__copy")).opacity,
    fonts: document.fonts.status,
    gsap: Boolean(window.gsap),
    lenis: Boolean(window.Lenis),
    canvas: (() => {
      const c = document.getElementById("orbitCanvas");
      return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
    })(),
    h1: document.querySelector("h1")?.innerText,
  })`);
  const overflow = metrics.scrollWidth > metrics.width + 1 || metrics.bodyWidth > metrics.width + 1;
  report.viewports.push({ label, ...metrics, overflow });
  report.checks.push({ name: `${label}: no horizontal overflow`, pass: !overflow });
  report.checks.push({ name: `${label}: boot completed`, pass: metrics.preloaderHidden && !metrics.isFallback });
  report.checks.push({ name: `${label}: split title active`, pass: metrics.heroSplit && metrics.words === 4 });
  report.checks.push({ name: `${label}: hero copy visible`, pass: Number(metrics.heroOpacity) > 0.9 });
  report.checks.push({ name: `${label}: fonts loaded`, pass: metrics.fonts === "loaded" });
  return metrics;
}

const viewports = [
  { label: "360", width: 360, height: 780 },
  { label: "768", width: 768, height: 1024 },
  { label: "1024", width: 1024, height: 768 },
  { label: "1440", width: 1440, height: 900 },
  { label: "1920", width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  await setViewport(viewport.width, viewport.height);
  await navigate(`${BASE}/?viewport=${viewport.label}&t=${Date.now()}`);
  const booted = await waitForBoot();
  if (!booted) report.checks.push({ name: `${viewport.label}: boot completed`, pass: false });
  await sleep(2800);
  await layoutCheck(viewport.label);
  await shot(`${viewport.label}-hero`);
  await evaluate(`window.scrollTo(0, document.getElementById("orbit").offsetTop + 20)`);
  await sleep(1000);
  await shot(`${viewport.label}-orbit`);
  await evaluate(`document.getElementById("technology").scrollIntoView()`);
  await sleep(900);
  await shot(`${viewport.label}-tech`);
  await evaluate(`document.getElementById("collection").scrollIntoView()`);
  await sleep(900);
  await shot(`${viewport.label}-collection`);
  if (viewport.label === "1440") {
    for (const [selector, name] of [
      ["#materials", "1440-materials"],
      ["#notes", "1440-notes"],
      ["footer", "1440-footer"],
    ]) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView()`);
      await sleep(900);
      await shot(name);
      await shotSection(selector, `${name}-section`);
    }
  }
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(500);
  report.screenshots.push(`${viewport.label}-hero`, `${viewport.label}-orbit`, `${viewport.label}-tech`, `${viewport.label}-collection`);
}

/* Interaction tests at desktop */
await setViewport(1440, 900);
await navigate(`${BASE}/?test=interactions&t=${Date.now()}`);
await waitForBoot();
await sleep(1200);

await evaluate(`localStorage.removeItem("strata-bag-v1"); localStorage.removeItem("strata-wishlist");`);
await navigate(`${BASE}/?test=clean&t=${Date.now()}`);
await waitForBoot();
await sleep(800);

// Switch to brown.
await evaluate(`document.querySelector('.swatch[data-shoe="brown"]').click()`);
await sleep(1200);
const brown = await evaluate(`({
  shoe: document.documentElement.dataset.shoe,
  name: document.getElementById("viewerName").textContent,
  type: document.getElementById("viewerType").textContent,
  price: document.getElementById("viewerPrice").textContent,
  heroName: document.getElementById("heroProductName").textContent,
  outline: document.getElementById("heroOutline").textContent,
  swatchPressed: document.querySelector('.swatch[data-shoe="brown"]').getAttribute("aria-pressed"),
  cardPressed: document.querySelector('.product-card[data-shoe="brown"]').getAttribute("aria-pressed"),
  poster: document.getElementById("collectionVideo").poster,
  sources: [...document.querySelectorAll("#collectionVideo source")].map((s) => s.src),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  stageName: document.getElementById("orbitName").textContent,
})`);
report.checks.push({ name: "product switch: theme and copy", pass: brown.shoe === "brown" && brown.name === "Terrain" && brown.heroName === "Terrain" && brown.outline === "TERRAIN" });
report.checks.push({ name: "product switch: aria/state", pass: brown.swatchPressed === "true" && brown.cardPressed === "true" });
report.checks.push({ name: "product switch: media paths", pass: brown.poster.includes("/brown/") && brown.sources.every((src) => src.includes("/brown/")) });
report.checks.push({
  name: "product switch: accent token",
  pass: brown.accent.toLowerCase() === "#b5733b" || brown.accent.replace(/\s/g, "") === "rgb(181,115,59)",
});
report.checks.push({ name: "product switch: stage label", pass: brown.stageName === "Terrain" });
report.interactions = { brown };

// Tech part.
await evaluate(`document.getElementById("technology").scrollIntoView()`);
await sleep(700);
const techBefore = await evaluate(`(() => {
  const video = document.getElementById("techVideo");
  return {
    time: video.currentTime,
    duration: video.duration,
    readyState: video.readyState,
    networkState: video.networkState,
    seeking: video.seeking,
    src: video.currentSrc,
  };
})()`);
await evaluate(`document.querySelector('.tech__part[data-part="2"]').click()`);
await sleep(100);
const techImmediate = await evaluate(`(() => {
  const video = document.getElementById("techVideo");
  return { time: video.currentTime, readyState: video.readyState, seeking: video.seeking };
})()`);
await sleep(1600);
const tech = await evaluate(`({
  name: document.getElementById("techActiveName").textContent,
  active: document.querySelector(".tech__part.is-active")?.dataset.part,
  hotspot: document.querySelector(".hotspot.is-active")?.dataset.part,
  time: document.getElementById("techVideo").currentTime,
  duration: document.getElementById("techVideo").duration,
  readyState: document.getElementById("techVideo").readyState,
  seeking: document.getElementById("techVideo").seeking,
  networkState: document.getElementById("techVideo").networkState,
  src: document.getElementById("techVideo").currentSrc,
  error: document.getElementById("techVideo").error?.message || null,
})`);
report.checks.push({ name: "tech: part selection syncs copy, button, hotspot", pass: tech.name === "Upper" && tech.active === "2" && tech.hotspot === "2" });
report.checks.push({ name: "tech: video seeks to part", pass: Number.isFinite(tech.time) && tech.time > 0.2 });
report.interactions.tech = { before: techBefore, immediate: techImmediate, after: tech };

// Cart + checkout.
await evaluate(`document.getElementById("addToCart").click()`);
await sleep(500);
const cart = await evaluate(`({
  open: document.getElementById("cartDrawer").classList.contains("is-open"),
  hidden: document.getElementById("cartDrawer").getAttribute("aria-hidden"),
  count: document.getElementById("cartCount").textContent,
  subtotal: document.getElementById("cartSubtotal").textContent,
  items: document.querySelectorAll(".cart-item").length,
  focus: document.activeElement?.id,
  bodyLocked: document.body.classList.contains("cart-open"),
})`);
report.checks.push({ name: "cart: add opens drawer with correct line", pass: cart.open && cart.hidden === "false" && cart.count === "1" && cart.items === 1 && cart.bodyLocked });
report.checks.push({ name: "cart: subtotal for Terrain", pass: cart.subtotal.includes("24,500") });
report.checks.push({ name: "cart: focus moves into drawer", pass: cart.focus === "cartClose" });
report.interactions.cart = cart;

await evaluate(`document.getElementById("checkoutButton").click()`);
await sleep(400);
const checkout = await evaluate(`({
  open: document.getElementById("checkoutDialog").open,
  summary: document.getElementById("checkoutSummary").textContent,
  focus: document.activeElement?.id,
})`);
report.checks.push({ name: "checkout: dialog opens with summary", pass: checkout.open && checkout.summary.includes("1 item") && checkout.summary.includes("24,500") });
report.checks.push({ name: "checkout: focus on return button", pass: checkout.focus === "closeCheckout" });
await evaluate(`document.getElementById("closeCheckout").click()`);
await sleep(300);
const closedCheckout = await evaluate(`document.getElementById("checkoutDialog").open`);
report.checks.push({ name: "checkout: dialog closes", pass: closedCheckout === false });

await evaluate(`document.getElementById("cartClose").click()`);
await sleep(400);
const cartClosed = await evaluate(`({
  open: document.getElementById("cartDrawer").classList.contains("is-open"),
  hidden: document.getElementById("cartDrawer").getAttribute("aria-hidden"),
  focus: document.activeElement?.id,
})`);
report.checks.push({ name: "cart: close restores state and focus", pass: !cartClosed.open && cartClosed.hidden === "true" && cartClosed.focus === "addToCart" });
report.interactions.checkout = checkout;
report.interactions.cartClosed = cartClosed;

// Wishlist.
await evaluate(`document.getElementById("wishlistToggle").click()`);
const wish = await evaluate(`({
  pressed: document.getElementById("wishlistToggle").getAttribute("aria-pressed"),
  stored: localStorage.getItem("strata-wishlist"),
})`);
report.checks.push({ name: "wishlist: toggles and persists", pass: wish.pressed === "true" && wish.stored.includes("brown") });
await evaluate(`document.getElementById("wishlistToggle").click()`);

// Newsletter.
await evaluate(`document.getElementById("newsletter").scrollIntoView()`);
await sleep(500);
await evaluate(`document.getElementById("email").value = "not-an-email"; document.getElementById("newsletterForm").requestSubmit();`);
await sleep(200);
const newsBad = await evaluate(`({
  error: document.getElementById("emailError").textContent,
  invalid: document.getElementById("email").getAttribute("aria-invalid"),
  hidden: document.getElementById("emailError").hidden,
})`);
report.checks.push({ name: "newsletter: rejects invalid email", pass: !newsBad.hidden && newsBad.invalid === "true" && newsBad.error.length > 5 });
await evaluate(`document.getElementById("email").value = "test@studio.com"; document.getElementById("newsletterForm").requestSubmit();`);
await sleep(300);
const newsGood = await evaluate(`({
  success: !document.getElementById("newsletterSuccess").hidden,
  errorHidden: document.getElementById("emailError").hidden,
  value: document.getElementById("email").value,
})`);
report.checks.push({ name: "newsletter: accepts valid email, demo state", pass: newsGood.success && newsGood.errorHidden && newsGood.value === "" });
report.interactions.newsletter = { newsBad, newsGood };

/* Mobile-specific: menu and cart bottom sheet */
await setViewport(360, 780);
await navigate(`${BASE}/?test=mobile&t=${Date.now()}`);
await waitForBoot();
await sleep(800);
await evaluate(`window.scrollTo(0, 120)`);
await sleep(300);
await evaluate(`document.getElementById("menuToggle").focus(); document.getElementById("menuToggle").click()`);
await sleep(400);
const menu = await evaluate(`({
  open: document.getElementById("mobileMenu").classList.contains("is-open"),
  expanded: document.getElementById("menuToggle").getAttribute("aria-expanded"),
  hidden: document.getElementById("mobileMenu").getAttribute("aria-hidden"),
  focus: document.activeElement?.id,
  body: document.body.classList.contains("menu-open"),
})`);
report.checks.push({ name: "mobile menu: opens, locks page, moves focus", pass: menu.open && menu.expanded === "true" && menu.hidden === "false" && menu.focus === "menuClose" && menu.body });
await shot("360-menu");
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(400);
const menuClosed = await evaluate(`({
  open: document.getElementById("mobileMenu").classList.contains("is-open"),
  expanded: document.getElementById("menuToggle").getAttribute("aria-expanded"),
  focus: document.activeElement?.id,
})`);
report.checks.push({ name: "mobile menu: Escape closes and restores focus", pass: !menuClosed.open && menuClosed.expanded === "false" && menuClosed.focus === "menuToggle" });
report.interactions.menu = { menu, menuClosed };

await evaluate(`document.getElementById("addToCart").click()`);
await sleep(600);
const mobileCart = await evaluate(`({
  open: document.getElementById("cartDrawer").classList.contains("is-open"),
  rect: (() => { const r = document.getElementById("cartDrawer").getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })(),
  viewport: { w: innerWidth, h: innerHeight },
})`);
report.checks.push({ name: "mobile cart: opens within viewport", pass: mobileCart.open && mobileCart.rect.left >= 0 && mobileCart.rect.right <= mobileCart.viewport.w + 1 });
await shot("360-cart");
await evaluate(`document.getElementById("cartClose").click()`);
await sleep(300);

/* Orbit scrub check at desktop */
await setViewport(1440, 900);
await navigate(`${BASE}/?test=orbit&t=${Date.now()}`);
await waitForBoot();
const libsReady = await waitForLibraries();
let pinReady = false;
for (let i = 0; i < 40; i += 1) {
  pinReady = await evaluate(`document.documentElement.classList.contains("has-pin")`);
  if (pinReady) break;
  await sleep(250);
}
report.checks.push({ name: "orbit: GSAP + Lenis libraries load", pass: libsReady });
report.checks.push({ name: "orbit: pin initializes", pass: pinReady });
const orbitBefore = await evaluate(`document.getElementById("orbitCounter").textContent`);
await evaluate(`window.scrollTo(0, document.getElementById("orbit").offsetTop + 900)`);
await sleep(1400);
const orbitAfter = await evaluate(`({
  counter: document.getElementById("orbitCounter").textContent,
  pinned: document.documentElement.classList.contains("has-pin"),
  activeCallout: document.querySelector(".orbit__callout.is-active")?.querySelector("h3")?.textContent,
  canvasRect: (() => { const r = document.getElementById("orbitCanvas").getBoundingClientRect(); return { top: r.top, height: r.height }; })(),
})`);
report.checks.push({ name: "orbit: scroll updates frame counter", pass: orbitBefore !== orbitAfter.counter });
report.checks.push({ name: "orbit: ScrollTrigger pin active", pass: orbitAfter.pinned });
report.checks.push({ name: "orbit: callout is present", pass: Boolean(orbitAfter.activeCallout) });
report.interactions.orbit = { orbitBefore, orbitAfter };
await shot("1440-orbit-scrubbed");

/* Keyboard skip link */
const skip = await evaluate(`(() => {
  const link = document.querySelector(".skip-link");
  const main = document.getElementById("main");
  return { href: link?.getAttribute("href"), tabIndex: main?.tabIndex, mainFocusable: main?.matches(":focus") || document.activeElement === main };
})()`);
report.checks.push({ name: "a11y: skip link targets focusable main", pass: skip.href === "#main" && skip.tabIndex === -1 });

/* Reduced motion */
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await setViewport(1440, 900);
await navigate(`${BASE}/?test=reduced&t=${Date.now()}`);
await waitForBoot();
await sleep(900);
const reduced = await evaluate(`({
  revealsHidden: [...document.querySelectorAll("[data-reveal]")].filter((n) => Number(getComputedStyle(n).opacity) < 0.9).length,
  words: [...document.querySelectorAll(".word__inner")].map((n) => getComputedStyle(n).transform).filter((t) => t !== "none").length,
  videos: [...document.querySelectorAll("video")].filter((v) => !v.paused).length,
  pinned: document.documentElement.classList.contains("has-pin"),
})`);
report.checks.push({ name: "reduced motion: no hidden reveals", pass: reduced.revealsHidden === 0 });
report.checks.push({ name: "reduced motion: no title transforms", pass: reduced.words === 0 });
report.checks.push({ name: "reduced motion: no autoplay videos", pass: reduced.videos === 0 });
report.checks.push({ name: "reduced motion: no pin", pass: reduced.pinned === false });
report.interactions.reduced = reduced;
await cdp.send("Emulation.setEmulatedMedia", { features: [] });

report.checks.push({ name: "console: no runtime errors", pass: errors.length === 0 });
report.checks.push({ name: "network: no failed requests", pass: failedRequests.length === 0 });
report.console = { errors, warnings, failedRequests };

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const failed = report.checks.filter((check) => !check.pass);
console.log(`\nViewports: ${report.viewports.length}`);
report.viewports.forEach((v) => console.log(`  ${v.label}: overflow=${v.overflow} split=${v.heroSplit} words=${v.words} fallback=${v.isFallback}`));
console.log(`\nChecks: ${report.checks.length - failed.length}/${report.checks.length} passed`);
failed.forEach((check) => console.log(`  FAIL ${check.name}`));
console.log(`\nErrors: ${errors.length}`);
errors.forEach((error) => console.log(`  ${error}`));
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 12).forEach((warning) => console.log(`  ${warning}`));
console.log(`Failed requests: ${failedRequests.length}`);
failedRequests.slice(0, 12).forEach((failure) => console.log(`  ${failure}`));
process.exit(failed.length ? 1 : 0);
