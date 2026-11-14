/* Case-exact path checker for the AERO site.
   Every file path the site can load must exist on disk with EXACT casing and
   be tracked by git with the same casing — the class of bug that works on
   Windows and 404s on a case-sensitive host like Vercel.

   Resolution rules (matching browser semantics):
   - HTML src/href/poster/srcset: relative to the referencing document.
   - CSS url(): relative to the CSS file.
   - JS strings starting "./" or "../": module-relative (import paths).
   - Other JS strings with a path + asset extension: document-relative
     (fetch/img resolve against the document, so data.js paths too).
   - Bare specifiers ("three", "three/addons/...") resolve through the
     importmap parsed out of index.html.
   Run: node scripts/verify_paths.mjs */
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_EXT = /\.(webp|png|jpe?g|gif|svg|mp4|webm|ogg|woff2?|ttf|otf|json|csv)(\?|#|$)/i;
const SKIP = /^(https?:|data:|blob:|mailto:|tel:|#|\/\/)/i;
const problems = [];
const untracked = [];
let checked = 0;

/* ---- inventories: disk files + dirs, git-tracked files ---- */
const disk = new Map();     // lowercase repo-relative path -> exact path
const diskDirs = new Set(); // lowercase repo-relative dir paths
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = resolve(dir, entry.name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (entry.isDirectory()) {
      diskDirs.add(rel.toLowerCase());
      await walk(full);
      continue;
    }
    disk.set(rel.toLowerCase(), rel);
  }
}
await walk(ROOT);

const tracked = new Set(
  execSync("git ls-files -z", { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
    .toString().split("\0").filter(Boolean),
);
const trackedLower = new Map([...tracked].map((p) => [p.toLowerCase(), p]));

/* ---- importmap out of index.html (longest-prefix match) ---- */
const importmap = { map: () => null };
const htmlPath = resolve(ROOT, "index.html");
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, "utf8");
  const tag = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (tag) {
    try {
      const imports = (JSON.parse(tag[1]).imports) ?? {};
      const keys = Object.keys(imports).sort((a, b) => b.length - a.length);
      importmap.map = (spec) => {
        const key = keys.find((k) => spec === k || spec.startsWith(k));
        if (!key) return null;
        const rest = spec.slice(key.length);
        const base = imports[key].split(/[?#]/)[0];
        const joined = rest ? `${base.replace(/\/$/, "")}/${rest}` : base;
        return { target: resolve(ROOT, joined.split(/[?#]/)[0]), isDir: joined.endsWith("/") };
      };
    } catch { /* malformed importmap: bare specifiers stay unchecked */ }
  }
}

/* ---- reference collection ---- */
const seen = new Set();
const refs = [];
const remember = (file, raw, target, isDir = false) => {
  const key = `${file}|${raw}`;
  if (seen.has(key) || !target) return;
  seen.add(key);
  refs.push({ file: relative(ROOT, file), raw, target, isDir });
};

function consider(file, raw) {
  if (!raw) return;
  raw = raw.trim();
  if (!raw || SKIP.test(raw)) return;
  if (raw === "/") { remember(file, raw, resolve(ROOT, "index.html")); return; }
  if (raw.startsWith("/")) {
    if (ASSET_EXT.test(raw) || raw.endsWith("/")) {
      remember(file, raw, resolve(ROOT, raw.slice(1).split(/[?#]/)[0]), raw.endsWith("/"));
    }
    return;
  }
  const mapped = importmap.map(raw);
  if (mapped) { remember(file, raw, mapped.target, mapped.isDir); return; }
  if (raw.startsWith("./") || raw.startsWith("../")) {
    remember(file, raw, resolve(dirname(file), raw.split(/[?#]/)[0]), raw.endsWith("/"));
    return;
  }
  if (raw.includes("/") && ASSET_EXT.test(raw)) {
    remember(file, raw, resolve(ROOT, raw.split(/[?#]/)[0]));
  }
  /* anything else is a bare, unmapped specifier or a plain string */
}

function scanAttrs(file, text) {
  const attr = /(?:\b(?:src|href|poster)\s*=|\bsrcset\s*=)(["'])(.*?)\1/gis;
  let m;
  while ((m = attr.exec(text))) {
    if (/srcset\s*=/i.test(m[0])) {
      for (const part of m[2].split(",")) {
        const token = part.trim().split(/\s+/)[0];
        if (token) consider(file, token);
      }
    } else {
      consider(file, m[2]);
    }
  }
}

function scanCss(file, text) {
  const url = /\burl\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m;
  while ((m = url.exec(text))) consider(file, m[2].trim());
}

function scanJs(file, text) {
  const str = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  const tpl = /`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = str.exec(text))) consider(file, m[2].replace(/\\(["'\\])/g, "$1"));
  while ((m = tpl.exec(text))) if (!m[1].includes("${")) consider(file, m[1]);
}

/* ---- gather sources ---- */
const sources = [];
for (const name of ["index.html", "404.html"]) {
  const file = resolve(ROOT, name);
  if (existsSync(file)) sources.push({ file, scans: [scanAttrs, scanCss, scanJs] });
}
for (const dir of ["css", "js"]) {
  for (const entry of await readdir(resolve(ROOT, dir), { withFileTypes: true })) {
    if (!entry.name.endsWith(".css") && !entry.name.endsWith(".js")) continue;
    const file = resolve(ROOT, dir, entry.name);
    sources.push({ file, scans: [dir === "css" ? scanCss : scanJs] });
  }
}
for (const { file, scans } of sources) {
  const text = readFileSync(file, "utf8");
  for (const fn of scans) fn(file, text);
}

/* ---- judge every reference ---- */
for (const r of refs) {
  checked += 1;
  const rel = relative(ROOT, r.target).split(sep).join("/");
  const lower = rel.toLowerCase();
  const onDisk = r.isDir ? diskDirs.has(lower) : disk.has(lower);
  if (!onDisk) {
    problems.push(`MISSING-ON-DISK  ${r.raw}  (referenced in ${r.file})`);
    continue;
  }
  if (r.isDir) continue; /* directories are served implicitly; git tracks files */
  const diskExact = disk.get(lower);
  if (diskExact !== rel) {
    problems.push(`CASE-DISK       code says "${rel}", disk has "${diskExact}"  (${r.file})`);
  }
  const gitExact = trackedLower.get(lower);
  if (!gitExact) {
    problems.push(`NOT-IN-GIT      "${rel}" is not tracked and would 404 on Vercel  (${r.file})`);
  } else if (gitExact !== rel) {
    problems.push(`CASE-GIT        code says "${rel}", git tracks "${gitExact}"  (${r.file})`);
  }
}

/* ---- tracked files whose casing differs from disk ---- */
const globalCase = [];
for (const t of tracked) {
  const d = disk.get(t.toLowerCase());
  if (d && d !== t) globalCase.push(`git "${t}" vs disk "${d}"`);
}

/* ---- site files on disk that git does not track ---- */
for (const exact of disk.values()) {
  if (!tracked.has(exact) && /^(index\.html|404\.html|css\/|js\/|public\/)/.test(exact)) {
    untracked.push(exact);
  }
}

/* ---- dynamic showroom cutout paths ----
   hangar.js and intro.js build these names at runtime from js/data.js ids,
   so the string scanner cannot see them. Every shoe's cutout pair and the
   manifest get the same disk-and-git casing judgement. */
try {
  const { SHOES } = await import(pathToFileURL(resolve(ROOT, "js", "data.js")).href);
  const checkShelf = (raw, label) => {
    checked += 1;
    const rel = relative(ROOT, resolve(ROOT, raw)).split(sep).join("/");
    const lower = rel.toLowerCase();
    if (!disk.has(lower)) {
      problems.push(`MISSING-ON-DISK  ${raw}  (${label})`);
      return;
    }
    if (disk.get(lower) !== rel) {
      problems.push(`CASE-DISK       code says "${rel}", disk has "${disk.get(lower)}"  (${label})`);
    }
    const gitExact = trackedLower.get(lower);
    if (!gitExact) {
      problems.push(`NOT-IN-GIT      "${rel}" is not tracked and would 404 on Vercel  (${label})`);
    } else if (gitExact !== rel) {
      problems.push(`CASE-GIT        code says "${rel}", git tracks "${gitExact}"  (${label})`);
    }
  };
  for (const shoe of SHOES) {
    checkShelf(`public/showroom/${shoe.id}.webp`, `showroom cutout for ${shoe.id}`);
    checkShelf(`public/showroom/${shoe.id}-800.webp`, `showroom cutout for ${shoe.id}`);
  }
  checkShelf("public/showroom/manifest.json", "showroom manifest");
} catch (error) {
  problems.push(`showroom check skipped: js/data.js could not be imported (${error.message})`);
}

const cap = (lines, n) => {
  for (const line of lines.slice(0, n)) console.log("  " + line);
  if (lines.length > n) console.log(`  ... and ${lines.length - n} more`);
};

console.log(`refs checked: ${checked} across ${sources.length} files`);
console.log(`problems: ${problems.length}`);
cap(problems, 20);
console.log(`tracked-vs-disk case mismatches: ${globalCase.length}`);
cap(globalCase, 20);
console.log(`untracked site files: ${untracked.length}${untracked.length ? " (expected for new files before commit)" : ""}`);
cap(untracked, 20);

if (problems.length || globalCase.length) process.exit(1);
console.log("OK: every referenced path exists with exact casing on disk and in git.");
