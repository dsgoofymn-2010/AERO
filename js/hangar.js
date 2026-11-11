/* AERO hangar showroom — the 3D wall.

   Thirteen shoes on glass shelves, laid out from data.js. Three.js is imported
   only when the hangar actually runs, and it resolves through the importmap
   to the vendored copy in public/vendor/, so the site boots even offline
   (same contract as intro.js).

   Camera states and the details panel land in hangar-focus; this module owns
   the scene, the layout, hover, and teardown. */

const DEFAULTS = {
  manifestUrl: "public/showroom/manifest.json",
  rows: 2,
  columns: null,
  fitRows: null,
  cell: { w: 1.55, h: 1.0, gapX: 0.45, gapY: 1.15 },
  shoe: { maxW: 1.3, maxH: 0.95 },
  dust: 700,
  pixelRatio: 2,
  fov: 35,
  backdrop: 0x17141c,
};

let WHITE = null;

const asset = (path) => new URL(path, document.baseURI).href;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* A 1x64 white-to-transparent ramp, used as the alphaMap that fades the
   mirrored shoe out as it falls away from the shelf. */
function rampTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 64;
  const g = c.getContext("2d").createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.45, "#4a4a4a");
  g.addColorStop(1, "#000000");
  const ctx = c.getContext("2d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function radialTexture(THREE, stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* A soft downward cone for the spotlight over the focused shoe: bright at the
   top where the fixture would be, feathered to nothing at the floor. */
function coneTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");
  for (let y = 0; y < 256; y += 1) {
    const t = y / 255;
    const halfWidth = 16 + t * 48;
    const alpha = Math.sin(Math.min(1, t * 1.25) * Math.PI) ** 1.4 * 0.62;
    const g = ctx.createLinearGradient(64 - halfWidth, 0, 64 + halfWidth, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, 128, 1);
  }
  return new THREE.CanvasTexture(c);
}

function layout(count, opts) {
  const { rows, cell } = opts;
  const cols = Math.max(1, opts.columns || Math.ceil(count / rows));
  const stepX = cell.w + cell.gapX;
  const stepY = cell.h + cell.gapY;
  const usedRows = Math.ceil(count / cols);
  const slots = [];

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    slots.push({
      row,
      col,
      // Centre each row on its own count, so a short last row is not left-heavy.
      x: (col - (inRow - 1) / 2) * stepX,
      y: ((usedRows - 1) / 2 - row) * stepY,
    });
  }
  return { slots, cols, rows: usedRows, width: cols * stepX, height: usedRows * stepY };
}

async function loadManifest(url) {
  try {
    const res = await fetch(asset(url), { cache: "force-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return new Map((data.shoes || []).map((entry) => [entry.id, entry]));
  } catch (error) {
    console.warn("AERO hangar: cutout manifest unavailable, falling back to conventional paths.", error);
    return new Map();
  }
}

export async function createHangar(options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options,
    cell: { ...DEFAULTS.cell, ...(options.cell || {}) },
    shoe: { ...DEFAULTS.shoe, ...(options.shoe || {}) },
  };
  const { mount, shoes } = opts;
  if (!mount || !Array.isArray(shoes) || shoes.length === 0) {
    throw new Error("createHangar needs a mount element and a non-empty shoes array");
  }

  const THREE = await import("three");
  const manifest = await loadManifest(opts.manifestUrl);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.classList.add("hangar__canvas");
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const grid = layout(shoes.length, opts);
  scene.fog = new THREE.Fog(opts.backdrop, grid.width * 0.9, grid.width * 2.6);

  const camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.1, 200);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  WHITE = WHITE || new THREE.Color(0xffffff);
  const hazeColor = new THREE.Color(opts.backdrop);
  const ramp = rampTexture(THREE);
  const glowSprite = radialTexture(THREE, [
    [0, "rgba(255,255,255,0.95)"],
    [0.35, "rgba(255,255,255,0.28)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const dustSprite = radialTexture(THREE, [
    [0, "rgba(255,255,255,1)"],
    [0.5, "rgba(255,255,255,0.35)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const cone = coneTexture(THREE);

  const loader = new THREE.TextureLoader();
  const bays = [];
  const pickTargets = [];
  const disposables = [ramp, glowSprite, dustSprite, cone];

  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  const planeGeo = track(new THREE.PlaneGeometry(1, 1));
  const shelfGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const shelfEdges = track(new THREE.EdgesGeometry(shelfGeo));

  shoes.forEach((shoe, index) => {
    const slot = grid.slots[index];
    const entry = manifest.get(shoe.id);
    const accent = new THREE.Color(shoe.accent || "#ffffff");
    const bay = new THREE.Group();
    bay.position.set(slot.x, slot.y, 0);
    scene.add(bay);

    const shelfW = opts.cell.w;
    const shelfTop = -opts.cell.h * 0.46;

    const glass = new THREE.Mesh(
      shelfGeo,
      track(new THREE.MeshBasicMaterial({
        color: 0xb9c2d0,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }))
    );
    glass.scale.set(shelfW, 0.03, 0.46);
    glass.position.y = shelfTop;
    bay.add(glass);

    const edge = new THREE.LineSegments(
      shelfEdges,
      track(new THREE.LineBasicMaterial({ color: 0xdfe6f0, transparent: true, opacity: 0.42 }))
    );
    edge.scale.copy(glass.scale);
    edge.position.copy(glass.position);
    bay.add(edge);

    // The one place the shoe's accent appears. It names the bay and doubles as
    // the hover signal, so it is carrying information, not decorating the shelf.
    const strip = new THREE.Mesh(
      planeGeo,
      track(new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, fog: false }))
    );
    strip.scale.set(shelfW * 0.86, 0.026, 1);
    strip.position.set(0, shelfTop - 0.048, 0.2);
    bay.add(strip);

    const bloom = new THREE.Sprite(
      track(new THREE.SpriteMaterial({
        map: glowSprite,
        color: accent,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }))
    );
    bloom.scale.set(shelfW * 1.5, 0.48, 1);
    bloom.position.set(0, shelfTop - 0.07, 0.16);
    bay.add(bloom);

    const shoeMat = track(new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(planeGeo, shoeMat);
    mesh.visible = false;
    bay.add(mesh);

    const mirrorMat = track(new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      alphaMap: ramp,
      side: THREE.DoubleSide,
    }));
    const mirror = new THREE.Mesh(planeGeo, mirrorMat);
    mirror.scale.y = -1;
    mirror.visible = false;
    bay.add(mirror);

    mesh.userData.index = index;
    pickTargets.push(mesh);

    bays.push({
      index,
      shoe,
      entry,
      slot,
      bay,
      mesh,
      mirror,
      strip,
      bloom,
      edge,
      accent,
      shelfTop,
      phase: (index * 1.37) % (Math.PI * 2),
      hover: 0,
      dim: 0,
      baseY: slot.y,
      loaded: false,
    });
  });

  const fit = (bayState, aspect) => {
    const h = Math.min(opts.shoe.maxH, opts.shoe.maxW / aspect);
    const w = h * aspect;
    const y = bayState.shelfTop + h / 2 + 0.035;
    bayState.mesh.scale.set(w, h, 1);
    bayState.mesh.position.set(0, y, 0.02);
    bayState.mirror.scale.set(w, -h * 0.62, 1);
    bayState.mirror.position.set(0, bayState.shelfTop - h * 0.31 - 0.02, 0.01);
    bayState.restY = y;
  };

  const dust = (() => {
    if (opts.dust <= 0) return null;
    const count = opts.dust;
    const positions = new Float32Array(count * 3);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * grid.width * 1.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * grid.height * 1.8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
      drift[i] = 0.012 + Math.random() * 0.03;
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      track(new THREE.PointsMaterial({
        map: dustSprite,
        size: 0.028,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }))
    );
    scene.add(points);
    return { points, positions, drift, spanY: grid.height * 1.8 };
  })();

  const spot = new THREE.Mesh(
    planeGeo,
    track(new THREE.MeshBasicMaterial({
      map: cone,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }))
  );
  spot.scale.set(1.5, 2.1, 1);
  spot.visible = false;
  scene.add(spot);

  /* ---- camera ---- */

  const startAspect = Math.max(0.4, (mount.clientWidth || 1280) / (mount.clientHeight || 720));
  const hFov = 2 * Math.atan(Math.tan((opts.fov * Math.PI) / 360) * startAspect);

  /* A bay is not symmetric about its origin: the shoe stands above the shelf and
     its reflection hangs below. Aim at the middle of what is actually drawn, or
     the wall rides high with dead frame under it. */
  const shelfTopY = -opts.cell.h * 0.46;
  const contentTop = grid.height / 2 - opts.cell.gapY / 2 + shelfTopY + opts.shoe.maxH;
  const contentBottom = -(grid.height / 2 - opts.cell.gapY / 2) + shelfTopY - opts.shoe.maxH * 0.62;
  const centerY = (contentTop + contentBottom) / 2;
  const contentH = contentTop - contentBottom;

  /* fitRows frames only part of the wall, which is how the single-column
     mobile layout works: the rest is reached by panning. */
  const stepY = opts.cell.h + opts.cell.gapY;
  const framedH = opts.fitRows ? opts.fitRows * stepY : contentH;

  const overviewZ = Math.max(
    framedH / 2 / Math.tan((opts.fov * Math.PI) / 360),
    grid.width / 2 / Math.tan(hFov / 2)
  ) * 1.04;

  const visibleH = 2 * overviewZ * Math.tan((opts.fov * Math.PI) / 360);
  const slack = Math.max(0, contentH - visibleH) / 2;
  const panRange = { min: centerY - slack, max: centerY + slack, span: slack * 2 };

  const cam = { x: 0, y: centerY, z: overviewZ, lookX: 0, lookY: centerY, roll: 0, fov: opts.fov };
  const home = { x: 0, y: centerY, z: overviewZ, lookX: 0, lookY: centerY, roll: 0, fov: opts.fov };
  camera.position.set(0, centerY, overviewZ);

  const pointer = new THREE.Vector2();
  const parallax = { x: 0, y: 0 };
  let hasPointer = false;

  /* ---- texture loading ---- */

  let loadedCount = 0;
  const total = bays.length;

  const srcFor = (bayState, size) => {
    const { entry, shoe } = bayState;
    if (entry) return asset(size === "wall" ? entry.srcMobile : entry.src);
    return asset(`public/showroom/${shoe.id}${size === "wall" ? "-800" : ""}.webp`);
  };

  const applyTexture = (bayState, texture, aspect) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    disposables.push(texture);
    bayState.mesh.material.map = texture;
    bayState.mesh.material.needsUpdate = true;
    bayState.mirror.material.map = texture;
    bayState.mirror.material.needsUpdate = true;
    fit(bayState, aspect);
    bayState.mesh.visible = true;
    bayState.mirror.visible = true;
    bayState.loaded = true;
    bayState.fade = 0;
  };

  const loadOne = (bayState) => new Promise((resolve) => {
    loader.load(
      srcFor(bayState, "wall"),
      (texture) => {
        const aspect = bayState.entry?.aspect || texture.image.width / texture.image.height;
        applyTexture(bayState, texture, aspect);
        loadedCount += 1;
        opts.onProgress?.(loadedCount, total);
        resolve();
      },
      undefined,
      (error) => {
        console.warn(`AERO hangar: cutout missing for ${bayState.shoe.id}.`, error);
        loadedCount += 1;
        opts.onProgress?.(loadedCount, total);
        resolve();
      }
    );
  });

  /* Four at a time: the wall paints in reading order instead of all thirteen
     fighting for the same connection. */
  const loadAll = async () => {
    const queue = bays.slice();
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) await loadOne(queue.shift());
    });
    await Promise.all(workers);
  };

  /* ---- interaction ---- */

  const raycaster = new THREE.Raycaster();
  let hovered = null;
  let interactive = true;
  let panLocked = false;

  const pick = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hasPointer = true;
    if (!interactive) return null;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    return hit ? bays[hit.object.userData.index] : null;
  };

  const setHover = (next) => {
    if (next === hovered) return;
    hovered = next;
    renderer.domElement.style.cursor = next ? "pointer" : "";
    mount.classList.toggle("is-hovering", Boolean(next));
    opts.onHover?.(next ? next.shoe : null, next ? next.index : -1);
  };

  const onPointerMove = (event) => setHover(pick(event));

  const onPointerLeave = () => {
    hasPointer = false;
    setHover(null);
  };

  const onClick = (event) => {
    const target = pick(event);
    if (target) opts.onSelect?.(target.shoe, target.index);
    else opts.onSelectEmpty?.();
  };

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("click", onClick);

  /* ---- loop ---- */

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let visible = true;
  let sized = { w: 0, h: 0 };

  const resize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (!w || !h || (w === sized.w && h === sized.h)) return;
    sized = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    // getElapsedTime() consumes the delta, so take dt first and read the
    // accumulated time off the clock.
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    resize();

    if (!reduced) {
      parallax.x = lerp(parallax.x, hasPointer ? pointer.x : 0, 0.045);
      parallax.y = lerp(parallax.y, hasPointer ? pointer.y : 0, 0.045);
    }

    // Overview drift: slow enough to read as a held camera, not a float loop.
    const driftX = reduced ? 0 : Math.sin(t * 0.09) * 0.22;
    const driftY = reduced ? 0 : Math.cos(t * 0.067) * 0.12;

    camera.position.set(
      cam.x + driftX + parallax.x * 0.5,
      cam.y + driftY + parallax.y * 0.3,
      cam.z
    );
    camera.lookAt(cam.lookX + parallax.x * 0.22, cam.lookY + parallax.y * 0.14, 0);
    camera.rotation.z += cam.roll;
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }

    for (const b of bays) {
      if (!b.loaded) continue;
      if (b.fade < 1) {
        b.fade = Math.min(1, b.fade + dt * 1.6);
      }
      const target = b === hovered ? 1 : 0;
      b.hover = lerp(b.hover, target, 0.12);

      const float = reduced ? 0 : Math.sin(t * 0.55 + b.phase) * 0.018;
      b.mesh.position.y = b.restY + float + b.hover * 0.07;
      b.mirror.position.y = b.shelfTop - (b.mesh.scale.y * 0.31) - 0.02 + float * 0.4;

      // Tiny billboard turn toward the pointer; enough to feel like an object,
      // not enough to show the plane is flat.
      b.mesh.rotation.y = parallax.x * 0.09;
      b.mesh.rotation.x = -parallax.y * 0.05;

      const lit = 1 - b.dim * 0.78;
      // Dimmed bays also sink toward the backdrop colour. There is no
      // postprocess blur, so recession has to come from tint and scale.
      b.mesh.material.color.copy(WHITE).lerp(hazeColor, b.dim * 0.55);
      b.mirror.material.color.copy(b.mesh.material.color);
      b.mesh.material.opacity = b.fade * lit;
      b.mirror.material.opacity = b.fade * 0.17 * lit;
      b.strip.material.opacity = (0.7 + b.hover * 0.3) * (1 - b.dim * 0.6);
      b.bloom.material.opacity = (0.42 + b.hover * 0.45) * (1 - b.dim * 0.7);
      b.edge.material.opacity = (0.34 + b.hover * 0.3) * (1 - b.dim * 0.6);
      b.bay.scale.setScalar(1 - b.dim * 0.06);
    }

    if (dust && !reduced) {
      const pos = dust.positions;
      for (let i = 0; i < dust.drift.length; i += 1) {
        pos[i * 3 + 1] += dust.drift[i] * dt;
        if (pos[i * 3 + 1] > dust.spanY / 2) pos[i * 3 + 1] = -dust.spanY / 2;
      }
      dust.points.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
  };

  const start = () => {
    if (running) return;
    running = true;
    clock.getDelta();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const setActive = (next) => {
    visible = next;
    if (next && !document.hidden) start();
    else stop();
  };

  const io = new IntersectionObserver(
    ([entry]) => setActive(entry.isIntersecting),
    { threshold: 0.01 }
  );
  io.observe(mount);

  const onVisibility = () => {
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  resize();
  start();
  const ready = loadAll();

  return {
    THREE,
    scene,
    camera,
    renderer,
    bays,
    grid,
    overviewZ,
    cam,
    home,
    panRange,
    ready,
    spot,
    reduced,

    /* Phase 3 hooks: the focus rig drives these rather than reaching into the
       scene graph. */
    setDim(index, amount) {
      for (const b of bays) b.dim = index < 0 ? 0 : (b.index === index ? 0 : clamp(amount, 0, 1));
    },
    setInteractive(next) {
      interactive = next;
      if (!next) setHover(null);
    },
    /* The turntable frames are cropped to their own union box, so the plane
       has to be re-sized to that aspect or the shoe sits off its shelf. */
    refit(index, aspect) {
      const b = bays[index];
      if (b && aspect > 0) fit(b, aspect);
      return b ? { w: b.mesh.scale.x, h: b.mesh.scale.y, y: b.restY } : null;
    },
    positionOf(index) {
      const b = bays[index];
      return b ? { x: b.bay.position.x, y: b.bay.position.y + (b.restY || 0), z: 0 } : null;
    },
    loadFocusTexture(index) {
      const b = bays[index];
      if (!b) return Promise.resolve(null);
      return new Promise((resolve) => {
        loader.load(srcFor(b, "focus"), (texture) => {
          const aspect = b.entry?.aspect || texture.image.width / texture.image.height;
          applyTexture(b, texture, aspect);
          b.fade = 1;
          resolve(texture);
        }, undefined, () => resolve(null));
      });
    },
    setActive,

    /* t runs 0 (top of the wall) to 1 (bottom). Writing home as well as cam
       means leaving focus returns to wherever the viewer had panned to. */
    setPan(t) {
      if (panRange.span <= 0) return;
      const y = panRange.max - clamp(t, 0, 1) * panRange.span;
      home.y = y;
      home.lookY = y;
      if (!panLocked) {
        cam.y = y;
        cam.lookY = y;
      }
    },
    lockPan(next) {
      panLocked = next;
    },

    destroy() {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onClick);
      for (const item of disposables) item.dispose?.();
      scene.traverse((obj) => {
        if (obj.isMesh || obj.isPoints || obj.isLineSegments) {
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
