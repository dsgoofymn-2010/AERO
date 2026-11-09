/* AERO hangar — camera states, HUD and the details panel.

   createHangar owns the scene; this owns what the viewer does with it. The
   camera is driven by writing to hangar.cam, which the render loop reads, so
   GSAP never fights the loop for the camera transform. */

import { SIZES, formatPrice } from "./data.js";

const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js";
const TURNTABLE_MANIFEST = "public/showroom/frames/manifest.json";

const FOCUS_FOV = 30;
const FOCUS_FILL = 0.62;
const FLIGHT = 1.4;
const SWIPE_MIN = 48;

const asset = (path) => new URL(path, document.baseURI).href;
const pad2 = (n) => String(n).padStart(2, "0");

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

function buildHud(mount, brand) {
  const hud = el("div", "hangar-hud");
  hud.innerHTML = `
    <div class="hangar-hud__corner hangar-hud__corner--tl">
      <span class="hangar-hud__brand">${brand}</span>
      <span class="hangar-hud__sub">Hangar showroom</span>
    </div>
    <nav class="hangar-hud__corner hangar-hud__corner--tr" aria-label="Showroom">
      <a class="hangar-hud__link" href="#collection">Collection</a>
      <button class="hangar-hud__link" type="button" data-hangar-cart>Cart <span data-hangar-cart-count>0</span></button>
    </nav>
    <div class="hangar-hud__corner hangar-hud__corner--bl" data-hangar-coords hidden>
      <p class="hangar-hud__coord"><span class="hangar-hud__rule"></span>Hangar <b data-hangar-bay>00</b></p>
      <p class="hangar-hud__coord"><span class="hangar-hud__rule"></span>Tier <b data-hangar-tier>0</b></p>
    </div>
    <div class="hangar-hud__corner hangar-hud__corner--br">
      <button class="hangar-hud__step" type="button" data-hangar-prev aria-label="Previous shoe">Prev</button>
      <p class="hangar-hud__count"><b data-hangar-index>00</b> / <span data-hangar-total>00</span></p>
      <button class="hangar-hud__step" type="button" data-hangar-next aria-label="Next shoe">Next</button>
    </div>
    <button class="hangar-hud__back" type="button" data-hangar-back hidden>Back to wall</button>
  `;
  mount.appendChild(hud);
  return hud;
}

function buildPanel(mount) {
  const panel = el("aside", "hangar-panel");
  panel.setAttribute("aria-label", "Shoe details");
  panel.hidden = true;
  panel.innerHTML = `
    <header class="hangar-panel__head">
      <p class="hangar-panel__eyebrow" data-p-category></p>
      <h2 class="hangar-panel__name" data-p-name></h2>
      <p class="hangar-panel__tagline" data-p-tagline></p>
      <p class="hangar-panel__price" data-p-price></p>
    </header>
    <dl class="hangar-panel__specs" data-p-specs></dl>
    <div class="hangar-panel__sizes">
      <p class="hangar-panel__label" id="hangarSizeLabel">Size, EU</p>
      <div class="hangar-panel__size-row" role="radiogroup" aria-labelledby="hangarSizeLabel" data-p-sizes></div>
    </div>
    <div class="hangar-panel__actions">
      <button class="hangar-panel__add" type="button" data-p-add>Add to bag</button>
      <button class="hangar-panel__save" type="button" data-p-save aria-pressed="false">Save</button>
    </div>
  `;
  mount.appendChild(panel);
  return panel;
}

/* `chrome` draws the hangar's own wordmark and Collection/Cart corners. Inside
   the site the header already carries both, so it defaults off and only the
   standalone scene test turns it on. */
export async function createFocus({ hangar, mount, shoes, brand = "AERO", chrome = false, cart, wishlist, announce, onFocusChange }) {
  const mod = await import(/* @vite-ignore */ GSAP_URL);
  const gsap = mod.gsap || mod.default || mod;
  const { THREE } = hangar;
  const reduced = hangar.reduced;

  const hud = buildHud(mount, brand);
  if (!chrome) {
    hud.querySelector(".hangar-hud__corner--tl")?.remove();
    hud.querySelector(".hangar-hud__corner--tr")?.remove();
  }
  const panel = buildPanel(mount);
  const q = (sel, root = mount) => root.querySelector(sel);

  const coords = q("[data-hangar-coords]");
  const bayOut = q("[data-hangar-bay]");
  const tierOut = q("[data-hangar-tier]");
  const indexOut = q("[data-hangar-index]");
  const backBtn = q("[data-hangar-back]");
  q("[data-hangar-total]").textContent = pad2(shoes.length);
  indexOut.textContent = "--";

  let current = -1;
  let syncCart = null;
  let size = SIZES[Math.floor(SIZES.length / 2)];
  let flight = null;

  /* ---- turntables ---- */

  const turntables = await fetch(asset(TURNTABLE_MANIFEST), { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => data?.turntables || {})
    .catch(() => ({}));

  const spins = new Map();

  async function loadSpin(shoe) {
    const meta = turntables[shoe.id];
    if (!meta) return null;
    if (spins.has(shoe.id)) return spins.get(shoe.id);

    const loader = new THREE.TextureLoader();
    const frames = new Array(meta.count).fill(null);
    const entry = { meta: { ...meta, id: shoe.id }, frames, ready: false, cancelled: false };
    spins.set(shoe.id, entry);

    // Every fourth frame first so a drag has something to show across the whole
    // rotation before the in-between frames land.
    const order = [];
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = pass; i < meta.count; i += 4) order.push(i);
    }
    const get = (i) => new Promise((done) => {
      loader.load(asset(`${meta.dir}/f_${String(i).padStart(3, "0")}.webp`), (tex) => {
        // A detach can land mid-flight; a texture arriving after it would
        // never be disposed by anyone.
        if (entry.cancelled) tex.dispose();
        else {
          tex.colorSpace = THREE.SRGBColorSpace;
          frames[i] = tex;
        }
        done();
      }, undefined, () => done());
    });

    const queue = order.slice();
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) await get(queue.shift());
    }));
    entry.ready = frames.some(Boolean);
    return entry;
  }

  const nearestFrame = (entry, i) => {
    const n = entry.frames.length;
    for (let d = 0; d < n; d += 1) {
      const a = entry.frames[(i + d) % n];
      if (a) return a;
      const b = entry.frames[(i - d + n) % n];
      if (b) return b;
    }
    return null;
  };

  /* ---- light sweep for the still shoes ---- */

  const sweepTex = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 4;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.42, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.5)");
    g.addColorStop(0.58, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 4);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  /* map carries the shoe (colour and silhouette alpha); alphaMap carries the
     travelling band. three.js samples alphaMap's green channel and multiplies
     it into map's alpha, so the sheen is clipped to the shoe. */
  const sweepMat = new THREE.MeshBasicMaterial({
    alphaMap: sweepTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sweep = new THREE.Mesh(hangar.bays[0].mesh.geometry, sweepMat);
  sweep.visible = false;
  hangar.scene.add(sweep);

  /* ---- camera ---- */

  const cam = hangar.cam;
  const home = hangar.home;

  /* Where the shoe sits in the frame depends on where the panel is. On a wide
     screen the panel takes the right edge, so the shoe slides left. On a phone
     the panel is a bottom sheet, so the shoe rides in the upper band instead.
     Fitting by height alone was wrong on a portrait viewport: the visible
     width is less than half the height there, so a wide shoe was cropped. */
  const frame = () => {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    return w < 900
      ? { fillH: 0.34, fillW: 0.86, centre: 0.27, shift: 0, aspect: w / h }
      : { fillH: FOCUS_FILL, fillW: 0.5, centre: 0.5, shift: 0.13, aspect: w / h };
  };

  const focusTarget = (index) => {
    const bay = hangar.bays[index];
    const sh = bay.mesh.scale.y || 0.95;
    const sw = bay.mesh.scale.x || 1.2;
    const f = frame();
    const tanV = Math.tan((FOCUS_FOV * Math.PI) / 360);
    const tanH = tanV * f.aspect;

    const z = Math.max((sh / f.fillH) / 2 / tanV, (sw / f.fillW) / 2 / tanH);
    const visibleH = 2 * z * tanV;
    const visibleW = visibleH * f.aspect;

    return {
      x: bay.bay.position.x + visibleW * f.shift,
      // Looking below the shoe lifts it in frame, clear of the bottom sheet.
      y: bay.bay.position.y + (bay.restY || 0) - visibleH * (0.5 - f.centre),
      z,
      // A degree of roll either side of level: enough to feel handheld, not
      // enough to look crooked.
      roll: (index % 2 ? 1 : -1) * 0.016,
      fov: FOCUS_FOV,
    };
  };

  const resetZoom = () => {
    const bay = hangar.bays[current];
    if (bay?.baseScale) {
      gsap.killTweensOf(bay.mesh.scale);
      bay.mesh.scale.set(bay.baseScale.x, bay.baseScale.y, 1);
    }
    zoomed = false;
    canvas.style.cursor = "";
  };

  const killFlight = () => {
    flight?.kill();
    flight = null;
  };

  function flyTo(index) {
    const t = focusTarget(index);
    killFlight();
    const from = { ...cam };
    const dolly = current >= 0 && current !== index;

    if (reduced) {
      gsap.set(cam, { x: t.x, y: t.y, z: t.z, lookX: t.x, lookY: t.y, roll: 0, fov: t.fov });
      return null;
    }

    flight = gsap.timeline({ defaults: { ease: "expo.inOut" } });
    if (dolly) {
      // Pull back through a midpoint instead of sliding along the wall, so a
      // jump between neighbours still reads as a camera move.
      const lift = Math.min(home.z, Math.max(from.z, t.z) + 2.6);
      flight
        .to(cam, { z: lift, roll: 0, fov: (FOCUS_FOV + home.fov) / 2, duration: 0.55 }, 0)
        .to(cam, { x: t.x, y: t.y, lookX: t.x, lookY: t.y, duration: 1.0, ease: "power2.inOut" }, 0.12)
        .to(cam, { z: t.z, roll: t.roll, fov: t.fov, duration: 0.7 }, 0.5);
    } else {
      flight.to(cam, {
        x: t.x, y: t.y, z: t.z, lookX: t.x, lookY: t.y,
        roll: t.roll, fov: t.fov, duration: FLIGHT,
      });
    }
    return flight;
  }

  /* ---- panel ---- */

  function fillPanel(shoe) {
    panel.style.setProperty("--accent", shoe.accent);
    panel.style.setProperty("--accent-text", shoe.accentText);
    panel.style.setProperty("--accent-ink", shoe.accentInk);
    q("[data-p-category]", panel).textContent = `${shoe.category} — ${shoe.style}`;
    q("[data-p-name]", panel).textContent = shoe.name;
    q("[data-p-tagline]", panel).textContent = shoe.tagline;
    q("[data-p-price]", panel).textContent = formatPrice(shoe.price);

    const specs = q("[data-p-specs]", panel);
    specs.innerHTML = "";
    shoe.specs.slice(0, 3).forEach((spec) => {
      specs.append(el("dt", null, spec.label), el("dd", null, spec.value));
    });

    const row = q("[data-p-sizes]", panel);
    row.innerHTML = "";
    SIZES.forEach((value) => {
      const b = el("button", "hangar-panel__size", String(value));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(value === size));
      b.addEventListener("click", () => {
        size = value;
        row.querySelectorAll(".hangar-panel__size").forEach((other) => {
          other.setAttribute("aria-checked", String(other === b));
        });
      });
      row.appendChild(b);
    });

    const save = q("[data-p-save]", panel);
    const saved = Boolean(wishlist?.has(shoe.id));
    save.setAttribute("aria-pressed", String(saved));
    save.textContent = saved ? "Saved" : "Save";
  }

  const panelIn = () => {
    panel.hidden = false;
    const rows = panel.querySelectorAll(".hangar-panel__head > *, .hangar-panel__specs, .hangar-panel__sizes, .hangar-panel__actions");
    gsap.killTweensOf([panel, rows]);
    if (reduced) {
      gsap.set(panel, { xPercent: 0, opacity: 1 });
      gsap.set(rows, { opacity: 1, y: 0 });
      return;
    }
    gsap.fromTo(panel, { xPercent: 8, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.5, ease: "expo.out", delay: 0.5 });
    gsap.fromTo(rows, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.045, delay: 0.62 });
  };

  const panelOut = () => {
    gsap.killTweensOf(panel);
    if (reduced) {
      panel.hidden = true;
      return;
    }
    gsap.to(panel, {
      xPercent: 8, opacity: 0, duration: 0.3, ease: "power2.in",
      onComplete: () => { panel.hidden = true; },
    });
  };

  /* ---- focus state ---- */

  function focus(index) {
    if (index < 0 || index >= shoes.length) return;
    resetZoom();
    const shoe = shoes[index];
    const bay = hangar.bays[index];
    const first = current < 0;
    current = index;

    hangar.setDim(index, 0.85);
    hangar.setInteractive(false);
    hangar.lockPan(true);
    mount.classList.add("is-focused");

    coords.hidden = false;
    backBtn.hidden = false;
    bayOut.textContent = pad2(bay.slot ? bay.slot.col + 1 : (index % hangar.grid.cols) + 1);
    tierOut.textContent = String(Math.floor(index / hangar.grid.cols) + 1);
    indexOut.textContent = pad2(index + 1);

    mount.style.setProperty("--accent", shoe.accent);
    mount.style.setProperty("--accent-text", shoe.accentText);
    mount.style.setProperty("--accent-ink", shoe.accentInk);
    fillPanel(shoe);
    if (first) panelIn();

    const t = focusTarget(index);
    /* The backlight is separation, not decoration: Onyx is a black shoe on a
       near-black wall and reads as a silhouette without it. Sized to the shoe
       so it lifts the backdrop right behind the subject. */
    hangar.spot.visible = true;
    const shoeY = bay.bay.position.y + (bay.restY || 0);
    hangar.spot.position.set(bay.bay.position.x, shoeY + bay.mesh.scale.y * 0.78, -0.9);
    hangar.spot.scale.set(bay.mesh.scale.x * 2.5, bay.mesh.scale.y * 2.8, 1);
    gsap.to(hangar.spot.material, { opacity: 0.58, duration: 0.9, delay: 0.3 });

    sweep.visible = false;
    sweepMat.opacity = 0;

    flyTo(index);
    hangar.loadFocusTexture(index).then(() => {
      if (current !== index) return;
      bay.baseScale = { x: bay.mesh.scale.x, y: bay.mesh.scale.y };
      sweep.geometry = bay.mesh.geometry;
      sweepMat.map = bay.mesh.material.map;
      sweepMat.needsUpdate = true;
      sweep.scale.copy(bay.mesh.scale);
      sweep.position.set(bay.bay.position.x, bay.bay.position.y + bay.mesh.position.y, 0.04);
      sweep.visible = !turntables[shoe.id];
    });

    if (turntables[shoe.id]) {
      loadSpin(shoe).then((entry) => {
        if (entry?.ready && current === index) spin.attach(index, entry);
      });
    }

    onFocusChange?.(shoe, index);
    announce?.(`${shoe.name}, ${formatPrice(shoe.price)}. Shoe ${index + 1} of ${shoes.length}.`);
  }

  function overview() {
    if (current < 0) return;
    resetZoom();
    spin.detach();
    const index = current;
    current = -1;
    hangar.setDim(-1, 0);
    hangar.setInteractive(true);
    mount.classList.remove("is-focused");
    coords.hidden = true;
    backBtn.hidden = true;
    indexOut.textContent = "--";
    mount.style.removeProperty("--accent");
    mount.style.removeProperty("--accent-text");
    mount.style.removeProperty("--accent-ink");
    panelOut();
    sweep.visible = false;
    gsap.to(hangar.spot.material, {
      opacity: 0, duration: 0.4,
      onComplete: () => { hangar.spot.visible = false; },
    });
    killFlight();
    hangar.lockPan(false);
    if (reduced) {
      gsap.set(cam, { x: home.x, y: home.y, z: home.z, lookX: home.lookX, lookY: home.lookY, roll: 0, fov: home.fov });
    } else {
      flight = gsap.to(cam, {
        x: home.x, y: home.y, z: home.z, lookX: home.lookX, lookY: home.lookY,
        roll: 0, fov: home.fov, duration: FLIGHT, ease: "expo.inOut",
      });
    }
    hangar.bays[index].mesh.rotation.set(0, 0, 0);
    onFocusChange?.(null, -1);
  }

  const step = (delta) => {
    if (current < 0) return;
    focus((current + delta + shoes.length) % shoes.length);
  };

  /* ---- turntable drag ---- */

  const spin = (() => {
    let entry = null;
    let index = -1;
    let prevMap = null;
    let angle = 0;
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let raf = 0;

    const apply = () => {
      if (!entry) return;
      const n = entry.frames.length;
      const i = ((Math.round(angle) % n) + n) % n;
      const tex = nearestFrame(entry, i);
      const bay = hangar.bays[index];
      if (!tex || bay.mesh.material.map === tex) return;
      // Swapping between textures of the same kind needs no shader rebuild.
      // Setting material.needsUpdate here would recompile the program every
      // frame of the spin.
      const first = bay.mesh.material.map === null;
      bay.mesh.material.map = tex;
      bay.mirror.material.map = tex;
      if (first) {
        bay.mesh.material.needsUpdate = true;
        bay.mirror.material.needsUpdate = true;
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!entry) return;
      if (!dragging) {
        // Idle rotation keeps the turntable reading as a turntable; a drag
        // takes over and its momentum decays back into it.
        velocity += ((reduced ? 0 : 0.055) - velocity) * 0.02;
        angle += velocity;
      }
      apply();
    };

    return {
      attach(i, data) {
        index = i;
        entry = data;
        angle = 0;
        velocity = 0;
        const bay = hangar.bays[i];
        prevMap = bay.mesh.material.map;
        hangar.refit(i, data.meta.aspect);
        bay.baseScale = { x: bay.mesh.scale.x, y: bay.mesh.scale.y };
        mount.classList.add("is-turntable");
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
        apply();
      },
      detach() {
        if (index >= 0) {
          const bay = hangar.bays[index];
          bay.mesh.rotation.set(0, 0, 0);
        }
        /* 48 frames is ~90 MB of decoded texture per shoe. Hold them only
           while the turntable is on screen; the files stay in the HTTP cache,
           so coming back re-decodes rather than re-downloads. */
        if (entry && index >= 0) {
          // The frames are about to be disposed, so put the still back first
          // or the bay keeps pointing at a dead texture.
          const bay = hangar.bays[index];
          bay.mesh.material.map = prevMap;
          bay.mirror.material.map = prevMap;
          const still = bay.entry?.aspect;
          if (still) hangar.refit(index, still);
          bay.baseScale = { x: bay.mesh.scale.x, y: bay.mesh.scale.y };
        }
        prevMap = null;
        if (entry) {
          entry.cancelled = true;
          entry.frames.forEach((tex) => tex?.dispose());
          spins.delete(entry.meta.id);
          entry.frames.fill(null);
          entry.ready = false;
        }
        entry = null;
        index = -1;
        dragging = false;
        mount.classList.remove("is-turntable");
        cancelAnimationFrame(raf);
      },
      get active() {
        return Boolean(entry);
      },
      down(x) {
        if (!entry) return;
        dragging = true;
        lastX = x;
        velocity = 0;
      },
      move(x) {
        if (!entry || !dragging) return;
        const dx = x - lastX;
        lastX = x;
        velocity = dx * 0.06;
        angle += velocity;
        apply();
      },
      up() {
        dragging = false;
      },
    };
  })();

  /* ---- pointer, keyboard, touch ---- */

  // hangar's own raycast is off during focus, so the zoom-on-hover detail
  // tests the focused shoe by itself.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let zoomed = false;

  const canvas = hangar.renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", `Shoe wall, ${shoes.length} shoes. Arrow keys to move, Enter to open, Escape to return.`);
  let touch = null;
  let dragged = false;

  const onSelect = (shoe, index) => focus(index);
  // A turntable drag ends in a click on empty space; that must not read as
  // "leave focus".
  const onEmpty = () => { if (!dragged) overview(); };

  const onPointerDown = (event) => {
    if (spin.active) {
      spin.down(event.clientX);
      canvas.setPointerCapture?.(event.pointerId);
    }
    dragged = false;
    touch = { x: event.clientX, y: event.clientY, t: performance.now() };
  };

  const onPointerMove = (event) => {
    if (touch && Math.abs(event.clientX - touch.x) > 6) dragged = true;
    if (spin.active) spin.move(event.clientX);
    if (current < 0) return;
    // Tilt the still shoes toward the pointer; the turntable owns its own
    // rotation, so it is left alone.
    const bay = hangar.bays[current];
    if (!bay || spin.active) return;
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    gsap.to(bay.mesh.rotation, { y: nx * 0.22, x: -ny * 0.12, duration: 0.6, ease: "power2.out", overwrite: true });

    ndc.set(nx, ny);
    ray.setFromCamera(ndc, hangar.camera);
    const over = ray.intersectObject(bay.mesh, false).length > 0;
    if (over === zoomed) return;
    zoomed = over;
    canvas.style.cursor = over ? "zoom-in" : "";
    gsap.to(bay.mesh.scale, {
      x: bay.baseScale.x * (over ? 1.07 : 1),
      y: bay.baseScale.y * (over ? 1.07 : 1),
      duration: 0.5, ease: "expo.out", overwrite: true,
    });
  };

  const onPointerUp = (event) => {
    spin.up();
    if (!touch) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    const quick = performance.now() - touch.t < 600;
    touch = null;
    if (current >= 0 && !spin.active && quick && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    }
  };

  const onKey = (event) => {
    // Focus mode owns the keys; in overview only act when the wall itself has
    // keyboard focus, so arrows still scroll the rest of the page.
    if (current < 0 && !mount.contains(document.activeElement)) return;
    if (event.key === "Escape" && current >= 0) {
      event.preventDefault();
      overview();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      current < 0 ? focus(0) : step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      current < 0 ? focus(shoes.length - 1) : step(-1);
    } else if (event.key === "Enter" && current < 0) {
      event.preventDefault();
      focus(0);
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKey);

  backBtn.addEventListener("click", overview);
  q("[data-hangar-prev]").addEventListener("click", () => (current < 0 ? focus(shoes.length - 1) : step(-1)));
  q("[data-hangar-next]").addEventListener("click", () => (current < 0 ? focus(0) : step(1)));

  q("[data-p-add]", panel).addEventListener("click", () => {
    if (current < 0) return;
    cart?.add(shoes[current], size);
    syncCart?.();
  });
  q("[data-p-save]", panel).addEventListener("click", () => {
    if (current < 0) return;
    const saved = wishlist?.toggle(shoes[current]);
    const btn = q("[data-p-save]", panel);
    btn.setAttribute("aria-pressed", String(Boolean(saved)));
    btn.textContent = saved ? "Saved" : "Save";
  });

  if (cart && q("[data-hangar-cart]")) {
    const count = q("[data-hangar-cart-count]");
    syncCart = () => { count.textContent = String(cart.getCount?.() ?? 0); };
    syncCart();
    q("[data-hangar-cart]").addEventListener("click", () => cart.open?.());
  }

  // The sweep rides across the focused shoe on a loop while focus is held; it
  // is the only thing marking the still shoes as inspectable.
  const sweepTick = () => {
    sweepRaf = requestAnimationFrame(sweepTick);
    if (!sweep.visible) return;
    sweepTex.offset.x = reduced ? 0.5 : (performance.now() / 2600) % 1;
    sweepMat.opacity = Math.min(0.55, sweepMat.opacity + 0.01);
  };
  let sweepRaf = requestAnimationFrame(sweepTick);

  return {
    focus,
    overview,
    next: () => step(1),
    prev: () => step(-1),
    get index() { return current; },
    get size() { return size; },
    hud,
    panel,
    onSelect,
    onEmpty,
    destroy() {
      killFlight();
      spin.detach();
      cancelAnimationFrame(sweepRaf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKey);
      sweepTex.dispose();
      sweepMat.dispose();
      hangar.scene.remove(sweep);
      spins.forEach((entry) => entry.frames.forEach((tex) => tex?.dispose()));
      spins.clear();
      hud.remove();
      panel.remove();
    },
  };
}
