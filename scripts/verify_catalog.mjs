/* Catalog audit: every category filter and all thirteen product dialogs.
   Needs scripts/serve.mjs on :5500 and Chrome on :9222.
   Run: node scripts/verify_catalog.mjs */

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
const failedRequests = [];
cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
  errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
});
cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
  if (type !== "error") return;
  errors.push(`console.error: ${args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`);
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
await cdp.send("Network.enable");
await cdp.send("Page.bringToFront");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 900,
});

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

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
};

await evaluate("sessionStorage.setItem('aero:intro','seen')").catch(() => {});
await cdp.send("Page.navigate", { url: `${BASE}/index.html` });
await waitFor("document.body && !document.body.classList.contains('is-intro')");
await waitFor("document.querySelectorAll('#collectionGrid .card').length === 13");
await sleep(900);

const expected = {
  All: 13,
  Sneakers: 4,
  Boots: 3,
  Formal: 3,
  Casual: 2,
  Sandals: 1,
};

for (const [category, count] of Object.entries(expected)) {
  await evaluate(`document.querySelector('#filters [data-category="${category}"]').click()`);
  await sleep(350);
  const actual = await evaluate("document.querySelectorAll('#collectionGrid .card').length");
  check(`${category} filter shows ${count}`, actual === count, actual);
}
await evaluate("document.querySelector('#filters [data-category=\"All\"]').click()");
await sleep(350);

const ids = await evaluate("[...document.querySelectorAll('#collectionGrid .card')].map((card) => card.dataset.shoe)");
check("collection exposes thirteen ids", ids.length === 13, ids.join(","));

const products = [];

for (const id of ids) {
  await evaluate(`(() => {
    const card = document.querySelector('.card[data-shoe="${id}"]');
    card.click();
  })()`);
  const opened = await waitFor("document.getElementById('productDialog').open", 5000);
  check(`${id} dialog opens`, opened);
  if (!opened) continue;
  await sleep(500);

  const info = await evaluate(`(() => {
    const viewer = document.getElementById('productViewer');
    const image = viewer.querySelector('.gallery__image, .product__detail img');
    return {
      name: document.getElementById('productName').textContent,
      tabs: [...document.querySelectorAll('#productTabs .product-tab')].map((tab) => tab.dataset.mode),
      hasGallery: !!viewer.querySelector('.gallery__stage'),
      hasOrbit: !!viewer.querySelector('.orbit-view'),
      imageLoaded: image ? image.complete && image.naturalWidth > 0 : null,
      imageSrc: image?.getAttribute('src') || '',
    };
  })()`);

  if (info.hasOrbit) {
    const ready = await waitFor("document.querySelector('.orbit-view')?.classList.contains('is-ready')", 20000);
    check(`${id} 360 preloads`, ready);
    const drawn = await evaluate(`(() => {
      const canvas = document.querySelector('#productViewer .orbit-view canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const pixel = [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      return pixel.some((value, index) => index < 3 && value > 18);
    })()`);
    check(`${id} 360 draws`, drawn);

    for (const mode of ["exploded", "closeup"]) {
      await evaluate(`document.querySelector('#productTabs [data-mode="${mode}"]').click()`);
      await sleep(700);
      const film = await evaluate(`(() => {
        const video = document.querySelector('#productViewer .product__film video');
        return {
          mounted: !!video,
          src: video?.currentSrc || '',
          sources: video ? video.querySelectorAll('source').length : 0,
        };
      })()`);
      check(`${id} ${mode} film mounts`, film.mounted && film.sources >= 1, film.src);
      check(`${id} ${mode} film uses its own clip`, film.src.includes(`/${id}/${mode}`), film.src);
    }
  } else if (info.hasGallery) {
    check(`${id} still image loads`, info.imageLoaded === true, info.imageSrc);
    await evaluate("document.querySelector('#productTabs [data-mode=\"detail\"]').click()");
    await sleep(500);
    const detail = await evaluate(`(() => {
      const image = document.querySelector('#productViewer .product__detail img');
      return {
        loaded: image ? image.complete && image.naturalWidth > 0 : false,
        src: image?.getAttribute('src') || '',
      };
    })()`);
    check(`${id} detail image loads`, detail.loaded, detail.src);
  } else {
    check(`${id} has a viewer`, false, "no gallery or orbit");
  }

  check(`${id} has the expected tabs`, info.tabs.length === (info.hasOrbit ? 4 : 2), info.tabs.join(","));
  products.push({ id, name: info.name, tabs: info.tabs });

  await evaluate("document.getElementById('productClose').click()");
  await sleep(450);
}

check("all product dialogs closed", !(await evaluate("document.getElementById('productDialog').open")));

const summary = {
  checks,
  passed: checks.filter((item) => item.ok).length,
  total: checks.length,
  products,
  errors,
  failedRequests,
};
await writeFile(`${OUT}/phase5_catalog.json`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      passed: summary.passed,
      total: summary.total,
      failures: checks.filter((item) => !item.ok),
      errors,
      failedRequests,
    },
    null,
    2,
  ),
);
process.exit(0);
