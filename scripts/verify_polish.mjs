/* Phase 5 polish audit: document semantics, keyboard flow, contrast, and
   touch targets. Needs scripts/serve.mjs on :5500 and Chrome on :9222.
   Run: node scripts/verify_polish.mjs */

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
cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
  errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
});
cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
  if (type !== "error") return;
  errors.push(`console.error: ${args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`);
});

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
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

async function waitFor(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(160);
  }
  return false;
}

async function setViewport(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
    screenWidth: width,
    screenHeight: height,
  });
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(`${OUT}/${name}`, Buffer.from(shot.data, "base64"));
}

async function press(key, { shift = false } = {}) {
  const codes = {
    Tab: { code: "Tab", keyCode: 9 },
    Enter: { code: "Enter", keyCode: 13 },
    Escape: { code: "Escape", keyCode: 27 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    Space: { code: "Space", keyCode: 32 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
  };
  const info = codes[key] || { code: key, keyCode: 0 };
  const base = {
    key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    modifiers: shift ? 8 : 0,
  };
  if (key === "Enter") {
    base.text = "\r";
    base.unmodifiedText = "\r";
  }
  if (key === "Space") {
    base.text = " ";
    base.unmodifiedText = " ";
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(120);
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
};

await setViewport(1440, 900);
await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
await waitFor("document.readyState === 'complete'");
await waitFor("document.querySelectorAll('#collectionGrid .card').length === 13");
await waitFor("document.body && !document.body.classList.contains('is-intro')");
await sleep(1200);

/* Document semantics ----------------------------------------------------- */

const doc = await evaluate(`(() => {
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((node) => Number(node.tagName[1]));
  const skipped = headings.filter((level, index) => index > 0 && level - headings[index - 1] > 1);
  const images = [...document.querySelectorAll('img')];
  const buttons = [...document.querySelectorAll('button')];
  const namelessButtons = buttons.filter((node) => {
    const text = (node.textContent || '').trim();
    return !text && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby');
  });
  return {
    lang: document.documentElement.lang,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    h1: document.querySelectorAll('h1').length,
    skipped,
    dupes: [...new Set(dupes)],
    images: images.length,
    missingAlt: images.filter((node) => !node.hasAttribute('alt')).length,
    namelessButtons: namelessButtons.length,
    main: !!document.querySelector('main#main'),
    nav: document.querySelectorAll('nav').length,
    footer: !!document.querySelector('footer'),
    live: !!document.getElementById('liveRegion'),
  };
})()`);

check("html lang is set", doc.lang === "en", doc.lang);
check("document title names AERO", doc.title.includes("AERO"), doc.title);
check("meta description present", doc.description.length > 40, doc.description.length);
check("one h1", doc.h1 === 1, doc.h1);
check("heading levels do not skip", doc.skipped.length === 0, doc.skipped.join(","));
check("no duplicate ids", doc.dupes.length === 0, doc.dupes.join(","));
check("all images have alt", doc.missingAlt === 0, doc.missingAlt);
check("all buttons have names", doc.namelessButtons === 0, doc.namelessButtons);
check("main landmark present", doc.main);
check("footer landmark present", doc.footer);
check("live region present", doc.live);

/* Keyboard flow ---------------------------------------------------------- */

const skipInfo = await evaluate(`(() => {
  const link = document.querySelector('.skip-link');
  const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  return {
    first: focusables[0] === link,
    tabIndex: link?.tabIndex,
    href: link?.getAttribute('href'),
  };
})()`);
check("skip link is the first focusable element", skipInfo.first && skipInfo.tabIndex === 0, JSON.stringify(skipInfo));

await evaluate("document.querySelector('.skip-link').focus(); window.scrollTo(0, 0)");
await sleep(300);
const skipVisible = await evaluate(`(() => {
  const rect = document.querySelector('.skip-link').getBoundingClientRect();
  return { top: Math.round(rect.top), height: Math.round(rect.height) };
})()`);
check("skip link is revealed on focus", skipVisible.top >= 0, JSON.stringify(skipVisible));

await press("Enter");
await sleep(1200);
const skipped = await evaluate(`(() => ({
  active: document.activeElement?.id,
  scroll: window.scrollY,
}))()`);
check("skip link moves focus to main", skipped.active === "main", skipped.active);

await evaluate(`(() => {
  const filter = document.querySelector('#filters [data-category="Boots"]');
  filter.focus();
})()`);
await press("Enter");
await sleep(400);
const filterKeys = await evaluate(`(() => ({
  cards: document.querySelectorAll('#collectionGrid .card').length,
  active: document.activeElement?.dataset?.category,
  pressed: document.querySelector('#filters [data-category="Boots"]')?.getAttribute('aria-pressed'),
}))()`);
check("filter works from the keyboard", filterKeys.cards === 3, filterKeys.cards);
check("filter reports aria-pressed", filterKeys.pressed === "true", filterKeys.pressed);
await evaluate("document.querySelector('#filters [data-category=\"All\"]').click()");
await sleep(300);

await evaluate(`(() => {
  const card = document.querySelector('.card[data-shoe="kestrel"]');
  card.focus();
})()`);
await press("Enter");
await waitFor("document.getElementById('productDialog').open", 4000);
await sleep(400);
check("card opens the study from the keyboard", await evaluate("document.getElementById('productDialog').open"));

let inside = true;
for (let index = 0; index < 24; index += 1) {
  await press("Tab");
  const state = await evaluate(`(() => {
    const dialog = document.getElementById('productDialog');
    return dialog.contains(document.activeElement) || document.activeElement === dialog;
  })()`);
  if (!state) inside = false;
}
check("focus stays inside the product dialog", inside);

await press("Escape");
await sleep(500);
const escaped = await evaluate(`(() => ({
  open: document.getElementById('productDialog').open,
  focus: document.activeElement?.dataset?.shoe || document.activeElement?.id,
}))()`);
check("Escape closes the product dialog", !escaped.open);
check("focus returns to the card after Escape", escaped.focus === "kestrel", escaped.focus);

await evaluate(`(() => {
  const card = document.querySelector('.card[data-shoe="kestrel"]');
  card.click();
})()`);
await waitFor("document.getElementById('productDialog').open", 4000);
await sleep(500);
const galleryTurn = await evaluate(`(() => {
  const stage = document.querySelector('#productViewer .gallery__stage');
  stage.focus();
  return stage.getAttribute('aria-label');
})()`);
const beforeTurn = await evaluate("getComputedStyle(document.querySelector('#productViewer .gallery__tilt')).transform");
await press("ArrowRight");
await sleep(300);
const afterTurn = await evaluate("getComputedStyle(document.querySelector('#productViewer .gallery__tilt')).transform");
check("gallery stage is keyboard focusable", Boolean(galleryTurn), galleryTurn);
check("arrow key turns the gallery", beforeTurn !== afterTurn, `${beforeTurn} -> ${afterTurn}`);
await press("Escape");
await sleep(400);

await evaluate("document.getElementById('bagToggle').focus()");
await press("Enter");
await waitFor("document.getElementById('cartDrawer').classList.contains('is-open')", 3000);
await sleep(400);
check("bag opens from the keyboard", await evaluate("document.getElementById('cartDrawer').getAttribute('aria-hidden') === 'false'"));
const cartFocus = await evaluate("document.activeElement?.id");
check("cart focuses its close button", cartFocus === "cartClose", cartFocus);
await press("Escape");
await sleep(500);
const cartEscaped = await evaluate(`(() => ({
  hidden: document.getElementById('cartDrawer').getAttribute('aria-hidden'),
  focus: document.activeElement?.id,
  locked: document.body.classList.contains('is-locked'),
}))()`);
check("Escape closes the bag", cartEscaped.hidden === "true", cartEscaped.hidden);
check("bag returns focus to its trigger", cartEscaped.focus === "bagToggle", cartEscaped.focus);
check("bag close unlocks the page", !cartEscaped.locked);

/* Contrast --------------------------------------------------------------- */

const contrast = await evaluate(`(() => {
  const parse = (value) => {
    const match = value.match(/rgba?\\(([^)]+)\\)/);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = (color) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const ratio = (a, b) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const background = (node) => {
    const chain = [];
    let current = node;
    while (current && current !== document.documentElement) {
      const color = parse(getComputedStyle(current).backgroundColor);
      if (color && color.a > 0) {
        chain.push(color);
        if (color.a >= 0.99) break;
      }
      current = current.parentElement;
    }
    let result = { r: 8, g: 9, b: 10, a: 1 };
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      result = blend(chain[index], result);
    }
    return result;
  };
  const results = [];
  const seen = new Set();
  for (const node of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(node.tagName)) continue;
    if (node.closest('[aria-hidden="true"], [hidden], .sr-only')) continue;
    const direct = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    if (!direct) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = background(node);
    const color = blend(fg, bg);
    const value = ratio(color, bg);
    const size = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const threshold = large ? 3 : 4.5;
    if (value < threshold) {
      const key = node.tagName + '.' + String(node.className).split(' ')[0] + '|' + style.color;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        tag: node.tagName,
        cls: String(node.className).slice(0, 40),
        text: (node.textContent || '').trim().slice(0, 46),
        color: style.color,
        bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
        size: Math.round(size * 10) / 10,
        weight,
        ratio: Math.round(value * 100) / 100,
        threshold,
      });
    }
  }
  return results;
})()`);

check("all visible text meets WCAG AA contrast", contrast.length === 0, JSON.stringify(contrast.slice(0, 8)));

/* Touch targets at 360 --------------------------------------------------- */

await setViewport(360, 800);
await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
await waitFor("document.querySelectorAll('#collectionGrid .card').length === 13");
await waitFor("document.body && !document.body.classList.contains('is-intro')");
await sleep(900);

const targets = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex="0"]')];
  const small = [];
  for (const node of nodes) {
    if (node.closest('[aria-hidden="true"], [hidden], .sr-only')) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (style.display === 'inline' && node.closest('p, li, span')) continue;
    if (rect.width < 44 || rect.height < 44) {
      small.push({
        tag: node.tagName,
        cls: String(node.className).slice(0, 36),
        text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
  }
  const seen = new Set();
  return small.filter((item) => {
    const key = item.tag + item.cls + item.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})()`);

check("touch targets are at least 44 px", targets.length === 0, JSON.stringify(targets.slice(0, 10)));

const targetsIn = (selector) => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('${selector} a[href], ${selector} button, ${selector} input, ${selector} select, ${selector} textarea, ${selector} [role="button"], ${selector} [tabindex="0"]')];
  const small = [];
  for (const node of nodes) {
    if (node.closest('[aria-hidden="true"], [hidden], .sr-only')) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.width < 44 || rect.height < 44) {
      small.push({
        tag: node.tagName,
        cls: String(node.className).slice(0, 36),
        text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
  }
  return small;
})()`);

await evaluate("document.querySelector('.card[data-shoe=\"blue\"]').click()");
await waitFor("document.getElementById('productDialog').open", 4000);
await sleep(500);
const videoTargets = await targetsIn("#productDialog");
check("360 product controls are at least 44 px", videoTargets.length === 0, JSON.stringify(videoTargets.slice(0, 6)));
await evaluate("document.getElementById('productClose').click()");
await sleep(500);

await evaluate("document.querySelector('.card[data-shoe=\"kestrel\"]').click()");
await waitFor("document.getElementById('productDialog').open", 4000);
await sleep(500);
const galleryTargets = await targetsIn("#productDialog");
check("gallery product controls are at least 44 px", galleryTargets.length === 0, JSON.stringify(galleryTargets.slice(0, 6)));
await evaluate("document.getElementById('productClose').click()");
await sleep(500);

await evaluate("document.getElementById('bagToggle').click()");
await waitFor("document.getElementById('cartDrawer').classList.contains('is-open')", 3000);
await sleep(400);
const cartTargets = await targetsIn("#cartDrawer");
check("bag controls are at least 44 px", cartTargets.length === 0, JSON.stringify(cartTargets.slice(0, 6)));
await evaluate("document.getElementById('cartClose').click()");
await sleep(400);

/* Wide screenshots ------------------------------------------------------- */

await setViewport(1024, 900);
await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
await waitFor("document.body && !document.body.classList.contains('is-intro')");
await sleep(900);
await screenshot("qa-1024-hero.png");
await evaluate(`(() => {
  const node = document.querySelector('#collection');
  window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY + 300, behavior: 'instant' });
})()`);
await sleep(900);
await screenshot("qa-1024-cards.png");

await setViewport(1920, 1080);
await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
await waitFor("document.body && !document.body.classList.contains('is-intro')");
await sleep(900);
await screenshot("qa-1920-hero.png");

const summary = {
  checks,
  passed: checks.filter((item) => item.ok).length,
  total: checks.length,
  contrast,
  targets,
  errors,
};
await writeFile(`${OUT}/phase5_polish.json`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      passed: summary.passed,
      total: summary.total,
      failures: checks.filter((item) => !item.ok),
      contrast,
      targets,
      errors,
    },
    null,
    2,
  ),
);
process.exit(0);

