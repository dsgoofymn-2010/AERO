/* AERO site shell.
   Renders the collection from data.js, runs the three film studies, opens the
   ten still studies, and keeps the bag and checkout in sync. */

import { BRAND, CATEGORIES, SIZES, SHOES, NOTES, getShoe, formatPrice } from "./data.js";
import { FrameSequence, ScrubStage } from "./scrub.js";
import { GalleryViewer } from "./gallery.js";
import { createCart } from "./cart.js";
import { runIntro } from "./intro.js";
import { createHangar } from "./hangar.js";
import { createFocus } from "./hangar-focus.js";
import { createWishlist } from "./wishlist.js";
import { createRouter, createNav } from "./router.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(3, "0");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const MATERIAL_LINES = {
  blue: "One knit surface. Denser where the foot needs it. Nothing stitched on top.",
  brown: "One hide, cut so the grain runs with the foot. Creases are the finish.",
  black: "Thin layers, burnished by hand. The shine comes from the leather, not a coat.",
};

const VIDEO_SHOES = SHOES.filter((shoe) => shoe.type === "video");

const state = {
  reduced: false,
  featureId: null,
  featureShoe: null,
  studyStage: null,
  studySequence: null,
  studySize: null,
  studyProgress: 0,
  activePart: 0,
  productShoe: null,
  productTab: null,
  productStage: null,
  productSequence: null,
  productGallery: null,
  productSize: 42,
  productAddedTimer: 0,
  cart: null,
  lenis: null,
  gsap: null,
  ScrollTrigger: null,
  menuOpen: false,
  menuFocus: null,
  previewCard: null,
  previewTimer: 0,
  collectionCategory: "All",
};

const announce = (message) => {
  const live = document.getElementById("liveRegion");
  if (live) live.textContent = message;
};

const isInView = (node) => {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

const metricText = (metric) => {
  const decimals = metric.decimals || 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(metric.value);
};

const setVideoSources = (video, mp4, webm, poster) => {
  if (!video || !mp4) return;
  if (video.dataset.src === mp4) return;
  video.dataset.src = mp4;
  video.dataset.userPaused = "false";
  if (poster) video.poster = poster;
  video.innerHTML = "";
  if (webm) {
    const webmSource = document.createElement("source");
    webmSource.src = webm;
    webmSource.type = "video/webm";
    video.append(webmSource);
  }
  const mp4Source = document.createElement("source");
  mp4Source.src = mp4;
  mp4Source.type = "video/mp4";
  video.append(mp4Source);
  video.load();
};

const tryPlay = (video) => {
  if (!video || state.reduced || !isInView(video)) return;
  if (video.dataset.userPaused === "true") return;
  const played = video.play();
  if (played && typeof played.catch === "function") played.catch(() => {});
};

/* Collection ------------------------------------------------------------- */

const renderFilters = () => {
  const filters = document.getElementById("filters");
  if (!filters) return;
  filters.innerHTML = CATEGORIES.map((category) => {
    const count = category === "All" ? SHOES.length : SHOES.filter((shoe) => shoe.category === category).length;
    const active = category === state.collectionCategory;
    return `<button class="filter${active ? " is-active" : ""}" type="button" data-category="${category}" aria-pressed="${active}">${category}<sup>${String(count).padStart(2, "0")}</sup></button>`;
  }).join("");
};

const cardMarkup = (shoe, index) => {
  const isFilm = shoe.type === "video";
  const preview = isFilm
    ? `<video class="card__preview" muted loop playsinline preload="none" data-preview="${shoe.assets.video360}" aria-hidden="true"></video>`
    : "";
  return `
    <button class="card" type="button" data-shoe="${shoe.id}" data-type="${shoe.type}" style="--i:${index};--accent:${shoe.accent};--accent-text:${shoe.accentText};--accent-ink:${shoe.accentInk}" aria-label="Open ${shoe.name}, ${shoe.style.toLowerCase()}, ${formatPrice(shoe.price)}">
      <span class="card__media">
        <img class="card__image" src="${shoe.assets.stillMobile}" srcset="${shoe.assets.stillMobile} 800w, ${shoe.assets.still} 1600w" sizes="(max-width: 680px) 92vw, (max-width: 900px) 46vw, 30vw" width="800" height="446" loading="lazy" decoding="async" alt="${shoe.name}, ${shoe.style.toLowerCase()}, ${shoe.colorway}">
        ${preview}
        <span class="card__badge"><i aria-hidden="true"></i>${isFilm ? "Film / 360" : "Still / detail"}</span>
        <span class="card__index">${shoe.index}</span>
        <span class="card__cue">Open study <span aria-hidden="true">+</span></span>
      </span>
      <span class="card__meta">
        <span class="card__name">${shoe.name}</span>
        <span class="card__type">${shoe.style}</span>
        <span class="card__price">${formatPrice(shoe.price)}</span>
        <span class="card__rule" aria-hidden="true"></span>
      </span>
    </button>
  `;
};

const renderCards = (category = state.collectionCategory) => {
  const grid = document.getElementById("collectionGrid");
  if (!grid) return;
  stopPreview();
  state.collectionCategory = category;
  const filtered = category === "All" ? SHOES : SHOES.filter((shoe) => shoe.category === category);
  grid.innerHTML = filtered.map((shoe, index) => cardMarkup(shoe, index)).join("");

  if (category === "All") {
    grid.insertAdjacentHTML(
      "beforeend",
      `<article class="card--journal">
        <div>
          <p class="journal__num">Journal / 01</p>
          <h3>The work is in what we removed.</h3>
          <p>Three notes from the bench, and the decisions behind the collection.</p>
        </div>
        <a class="journal__link" href="#notes">Read the notes <span aria-hidden="true">+</span></a>
      </article>`,
    );
  }

  const count = document.getElementById("collectionCount");
  const label = document.getElementById("collectionCountLabel");
  if (count) count.textContent = String(filtered.length);
  if (label) label.textContent = filtered.length === 1 ? "object shown" : "objects shown";
};

const renderNotes = () => {
  const grid = document.getElementById("notesGrid");
  if (!grid) return;
  grid.innerHTML = NOTES.map(
    (note) => `<article class="note" data-reveal>
      <span class="note__num">${note.number}</span>
      <h3>${note.title}</h3>
      <p>${note.body}</p>
      <p class="note__source">${note.source}</p>
    </article>`,
  ).join("");
};

const renderStudyTabs = () => {
  const tabs = document.getElementById("studyTabs");
  if (!tabs) return;
  tabs.innerHTML = VIDEO_SHOES.map((shoe) => {
    const active = shoe.id === (state.featureId || "blue");
    return `<button class="study-tab${active ? " is-active" : ""}" type="button" data-shoe="${shoe.id}" aria-pressed="${active}">
      <span>${shoe.index}</span><span>${shoe.name}</span><span>360</span>
    </button>`;
  }).join("");
};

const renderAnatomyTabs = () => {
  const tabs = document.getElementById("anatomyTabs");
  if (!tabs) return;
  tabs.innerHTML = VIDEO_SHOES.map((shoe) => {
    const active = shoe.id === (state.featureId || "blue");
    return `<button class="anatomy-tab${active ? " is-active" : ""}" type="button" data-shoe="${shoe.id}" aria-pressed="${active}">
      <span>${shoe.index}</span>${shoe.name}
    </button>`;
  }).join("");
};

const setupFilters = () => {
  const filters = document.getElementById("filters");
  if (!filters) return;
  filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const category = button.dataset.category;
    $$(".filter", filters).forEach((node) => {
      const active = node === button;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    renderCards(category);
    const count = document.getElementById("collectionCount");
    announce(`${count ? count.textContent : ""} objects shown, ${category}.`);
  });
};

const stopPreview = () => {
  window.clearTimeout(state.previewTimer);
  if (state.previewCard) {
    const video = state.previewCard.querySelector("[data-preview]");
    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* Metadata may not be ready yet. */
      }
    }
    state.previewCard.classList.remove("is-previewing");
    state.previewCard = null;
  }
};

const startPreview = (card) => {
  if (!card || card.dataset.type !== "video" || state.previewCard === card) return;
  stopPreview();
  const video = card.querySelector("[data-preview]");
  if (!video) return;
  if (!video.getAttribute("src")) video.src = video.dataset.preview;
  state.previewCard = card;
  state.previewTimer = window.setTimeout(() => {
    if (state.previewCard !== card) return;
    card.classList.add("is-previewing");
    const played = video.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  }, 120);
};

const setupCollectionEvents = () => {
  const grid = document.getElementById("collectionGrid");
  if (!grid) return;

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    openProduct(card.dataset.shoe);
  });

  grid.addEventListener("pointerover", (event) => {
    const card = event.target.closest(".card");
    if (!card || card.contains(event.relatedTarget)) return;
    startPreview(card);
  });

  grid.addEventListener("pointerout", (event) => {
    const card = event.target.closest(".card");
    if (!card || card.contains(event.relatedTarget)) return;
    if (state.previewCard === card) stopPreview();
  });

  grid.addEventListener("focusin", (event) => {
    const card = event.target.closest(".card");
    if (card) startPreview(card);
  });

  grid.addEventListener("focusout", (event) => {
    const card = event.target.closest(".card");
    if (card && state.previewCard === card) stopPreview();
  });
};

/* Object study ----------------------------------------------------------- */

const renderStudyCallouts = (shoe) => {
  const container = document.getElementById("studyCallouts");
  if (!container) return;
  const callouts = shoe.callouts || [];
  container.innerHTML = callouts
    .map(
      (callout, index) => `<article class="study__callout is-${callout.side}" data-callout data-range="${callout.range[0]},${callout.range[1]}" style="--top:${callout.top}">
        <span class="study__callout-num">${String(index + 1).padStart(2, "0")}</span>
        <h3>${callout.title}</h3>
        <p>${callout.body}</p>
      </article>`,
    )
    .join("");
  updateStudyCallouts(state.studyProgress);
};

const updateStudyCallouts = (progress) => {
  const container = document.getElementById("studyCallouts");
  if (!container) return;
  $$("[data-callout]", container).forEach((node) => {
    const [start, end] = node.dataset.range.split(",").map(Number);
    node.classList.toggle("is-active", progress >= start && progress <= end);
  });
};

const updateStudy = () => {
  const section = document.getElementById("study");
  if (!section) return;
  const rect = section.getBoundingClientRect();
  const scrollable = section.offsetHeight - window.innerHeight;
  const progress = scrollable > 0 ? clamp(-rect.top / scrollable, 0, 1) : 0;
  state.studyProgress = progress;
  if (state.studyStage) state.studyStage.setProgress(progress);
  updateStudyCallouts(progress);
};

const createStudyStage = (shoe) => {
  const stageEl = document.getElementById("studyStage");
  const canvas = document.getElementById("studyCanvas");
  if (!stageEl || !canvas) return;

  const size = window.innerWidth < 760 ? "mobile" : "desktop";
  if (state.studyStage) state.studyStage.dispose();
  else if (state.studySequence) state.studySequence.dispose();
  state.studyStage = null;
  state.studySequence = null;

  const sequence = new FrameSequence(shoe, size, {
    maxWidth: size === "mobile" ? 720 : 960,
    maxCached: size === "mobile" ? 24 : 48,
    concurrency: size === "mobile" ? 4 : 6,
  });
  const stage = new ScrubStage({
    canvas,
    stage: stageEl,
    counter: document.getElementById("studyCounter"),
    poster: shoe.assets.poster,
    maxDpr: 2,
  });

  state.studyStage = stage;
  state.studySequence = sequence;
  state.studySize = size;
  stageEl.classList.remove("is-ready");
  stageEl.dataset.shoe = shoe.id;

  const poster = document.getElementById("studyPoster");
  if (poster) {
    poster.src = shoe.assets.poster;
    poster.alt = "";
  }
  const total = document.getElementById("studyTotal");
  if (total) total.textContent = `/ ${sequence.count}`;
  const name = document.getElementById("studyName");
  if (name) name.textContent = shoe.name;
  const counter = document.getElementById("studyCounter");
  if (counter) counter.textContent = "001";

  renderStudyCallouts(shoe);
  stage.setProgress(state.studyProgress);

  sequence
    .preloadFirst(12)
    .then(() => {
      if (state.studySequence !== sequence) return;
      stage.setSequence(sequence);
      stageEl.classList.add("is-ready");
      stage.setProgress(state.studyProgress);
      sequence.startBackgroundLoad();
    })
    .catch(() => {
      if (state.studySequence !== sequence) return;
      stageEl.classList.add("is-ready");
    });
};

const setFeature = (id, { force = false, silent = false } = {}) => {
  const shoe = getShoe(id);
  if (!force && state.featureId === shoe.id && state.studyStage) return;

  state.featureId = shoe.id;
  state.featureShoe = shoe;
  document.documentElement.dataset.shoe = shoe.id;

  ["study", "anatomy", "materials"].forEach((sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.style.setProperty("--accent", shoe.accent);
    section.style.setProperty("--accent-text", shoe.accentText);
    section.style.setProperty("--accent-ink", shoe.accentInk);
  });

  $$(".study-tab").forEach((button) => {
    const active = button.dataset.shoe === shoe.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$(".anatomy-tab").forEach((button) => {
    const active = button.dataset.shoe === shoe.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  createStudyStage(shoe);
  updateFeatureSections(shoe);
  updateStudyCallouts(state.studyProgress);
  if (!silent) announce(`${shoe.name} study selected.`);
};

/* Anatomy and materials -------------------------------------------------- */

const animateNumber = (node, metric) => {
  if (!node) return;
  if (state.reduced) {
    node.textContent = metricText(metric);
    return;
  }
  const final = metric.value;
  const decimals = metric.decimals || 0;
  const duration = 720;
  const started = performance.now();
  const formatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const tick = (now) => {
    const progress = clamp((now - started) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = formatter.format(final * eased);
    if (progress < 1 && node.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const renderMetrics = (shoe) => {
  const container = document.getElementById("metrics");
  if (!container) return;
  container.innerHTML = shoe.metrics
    .map(
      (metric, index) => `<article class="metric">
        <p class="metric__label">${metric.label}</p>
        <p class="metric__value"><span class="metric__number" data-metric="${index}">0</span><span class="metric__suffix">${metric.suffix}</span></p>
        <p class="metric__note">${metric.note}</p>
      </article>`,
    )
    .join("");
  $$("[data-metric]", container).forEach((node, index) => animateNumber(node, shoe.metrics[index]));
};

const setPartNote = (shoe, index) => {
  const part = shoe.parts?.[index];
  if (!part) return;
  state.activePart = index;
  const list = document.getElementById("anatomyParts");
  if (list) {
    $$(".anatomy__part", list).forEach((node, nodeIndex) => {
      const active = nodeIndex === index;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
  }
  const name = document.getElementById("anatomyPartName");
  const note = document.getElementById("anatomyPartNote");
  if (name) name.textContent = part.name;
  if (note) note.textContent = part.note;
};

const renderParts = (shoe) => {
  const list = document.getElementById("anatomyParts");
  if (!list) return;
  const parts = shoe.parts || [];
  list.innerHTML = parts
    .map(
      (part, index) => `<li>
        <button class="anatomy__part${index === 0 ? " is-active" : ""}" type="button" data-part="${index}" aria-pressed="${index === 0}">
          <span class="anatomy__part-num">${String(index + 1).padStart(2, "0")}</span>
          <span class="anatomy__part-name">${part.name}</span>
          <span class="anatomy__part-line" aria-hidden="true"></span>
        </button>
      </li>`,
    )
    .join("");
  setPartNote(shoe, 0);
};

const syncFilmButton = (video, button, label) => {
  if (!video || !button) return;
  const paused = video.paused;
  button.textContent = paused ? "Play film" : "Pause film";
  button.setAttribute("aria-label", `${paused ? "Play" : "Pause"} the ${label} film`);
};

const updateFeatureSections = (shoe) => {
  const anatomyVideo = document.getElementById("anatomyVideo");
  const materialVideo = document.getElementById("materialVideo");
  const anatomyPlay = document.getElementById("anatomyPlay");
  const materialPlay = document.getElementById("materialPlay");

  if (anatomyVideo) {
    setVideoSources(anatomyVideo, shoe.assets.exploded, shoe.assets.explodedWebm, shoe.assets.posterExploded);
    anatomyVideo.setAttribute("aria-label", `Exploded view of the ${shoe.name} ${shoe.style.toLowerCase()}`);
    tryPlay(anatomyVideo);
    syncFilmButton(anatomyVideo, anatomyPlay, "exploded");
  }

  if (materialVideo) {
    setVideoSources(materialVideo, shoe.assets.closeup, shoe.assets.closeupWebm, shoe.assets.posterCloseup);
    materialVideo.setAttribute("aria-label", `Close study of the ${shoe.name} upper`);
    tryPlay(materialVideo);
    syncFilmButton(materialVideo, materialPlay, "material");
  }

  const active = document.getElementById("anatomyActive");
  if (active) active.textContent = `${shoe.name} / ${shoe.style.toLowerCase()}`;

  const caption = document.getElementById("anatomyCaption");
  if (caption) caption.textContent = `${shoe.name} / four components`;

  renderParts(shoe);

  const specs = document.getElementById("anatomySpecs");
  if (specs) {
    specs.innerHTML = shoe.specs
      .map((spec) => `<div><dt>${spec.label}</dt><dd>${spec.value}</dd></div>`)
      .join("");
  }

  const marks = document.getElementById("anatomyMarks");
  if (marks) {
    marks.innerHTML = (shoe.parts || [])
      .map((part) => `<i style="left:${(part.at * 100).toFixed(2)}%"></i>`)
      .join("");
  }

  const quote = document.getElementById("materialQuote");
  if (quote) quote.textContent = MATERIAL_LINES[shoe.id] || shoe.tagline;

  const materialCaption = document.getElementById("materialCaption");
  if (materialCaption) materialCaption.textContent = shoe.materialCaption;

  const materialNote = document.getElementById("materialNote");
  if (materialNote) materialNote.textContent = shoe.materials;

  renderMetrics(shoe);
};

const setupStudy = () => {
  const tabs = document.getElementById("studyTabs");
  if (tabs) {
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shoe]");
      if (!button) return;
      setFeature(button.dataset.shoe);
    });
  }

  let resizeTimer = 0;
  window.addEventListener(
    "resize",
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        updateStudy();
        const nextSize = window.innerWidth < 760 ? "mobile" : "desktop";
        if (state.featureShoe && nextSize !== state.studySize) createStudyStage(state.featureShoe);
      }, 180);
    },
    { passive: true },
  );
};

const seekPart = (index) => {
  const shoe = state.featureShoe;
  const video = document.getElementById("anatomyVideo");
  if (!shoe || !video || !shoe.parts?.[index]) return;
  const part = shoe.parts[index];
  setPartNote(shoe, index);
  video.dataset.userPaused = "false";
  const seek = () => {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.05, part.at * video.duration));
    const played = video.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener("loadedmetadata", seek, { once: true });
};

const setupAnatomy = () => {
  const tabs = document.getElementById("anatomyTabs");
  const parts = document.getElementById("anatomyParts");
  const video = document.getElementById("anatomyVideo");
  const play = document.getElementById("anatomyPlay");
  const progress = document.getElementById("anatomyProgress");

  tabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shoe]");
    if (!button) return;
    setFeature(button.dataset.shoe);
  });

  parts?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-part]");
    if (!button) return;
    seekPart(Number(button.dataset.part));
  });

  play?.addEventListener("click", () => {
    if (!video) return;
    if (video.paused) {
      video.dataset.userPaused = "false";
      const played = video.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } else {
      video.dataset.userPaused = "true";
      video.pause();
    }
  });

  video?.addEventListener("play", () => syncFilmButton(video, play, "exploded"));
  video?.addEventListener("pause", () => syncFilmButton(video, play, "exploded"));

  video?.addEventListener("timeupdate", () => {
    if (!video.duration) return;
    const value = video.currentTime / video.duration;
    if (progress) progress.style.width = `${clamp(value, 0, 1) * 100}%`;
    const shoe = state.featureShoe;
    if (!shoe?.parts) return;
    let active = 0;
    shoe.parts.forEach((part, index) => {
      if (value + 0.03 >= part.at) active = index;
    });
    if (active !== state.activePart) setPartNote(shoe, active);
  });
};

const setupMaterials = () => {
  const video = document.getElementById("materialVideo");
  const play = document.getElementById("materialPlay");
  if (!video || !play) return;

  play.addEventListener("click", () => {
    if (video.paused) {
      video.dataset.userPaused = "false";
      const played = video.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } else {
      video.dataset.userPaused = "true";
      video.pause();
    }
  });

  video.addEventListener("play", () => syncFilmButton(video, play, "material"));
  video.addEventListener("pause", () => syncFilmButton(video, play, "material"));
};

const setupVideoObserver = () => {
  const videos = [document.getElementById("anatomyVideo"), document.getElementById("materialVideo")].filter(Boolean);
  if (!videos.length) return;

  if (!("IntersectionObserver" in window)) {
    videos.forEach((video) => tryPlay(video));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          tryPlay(video);
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.25 },
  );

  videos.forEach((video) => observer.observe(video));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) videos.forEach((video) => video.pause());
  });
};

/* Product study ---------------------------------------------------------- */

const productDialog = document.getElementById("productDialog");
const productViewer = document.getElementById("productViewer");
const productTabsEl = document.getElementById("productTabs");
const productCounter = document.getElementById("productCounter");
const productAdded = document.getElementById("productAdded");
const productAddButton = document.getElementById("productAdd");
const productSizeOptions = document.getElementById("productSizeOptions");

let productLastFocus = null;
let productMode = null;
let productOrbitCleanup = null;

const productModes = (shoe) =>
  shoe.type === "video"
    ? [
        { id: "360", label: "360" },
        { id: "exploded", label: "Exploded" },
        { id: "closeup", label: "Close-up" },
        { id: "detail", label: "Detail" },
      ]
    : [
        { id: "still", label: "Still" },
        { id: "detail", label: "Detail" },
      ];

const clearProductViewer = () => {
  if (productOrbitCleanup) {
    productOrbitCleanup();
    productOrbitCleanup = null;
  }
  if (state.productGallery) {
    state.productGallery.destroy();
    state.productGallery = null;
  }
  if (state.productStage) {
    state.productStage.dispose();
    state.productStage = null;
  }
  if (state.productSequence) {
    state.productSequence.dispose();
    state.productSequence = null;
  }
  if (productViewer) productViewer.innerHTML = "";
  productMode = null;
};

const mountProductStill = (shoe) => {
  const mount = document.createElement("div");
  mount.style.position = "absolute";
  mount.style.inset = "0";
  productViewer.append(mount);
  state.productGallery = new GalleryViewer({ mount, shoe, reduced: state.reduced });
  productCounter.textContent = `${shoe.index} / 13`;
};

const mountProductDetail = (shoe) => {
  const wrap = document.createElement("div");
  wrap.className = "product__detail";
  const image = document.createElement("img");
  image.src = shoe.assets.detail || shoe.assets.still;
  image.alt = `${shoe.name}, close detail of the ${shoe.style.toLowerCase()}`;
  image.width = 1600;
  image.height = 893;
  image.decoding = "async";
  wrap.append(image);
  productViewer.append(wrap);
  productCounter.textContent = `${shoe.index} / 13`;
};

const mountProductFilm = (shoe, kind) => {
  const exploded = kind === "exploded";
  const mp4 = exploded ? shoe.assets.exploded : shoe.assets.closeup;
  const webm = exploded ? shoe.assets.explodedWebm : shoe.assets.closeupWebm;
  const poster = exploded ? shoe.assets.posterExploded : shoe.assets.posterCloseup;
  if (!mp4) return;

  const wrap = document.createElement("div");
  wrap.className = "product__film";
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = true;
  video.preload = "metadata";
  video.poster = poster;
  video.setAttribute(
    "aria-label",
    exploded ? `Exploded view of the ${shoe.name}` : `Close study of the ${shoe.name} upper`,
  );
  setVideoSources(video, mp4, webm, poster);
  wrap.append(video);
  productViewer.append(wrap);
  productCounter.textContent = exploded ? "Exploded film" : "Close-up film";
  const played = video.play();
  if (played && typeof played.catch === "function") played.catch(() => {});
};

const mountProductOrbit = (shoe) => {
  const wrap = document.createElement("div");
  wrap.className = "orbit-view";
  wrap.innerHTML = `
    <canvas aria-hidden="true"></canvas>
    <img class="orbit-view__poster" src="${shoe.assets.poster}" alt="" aria-hidden="true" decoding="async">
    <p class="orbit-view__loading">Loading 360</p>
    <p class="orbit-view__hint">Drag to turn</p>
    <input class="orbit-view__range" type="range" min="0" max="100" step="1" value="12" aria-label="Turn the ${shoe.name} through 360 degrees">
  `;
  productViewer.append(wrap);

  const canvas = wrap.querySelector("canvas");
  const range = wrap.querySelector(".orbit-view__range");
  const size = window.innerWidth < 760 ? "mobile" : "desktop";
  let progress = 0.12;

  const sequence = new FrameSequence(shoe, size, {
    maxWidth: size === "mobile" ? 720 : 960,
    maxCached: size === "mobile" ? 24 : 40,
    concurrency: size === "mobile" ? 4 : 6,
  });
  const stage = new ScrubStage({
    canvas,
    stage: wrap,
    poster: shoe.assets.poster,
    maxDpr: 2,
    onFrame: (frame) => {
      productCounter.textContent = `${pad(sequence.displayIndex(frame))} / ${sequence.count}`;
    },
  });

  state.productStage = stage;
  state.productSequence = sequence;
  stage.setProgress(progress);

  sequence
    .preloadFirst(12)
    .then(() => {
      if (state.productSequence !== sequence) return;
      stage.setSequence(sequence);
      wrap.classList.add("is-ready");
      stage.setProgress(progress);
      sequence.startBackgroundLoad();
    })
    .catch(() => {
      if (state.productSequence === sequence) wrap.classList.add("is-ready");
    });

  range.addEventListener("input", () => {
    progress = Number(range.value) / 100;
    stage.setProgress(progress);
  });

  let drag = null;
  const onDown = (event) => {
    if (event.button !== 0 || event.target === range) return;
    drag = { x: event.clientX, progress };
    wrap.classList.add("is-dragging");
    wrap.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event) => {
    if (!drag) return;
    const width = wrap.clientWidth || 1;
    progress = clamp(drag.progress - (event.clientX - drag.x) / width, 0, 1);
    range.value = String(Math.round(progress * 100));
    stage.setProgress(progress);
  };
  const onUp = () => {
    drag = null;
    wrap.classList.remove("is-dragging");
  };

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointercancel", onUp);

  productOrbitCleanup = () => {
    wrap.removeEventListener("pointerdown", onDown);
    wrap.removeEventListener("pointermove", onMove);
    wrap.removeEventListener("pointerup", onUp);
    wrap.removeEventListener("pointercancel", onUp);
  };
};

const showProductMode = (shoe, mode) => {
  if (!productViewer || !shoe) return;
  clearProductViewer();
  productMode = mode;
  $$(".product-tab", productTabsEl).forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  if (mode === "360") mountProductOrbit(shoe);
  else if (mode === "still") mountProductStill(shoe);
  else if (mode === "exploded" || mode === "closeup") mountProductFilm(shoe, mode);
  else mountProductDetail(shoe);
};

const renderProductTabs = (shoe) => {
  if (!productTabsEl) return;
  const modes = productModes(shoe);
  productTabsEl.innerHTML = modes
    .map(
      (mode, index) =>
        `<button class="product-tab" type="button" role="tab" data-mode="${mode.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${mode.label}</button>`,
    )
    .join("");
};

const renderProductSizes = () => {
  if (!productSizeOptions) return;
  productSizeOptions.innerHTML = SIZES.map(
    (size) =>
      `<button class="size-option${size === state.productSize ? " is-active" : ""}" type="button" data-size="${size}" aria-pressed="${size === state.productSize}">${size}</button>`,
  ).join("");
};

const renderProduct = (shoe) => {
  if (!productDialog || !shoe) return;
  state.productShoe = shoe;
  state.productSize = SIZES.includes(state.productSize) ? state.productSize : 42;

  productDialog.style.setProperty("--accent", shoe.accent);
  productDialog.style.setProperty("--accent-text", shoe.accentText);
  productDialog.style.setProperty("--accent-ink", shoe.accentInk);

  const set = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  set("productIndex", `${shoe.index} / 13`);
  set("productCategory", `${shoe.category} / ${shoe.style}`);
  set("productName", shoe.name);
  set("productTagline", shoe.tagline);
  set("productPrice", formatPrice(shoe.price));
  set("productDesc", shoe.description);
  set("productMaterial", shoe.materials);
  set("productMaterialCaption", shoe.materialCaption);
  if (productAdded) productAdded.textContent = "";

  const specs = document.getElementById("productSpecs");
  if (specs) {
    specs.innerHTML = shoe.specs
      .map((spec) => `<div><dt>${spec.label}</dt><dd>${spec.value}</dd></div>`)
      .join("");
  }

  const metrics = document.getElementById("productMetrics");
  if (metrics) {
    metrics.innerHTML = shoe.metrics
      .map(
        (metric) =>
          `<div class="product-metric"><span>${metric.label}</span><strong>${metricText(metric)}${metric.suffix}</strong><em>${metric.note}</em></div>`,
      )
      .join("");
  }

  renderProductTabs(shoe);
  renderProductSizes();
  showProductMode(shoe, productModes(shoe)[0].id);
};

const openProduct = (id) => {
  const shoe = getShoe(id);
  if (!shoe || !productDialog) return;

  if (!productDialog.open) {
    productLastFocus = document.activeElement;
    productDialog.showModal();
    lockScroll();
  }

  renderProduct(shoe);
  const shell = $(".product__shell", productDialog);
  if (shell) shell.scrollTop = 0;
  const info = document.getElementById("productInfo");
  if (info) info.scrollTop = 0;
  window.setTimeout(() => document.getElementById("productClose")?.focus({ preventScroll: true }), 60);
  announce(`${shoe.name} study opened.`);
};

const stepProduct = (direction) => {
  if (!state.productShoe) return;
  const index = SHOES.findIndex((shoe) => shoe.id === state.productShoe.id);
  const next = SHOES[(index + direction + SHOES.length) % SHOES.length];
  openProduct(next.id);
};

const setupProduct = () => {
  if (!productDialog) return;

  productDialog.addEventListener("click", (event) => {
    if (event.target === productDialog) productDialog.close();
  });

  productDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const nodes = [
      ...productDialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => node.getClientRects().length > 0);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  productDialog.addEventListener("close", () => {
    clearProductViewer();
    state.productShoe = null;
    unlockScroll();
    if (productLastFocus && typeof productLastFocus.focus === "function") {
      productLastFocus.focus({ preventScroll: true });
    }
    productLastFocus = null;
    announce("Product study closed.");
  });

  document.getElementById("productClose")?.addEventListener("click", () => productDialog.close());
  document.getElementById("productPrev")?.addEventListener("click", () => stepProduct(-1));
  document.getElementById("productNext")?.addEventListener("click", () => stepProduct(1));

  productTabsEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || !state.productShoe) return;
    showProductMode(state.productShoe, button.dataset.mode);
  });

  productTabsEl?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = $$(".product-tab", productTabsEl);
    if (!tabs.length) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    let next = current < 0 ? 0 : current;
    if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    tabs[next].focus();
    tabs[next].click();
  });

  productSizeOptions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-size]");
    if (!button) return;
    state.productSize = Number(button.dataset.size);
    $$(".size-option", productSizeOptions).forEach((node) => {
      const active = node === button;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
  });

  productAddButton?.addEventListener("click", () => {
    if (!state.productShoe) return;
    state.cart?.add(state.productShoe, state.productSize);
    if (productAdded) {
      productAdded.textContent = `Added / EU ${state.productSize}`;
      window.clearTimeout(state.productAddedTimer);
      state.productAddedTimer = window.setTimeout(() => {
        productAdded.textContent = "";
      }, 2800);
    }
  });
};

/* Scroll lock, menu, and shell ------------------------------------------- */

let scrollLocks = 0;

const lockScroll = () => {
  scrollLocks += 1;
  document.body.classList.add("is-locked");
  state.lenis?.stop();
};

const unlockScroll = () => {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  document.body.classList.remove("is-locked");
  state.lenis?.start();
};

const menu = document.getElementById("siteMenu");
const menuToggle = document.getElementById("menuToggle");
const menuClose = document.getElementById("menuClose");
const menuBag = document.getElementById("menuBag");

let menuOpen = false;
let menuLastFocus = null;

const menuFocusables = () =>
  menu
    ? [...menu.querySelectorAll('a[href], button:not([disabled])')].filter((node) => node.offsetParent !== null)
    : [];

const openMenu = () => {
  if (!menu || menuOpen) return;
  menuOpen = true;
  menuLastFocus = document.activeElement;
  menu.inert = false;
  menu.removeAttribute("inert");
  menu.setAttribute("aria-hidden", "false");
  menu.classList.add("is-open");
  menuToggle?.setAttribute("aria-expanded", "true");
  menuToggle?.setAttribute("aria-label", "Close menu");
  lockScroll();
  window.setTimeout(() => menuClose?.focus(), 80);
  announce("Menu opened.");
};

const closeMenu = ({ restore = true } = {}) => {
  if (!menu || !menuOpen) return;
  menuOpen = false;
  menu.classList.remove("is-open");
  menu.setAttribute("aria-hidden", "true");
  menu.setAttribute("inert", "");
  menu.inert = true;
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open menu");
  unlockScroll();
  if (restore && menuLastFocus && typeof menuLastFocus.focus === "function") {
    menuLastFocus.focus({ preventScroll: true });
  }
  menuLastFocus = null;
};

const setupMenu = () => {
  if (!menu) return;

  menuToggle?.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
  menuClose?.addEventListener("click", () => closeMenu());
  menuBag?.addEventListener("click", () => {
    closeMenu({ restore: false });
    state.cart?.open();
  });

  menu.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", () => closeMenu({ restore: false }));
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = menuFocusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
};

const headerHeight = () => document.getElementById("siteHeader")?.offsetHeight || 76;

const scrollToTarget = (target) => {
  if (!target) return;
  if (state.lenis) {
    state.lenis.scrollTo(target, { offset: -headerHeight() + 1, duration: 1.15 });
  } else {
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight() + 1;
    window.scrollTo({ top, behavior: state.reduced ? "auto" : "smooth" });
  }
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  window.setTimeout(() => target.focus({ preventScroll: true }), state.lenis ? 720 : 420);
};

const setupAnchors = () => {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    // The router owns these; it also scrolls, so handling them here too would
    // run the animation twice.
    if (link.dataset.route || link.dataset.section) {
      if (menuOpen) closeMenu({ restore: false });
      return;
    }
    const href = link.getAttribute("href");
    if (!href || href === "#") return;
    let target = null;
    try {
      target = document.querySelector(href);
    } catch {
      return;
    }
    if (!target) return;
    event.preventDefault();
    if (menuOpen) closeMenu({ restore: false });
    scrollToTarget(target);
  });
};

const setupScrollUI = () => {
  const bar = document.getElementById("scrollProgress");
  const header = document.getElementById("siteHeader");

  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const value = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    if (bar) bar.style.width = `${(value * 100).toFixed(2)}%`;
    header?.classList.toggle("is-stuck", window.scrollY > 24);
    updateStudy();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();
};

/* Motion ----------------------------------------------------------------- */

const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js";
const SCROLL_TRIGGER_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.js";
const LENIS_URL = "https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.mjs";

const revealHero = () => {
  $$("[data-hero]").forEach((node) => node.classList.add("is-revealed"));
  document.body.classList.add("is-ready");
};

const setupReveals = () => {
  const nodes = $$("[data-reveal]");
  if (!nodes.length) return;
  if (state.reduced || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-revealed"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
  );
  nodes.forEach((node) => observer.observe(node));
};

const setupCursor = () => {
  if (state.reduced || !window.matchMedia("(pointer: fine)").matches) return;
  const cursor = document.getElementById("cursor");
  if (!cursor) return;
  document.documentElement.classList.add("has-cursor");

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let x = targetX;
  let y = targetY;
  let raf = 0;

  const tick = () => {
    x += (targetX - x) * 0.18;
    y += (targetY - y) * 0.18;
    cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    raf = requestAnimationFrame(tick);
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    },
    { passive: true },
  );

  document.addEventListener("pointerover", (event) => {
    const node = event.target.closest("a, button, [data-magnetic], .card, input, textarea");
    cursor.classList.toggle("is-active", Boolean(node));
  });

  raf = requestAnimationFrame(tick);
};

const setupMagnetic = () => {
  if (state.reduced || !window.matchMedia("(pointer: fine)").matches) return;
  $$("[data-magnetic]").forEach((node) => {
    node.addEventListener("pointermove", (event) => {
      const rect = node.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
      const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
      node.style.transform = `translate(${(dx * 9).toFixed(1)}px, ${(dy * 7).toFixed(1)}px)`;
    });
    node.addEventListener("pointerleave", () => {
      node.style.transform = "";
    });
  });
};

const setupMotion = async () => {
  setupReveals();
  setupCursor();
  setupMagnetic();

  if (state.reduced) return;

  let gsap = null;
  let ScrollTrigger = null;
  let Lenis = null;

  try {
    const mod = await import(GSAP_URL);
    gsap = mod.gsap || mod.default;
  } catch (error) {
    console.warn("AERO motion: GSAP unavailable.", error);
  }

  if (gsap) {
    try {
      const mod = await import(SCROLL_TRIGGER_URL);
      ScrollTrigger = mod.ScrollTrigger || mod.default;
      if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    } catch (error) {
      console.warn("AERO motion: ScrollTrigger unavailable.", error);
    }
  }

  try {
    const mod = await import(LENIS_URL);
    Lenis = mod.default || mod.Lenis;
  } catch (error) {
    console.warn("AERO motion: Lenis unavailable.", error);
  }

  if (Lenis) {
    try {
      state.lenis = new Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 0.92 });
      if (gsap && ScrollTrigger) {
        state.lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add((time) => state.lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
      } else {
        const loop = (time) => {
          state.lenis?.raf(time);
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }
      if (document.body.classList.contains("is-locked")) state.lenis.stop();
      document.documentElement.dataset.lenis = "on";
    } catch (error) {
      console.warn("AERO motion: Lenis could not start.", error);
      state.lenis = null;
      document.documentElement.dataset.lenis = "off";
    }
  } else {
    document.documentElement.dataset.lenis = "off";
  }

  if (gsap && ScrollTrigger) {
    state.gsap = gsap;
    state.ScrollTrigger = ScrollTrigger;

    $$("[data-parallax]").forEach((node) => {
      const amount = Number.parseFloat(node.dataset.parallax) || 0.05;
      node.style.transition = "none";
      gsap.to(node, {
        yPercent: amount * 100,
        ease: "none",
        scrollTrigger: {
          trigger: node,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.5,
        },
      });
    });

    const ghost = $(".hero__ghost");
    if (ghost) {
      gsap.to(ghost, {
        yPercent: 14,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }

    window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
  }
};

/* Newsletter ------------------------------------------------------------- */

const setupNewsletter = () => {
  const form = document.getElementById("newsletterForm");
  const input = document.getElementById("email");
  const error = document.getElementById("emailError");
  const success = document.getElementById("newsletterSuccess");
  const note = document.getElementById("emailNote");
  if (!form || !input) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

    if (!valid) {
      if (success) success.hidden = true;
      if (error) {
        error.hidden = false;
        error.textContent = value
          ? "That address is missing something. Try name@studio.com."
          : "Add an email address first.";
      }
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }

    if (error) error.hidden = true;
    input.removeAttribute("aria-invalid");
    if (success) success.hidden = false;
    if (note) note.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    input.value = "";
    input.disabled = true;
    announce("You are on the letters list. This is a demo, so no email was sent.");
  });

  input.addEventListener("input", () => {
    if (error && !error.hidden) {
      error.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  });
};

/* Boot ------------------------------------------------------------------- */


/* ---- Hangar showroom ---- */

const hasWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

const paintAccent = (shoe) => {
  const root = document.documentElement;
  if (!shoe) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-text");
    root.style.removeProperty("--accent-ink");
    return;
  }
  root.style.setProperty("--accent", shoe.accent);
  root.style.setProperty("--accent-text", shoe.accentText);
  root.style.setProperty("--accent-ink", shoe.accentInk);
};

const setupHangar = () => {
  const section = document.getElementById("showroom");
  const stage = document.getElementById("hangarStage");
  const fallback = document.getElementById("hangarFallback");
  if (!section || !stage) return { start() {}, setActive() {}, available: false };

  if (!hasWebGL()) {
    // No WebGL: say so where the wall would have been and point at the grid,
    // which is the same thirteen shoes.
    section.classList.add("is-unavailable");
    if (fallback) fallback.hidden = false;
    return { start() {}, setActive() {}, available: false };
  }

  const loading = document.getElementById("hangarLoading");
  const bar = document.getElementById("hangarLoadingBar");
  const loadingText = document.getElementById("hangarLoadingText");
  const narrow = window.matchMedia("(max-width: 900px)").matches;

  let hangar = null;
  let focus = null;
  let booted = false;

  /* Inside a full-screen view there is no page scroll to ride, so a single
     column pans by wheel and vertical drag instead. Nothing competes for the
     gesture here, which it would have as a scroll section. */
  let pan = 0;
  const applyPan = () => hangar?.setPan(pan);

  const nudge = (deltaPx) => {
    if (!hangar || hangar.panRange.span <= 0) return;
    pan = Math.min(1, Math.max(0, pan + deltaPx / (window.innerHeight * 1.6)));
    applyPan();
  };

  const onWheel = (event) => {
    if (!hangar || hangar.panRange.span <= 0) return;
    event.preventDefault();
    nudge(event.deltaY);
  };

  let dragY = null;
  const onTouchStart = (event) => { dragY = event.touches[0].clientY; };
  const onTouchMove = (event) => {
    if (dragY === null || !hangar || hangar.panRange.span <= 0) return;
    const y = event.touches[0].clientY;
    nudge(dragY - y);
    dragY = y;
  };
  const onTouchEnd = () => { dragY = null; };

  const bindPan = () => {
    if (!hangar || hangar.panRange.span <= 0) return;
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("touchstart", onTouchStart, { passive: true });
    stage.addEventListener("touchmove", onTouchMove, { passive: true });
    stage.addEventListener("touchend", onTouchEnd, { passive: true });
    applyPan();
  };

  /* Built the first time the tab is opened, then kept. Reopening restores the
     view the viewer left, which is why this is not torn down on close. */
  const start = async () => {
    if (booted) return;
    booted = true;
    if (loading) loading.hidden = false;

    try {
      hangar = await createHangar({
        mount: stage,
        shoes: SHOES,
        // One column on a phone, panned by gesture; two rows on a wall.
        columns: narrow ? 1 : null,
        rows: 2,
        fitRows: narrow ? 2 : null,
        dust: narrow ? 220 : 700,
        pixelRatio: narrow ? 1.5 : 2,
        onProgress(done, total) {
          if (bar) bar.style.setProperty("--progress", done / total);
          if (loadingText) loadingText.textContent = `Loading the wall — ${done} / ${total}`;
        },
        onSelect(shoe, index) {
          focus?.focus(index);
        },
        onSelectEmpty() {
          focus?.overview();
        },
      });

      focus = await createFocus({
        hangar,
        mount: stage,
        shoes: SHOES,
        brand: BRAND.name,
        cart: state.cart,
        wishlist: state.wishlist,
        announce,
        onFocusChange: paintAccent,
      });

      bindPan();
      await hangar.ready;
      loading?.classList.add("is-done");
      state.hangar = hangar;
      state.hangarFocus = focus;
      // Handle for scripts/verify_site_hangar.mjs and verify_routing.mjs.
      window.__aeroShowroom = { hangar, focus, section };
    } catch (error) {
      console.warn("AERO hangar failed to start.", error);
      section.classList.add("is-unavailable");
      if (loading) loading.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  };

  return { start, setActive: (on) => hangar?.setActive(on), available: true };
};

const boot = async () => {
  state.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!state.reduced) document.documentElement.classList.add("motion");

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  renderFilters();
  renderCards();
  renderNotes();
  renderStudyTabs();
  renderAnatomyTabs();
  setupFilters();
  setupCollectionEvents();
  setupStudy();
  setupAnatomy();
  setupMaterials();
  setupVideoObserver();
  setupProduct();
  setupMenu();
  setupAnchors();
  setupScrollUI();
  setupNewsletter();

  state.cart = createCart({
    announce,
    onLock: lockScroll,
    onUnlock: unlockScroll,
  });
  state.wishlist = createWishlist({ announce });

  const showroom = setupHangar();
  state.router = createRouter({
    views: { home: document.getElementById("viewHome"), hangar: document.getElementById("viewHangar") },
    reduced: state.reduced,
    scrollTo(target) {
      if (state.lenis) state.lenis.scrollTo(target, { duration: 1.1 });
      else target.scrollIntoView({ behavior: state.reduced ? "auto" : "smooth" });
    },
    onEnter(view) {
      if (view === "hangar") {
        showroom.start();
        showroom.setActive(true);
        // Nothing scrolls behind a full-screen view, and a running Lenis
        // fights the overflow lock.
        state.lenis?.stop();
      } else {
        state.lenis?.start();
        // While the hangar was open the document was one viewport tall, so
        // Lenis cached a scroll limit that would clamp any jump to a section.
        state.lenis?.resize();
      }
      state.nav?.refresh();
      state.ScrollTrigger?.refresh();
    },
    onLeave(view) {
      // Stop rendering the moment the view is covered, not when it unmounts.
      if (view === "hangar") showroom.setActive(false);
    },
  });

  state.nav = createNav({
    nav: document.getElementById("primaryNav"),
    indicator: document.getElementById("navIndicator"),
    header: document.getElementById("siteHeader"),
    router: state.router,
    reduced: state.reduced,
  });
  state.nav.setActive("home");

  setFeature("blue", { force: true, silent: true });

  document.getElementById("replayIntro")?.addEventListener("click", async () => {
    try { sessionStorage.removeItem("aero:intro"); } catch { /* private mode */ }
    state.router?.go("home");
    document.body.classList.add("is-intro");
    try {
      await runIntro({ skip: false });
    } catch (error) {
      console.warn("AERO intro failed.", error);
    }
    document.body.classList.remove("is-intro");
    revealHero();
  });

  document.getElementById("backToTop")?.addEventListener("click", () => {
    if (state.lenis) state.lenis.scrollTo(0, { duration: 1.1 });
    else window.scrollTo({ top: 0, behavior: state.reduced ? "auto" : "smooth" });
  });

  let seen = false;
  try {
    seen = sessionStorage.getItem("aero:intro") === "seen";
  } catch {
    seen = false;
  }

  const introBackdrop = ["siteHeader", "main", "contact"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  introBackdrop.forEach((node) => {
    node.inert = true;
  });

  try {
    await runIntro({ skip: seen });
  } catch (error) {
    console.warn("AERO intro failed.", error);
  }

  introBackdrop.forEach((node) => {
    node.inert = false;
  });

  // Mark it seen only once it has actually finished, so a reload mid-intro
  // still plays it.
  try { sessionStorage.setItem("aero:intro", "seen"); } catch { /* private mode */ }

  window.clearTimeout(window.__aeroBootTimer);
  document.body.classList.remove("is-intro");
  revealHero();
  document.getElementById("main")?.focus({ preventScroll: true });
  setupMotion();

  // A deep link such as /#hangar is honoured only now, so the intro is never
  // racing a view swap.
  state.router.fromLocation({ push: false });
  // Boot is done: the router is listening and the nav is live.
  window.__aeroReady = true;

};

boot();


