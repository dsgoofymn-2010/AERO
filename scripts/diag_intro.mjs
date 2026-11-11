/* Timeline diagnostic for the intro boot.

   Same headless setup as verify_routing.mjs, but it snapshots the whole boot
   every 500ms instead of checking one endpoint, and it captures the Chrome Log
   domain as well as the console, because CDN module failures land there.

   Run: node scripts/diag_intro.mjs [runs=2] */
import { writeFile } from "node:fs/promises";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:5500";
const RUNS = Number(process.argv[2] || 2);

const snapshot = `(() => {
  const intro = document.getElementById("intro");
  return {
    t: Math.round(performance.now()),
    body: document.body.className,
    intro: !!intro,
    isReady: intro?.classList.contains("is-ready") ?? null,
    isStatic: intro?.classList.contains("is-static") ?? null,
    isLeaving: intro?.classList.contains("is-leaving") ?? null,
    state: document.getElementById("introState")?.textContent ?? null,
    count: document.getElementById("introCount")?.textContent ?? null,
    hook: typeof window.__introCards,
    canvases: document.querySelectorAll("#intro canvas").length,
    aeroReady: window.__aeroReady === true,
  };
})()`;

for (let run = 1; run <= RUNS; run += 1) {
  const { cdp, close } = await launch({
    // A fresh port per run: a leftover Chrome from a previous invocation held
    // :9270 and once served a stale index.html to run 2, which made the
    // healthy site look like it had regressed.
    port: 9270 + run,
    url: "about:blank",
    headless: true,
    width: 1440,
    height: 900,
  });

  const log = [];
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    log.push(`${type}: ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  });
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    log.push(`exception: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable").catch(() => {});
  // Same reason: read the current site, not a cached copy.
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  cdp.on("Log.entryAdded", ({ entry }) => {
    log.push(`log.${entry.level}: ${entry.text} ${entry.url || ""}`.slice(0, 300));
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  const evaluate = async (expression, timeout = 25000) => {
    let res;
    try {
      res = await cdp.send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      }, timeout);
    } catch (error) {
      // A single wedged sample (e.g. SwiftShader compiling the intro shaders)
      // must not kill the probe; the next sample shows where it recovered.
      return { evalError: error.message };
    }
    if (res.exceptionDetails) return { evalError: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
    return res.result.value;
  };

  // ?intro=1 keeps the film on: this probe exists to time the intro boot,
  // and headless sessions skip it by contract now.
  await cdp.send("Page.navigate", { url: `${BASE}/index.html?intro=1` });

  const timeline = [];
  for (let i = 0; i < 90; i += 1) {
    const s = await evaluate(snapshot, 50000);
    if (!timeline.length || JSON.stringify(s) !== JSON.stringify(timeline[timeline.length - 1])) {
      timeline.push(s);
    }
    // Final state could arrive late; keep polling for stability either way.
    await sleep(500);
  }

  const resources = await evaluate(`performance.getEntriesByType("resource").map((e) => ({
    url: e.name.length > 90 ? e.name.slice(0, 90) : e.name,
    bytes: e.transferSize,
    ms: Math.round(e.duration),
    status: e.responseStatus ?? "",
    kind: e.initiatorType,
  }))`).catch((e) => [{ evalError: e.message }]);
  const cdn = resources.filter((r) => r.url.includes("jsdelivr") || r.url.includes("unpkg"));
  const moduleScripts = resources.filter((r) => r.kind === "script").filter((r) => r.url.includes(".js") || r.url.includes("mjs"));

  const out = { run, timeline, cdn, moduleScripts, log };
  await writeFile(`public/_verification/diag_intro_run${run}.json`, JSON.stringify(out, null, 2));
  console.log(`\n=== run ${run} ===`);
  console.log("timeline:");
  for (const s of timeline) console.log(`  t=${s.t} body="${s.body}" intro=${s.intro} ready=${s.isReady} static=${s.isStatic} state="${s.state}" count=${s.count} hook=${s.hook} canvas=${s.canvases} aeroReady=${s.aeroReady}`);
  console.log(`cdn resources (${cdn.length}):`, cdn.slice(0, 8).map((r) => `${r.url} ${r.bytes}b ${r.ms}ms ${r.status}`).join("\n  ") || "NONE");
  console.log(`module scripts:`, moduleScripts.slice(0, 12).map((r) => `${r.url} ${r.status}`).join("\n  "));
  console.log("page log:", log.length ? log.slice(0, 14).join(" | ") : "(clean)");

  await close();
}
