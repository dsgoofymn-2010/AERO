/* AERO opening sequence — "Enter the hangar".

   A ring of the thirteen shoe cutouts hanging in a dark studio. The camera
   flies in on load, idles, and on Enter dives through the ring into the hero.

   Three.js and its addons resolve through the importmap in index.html but are
   imported dynamically, so a return visit that skips the intro never pays for
   them and a blocked CDN cannot stop the site booting. */

import { SHOES, formatPrice } from "./data.js";

const MANIFEST = "public/showroom/manifest.json";
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

/* The backdrop is a shader rather than a gradient image so the noise can move
   without a texture and without banding on a dark ramp. */
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

    vec3 low  = vec3(0.055, 0.047, 0.066);
    vec3 high = vec3(0.176, 0.153, 0.204);
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
   is the only thing between bloom and the screen. */
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
  setTimeout(() => ctx.close(), 1400);
}

/* Reduced motion, no WebGL, or a failed scene: the wordmark, one line and
   Enter. Same contract, no camera. */
async function staticIntro(el, { reason }) {
  el.intro.classList.add("is-ready", "is-static");
  el.state.textContent = reason;
  el.count.textContent = "100";
  el.bar.style.width = "100%";
  await new Promise((resolve) => {
    const done = () => resolve();
    el.enter.addEventListener("click", done, { once: true });
    el.skip.addEventListener("click", done, { once: true });
  });
  el.intro.classList.add("is-leaving");
  await wait(260);
  el.intro.remove();
}

export async function runIntro({ skip = false } = {}) {
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
  splitWord(el.word, "AERO");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let muted = true;
  el.sound?.addEventListener("click", () => {
    muted = !muted;
    el.sound.textContent = muted ? "Sound off" : "Sound on";
    el.sound.setAttribute("aria-pressed", String(!muted));
  });

  if (reduced) return staticIntro(el, { reason: "Ready" });
  if (!hasWebGL()) return staticIntro(el, { reason: "Ready, without 3D" });

  let THREE;
  let EffectComposer;
  let RenderPass;
  let UnrealBloomPass;
  let ShaderPass;
  try {
    [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] = await Promise.all([
      import("three"),
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/ShaderPass.js"),
    ]);
  } catch (error) {
    console.warn("AERO intro: Three.js unavailable.", error);
    return staticIntro(el, { reason: "Ready, without 3D" });
  }

  const narrow = window.innerWidth < 760;
  const dpr = Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 2);

  const renderer = new THREE.WebGLRenderer({ antialias: !narrow, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0e0e10, 1);
  el.mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x15121b, 0.026);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
  camera.position.set(0, 0.6, 34);

  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };

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
     rather than a Reflector pass, which would render the whole scene twice for
     a reflection that is mostly fog. */
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

  /* Spotlight cone from above */
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

  /* The ring of shoes */
  const manifest = await fetch(asset(MANIFEST), { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => new Map((d?.shoes || []).map((e) => [e.id, e])))
    .catch(() => new Map());

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
      opacity: 0.5,
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
      baseScale: 1,
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

  /* Light streaks: a few long additive slivers drifting through the ring */
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

  /* Post */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    narrow ? 0.5 : 0.75, 0.75, 0.22
  );
  composer.addPass(bloom);

  const grain = new ShaderPass(GRAIN_SHADER);
  grain.renderToScreen = true;
  composer.addPass(grain);
  let postOn = true;

  /* Texture preload drives the real 000 to 100 counter */
  const loader = new THREE.TextureLoader();
  let loaded = 0;
  const setProgress = (n) => {
    const pct = clamp(Math.round(n * 100), 0, 100);
    el.count.textContent = String(pct).padStart(3, "0");
    el.bar.style.width = `${pct}%`;
  };
  setProgress(0);

  const loadCard = (card) => new Promise((done) => {
    const entry = manifest.get(card.shoe.id);
    const src = asset(entry?.srcMobile || `public/showroom/${card.shoe.id}-800.webp`);
    loader.load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      disposables.push(tex);
      const aspect = entry?.aspect || tex.image.width / tex.image.height;
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
      card.baseScale = 1;
      loaded += 1;
      setProgress(loaded / cards.length);
      done();
    }, undefined, () => {
      loaded += 1;
      setProgress(loaded / cards.length);
      done();
    });
  });

  /* Interaction */
  const pointer = new THREE.Vector2();
  const parallax = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  const ray = new THREE.Raycaster();
  let hovered = null;
  let diving = false;

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
      document.getElementById("cursor")?.classList.toggle("is-active", Boolean(next));
      if (next) {
        el.label.querySelector("b").textContent = next.shoe.name;
        el.label.querySelector("i").textContent = formatPrice(next.shoe.price);
      }
      el.label.classList.toggle("is-on", Boolean(next));
    }
    if (hovered) {
      el.label.style.left = `${event.clientX}px`;
      el.label.style.top = `${event.clientY}px`;
    }
  };
  window.addEventListener("pointermove", onPointerMove);

  const onOrient = (event) => {
    if (event.gamma == null || event.beta == null) return;
    tilt.x = clamp(event.gamma / 45, -1, 1);
    tilt.y = clamp((event.beta - 45) / 45, -1, 1);
  };
  // Only where it needs no prompt; iOS requires a gesture and the intro should
  // not open a permission dialog before the viewer has asked for anything.
  if (narrow && typeof DeviceOrientationEvent !== "undefined"
      && typeof DeviceOrientationEvent.requestPermission !== "function") {
    window.addEventListener("deviceorientation", onOrient);
  }

  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    backdropUniforms.uAspect.value.set(Math.max(1, w / h), Math.max(1, h / w));
  };
  window.addEventListener("resize", onResize);
  onResize();

  // Lets scripts/verify_routing.mjs assert the ring actually drew.
  window.__introCards = () => ({
    visible: cards.filter((c) => c.mesh.visible).length,
    opaque: cards.filter((c) => c.mesh.material.opacity > 0.9).length,
    z: +camera.position.z.toFixed(1),
  });

  const clock = new THREE.Clock();
  let raf = 0;
  let ringSpin = 0;
  let dive = 0;

  // If the first second cannot hold a reasonable frame rate, drop the heaviest
  // pass rather than shipping a slideshow.
  let frames = 0;
  let checkAt = 1.2;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    frames += 1;

    if (postOn && t > checkAt) {
      if (frames / t < 40) {
        composer.removePass(bloom);
        postOn = false;
        el.state.textContent = "Ready";
      }
      checkAt = Infinity;
    }

    backdropUniforms.uTime.value = t;
    grain.uniforms.uTime.value = t;

    parallax.x = lerp(parallax.x, pointer.x + tilt.x, 0.035);
    parallax.y = lerp(parallax.y, pointer.y + tilt.y, 0.035);

    if (!diving) {
      ringSpin += dt * 0.05;
      camera.position.x = lerp(camera.position.x, parallax.x * 1.5, 0.05);
      camera.position.y = lerp(camera.position.y, 0.6 + parallax.y * 0.9, 0.05);
    } else {
      dive = Math.min(1, dive + dt * 1.5);
      camera.position.z = lerp(camera.position.z, -9, 0.06);
      camera.rotation.z = lerp(camera.rotation.z, 0.12, 0.05);
      bloom.strength = lerp(bloom.strength, 2.4, 0.07);
    }
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

    const pos = dustGeo.attributes.position.array;
    for (let i = 0; i < DUST; i += 1) {
      pos[i * 3 + 1] += dustDrift[i] * dt * 0.4;
      if (pos[i * 3 + 1] > 10) pos[i * 3 + 1] = -10;
    }
    dustGeo.attributes.position.needsUpdate = true;

    streaks.forEach(({ mesh, speed }) => {
      mesh.position.y += speed * dt * (diving ? 14 : 1);
      if (mesh.position.y > 10) mesh.position.y = -10;
      if (diving) mesh.scale.y = lerp(mesh.scale.y, 26, 0.08);
    });

    composer.render();
  };

  const onHidden = () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else { clock.getDelta(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onHidden);
  raf = requestAnimationFrame(frame);

  /* Clock ticker */
  const tick = setInterval(() => {
    if (!el.clock) return;
    const now = new Date();
    el.clock.textContent = `IST ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  }, 1000);

  /* Load, then let the viewer in */
  el.state.textContent = "Loading the hangar";
  await Promise.all(cards.map(loadCard));
  el.state.textContent = "Ready";
  intro.classList.add("is-ready");

  // Fly-in: from far back with a little roll, settling just outside the ring.
  const flyFrom = { z: 34, roll: -0.09 };
  const flyStart = performance.now();
  const flyIn = () => {
    const k = clamp((performance.now() - flyStart) / 2600, 0, 1);
    const e = 1 - (1 - k) ** 3;
    if (!diving) {
      camera.position.z = lerp(flyFrom.z, 11.5, e);
      camera.rotation.z = lerp(flyFrom.roll, 0, e);
    }
    if (k < 1) requestAnimationFrame(flyIn);
  };
  requestAnimationFrame(flyIn);

  /* Enter */
  el.enter.addEventListener("click", (event) => {
    const box = el.enter.getBoundingClientRect();
    const r = document.createElement("span");
    r.className = "intro__ripple";
    r.style.left = `${event.clientX - box.left}px`;
    r.style.top = `${event.clientY - box.top}px`;
    r.style.width = r.style.height = `${box.width / 2}px`;
    el.enter.appendChild(r);
    setTimeout(() => r.remove(), 800);
  });

  await new Promise((resolve) => {
    const leave = (dived) => {
      if (diving) return;
      diving = true;
      if (!muted) playWhoosh();
      resolve(dived);
    };
    el.enter.addEventListener("click", () => leave(true), { once: true });
    el.skip.addEventListener("click", () => leave(false), { once: true });
  }).then(async (dived) => {
    if (dived) {
      // Dive through the ring, flash, then hand over to the hero.
      await wait(620);
      el.flash.animate(
        [{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }],
        { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
      await wait(180);
    }
    intro.classList.add("is-leaving");
    await wait(dived ? 520 : 300);
  });

  /* Teardown */
  clearInterval(tick);
  cancelAnimationFrame(raf);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("deviceorientation", onOrient);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onHidden);
  document.getElementById("cursor")?.classList.remove("is-active");

  disposables.forEach((d) => d.dispose?.());
  scene.traverse((obj) => {
    if (obj.isMesh || obj.isPoints || obj.isSprite) {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m?.dispose?.());
    }
  });
  bloom.dispose?.();
  grain.dispose?.();
  composer.renderTarget1?.dispose?.();
  composer.renderTarget2?.dispose?.();
  renderer.dispose();
  renderer.forceContextLoss?.();
  intro.remove();
}
