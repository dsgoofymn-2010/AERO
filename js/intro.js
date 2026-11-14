/* AERO opening sequence: "Enter the hangar".

   A ring of the thirteen shoe cutouts hanging in a dark charcoal-violet
   studio. The camera flies in on load, idles in a slow orbit, and on Enter
   dives through the ring into the hero.

   Robustness contract:
   - The only entry is runIntro({ skip, onHandoff }). skip:true removes the
     overlay without importing Three.
   - Every stage degrades instead of blocking: no WebGL, a failed import, or
     any thrown error falls back to the static card; textures get a 6s
     timeout and a generated stand-in; Enter/Skip are live within 8s no
     matter how slow the network is; a rolling FPS window below 30 drops
     post-processing; a render error drops post first, then stops the loop
     while the UI stays operable.
   - Three.js and its addons resolve through index.html's importmap at one
     pinned vendored version and are imported dynamically, so a return visit
     that skips the intro never pays for them and a blocked vendor file
     cannot stop the site booting. */

import { SHOES, formatPrice } from "./data.js";
import { createPulsatingBorder } from "./intro-border.js";

const MANIFEST_URL = "public/showroom/manifest.json";
const MANIFEST_TIMEOUT = 2500;  // the manifest is a nicety, never a gate
const TEXTURE_TIMEOUT = 6000;   // per-image: stand-in after this, swap on arrival
const READY_DEADLINE = 8000;    // Enter/Skip guaranteed interactive by here
const FLY_MS = 2600;            // cinematic fly-in
const DIVE_WAIT = 620;          // Enter → handoff: the hero starts under the flash
const POST_FPS_FLOOR = 30;      // rolling average below which post drops
const POST_WINDOW = 2.0;        // seconds of an fps window

const asset = (path) => new URL(path, document.baseURI).href;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasWebGL = () => {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};

const pointerIsFine = () => {
  try {
    return window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
};

/* The backdrop is a shader rather than a gradient image so the noise can move
   without a texture and without banding on a dark ramp. Palette: #0e0e10
   charcoal out to #2a2430 violet at the centre. */
const BACKDROP_FRAG = `
  precision highp float;
  uniform float uTime;
  uniform vec2 uAspect;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 c = (uv - 0.5) * uAspect;
    float d = length(c);

    float n = noise(uv * 3.0 + vec2(uTime * 0.03, uTime * 0.02)) * 0.5
            + noise(uv * 7.0 - vec2(uTime * 0.02, uTime * 0.035)) * 0.25;

    vec3 low  = vec3(0.055, 0.055, 0.063);
    vec3 high = vec3(0.165, 0.141, 0.188);
    vec3 col = mix(low, high, smoothstep(1.05, 0.0, d) * (0.72 + n * 0.5));

    // Dither against banding, which is very visible across a dark ramp.
    col += (hash(uv * 1024.0 + uTime) - 0.5) * 0.012;
    col *= smoothstep(1.35, 0.25, d);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BACKDROP_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

/* Film grain plus a little chromatic aberration at the edges. One pass, so it
   is the last thing between bloom and the screen. OutputPass is deliberately
   not in the chain: this look was tuned and verified against the linear
   pipeline the composer produces. */
const GRAIN_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uAberration: { value: 0.0016 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 off = (vUv - 0.5) * uAberration * length(vUv - 0.5) * 2.0;
      vec4 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col.a = 1.0;
      col.rgb += (hash(vUv * 999.0 + fract(uTime)) - 0.5) * uGrain;
      gl_FragColor = col;
    }
  `,
};

function radial(THREE, stops, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function coneTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");
  for (let y = 0; y < 256; y += 1) {
    const t = y / 255;
    const half = 8 + t * 56;
    const alpha = (1 - t) ** 1.6 * 0.5;
    const g = ctx.createLinearGradient(64 - half, 0, 64 + half, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, 128, 1);
  }
  return new THREE.CanvasTexture(c);
}

/* A texture 404ed or stalled: a soft accent glow in the shoe's colour, so a
   missing shot reads as a lit empty bay instead of a broken image. */
function placeholderTexture(THREE, accent, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size * 0.56, size * 0.05, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, "rgba(255,255,255,0.5)");
  g.addColorStop(0.28, `${accent}b0`);
  g.addColorStop(0.62, `${accent}40`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function splitWord(node, word) {
  node.innerHTML = "";
  [...word].forEach((char, i) => {
    const outer = document.createElement("span");
    outer.className = "intro__letter";
    outer.style.setProperty("--i", String(i));
    const inner = document.createElement("span");
    inner.textContent = char;
    outer.appendChild(inner);
    node.appendChild(outer);
  });
}

/* A short whoosh built from an oscillator sweep and filtered noise. No audio
   files, and nothing is created until the viewer unmutes. */
function playWhoosh() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    noise.buffer = buffer;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(320, now);
    band.frequency.exponentialRampToValueAtTime(2600, now + 0.55);
    band.Q.value = 0.9;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

    noise.connect(band).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 1.1);
    setTimeout(() => ctx.close().catch(() => {}), 1400);
  } catch {
    /* Audio is a garnish; a blocked AudioContext must not break the dive. */
  }
}

/* Reduced motion, no WebGL, a failed import, or a failed scene: the wordmark,
   one line and Enter. Same contract, no camera, no Three. */
async function staticIntro(el, { reason }) {
  /* The module layer settled and this is a designed no-camera path, so the
     boot watchdog has nothing left to release. */
  window.__aeroIntroAlive = true;
  // The CTA light runs on both paths: animated here when motion is welcome,
  // a stable frame under reduced motion.
  const border = createPulsatingBorder(el.enter);
  border.start();
  el.intro.classList.add("is-ready", "is-static");
  if (el.state) el.state.textContent = reason;
  if (el.count) el.count.textContent = "100";
  if (el.bar) el.bar.style.width = "100%";
  await new Promise((resolve) => {
    el.enter?.addEventListener("click", resolve, { once: true });
    el.skip?.addEventListener("click", resolve, { once: true });
  });
  el.intro.classList.add("is-leaving");
  await wait(260);
  border.destroy();
  el.intro.remove();
}

/* Postprocessing is optional: a failed import here degrades to plain
   rendering rather than to the static card. */
async function loadPost() {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/ShaderPass.js"),
  ]);
  return { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass };
}

export async function runIntro({ skip = false, onHandoff = null } = {}) {
  const intro = document.getElementById("intro");
  if (!intro) return;
  if (skip) {
    intro.remove();
    return;
  }

  const el = {
    intro,
    mount: document.getElementById("introCanvas"),
    word: document.getElementById("introWord"),
    count: document.getElementById("introCount"),
    bar: document.getElementById("introBar"),
    state: document.getElementById("introState"),
    label: document.getElementById("introLabel"),
    enter: document.getElementById("introEnter"),
    skip: document.getElementById("introSkip"),
    sound: document.getElementById("introSound"),
    flash: document.getElementById("introFlash"),
    clock: document.getElementById("introClock"),
  };
  const sound = { muted: true };

  try {
    splitWord(el.word, "AERO");

    el.sound?.addEventListener("click", () => {
      sound.muted = !sound.muted;
      el.sound.textContent = sound.muted ? "Sound off" : "Sound on";
      el.sound.setAttribute("aria-pressed", String(!sound.muted));
    });

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return await staticIntro(el, { reason: "Ready" });
    if (!hasWebGL()) return await staticIntro(el, { reason: "Ready, without 3D" });

    let THREE;
    try {
      THREE = await import("three");
    } catch (error) {
      console.warn("AERO intro: Three.js unavailable: showing the static card.");
      return await staticIntro(el, { reason: "Ready, without 3D" });
    }

    /* The core settled, so the scene owns the intro from here and the boot
       watchdog stands down. If an import ever hangs without resolving, this
       line never runs and the watchdog still releases the page at 9s. */
    window.__aeroIntroAlive = true;

    let post = null;
    try {
      post = await loadPost();
    } catch (error) {
      console.warn("AERO intro: postprocessing unavailable: plain rendering.");
    }

    await film(el, THREE, post, { sound, onHandoff });
  } catch (error) {
    console.warn("AERO intro: scene failed: showing the static card.", error);
    window.__aeroIntroAlive = true;
    try {
      await staticIntro(el, { reason: "Ready" });
    } catch {
      intro.remove();
    }
  }
}

async function film(el, THREE, post, { sound, onHandoff }) {
  /* ---- bookkeeping: everything the teardown must release ---- */
  const disposables = [];
  const removers = [];
  const track = (x) => { disposables.push(x); return x; };
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    removers.push(() => target.removeEventListener(type, fn, opts));
  };
  let tornDown = false;
  let border = null; // the CTA light, started at is-ready, destroyed on teardown

  const built = { scene: null, composer: null, bloom: null, grain: null, renderer: null };
  const releaseGpu = () => {
    if (tornDown) return;
    tornDown = true;
    removers.splice(0).forEach((fn) => { try { fn(); } catch { /* already gone */ } });
    disposables.splice(0).forEach((d) => { try { d.dispose?.(); } catch { /* inert */ } });
    border?.destroy();
    built.scene?.traverse((obj) => {
      if (obj.isMesh || obj.isPoints || obj.isSprite) {
        try { obj.geometry?.dispose?.(); } catch { /* shared or gone */ }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { try { m?.dispose?.(); } catch { /* shared or gone */ } });
      }
    });
    try { built.bloom?.dispose?.(); } catch { /* optional */ }
    try { built.grain?.dispose?.(); } catch { /* optional */ }
    try { built.composer?.dispose?.(); } catch { /* older three */ }
    try { built.renderer?.dispose(); } catch { /* gone */ }
    try { built.renderer?.forceContextLoss?.(); } catch { /* gone */ }
  };

  try {
    /* Pulsating rim on Enter: js/intro-border.js draws it on a 2D canvas,
       keeping the film's single WebGL context. Decoration only, so a failure
       here leaves the plain button with its own hover and focus states. */
    border = (() => {
      try { return createPulsatingBorder(el.enter); } catch { return null; }
    })();

    /* ---- renderer, scene, camera ---- */
    const narrow = window.innerWidth < 760;
    const dprCap = () => Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.5 : 2);

    const renderer = new THREE.WebGLRenderer({ antialias: !narrow, powerPreference: "high-performance" });
    renderer.setPixelRatio(dprCap());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x0e0e10, 1);
    el.mount.appendChild(renderer.domElement);
    built.renderer = renderer;

    const scene = new THREE.Scene();
    built.scene = scene;
    scene.fog = new THREE.FogExp2(0x181420, 0.026);

    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
    camera.position.set(0, 0.6, 34);
    const clock = new THREE.Clock();

    /* Backdrop */
    const backdropUniforms = { uTime: { value: 0 }, uAspect: { value: new THREE.Vector2(1, 1) } };
    const backdrop = new THREE.Mesh(
      track(new THREE.PlaneGeometry(2, 2)),
      track(new THREE.ShaderMaterial({
        uniforms: backdropUniforms,
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }))
    );
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -1;
    scene.add(backdrop);

    /* Floor: a dark glossy plane. The mirror is a flipped copy of each shoe
       rather than a Reflector pass, which would render the whole scene twice
       for a reflection that is mostly fog. */
    const floorTex = track(radial(THREE, [
      [0, "rgba(150,140,170,0.5)"],
      [0.45, "rgba(90,84,105,0.16)"],
      [1, "rgba(0,0,0,0)"],
    ], 256));
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(80, 80)),
      track(new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, opacity: 0.5, depthWrite: false }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -5.2;
    scene.add(floor);

    /* Volumetric spotlight cone from above */
    const cone = new THREE.Mesh(
      track(new THREE.PlaneGeometry(1, 1)),
      track(new THREE.MeshBasicMaterial({
        map: track(coneTexture(THREE)),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }))
    );
    cone.scale.set(16, 13, 1);
    cone.position.set(0, 1.4, -7);
    scene.add(cone);

    /* The ring of shoes. The manifest only supplies exact aspects; if it is
       slow or missing, the images report their own aspect, so nothing here
       waits on it beyond MANIFEST_TIMEOUT. */
    const manifestReq = fetch(asset(MANIFEST_URL), { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => new Map((d?.shoes || []).map((e) => [e.id, e])))
      .catch(() => new Map());
    const manifest = await Promise.race([
      manifestReq,
      wait(MANIFEST_TIMEOUT).then(() => new Map()),
    ]);

    const planeGeo = track(new THREE.PlaneGeometry(1, 1));
    const glowTex = track(radial(THREE, [
      [0, "rgba(255,255,255,0.85)"],
      [0.4, "rgba(255,255,255,0.22)"],
      [1, "rgba(255,255,255,0)"],
    ]));

    const RADIUS = narrow ? 5.4 : 6.6;
    const cards = [];

    SHOES.forEach((shoe, i) => {
      const angle = (i / SHOES.length) * Math.PI * 2;
      const group = new THREE.Group();
      group.position.set(Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS * 0.62, 0);
      scene.add(group);

      const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(shoe.accent),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })));
      glow.scale.set(3.4, 2.4, 1);
      glow.position.z = -0.45;
      group.add(glow);

      const mat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      group.add(mesh);

      const mirror = new THREE.Mesh(planeGeo, track(new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false,
      })));
      mirror.scale.y = -1;
      mirror.visible = false;
      group.add(mirror);

      mesh.userData.card = cards.length;
      cards.push({
        shoe, group, mesh, mirror, glow,
        phase: (i * 1.9) % (Math.PI * 2),
        hover: 0,
        fade: 0,
        hasReal: false,
        failed: false,
        standIn: false,
        applied: null,
      });
    });

    /* Particles with a depth fade, so the far ones sink into the fog */
    const DUST = narrow ? 260 : 900;
    const dustPos = new Float32Array(DUST * 3);
    const dustDrift = new Float32Array(DUST);
    for (let i = 0; i < DUST; i += 1) {
      dustPos[i * 3] = (Math.random() - 0.5) * 34;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 28 - 4;
      dustDrift[i] = 0.1 + Math.random() * 0.4;
    }
    const dustGeo = track(new THREE.BufferGeometry());
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, track(new THREE.PointsMaterial({
      map: track(radial(THREE, [[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,0.3)"], [1, "rgba(255,255,255,0)"]], 64)),
      size: narrow ? 0.07 : 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })));
    scene.add(dust);

    /* Light streaks: long additive slivers that become speed lines on dive */
    const streaks = [];
    for (let i = 0; i < (narrow ? 4 : 8); i += 1) {
      const s = new THREE.Mesh(planeGeo, track(new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.1 + Math.random() * 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })));
      s.scale.set(0.09, 5 + Math.random() * 9, 1);
      s.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 16, -3 - Math.random() * 16);
      scene.add(s);
      streaks.push({ mesh: s, speed: 0.4 + Math.random() * 1.1 });
    }

    /* Post. A composer construction failure leaves plain rendering. */
    let composer = null;
    let bloom = null;
    let grain = null;
    if (post) {
      try {
        composer = new post.EffectComposer(renderer);
        composer.setPixelRatio(dprCap());
        composer.setSize(window.innerWidth, window.innerHeight);
        composer.addPass(new post.RenderPass(scene, camera));

        bloom = new post.UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          narrow ? 0.5 : 0.75, 0.75, 0.22
        );
        composer.addPass(bloom);

        grain = new post.ShaderPass(GRAIN_SHADER);
        composer.addPass(grain);
        built.composer = composer;
        built.bloom = bloom;
        built.grain = grain;
      } catch (error) {
        console.warn("AERO intro: composer unavailable: plain rendering.");
        composer = bloom = grain = null;
      }
    }
    let postOn = Boolean(composer);
    const render = () => (postOn ? composer.render() : renderer.render(scene, camera));

    /* ---- loading: real progress, stand-ins, an 8s interactivity deadline ---- */
    let loaded = 0;
    let ready = false;
    const writeProgress = (n) => {
      const pct = clamp(Math.round(n * 100), 0, 100);
      if (el.count) el.count.textContent = String(pct).padStart(3, "0");
      if (el.bar) el.bar.style.width = `${pct}%`;
    };
    /* Once Ready is declared the counter freezes at 100: late textures must
       not drag a settled counter backwards. */
    const setProgress = (n) => { if (!ready) writeProgress(n); };
    writeProgress(0);

    const applyTexture = (card, tex) => {
      if (tornDown) { tex.dispose?.(); return; }
      if (card.applied === tex) return;
      card.applied = tex;
      track(tex);
      const aspect = tex.image?.width && tex.image?.height
        ? tex.image.width / tex.image.height
        : 1.6;
      const h = 2.5;
      const w = h * aspect;
      card.mesh.material.map = tex;
      card.mesh.material.needsUpdate = true;
      card.mesh.scale.set(w, h, 1);
      card.mesh.visible = true;
      card.mirror.material.map = tex;
      card.mirror.material.needsUpdate = true;
      card.mirror.scale.set(w, -h * 0.5, 1);
      card.mirror.position.y = -h * 0.78;
      card.mirror.visible = true;
    };

    const applyStandIn = (card) => {
      if (tornDown || card.hasReal || card.standIn) return;
      card.standIn = true;
      applyTexture(card, placeholderTexture(THREE, card.shoe.accent));
    };

    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);

    const loadCard = (card) => new Promise((resolve) => {
      const entry = manifest.get(card.shoe.id);
      const src = asset(entry?.srcMobile || `public/showroom/${card.shoe.id}-800.webp`);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        loaded += 1;
        setProgress(loaded / cards.length);
        resolve();
      };
      const timer = setTimeout(() => {
        /* Slow, not broken: show the stand-in now; the real shot swaps in
           silently when the request eventually lands. */
        applyStandIn(card);
        finish();
      }, TEXTURE_TIMEOUT);

      loader.load(src, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        if (settled) { applyTexture(card, tex); return; }
        clearTimeout(timer);
        card.hasReal = true;
        applyTexture(card, tex);
        finish();
      }, undefined, () => {
        if (settled) return;
        clearTimeout(timer);
        card.failed = true;
        applyStandIn(card);
        console.warn(`AERO intro: "${card.shoe.name}" image unavailable: generated stand-in shown.`);
        finish();
      });
    });

    const startFlyIn = () => {
      const flyStart = performance.now();
      const flyIn = () => {
        if (tornDown) return;
        const k = clamp((performance.now() - flyStart) / FLY_MS, 0, 1);
        const e = 1 - (1 - k) ** 3;
        if (!diving) {
          camera.position.z = lerp(34, 11.5, e);
          roll = lerp(-0.09, 0, e);
        }
        if (k < 1) requestAnimationFrame(flyIn);
        else flyDone = true;
      };
      requestAnimationFrame(flyIn);
    };
    const markReady = () => {
      if (ready || tornDown) return;
      ready = true;
      clearTimeout(deadlineTimer);
      writeProgress(1);
      if (el.state) el.state.textContent = "Ready";
      el.intro.classList.add("is-ready");
      border?.start?.();
      startFlyIn();
    };
    const deadlineTimer = setTimeout(() => {
      if (ready) return;
      /* Anything still pending at the deadline gets its stand-in so the ring
         is complete, then swaps in the real shot if it ever lands. */
      let late = 0;
      cards.forEach((card) => {
        if (!card.hasReal && !card.failed) late += 1;
        applyStandIn(card);
      });
      if (late) {
        console.warn(`AERO intro: ${late} shoe image(s) slow to load: stand-ins shown; the real shots swap in when they land.`);
      }
      markReady();
    }, READY_DEADLINE);

    /* ---- interaction state (declared before any listener uses it) ---- */
    const pointer = new THREE.Vector2();
    const parallax = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    const ray = new THREE.Raycaster();
    let hovered = null;
    let diving = false;
    let flyDone = false;
    let orbit = 0;
    let roll = 0;

    /* ---- custom cursor + magnetic Enter (site-wide versions arm only after
       the intro, so the film drives its own) ---- */
    let cursorEl = null;
    let cursorRaf = 0;
    const cursorTickRef = { tick: null };
    let cursorShoe = false;
    let cursorButton = false;
    const syncCursor = () => {
      cursorEl?.classList.toggle("is-active", cursorShoe || cursorButton);
    };
    if (pointerIsFine()) {
      cursorEl = document.getElementById("cursor");
      if (cursorEl) {
        document.documentElement.classList.add("has-cursor");
        let tx = window.innerWidth / 2;
        let ty = window.innerHeight / 2;
        let cx = tx;
        let cy = ty;
        const cursorTick = () => {
          cx = lerp(cx, tx, 0.18);
          cy = lerp(cy, ty, 0.18);
          cursorEl.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
          cursorRaf = requestAnimationFrame(cursorTick);
        };
        cursorTickRef.tick = cursorTick;
        on(window, "pointermove", (event) => {
          tx = event.clientX;
          ty = event.clientY;
          if (!cursorRaf) cursorRaf = requestAnimationFrame(cursorTick);
        }, { passive: true });
        on(document, "pointerover", (event) => {
          cursorButton = Boolean(event.target.closest?.("a, button, [data-magnetic]"));
          syncCursor();
        });
        cursorRaf = requestAnimationFrame(cursorTick);
      }

      const magnet = el.enter;
      const onMagMove = (event) => {
        const rect = magnet.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
        magnet.style.transform = `translate(${(dx * 9).toFixed(1)}px, ${(dy * 7).toFixed(1)}px)`;
      };
      const onMagLeave = () => { magnet.style.transform = ""; };
      on(magnet, "pointermove", onMagMove);
      on(magnet, "pointerleave", onMagLeave);
    }

    /* ---- pointer parallax, hover labels ---- */
    const labelName = el.label?.querySelector("b");
    const labelPrice = el.label?.querySelector("i");
    const onPointerMove = (event) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = -(event.clientY / window.innerHeight) * 2 + 1;
      pointer.set(x, y);
      if (diving) return;
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(cards.filter((c) => c.mesh.visible).map((c) => c.mesh), false)[0];
      const next = hit ? cards[hit.object.userData.card] : null;
      if (next !== hovered) {
        hovered = next;
        cursorShoe = Boolean(next);
        syncCursor();
        if (next) {
          if (labelName) labelName.textContent = next.shoe.name;
          if (labelPrice) labelPrice.textContent = formatPrice(next.shoe.price);
          el.label?.style.setProperty("--accent", next.shoe.accent);
        }
        el.label?.classList.toggle("is-on", Boolean(next));
      }
      if (hovered && el.label) {
        el.label.style.left = `${event.clientX}px`;
        el.label.style.top = `${event.clientY}px`;
      }
    };
    on(window, "pointermove", onPointerMove);

    /* Tilt from devices that report orientation without a permission prompt;
       iOS would need a gesture first and the intro must not open a dialog. */
    const onOrient = (event) => {
      if (event.gamma == null || event.beta == null) return;
      tilt.x = clamp(event.gamma / 45, -1, 1);
      tilt.y = clamp((event.beta - 45) / 45, -1, 1);
    };
    if (narrow && typeof DeviceOrientationEvent !== "undefined"
        && typeof DeviceOrientationEvent.requestPermission !== "function") {
      on(window, "deviceorientation", onOrient);
    }

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(dprCap());
      if (composer) {
        composer.setSize(w, h);
        composer.setPixelRatio(dprCap());
      }
      backdropUniforms.uAspect.value.set(Math.max(1, w / h), Math.max(1, h / w));
    };
    on(window, "resize", onResize);
    on(window, "orientationchange", onResize);
    onResize();

    /* Lets scripts/verify_routing.mjs assert both that the cards exist and
       that bright pixels actually reached the framebuffer: the backdrop
       tops out near luma 45, so anything above 64 counts as drawn content. */
    window.__introCards = () => {
      if (tornDown) return null;
      render();
      const probe = document.createElement("canvas");
      probe.width = 64;
      probe.height = 36;
      const g = probe.getContext("2d", { willReadFrequently: true });
      g.drawImage(renderer.domElement, 0, 0, 64, 36);
      const data = g.getImageData(0, 0, 64, 36).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 64) lit += 1;
      }
      return {
        visible: cards.filter((c) => c.mesh.visible).length,
        opaque: cards.filter((c) => c.mesh.material.opacity > 0.9).length,
        z: +camera.position.z.toFixed(1),
        drawn: +(lit / (64 * 36)).toFixed(3),
        // fade0 + t distinguish "fade still climbing" from "render loop stalled":
        // t moves iff the loop ticks, fade0 rises iff the fade gate is open.
        fade0: +cards[0].fade.toFixed(3),
        t: +clock.elapsedTime.toFixed(2),
      };
    };

    /* ---- render loop ---- */
    let raf = 0;
    let ringSpin = 0;
    let frameFailures = 0;
    let winStart = 0;
    let winFrames = 0;

    const disablePost = (why) => {
      if (!postOn) return;
      postOn = false;
      /* Disable, never removePass: EffectComposer.removePass takes an index,
         and a stale pass reference there splices the wrong pass out. */
      if (bloom) bloom.enabled = false;
      if (grain) grain.enabled = false;
      if (why) console.warn(`AERO intro: postprocessing disabled (${why}): plain rendering.`);
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;

      try {
        if (postOn) {
          if (!winStart) { winStart = t; winFrames = 0; }
          winFrames += 1;
          if (t - winStart >= POST_WINDOW) {
            if (winFrames / (t - winStart) < POST_FPS_FLOOR) disablePost("frame rate");
            winStart = 0;
            winFrames = 0;
          }
        }

        backdropUniforms.uTime.value = t;
        if (postOn && grain) grain.uniforms.uTime.value = t;

        parallax.x = lerp(parallax.x, pointer.x + tilt.x, 0.035);
        parallax.y = lerp(parallax.y, pointer.y + tilt.y, 0.035);

        if (!diving) {
          ringSpin += dt * 0.05;
          orbit += dt * 0.02;
          camera.position.x = lerp(camera.position.x, Math.sin(orbit) * 1.1 + parallax.x * 1.5, 0.05);
          camera.position.y = lerp(camera.position.y, 0.6 + parallax.y * 0.9, 0.05);
          if (flyDone) {
            camera.position.z = lerp(camera.position.z, 11.5 + Math.cos(orbit) * 0.55, 0.04);
          }
        } else {
          camera.position.z = lerp(camera.position.z, -9, 0.06);
          roll = lerp(roll, 0.12, 0.05);
          if (bloom) bloom.strength = lerp(bloom.strength, 2.4, 0.07);
        }
        /* lookAt builds its quaternion from `up`, so the roll has to ride in
           `up`: a rotation.z write is overwritten by every lookAt call. */
        camera.up.set(Math.sin(roll), Math.cos(roll), 0).normalize();
        camera.lookAt(parallax.x * 0.7, 0.4 + parallax.y * 0.4, 0);

        cards.forEach((card, i) => {
          const angle = (i / cards.length) * Math.PI * 2 + ringSpin;
          card.group.position.x = Math.cos(angle) * RADIUS;
          card.group.position.y = Math.sin(angle) * RADIUS * 0.62;

          if (card.fade < 1 && card.mesh.visible) card.fade = Math.min(1, card.fade + dt * 1.1);
          const target = card === hovered ? 1 : 0;
          card.hover = lerp(card.hover, target, 0.1);

          const float = Math.sin(t * 0.6 + card.phase) * 0.12;
          card.mesh.position.y = float;
          card.mesh.position.z = card.hover * 1.3;
          card.mesh.rotation.y = Math.sin(t * 0.25 + card.phase) * 0.12 + parallax.x * 0.08;
          card.mirror.rotation.y = card.mesh.rotation.y;
          card.mesh.material.opacity = card.fade;
          card.mirror.material.opacity = card.fade * 0.14;
          card.glow.material.opacity = (0.34 + card.hover * 0.5) * card.fade;
          card.glow.position.z = -0.45 + card.hover * 1.3;
        });

        const dustBoost = diving ? 6 : 1;
        const pos = dustGeo.attributes.position.array;
        for (let i = 0; i < DUST; i += 1) {
          pos[i * 3 + 1] += dustDrift[i] * dt * 0.4 * dustBoost;
          if (pos[i * 3 + 1] > 10) pos[i * 3 + 1] = -10;
        }
        dustGeo.attributes.position.needsUpdate = true;

        streaks.forEach(({ mesh, speed }) => {
          mesh.position.y += speed * dt * (diving ? 14 : 1);
          if (mesh.position.y > 10) mesh.position.y = -10;
          if (diving) mesh.scale.y = lerp(mesh.scale.y, 26, 0.08);
        });

        render();
      } catch (error) {
        /* A render failure must never brick the page: drop post first (most
           such errors live in the passes), then stop the loop: the HUD, the
           buttons and the handoff keep working without the film. */
        frameFailures += 1;
        if (frameFailures === 1) {
          disablePost("render error");
          console.warn("AERO intro: render error: plain rendering from here.", error);
        } else if (frameFailures >= 4) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      }
    };

    const onHidden = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        if (cursorRaf) { cancelAnimationFrame(cursorRaf); cursorRaf = 0; }
      } else if (frameFailures < 4) {
        /* A loop stopped by repeated render errors stays stopped; the HUD and
           the buttons keep working without it. */
        clock.getDelta();
        raf = requestAnimationFrame(frame);
        if (cursorEl && !cursorRaf && cursorTickRef.tick) {
          cursorRaf = requestAnimationFrame(cursorTickRef.tick);
        }
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    removers.push(() => document.removeEventListener("visibilitychange", onHidden));
    raf = requestAnimationFrame(frame);

    /* Clock ticker for the HUD coordinates label */
    const tick = setInterval(() => {
      if (!el.clock) return;
      const now = new Date();
      el.clock.textContent = `IST ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    }, 1000);

    /* ---- wait for the viewer: Skip is live from the first frame, Enter from
       is-ready (8s worst case), never later ---- */
    el.state.textContent = "Loading the hangar";
    const whenLeft = new Promise((resolve) => {
      el.skip.addEventListener("click", () => resolve("skip"), { once: true });
      el.enter.addEventListener("click", () => resolve("enter"), { once: true });
    });
    const whenLoaded = Promise.all(cards.map(loadCard)).then(() => "loaded");
    const winner = await Promise.race([whenLeft, whenLoaded]);
    if (winner === "loaded") markReady();

    /* Enter needs the ripple even if it fires in the same tick as Ready. */
    const ripple = (event) => {
      const box = el.enter.getBoundingClientRect();
      const r = document.createElement("span");
      r.className = "intro__ripple";
      r.style.left = `${event.clientX - box.left}px`;
      r.style.top = `${event.clientY - box.top}px`;
      r.style.width = r.style.height = `${box.width / 2}px`;
      el.enter.appendChild(r);
      setTimeout(() => r.remove(), 800);
    };
    el.enter.addEventListener("click", ripple);

    const choice = await whenLeft;

    if (choice === "enter") {
      /* Dive through the ring, flash, then hand over to the hero. The hero's
         entrance is fired here, under the flash, so the dive, the flash
         clearing and the title rising read as one move instead of opening on
         an already-emptied stage. */
      diving = true;
      if (!sound.muted) playWhoosh();
      await wait(DIVE_WAIT);
      onHandoff?.();
      el.flash?.animate(
        [{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }],
        { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
      await wait(180);
    }

    el.intro.classList.add("is-leaving");
    await wait(choice === "enter" ? 520 : 300);

    /* ---- teardown ---- */
    clearInterval(tick);
    clearTimeout(deadlineTimer);
    cancelAnimationFrame(raf);
    if (cursorRaf) cancelAnimationFrame(cursorRaf);
    border?.destroy?.();
    if (cursorEl) {
      cursorEl.classList.remove("is-active");
      cursorEl.style.transform = "";
      document.documentElement.classList.remove("has-cursor");
    }
    if (el.enter) el.enter.style.transform = "";
    releaseGpu();
    el.intro.remove();
  } catch (error) {
    /* Keep the overlay element: runIntro's catch rebuilds the static card
       on it, and its buttons must still be in the document to be clickable. */
    releaseGpu();
    throw error;
  }
}
