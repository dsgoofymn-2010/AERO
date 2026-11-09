/* Minimal Chrome DevTools Protocol client shared by the hangar verifiers.
   Chrome is launched with its own profile and port so it never touches the
   browser you are using. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
];

export class CDP {
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

  send(method, params = {}, timeout = 25000) {
    const id = ++this.id;
    return Promise.race([
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ id, method, params }));
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${method}`)), timeout)),
    ]);
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
}

export async function launch({ port, url, extraArgs = [], width = 1440, height = 900, headless = false }) {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  if (!chrome) throw new Error("Chrome not found");
  const profile = join(tmpdir(), `aero-cdp-${port}-${Date.now()}`);

  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    // An unfocused window is treated as occluded and stops producing frames,
    // which makes screenshots hang and rAF throttle.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    // Headless never depends on window focus, so captures cannot stall and the
    // run does not steal focus from the browser you are using. WebGL falls
    // back to SwiftShader, which is correct but software-rendered: keep frame
    // rate assertions in the headful runner.
    ...(headless ? ["--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] : []),
    ...extraArgs,
    url,
  ], { stdio: "ignore" });

  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((e) => e.type === "page" && e.webSocketDebuggerUrl);
      if (page) {
        const cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.ready();
        return { cdp, close: async () => {
          await cdp.send("Browser.close").catch(() => {});
          proc.kill();
          await sleep(300);
          await rm(profile, { recursive: true, force: true }).catch(() => {});
        } };
      }
    } catch { /* still starting */ }
    await sleep(500);
  }
  proc.kill();
  throw new Error("Chrome page target never appeared");
}
