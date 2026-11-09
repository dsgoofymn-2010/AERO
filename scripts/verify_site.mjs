/* Phase 4 verification for the AERO site.
   Needs scripts/serve.mjs on :5500 and Chrome with --remote-debugging-port=9222.
   Run: node scripts/verify_site.mjs */

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
  if (response.status >= 400 && !response.url.endsWith("/favicon.ico")) {
    failedRequests.push(`${response.status} ${response.url}`);
  }
});
cdp.on("Network.loadingFailed", (event) => {
  if (!event.canceled) failedRequests.push(`failed ${event.errorText} ${event.type}`);
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

async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(180);
  }
  return false;
}

async function setViewport(width, height, mobile = width < 700) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(`${OUT}/${name}`, Buffer.from(shot.data, "base64"));
}

async function load({ reduced = false, clearSession = false } = {}) {
  if (clearSession) {
    await evaluate("sessionStorage.clear(); localStorage.removeItem('aero:bag:v1')");
  }
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
  });
  await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
  await waitFor("document.readyState === 'complete'", 20000);
  await waitFor("document.querySelectorAll('#collectionGrid .card').length === 13", 20000);
  await waitFor("!document.body.classList.contains('is-intro')", 20000);
  if (!reduced) await waitFor("document.documentElement.dataset.lenis", 15000);
  await sleep(reduced ? 400 : 1400);
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
};

const scrollTo = async (selector, offset = 0) => {
  await evaluate(`(() => {
    const node = document.querySelector('${selector}');
    if (!node) return false;
    const top = node.getBoundingClientRect().top + window.scrollY + ${offset};
    window.scrollTo({ top, behavior: 'instant' });
    return true;
  })()`);
  await sleep(900);
};

try {
  await setViewport(1440, 900, false);
  await load({ clearSession: true });

  const base = await evaluate(`(() => ({
    cards: document.querySelectorAll('#collectionGrid .card').length,
    filters: document.querySelectorAll('#filters .filter').length,
    notes: document.querySelectorAll('#notesGrid .note').length,
    studyTabs: document.querySelectorAll('#studyTabs .study-tab').length,
    anatomyTabs: document.querySelectorAll('#anatomyTabs .anatomy-tab').length,
    heroRevealed: document.querySelectorAll('[data-hero].is-revealed').length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    introHidden: document.getElementById('intro').hidden,
    introInert: document.getElementById('main').inert,
    lenis: document.documentElement.dataset.lenis,
    motion: document.documentElement.classList.contains('motion'),
    mainFocused: document.activeElement === document.getElementById('main'),
  }))()`);

  check("13 cards render", base.cards === 13, base.cards);
  check("6 category filters", base.filters === 6, base.filters);
  check("3 notes render", base.notes === 3, base.notes);
  check("3 study tabs", base.studyTabs === 3, base.studyTabs);
  check("3 anatomy tabs", base.anatomyTabs === 3, base.anatomyTabs);
  check("hero reveals", base.heroRevealed === 8, base.heroRevealed);
  check("no horizontal overflow at 1440", !base.overflowX);
  check("intro hidden after boot", base.introHidden);
  check("main released from inert", base.introInert === false);
  check("Lenis started", base.lenis === "on", base.lenis);
  check("motion class present", base.motion);
  check("focus moves to main after intro", base.mainFocused);

  await screenshot("phase4-hero.png");

  await scrollTo("#collection");
  await screenshot("phase4-collection.png");

  await evaluate("document.querySelector('#filters [data-category=\"Boots\"]').click()");
  await sleep(300);
  const boots = await evaluate(`(() => ({
    cards: document.querySelectorAll('#collectionGrid .card').length,
    count: document.getElementById('collectionCount').textContent,
    label: document.getElementById('collectionCountLabel').textContent,
    active: document.querySelector('#filters .filter.is-active')?.dataset.category,
  }))()`);
  check("Boots filter shows 3", boots.cards === 3, boots.cards);
  check("filter count label updates", boots.count === "3" && boots.label === "objects shown", `${boots.count} ${boots.label}`);
  check("Boots filter active", boots.active === "Boots", boots.active);

  await evaluate("document.querySelector('#filters [data-category=\"All\"]').click()");
  await sleep(300);
  check("All filter restores 13", (await evaluate("document.querySelectorAll('#collectionGrid .card').length")) === 13);

  await evaluate(`(() => {
    const card = document.querySelector('.card[data-shoe="kestrel"]');
    card.focus();
    card.click();
  })()`);
  await waitFor("document.getElementById('productDialog').open", 4000);
  await sleep(500);

  const gallery = await evaluate(`(() => ({
    open: document.getElementById('productDialog').open,
    name: document.getElementById('productName').textContent,
    tabs: document.querySelectorAll('#productTabs .product-tab').length,
    stage: !!document.querySelector('#productViewer .gallery__stage'),
    counter: document.getElementById('productCounter').textContent,
    sizeActive: document.querySelector('.size-option.is-active')?.dataset.size,
    bodyLocked: document.body.classList.contains('is-locked'),
  }))()`);
  check("gallery product dialog opens", gallery.open);
  check("gallery product name is Kestrel", gallery.name === "Kestrel", gallery.name);
  check("gallery has 2 viewer tabs", gallery.tabs === 2, gallery.tabs);
  check("gallery viewer mounts", gallery.stage);
  check("gallery counter is 04 / 13", gallery.counter.trim() === "04 / 13", gallery.counter);
  check("default size 42", gallery.sizeActive === "42", gallery.sizeActive);
  check("body locks for product dialog", gallery.bodyLocked);
  await screenshot("phase4-product-gallery.png");

  await evaluate("document.querySelector('#productTabs [data-mode=\"detail\"]').click()");
  await sleep(400);
  const detail = await evaluate(`(() => ({
    image: !!document.querySelector('#productViewer .product__detail img'),
    src: document.querySelector('#productViewer .product__detail img')?.getAttribute('src'),
  }))()`);
  check("detail tab shows detail image", detail.image && detail.src.includes("detail-1600.webp"), detail.src);

  await evaluate("document.querySelector('#productTabs [data-mode=\"still\"]').click()");
  await sleep(400);
  await evaluate("document.querySelector('.size-option[data-size=\"43\"]').click()");
  await evaluate("document.getElementById('productAdd').click()");
  await sleep(300);
  const added = await evaluate(`(() => ({
    bag: document.getElementById('bagCount').textContent,
    note: document.getElementById('productAdded').textContent,
    stored: JSON.parse(localStorage.getItem('aero:bag:v1') || '[]'),
  }))()`);
  check("add to bag updates count", added.bag === "1", added.bag);
  check("add note names size", added.note.includes("EU 43"), added.note);
  check("bag persists to localStorage", added.stored.length === 1 && added.stored[0].shoeId === "kestrel", JSON.stringify(added.stored));

  await evaluate("document.getElementById('productClose').click()");
  await sleep(500);
  const closed = await evaluate(`(() => ({
    open: document.getElementById('productDialog').open,
    focus: document.activeElement?.dataset?.shoe || '',
    bodyLocked: document.body.classList.contains('is-locked'),
  }))()`);
  check("product dialog closes", !closed.open);
  check("focus returns to the card", closed.focus === "kestrel", closed.focus);
  check("body unlocks after product close", !closed.bodyLocked);

  await evaluate(`(() => {
    const card = document.querySelector('.card[data-shoe="blue"]');
    card.focus();
    card.click();
  })()`);
  await waitFor("document.getElementById('productDialog').open", 4000);
  await sleep(500);
  const videoProduct = await evaluate(`(() => ({
    tabs: document.querySelectorAll('#productTabs .product-tab').length,
    orbit: !!document.querySelector('#productViewer .orbit-view'),
    range: !!document.querySelector('#productViewer .orbit-view__range'),
    counter: document.getElementById('productCounter').textContent,
  }))()`);
  check("video product has 4 tabs", videoProduct.tabs === 4, videoProduct.tabs);
  check("360 orbit mounts", videoProduct.orbit && videoProduct.range);
  const orbitReady = await waitFor("document.querySelector('.orbit-view')?.classList.contains('is-ready')", 15000);
  check("360 frames preload", orbitReady);
  await sleep(800);
  const orbitState = await evaluate(`(() => {
    const canvas = document.querySelector('#productViewer .orbit-view canvas');
    const ctx = canvas.getContext('2d');
    const pixel = [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    return {
      counter: document.getElementById('productCounter').textContent,
      pixel,
      range: document.querySelector('.orbit-view__range')?.value,
    };
  })()`);
  check("360 counter advances", /^\d{3} \/ 215$/.test(orbitState.counter) && orbitState.counter !== "000 / 215", orbitState.counter);
  check("360 canvas draws a frame", orbitState.pixel.some((value, index) => index < 3 && value > 18), orbitState.pixel.join(","));
  await screenshot("phase4-product-360.png");

  await evaluate("document.querySelector('#productTabs [data-mode=\"exploded\"]').click()");
  await sleep(700);
  const exploded = await evaluate(`(() => ({
    video: !!document.querySelector('#productViewer .product__film video'),
    sources: document.querySelectorAll('#productViewer .product__film video source').length,
    counter: document.getElementById('productCounter').textContent,
  }))()`);
  check("exploded film mounts", exploded.video && exploded.sources >= 1);
  check("exploded counter label", exploded.counter === "Exploded film", exploded.counter);

  await evaluate("document.querySelector('#productTabs [data-mode=\"closeup\"]').click()");
  await sleep(500);
  check("close-up film mounts", await evaluate("!!document.querySelector('#productViewer .product__film video')"));
  await evaluate("document.getElementById('productClose').click()");
  await sleep(500);

  await evaluate("document.getElementById('bagToggle').click()");
  await waitFor("document.getElementById('cartDrawer').classList.contains('is-open')", 3000);
  await sleep(300);
  const cart = await evaluate(`(() => ({
    open: document.getElementById('cartDrawer').getAttribute('aria-hidden') === 'false',
    items: document.querySelectorAll('#cartItems .cart-item').length,
    qty: document.querySelector('#cartItems .qty span')?.textContent,
    subtotal: document.getElementById('cartSubtotal').textContent,
    checkoutDisabled: document.getElementById('checkoutButton').disabled,
  }))()`);
  check("cart drawer opens", cart.open);
  check("cart has one line item", cart.items === 1, cart.items);
  check("cart quantity is 1", cart.qty === "1", cart.qty);
  check("cart subtotal is ₹14,499", cart.subtotal.includes("14,499"), cart.subtotal);
  check("checkout enabled with items", !cart.checkoutDisabled);

  await evaluate("document.querySelector('#cartItems [data-action=\"plus\"]').click()");
  await sleep(300);
  const cartPlus = await evaluate(`(() => ({
    qty: document.querySelector('#cartItems .qty span')?.textContent,
    subtotal: document.getElementById('cartSubtotal').textContent,
    count: document.getElementById('bagCount').textContent,
  }))()`);
  check("quantity increments", cartPlus.qty === "2", cartPlus.qty);
  check("subtotal doubles", cartPlus.subtotal.includes("28,998"), cartPlus.subtotal);
  check("bag count updates", cartPlus.count === "2", cartPlus.count);
  await screenshot("phase4-cart.png");

  await evaluate("document.getElementById('checkoutButton').click()");
  await sleep(500);
  const checkout = await evaluate(`(() => ({
    open: document.getElementById('checkoutDialog').open,
    summary: document.getElementById('checkoutSummary').textContent,
    cartOpen: document.getElementById('cartDrawer').classList.contains('is-open'),
  }))()`);
  check("demo checkout opens", checkout.open);
  check("checkout summary has 2 items", checkout.summary.includes("2 items"), checkout.summary);
  check("cart closes for checkout", !checkout.cartOpen);
  await evaluate("document.getElementById('closeCheckout').click()");
  await sleep(500);
  check("checkout closes and unlocks", await evaluate("!document.getElementById('checkoutDialog').open && !document.body.classList.contains('is-locked')"));

  await scrollTo("#study", 200);
  const studyReady = await waitFor("document.getElementById('studyStage').classList.contains('is-ready')", 15000);
  await sleep(900);
  const study = await evaluate(`(() => {
    const canvas = document.getElementById('studyCanvas');
    const ctx = canvas.getContext('2d');
    const pixel = [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    return {
      ready: document.getElementById('studyStage').classList.contains('is-ready'),
      counter: document.getElementById('studyCounter').textContent,
      total: document.getElementById('studyTotal').textContent,
      name: document.getElementById('studyName').textContent,
      pixel,
      progress: getComputedStyle(document.getElementById('scrollProgress')).width,
    };
  })()`);
  check("study stage ready", studyReady && study.ready);
  check("study frame count is 215", study.total.trim() === "/ 215", study.total);
  check("study counter advances", study.counter !== "001", study.counter);
  check("study canvas draws", study.pixel.some((value, index) => index < 3 && value > 18), study.pixel.join(","));
  check("study model is Cirra", study.name === "Cirra", study.name);
  await screenshot("phase4-study.png");

  await evaluate("document.querySelector('#studyTabs [data-shoe=\"brown\"]').click()");
  await waitFor("document.getElementById('studyStage').dataset.shoe === 'brown'", 5000);
  await sleep(1200);
  const switched = await evaluate(`(() => ({
    name: document.getElementById('studyName').textContent,
    total: document.getElementById('studyTotal').textContent,
    anatomy: document.getElementById('anatomyActive').textContent,
    material: document.getElementById('materialCaption').textContent,
    activeTab: document.querySelector('#studyTabs .study-tab.is-active')?.dataset.shoe,
  }))()`);
  check("study switches to Terrae", switched.name === "Terrae", switched.name);
  check("Terrae has 192 frames", switched.total.trim() === "/ 192", switched.total);
  check("anatomy follows feature", switched.anatomy.includes("Terrae"), switched.anatomy);
  check("materials follow feature", switched.material.toLowerCase().includes("leather"), switched.material);
  check("study tab state follows", switched.activeTab === "brown", switched.activeTab);

  await scrollTo("#anatomy");
  await sleep(600);
  const anatomy = await evaluate(`(() => {
    const video = document.getElementById('anatomyVideo');
    return {
      name: document.getElementById('anatomyPartName').textContent,
      parts: document.querySelectorAll('#anatomyParts .anatomy__part').length,
      specs: document.querySelectorAll('#anatomySpecs div').length,
      videoSrc: video.currentSrc,
      videoPaused: video.paused,
      marks: document.querySelectorAll('#anatomyMarks i').length,
    };
  })()`);
  check("anatomy has 4 parts", anatomy.parts === 4, anatomy.parts);
  check("anatomy has 4 specs", anatomy.specs === 4, anatomy.specs);
  check("anatomy film has a source", anatomy.videoSrc.includes("brown/exploded"), anatomy.videoSrc);
  check("anatomy marks render", anatomy.marks === 4, anatomy.marks);

  await evaluate("document.querySelectorAll('#anatomyParts [data-part]')[2].click()");
  await sleep(700);
  const part = await evaluate(`(() => ({
    name: document.getElementById('anatomyPartName').textContent,
    pressed: document.querySelectorAll('#anatomyParts [data-part]')[2].getAttribute('aria-pressed'),
    current: document.getElementById('anatomyVideo').currentTime,
  }))()`);
  check("part selection updates the note", part.name !== anatomy.name, `${anatomy.name} -> ${part.name}`);
  check("part button is pressed", part.pressed === "true", part.pressed);
  check("part selection seeks the film", part.current > 0, part.current);

  await scrollTo("#materials");
  await sleep(700);
  const materials = await evaluate(`(() => ({
    quote: document.getElementById('materialQuote').textContent,
    caption: document.getElementById('materialCaption').textContent,
    note: document.getElementById('materialNote').textContent,
    metrics: document.querySelectorAll('#metrics .metric').length,
    video: document.getElementById('materialVideo').currentSrc,
    playLabel: document.getElementById('materialPlay').textContent,
  }))()`);
  check("materials quote is set", materials.quote.length > 20, materials.quote);
  check("materials caption is set", materials.caption.length > 8, materials.caption);
  check("three metrics render", materials.metrics === 3, materials.metrics);
  check("material film has a source", materials.video.includes("brown/closeup"), materials.video);
  await screenshot("phase4-materials.png");

  await scrollTo("#letters");
  await sleep(500);
  await evaluate("document.getElementById('email').value = 'nope'");
  await evaluate("document.getElementById('newsletterForm').requestSubmit()");
  await sleep(300);
  const invalid = await evaluate(`(() => ({
    error: document.getElementById('emailError').hidden === false,
    text: document.getElementById('emailError').textContent,
    invalid: document.getElementById('email').getAttribute('aria-invalid'),
    success: document.getElementById('newsletterSuccess').hidden === false,
  }))()`);
  check("invalid email shows an error", invalid.error && invalid.invalid === "true", invalid.text);
  check("invalid email does not show success", !invalid.success);

  await evaluate("document.getElementById('email').value = 'studio@aero.example'");
  await evaluate("document.getElementById('newsletterForm').requestSubmit()");
  await sleep(400);
  const valid = await evaluate(`(() => ({
    success: document.getElementById('newsletterSuccess').hidden === false,
    error: document.getElementById('emailError').hidden,
    disabled: document.getElementById('email').disabled,
  }))()`);
  check("valid email shows success", valid.success);
  check("error clears on success", valid.error);
  check("input locks after success", valid.disabled);

  await scrollTo("#contact");
  await sleep(400);
  const footer = await evaluate(`(() => ({
    links: document.querySelectorAll('.footer__nav a').length,
    email: document.querySelector('.footer__email')?.textContent,
    year: document.getElementById('year').textContent,
    top: !!document.getElementById('backToTop'),
  }))()`);
  check("footer has 9 links", footer.links === 9, footer.links);
  check("footer email is set", footer.email === "studio@aero.example", footer.email);
  check("year is current", footer.year === String(new Date().getFullYear()), footer.year);

  await evaluate("document.getElementById('backToTop').click()");
  await sleep(1500);
  check("back to top returns to hero", (await evaluate("window.scrollY")) < 40);

  /* Mobile */
  await setViewport(390, 844, true);
  await load();
  const mobile = await evaluate(`(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    nav: getComputedStyle(document.querySelector('.nav')).display,
    toggle: getComputedStyle(document.getElementById('menuToggle')).display,
    heroTitle: getComputedStyle(document.querySelector('.hero__title')).fontSize,
    filtersScroll: document.getElementById('filters').scrollWidth > document.getElementById('filters').clientWidth,
    gridCols: getComputedStyle(document.getElementById('collectionGrid')).gridTemplateColumns,
  }))()`);
  check("no horizontal overflow at 390", !mobile.overflowX);
  check("desktop nav hidden at 390", mobile.nav === "none", mobile.nav);
  check("menu toggle visible at 390", mobile.toggle !== "none", mobile.toggle);
  check("mobile filters scroll horizontally", mobile.filtersScroll);
  check("mobile grid is one column", mobile.gridCols.split(" ").length === 1, mobile.gridCols);
  await screenshot("phase4-mobile-hero.png");

  await evaluate("document.getElementById('menuToggle').click()");
  await sleep(600);
  const menu = await evaluate(`(() => ({
    open: document.getElementById('siteMenu').classList.contains('is-open'),
    expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
    hidden: document.getElementById('siteMenu').getAttribute('aria-hidden'),
    locked: document.body.classList.contains('is-locked'),
    focus: document.activeElement?.id,
    links: document.querySelectorAll('#siteMenu .menu__link').length,
  }))()`);
  check("mobile menu opens", menu.open);
  check("menu toggle reports expanded", menu.expanded === "true", menu.expanded);
  check("menu aria-hidden is false", menu.hidden === "false", menu.hidden);
  check("menu locks the page", menu.locked);
  check("menu focuses its close button", menu.focus === "menuClose", menu.focus);
  check("menu has 5 links", menu.links === 5, menu.links);
  await screenshot("phase4-mobile-menu.png");

  await evaluate("document.querySelector('#siteMenu .menu__link[href=\"#collection\"]').click()");
  await sleep(1600);
  const menuClosed = await evaluate(`(() => ({
    open: document.getElementById('siteMenu').classList.contains('is-open'),
    hidden: document.getElementById('siteMenu').getAttribute('aria-hidden'),
    locked: document.body.classList.contains('is-locked'),
    scroll: window.scrollY,
    collection: document.getElementById('collection').getBoundingClientRect().top,
  }))()`);
  check("menu closes after choosing a link", !menuClosed.open);
  check("menu returns aria-hidden", menuClosed.hidden === "true", menuClosed.hidden);
  check("menu unlocks the page", !menuClosed.locked);
  check("menu link scrolls to collection", menuClosed.scroll > 200, menuClosed.scroll);

  /* Width sweep */
  const widths = [360, 768, 1024, 1440, 1920];
  const widthResults = [];
  for (const width of widths) {
    await setViewport(width, 900, false);
    await sleep(500);
    const result = await evaluate(`(() => ({
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      nav: getComputedStyle(document.querySelector('.nav')).display,
      toggle: getComputedStyle(document.getElementById('menuToggle')).display,
      hero: document.querySelector('.hero__title').getBoundingClientRect().width,
    }))()`);
    widthResults.push(result);
    check(`no horizontal overflow at ${width}`, !result.overflow, `${result.width}px viewport`);
  }
  check("nav hidden at 1024 and below", widthResults.find((r) => r.width === 1024)?.nav === "none");
  check("nav visible at 1440 and 1920", widthResults.find((r) => r.width === 1440)?.nav !== "none" && widthResults.find((r) => r.width === 1920)?.nav !== "none");
  check("menu toggle visible at 768", widthResults.find((r) => r.width === 768)?.toggle !== "none");

  /* Reduced motion */
  await setViewport(1440, 900, false);
  await load({ reduced: true, clearSession: true });
  const reduced = await evaluate(`(() => ({
    introHidden: document.getElementById('intro').hidden || getComputedStyle(document.getElementById('intro')).display === 'none',
    motion: document.documentElement.classList.contains('motion'),
    revealed: [...document.querySelectorAll('[data-reveal]')].every((node) => getComputedStyle(node).opacity === '1'),
    hero: [...document.querySelectorAll('[data-hero]')].every((node) => getComputedStyle(node).opacity === '1'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    cursor: document.documentElement.classList.contains('has-cursor'),
  }))()`);
  check("reduced motion skips the intro", reduced.introHidden);
  check("reduced motion skips the motion class", !reduced.motion);
  check("reduced motion shows all reveals", reduced.revealed && reduced.hero);
  check("reduced motion has no overflow", !reduced.overflow);
  check("reduced motion disables the cursor", !reduced.cursor);

  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  const summary = {
    base,
    checks,
    passed: checks.filter((item) => item.ok).length,
    total: checks.length,
    errors,
    warnings,
    failedRequests,
  };
  await writeFile(`${OUT}/phase4_site.json`, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: summary.passed,
        total: summary.total,
        failures: checks.filter((item) => !item.ok),
        errors,
        warnings,
        failedRequests,
      },
      null,
      2,
    ),
  );
} finally {
  process.exit(0);
}
