/* Vendors the site's runtime library graph into public/vendor/.

   Three packages, the pinned versions the site ships:
   - three@0.161.0: the module build plus the four postprocessing addons the
     intro and the hangar use. Walks each file's relative imports (Pass.js,
     MaskPass.js, the Shader sources) so the mirror stays complete when the
     addon set grows.
   - gsap@3.12.5: the module build and ScrollTrigger.
   - lenis@1.1.20: dist/lenis.mjs.

   The CDN path is the release blocker: on some connections the module graph
   measures 8 to 25 seconds for a few kilobytes, which loses its race with the
   nine-second boot watchdog on every cold visit, and the intro never shows.
   Retail copies also keep the site working offline.

   Rerun after a version bump; index.html's importmap pins the same versions.

   Run: node scripts/vendor_cdn.mjs */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGES = [
  {
    root: "public/vendor/three@0.161.0",
    cdn: "https://cdn.jsdelivr.net/npm/three@0.161.0",
    /* Bare specifiers index.html's importmap resolves. */
    bare: ["three", "three/addons/"],
    entries: [
      "build/three.module.js",
      "examples/jsm/postprocessing/EffectComposer.js",
      "examples/jsm/postprocessing/RenderPass.js",
      "examples/jsm/postprocessing/UnrealBloomPass.js",
      "examples/jsm/postprocessing/ShaderPass.js",
    ],
  },
  {
    root: "public/vendor/gsap@3.12.5",
    cdn: "https://cdn.jsdelivr.net/npm/gsap@3.12.5",
    bare: [],
    entries: ["index.js", "ScrollTrigger.js"],
  },
  {
    root: "public/vendor/lenis@1.1.20",
    cdn: "https://cdn.jsdelivr.net/npm/lenis@1.1.20",
    bare: [],
    entries: ["dist/lenis.mjs"],
  },
];

/* Statement-anchored matchers. Line-anchored static imports plus dynamic
   import() calls only: loose patterns match prose inside gsap's bundled
   strings, which would download nonsense files. */
const STATIC_IMPORT = /^\s*(?:import\s[^'"]*?from\s*|export\s+(?:\*|\{[^}]*\})\s*from\s*)['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

const specifiersOf = (source) =>
  [...source.matchAll(STATIC_IMPORT), ...source.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]);

for (const pkg of PACKAGES) {
  const seen = new Set();
  const report = [];

  const download = async (relPath) => {
    if (seen.has(relPath)) return;
    seen.add(relPath);

    const res = await fetch(`${pkg.cdn}/${relPath}`, { headers: { "user-agent": "aero-vendor" } });
    if (!res.ok) throw new Error(`${res.status} for ${pkg.cdn}/${relPath}`);
    const source = await res.text();

    const target = join(pkg.root, relPath);
    await mkdir(target.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
    await writeFile(target, source);
    report.push({ path: relPath, bytes: Buffer.byteLength(source) });

    for (const spec of specifiersOf(source)) {
      if (!spec.startsWith(".")) continue;
      const base = relPath.replace(/[^/\\]+$/, "");
      const parts = [...`${base}${spec}`.split("/")];
      const out = [];
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") out.pop();
        else out.push(part);
      }
      await download(out.join("/"));
    }
  };

  for (const entry of pkg.entries) await download(entry);

  const total = report.reduce((sum, file) => sum + file.bytes, 0);
  console.log(`vendored ${report.length} files under ${pkg.root} (${(total / 1024).toFixed(0)} KB)`);
  for (const file of report) console.log(`  ${String(file.bytes).padStart(7)}  ${file.path}`);

  /* A bare import outside the package's accepted set would 404 at runtime. */
  for (const file of report) {
    const source = await readFile(join(pkg.root, file.path), "utf8");
    const specs = specifiersOf(source)
      .filter((s) => !s.startsWith(".") && !pkg.bare.some((ok) => s === ok || s.startsWith(ok)));
    if (specs.length) {
      console.warn(`unexpected import specifiers in ${file.path}: ${specs.join(", ")}`);
      process.exitCode = 1;
    }
  }
}
