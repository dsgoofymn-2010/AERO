/* Times the three.js module graph from inside the page across mirrors, so the
   CDN diagnosis is measured where the failure happens, not from Node.

   Run: node scripts/diag_cdn.mjs */
import { launch, sleep } from "./cdp.mjs";

const URLS = [
  "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js",
  "https://fastly.jsdelivr.net/npm/three@0.161.0/build/three.module.js",
  "https://unpkg.com/three@0.161.0/build/three.module.js",
  "https://esm.sh/three@0.161.0",
  "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js",
  "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/RenderPass.js",
  "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js",
  "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/ShaderPass.js",
];

const { cdp, close } = await launch({ port: 9271, url: "http://127.0.0.1:5500/index.html", headless: true, width: 900, height: 600 });
await cdp.send("Page.enable");

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
};

// Let the page settle before measuring anything.
await sleep(2500);

const run = async (label, heads) => {
  const results = [];
  for (const url of URLS) {
    const src = heads ? JSON.stringify(url) : `new Request(${JSON.stringify(url)})`;
    const r = await evaluate(`(async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(${src}, { cache: "no-store" });
        return { ms: Math.round(performance.now() - t0), status: res.status };
      } catch (e) {
        return { ms: Math.round(performance.now() - t0), error: (e?.cause?.code || e?.message || String(e)).slice(0, 80) };
      }
    })()`).catch((e) => ({ ms: -1, error: e.message.slice(0, 80) }));
    results.push({ url: url.replace("https://", "").replace("/npm/three@0.161.0", ""), ...r });
  }
  console.log(`\n${label}`);
  for (const r of results) console.log(`  ${String(r.ms).padStart(6)}ms ${r.status ?? ""} ${r.error ? "ERR " + r.error + " " : ""}${r.url}`);
  return results;
};

await run("pass 1 (cold, no-store)", false);
await sleep(1500);
await run("pass 2 (again, no-store)", false);
await close();
