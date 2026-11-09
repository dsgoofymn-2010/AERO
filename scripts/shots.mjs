/* Ad-hoc visual QA screenshots. Run after scripts/serve.mjs is up. */
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:5500";
const OUT = "public/_verification";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(OUT, { recursive: true });

const list = await fetch("http://127.0.0.1:9222/json/list").then((res) => res.json());
const target = list.find((entry) => entry.type === "page");
if (!target) throw new Error("No page target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

const viewport = (width, height) =>
  send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
    screenWidth: width,
    screenHeight: height,
  });

const shot = async (name) => {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(`${OUT}/${name}`, Buffer.from(result.data, "base64"));
};

const scroll = async (selector, offset = 0) => {
  await evaluate(`(() => {
    const node = document.querySelector('${selector}');
    if (!node) return;
    window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY + ${offset}, behavior: 'instant' });
  })()`);
  await sleep(900);
};

await viewport(1440, 900);
await send("Page.navigate", { url: `${BASE}/index.html` });
await sleep(1500);
await evaluate("sessionStorage.setItem('aero:intro','seen')");
await send("Page.reload");
await sleep(3500);

await scroll("#collection", 520);
await shot("qa-collection-cards.png");

await scroll("#anatomy", 60);
await shot("qa-anatomy.png");

await scroll("#notes", 40);
await shot("qa-notes.png");

await scroll("#contact", 40);
await shot("qa-footer.png");

await viewport(768, 900);
await send("Page.reload");
await sleep(3000);
await evaluate("window.scrollTo(0, 0)");
await sleep(600);
await shot("qa-tablet-hero.png");
await scroll("#collection", 420);
await shot("qa-tablet-cards.png");

await viewport(360, 800);
await send("Page.reload");
await sleep(3000);
await evaluate("window.scrollTo(0, 0)");
await sleep(600);
await shot("qa-small-hero.png");
await scroll("#contact", 40);
await shot("qa-small-footer.png");

console.log("shots done");
process.exit(0);
