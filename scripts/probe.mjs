import { writeFile } from "node:fs/promises";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const list = await fetch("http://127.0.0.1:9222/json/list").then((res) => res.json());
const page = list.find((entry) => entry.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", ({ data }) => {
  const msg = JSON.parse(data);
  if (!msg.id) return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, { resolve, reject });
    ws.send(JSON.stringify({ id: current, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.clearBrowserCache");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "http://127.0.0.1:5500/?probe=" + Date.now() });
const bootStart = Date.now();
let bootMs = null;
for (let i = 0; i < 100; i += 1) {
  const done = await evaluate(`Boolean(document.body && !document.body.classList.contains("is-loading"))`);
  if (done) break;
  await sleep(200);
}
bootMs = Date.now() - bootStart;
await sleep(4500);
const state = await evaluate(`(() => {
  const v = document.getElementById("heroVideo");
  const r = v.getBoundingClientRect();
  const media = document.querySelector(".hero__media");
  const mr = media.getBoundingClientRect();
  return {
    video: {
      currentSrc: v.currentSrc,
      paused: v.paused,
      ended: v.ended,
      readyState: v.readyState,
      networkState: v.networkState,
      currentTime: v.currentTime,
      duration: v.duration,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      error: v.error?.message || null,
      poster: v.poster,
      display: getComputedStyle(v).display,
      opacity: getComputedStyle(v).opacity,
      visibility: getComputedStyle(v).visibility,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      sources: [...v.querySelectorAll("source")].map((s) => s.src),
    },
    media: { rect: { x: mr.x, y: mr.y, w: mr.width, h: mr.height }, opacity: getComputedStyle(media).opacity, display: getComputedStyle(media).display },
    bodyClasses: document.body.className,
    visibility: document.visibilityState,
    hidden: document.hidden,
    tech: (() => { const t = document.getElementById("techVideo"); return { src: t.currentSrc, ready: t.readyState, duration: t.duration, time: t.currentTime }; })(),
    loaded: document.readyState,
    bootMs: ${bootMs},
  };
})()`);
console.log(JSON.stringify(state, null, 2));

const seek = await evaluate(`(async () => {
  const t = document.getElementById("techVideo");
  const before = t.currentTime;
  t.currentTime = 5;
  const immediate = t.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { before, immediate, after: t.currentTime, ready: t.readyState, seeking: t.seeking, error: t.error?.message || null };
})()`);
console.log("seek:", JSON.stringify(seek));

const heroSeek = await evaluate(`(async () => {
  const v = document.getElementById("heroVideo");
  v.currentTime = 4;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { time: v.currentTime, paused: v.paused, ready: v.readyState };
})()`);
console.log("hero seek:", JSON.stringify(heroSeek));
await sleep(1500);

const { data } = await send("Page.captureScreenshot", { format: "png" });
await writeFile("assets/_verification/browser/probe-hero.png", Buffer.from(data, "base64"));
ws.close();
