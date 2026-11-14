/* Pulsating border — a vanilla port of Originkit's "pulsating-border"
   component, rebuilt for this site's contract: no React, no build step, and
   Canvas 2D instead of a second WebGL context, which the intro film already
   owns.

   Enter is the one control the opening film offers, so the border is the
   intro's single focus accent: three light sources drift around the button's
   circular rim, each drawn as a crisp core, a soft bloom and a faint
   atmospheric spill. A gradient punch erases the glow toward the centre so
   the label keeps its contrast.

   Motion contract: prefers-reduced-motion renders one stable frame and stops,
   the loop pauses while the tab is hidden, and destroy() releases everything.
   The canvas is aria-hidden and pointer-transparent, so the button keeps its
   own hover and focus states. */

const TAU = Math.PI * 2;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

const rootColor = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

export function createPulsatingBorder(host, { colors = {} } = {}) {
  if (!host) return { start() {}, destroy() {} };

  /* Two hues from the site's palette: the bone the button already speaks in,
     plus the accent tint of the backdrop's violet ramp. */
  const core = hexToRgb(colors.core || rootColor("--bone", "#f1eee7"));
  const tint = hexToRgb(colors.spill || rootColor("--accent-text", "#a9bcff"));
  const dim = hexToRgb(colors.dim || rootColor("--bone-dim", "#d2cdc2"));

  const canvas = document.createElement("canvas");
  canvas.className = "intro__border";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { start() {}, destroy() { canvas.remove(); } };

  /* Speeds are rad/s and deliberately unsynced, so the sources overtake each
     other instead of orbiting as a rigid set. */
  const sources = [
    { rgb: core, speed: 0.34, phase: 0.0, core: 1.0, bloom: 0.8, spill: 0.4 },
    { rgb: tint, speed: 0.21, phase: 2.3, core: 0.7, bloom: 0.6, spill: 0.95 },
    { rgb: dim, speed: 0.46, phase: 4.4, core: 0.55, bloom: 0.45, spill: 0.3 },
  ];

  let size = 0;
  let radius = 0;
  let pad = 0;
  let dpr = 1;
  let t = 0;
  let prev = 0;
  let raf = 0;
  let active = false;

  const measure = () => {
    const s = Math.max(host.offsetWidth, host.offsetHeight);
    if (!s) return false;
    size = s;
    radius = s / 2;
    pad = Math.round(radius * 0.95);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = size + pad * 2;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.style.left = `calc(50% - ${cssSize / 2}px)`;
    canvas.style.top = `calc(50% - ${cssSize / 2}px)`;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    return true;
  };

  const glow = (x, y, r, rgb, a) => {
    if (r <= 0 || a <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(rgb, a));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };

  const draw = () => {
    if (!size) return;
    const c = pad + radius;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
    ctx.globalCompositeOperation = "lighter";

    for (const s of sources) {
      const breathe = 1 + Math.sin(t * 0.9 + s.phase * 1.7) * 0.035;
      const r = radius * breathe;
      const a = s.phase + t * s.speed;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      glow(x, y, radius * 0.06 * s.core, s.rgb, 0.9);
      glow(x, y, radius * 0.3 * s.bloom, s.rgb, 0.3);
      glow(x, y, radius * 0.78 * s.spill, s.rgb, 0.09);
    }

    /* destination-out only reads the fill's alpha, so a gradient punch erases
       the inner plane smoothly instead of cutting a hard edge into the bloom. */
    ctx.globalCompositeOperation = "destination-out";
    const punch = ctx.createRadialGradient(c, c, radius * 0.55, c, c, radius * 0.98);
    punch.addColorStop(0, "rgba(0,0,0,1)");
    punch.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = punch;
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.98, 0, TAU);
    ctx.fill();
  };

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!prev) prev = now;
    t += Math.min(0.05, (now - prev) / 1000);
    prev = now;
    draw();
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    prev = 0;
  };

  const apply = () => {
    if (!active) return;
    if (REDUCED.matches) { stop(); draw(); return; }
    if (document.hidden) { stop(); return; }
    if (!raf) { prev = 0; raf = requestAnimationFrame(frame); }
  };

  const start = () => {
    if (active) { apply(); return; }
    active = true;
    measure();
    apply();
  };

  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (measure() && !raf) draw();
    });
    ro.observe(host);
  } else {
    measure();
  }

  if (REDUCED.addEventListener) REDUCED.addEventListener("change", apply);
  else if (REDUCED.addListener) REDUCED.addListener(apply);
  document.addEventListener("visibilitychange", apply);

  const destroy = () => {
    stop();
    active = false;
    ro?.disconnect();
    if (REDUCED.removeEventListener) REDUCED.removeEventListener("change", apply);
    else if (REDUCED.removeListener) REDUCED.removeListener(apply);
    document.removeEventListener("visibilitychange", apply);
    canvas.remove();
  };

  return { start, destroy };
}
