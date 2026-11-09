/* AERO frame sequence engine.
   Loads WebP frames as ImageBitmaps, keeps the first 20 frames hot, then fills
   the rest in the background. ScrubStage lerps scroll progress into a frame
   index and draws cover-fit on a DPR-aware canvas. */

const pad = (value) => String(value).padStart(3, "0");

const isBitmap = (image) =>
  typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;

const imageReady = (image) => {
  if (!image) return false;
  if (isBitmap(image)) return image.width > 0 && image.height > 0;
  return Boolean(image.complete && image.naturalWidth);
};

const imageSize = (image) => {
  if (!image) return [0, 0];
  if (isBitmap(image)) return [image.width, image.height];
  return [image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0];
};

export class FrameSequence {
  constructor(shoe, size = "desktop", options = {}) {
    this.shoe = shoe;
    this.size = size;
    const frames = shoe.assets?.frames;
    const hasFrames = Boolean(frames);
    this.basePath = frames?.[size] || `${shoe.framePath}/${size}`;
    this.count = Math.max(1, (hasFrames ? frames.count : shoe.frameCount) || 240);
    const start = hasFrames ? frames.start || 1 : shoe.frameStart || 1;
    this.first = Math.max(0, Math.min(this.count - 1, start - 1));
    this.span = Math.max(1, this.count - 1 - this.first);
    this.pattern = frames?.pattern || "frame_###.webp";
    this.concurrency = options.concurrency || (size === "mobile" ? 4 : 6);
    this.maxWidth = options.maxWidth || (size === "mobile" ? 720 : 1280);
    this.maxCached = options.maxCached || 0;
    this.onLoad = options.onLoad || null;
    this.images = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.loaded = 0;
    this.focus = this.first;
    this.disposed = false;
    this.ready = false;
    this.complete = false;
    this.firstLoad = null;
    this.background = null;
    this.controller = new AbortController();
  }

  url(index) {
    const file = this.pattern.includes("###")
      ? this.pattern.replace("###", pad(index + 1))
      : `frame_${pad(index + 1)}.webp`;
    return `${this.basePath}/${file}`;
  }

  displayIndex(index) {
    return index + 1;
  }

  has(index) {
    return this.images.has(index);
  }

  frameAt(progress) {
    return this.first + Math.round(Math.min(1, Math.max(0, progress)) * this.span);
  }

  loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.loading = "eager";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${url}`));
      image.src = url;
    });
  }

  async fetchBitmap(index) {
    const url = this.url(index);
    try {
      const response = await fetch(url, {
        signal: this.controller.signal,
        cache: "force-cache",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const blob = await response.blob();
      if (this.disposed) return null;
      if (typeof window.createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: this.maxWidth,
          resizeQuality: "high",
        });
        return bitmap;
      }
      return await this.loadImageElement(url);
    } catch (error) {
      if (error?.name === "AbortError" || this.disposed) return null;
      try {
        return await this.loadImageElement(url);
      } catch {
        this.failed.add(index);
        return null;
      }
    }
  }

  async load(index) {
    if (index < this.first || index >= this.count) return null;
    if (this.images.has(index)) return this.images.get(index);
    if (this.pending.has(index)) return this.pending.get(index);
    if (this.failed.has(index) || this.disposed) return null;

    const task = this.fetchBitmap(index);
    this.pending.set(index, task);
    try {
      const image = await task;
      if (image && !this.disposed) {
        this.images.set(index, image);
        this.loaded = this.images.size;
        this.trim();
        if (this.onLoad) this.onLoad(index, image);
        return image;
      }
      return null;
    } finally {
      this.pending.delete(index);
    }
  }

  async loadSet(indices, onEach) {
    const queue = [...new Set(indices)];
    const workers = Array.from(
      { length: Math.min(this.concurrency, queue.length) },
      async () => {
        while (queue.length && !this.disposed) {
          const index = queue.shift();
          const image = await this.load(index);
          if (onEach) onEach(index, image);
        }
      },
    );
    await Promise.all(workers);
  }

  preloadFirst(count = 20, onProgress) {
    if (this.firstLoad) return this.firstLoad;
    const total = Math.min(count, this.count - this.first);
    const indices = [];
    for (let i = 0; i < total; i += 1) indices.push(this.first + i);
    let done = 0;
    this.firstLoad = this.loadSet(indices, () => {
      done += 1;
      if (onProgress) onProgress(done / Math.max(1, total));
    }).then(() => {
      this.ready = true;
      return this;
    });
    return this.firstLoad;
  }

  startBackgroundLoad() {
    if (this.background) return this.background;
    const missing = [];
    for (let i = this.first; i < this.count; i += 1) {
      if (!this.images.has(i) && !this.pending.has(i)) missing.push(i);
    }
    this.background = this.loadSet(missing).then(() => {
      this.complete = true;
      return this;
    });
    return this.background;
  }

  nearest(index) {
    if (this.images.has(index)) return this.images.get(index);
    for (let radius = 1; radius < this.count; radius += 1) {
      const before = index - radius;
      const after = index + radius;
      if (before >= this.first && this.images.has(before)) return this.images.get(before);
      if (after < this.count && this.images.has(after)) return this.images.get(after);
    }
    return null;
  }

  setFocus(index) {
    this.focus = index;
    if (!this.maxCached || this.images.size <= this.maxCached) return;
    const keep = new Set();
    const radius = Math.max(1, Math.floor((this.maxCached - 1) / 2));
    for (let offset = -radius; offset <= radius; offset += 1) keep.add(index + offset);
    const candidates = [...this.images.keys()]
      .filter((candidate) => !keep.has(candidate))
      .sort((a, b) => Math.abs(b - index) - Math.abs(a - index));
    while (this.images.size > this.maxCached && candidates.length) {
      const candidate = candidates.shift();
      const image = this.images.get(candidate);
      if (isBitmap(image)) image.close();
      this.images.delete(candidate);
    }
    this.loaded = this.images.size;
  }

  trim() {
    this.setFocus(this.focus);
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    for (const image of this.images.values()) {
      if (isBitmap(image)) image.close();
    }
    this.images.clear();
    this.pending.clear();
    this.failed.clear();
    this.loaded = 0;
  }
}

export class ScrubStage {
  constructor({
    canvas,
    stage,
    counter,
    name,
    callouts,
    poster,
    onFrame,
    maxDpr = 2,
  }) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
    this.counter = counter;
    this.name = name;
    this.calloutNodes = callouts ? [...callouts.querySelectorAll("[data-callout]")] : [];
    this.poster = poster ? this.loadPoster(poster) : null;
    this.sequence = null;
    this.progress = 0;
    this.target = 0;
    this.frame = 0;
    this.lastFrame = -1;
    this.lastDrawn = -1;
    this.running = false;
    this.raf = null;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.maxDpr = maxDpr;
    this.onFrame = onFrame;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);

    this.resizeObserver =
      "ResizeObserver" in window
        ? new ResizeObserver(() => this.resize())
        : null;
    if (this.resizeObserver) this.resizeObserver.observe(this.stage);
    window.addEventListener("resize", this.resize, { passive: true });
    this.resize();
  }

  loadPoster(src) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (this.disposed) return;
      this.lastDrawn = -1;
      this.draw(true);
    };
    image.src = src;
    return image;
  }

  setPoster(src) {
    this.poster = src ? this.loadPoster(src) : null;
    this.lastDrawn = -1;
    this.draw(true);
  }

  setSequence(sequence) {
    this.sequence = sequence;
    if (sequence) {
      sequence.onLoad = (index) => {
        if (index !== this.frame || this.disposed) return;
        this.lastDrawn = -1;
        this.draw(true);
      };
    }
    this.frame = sequence ? sequence.frameAt(this.progress) : 0;
    this.lastFrame = -1;
    this.lastDrawn = -1;
    this.draw(true);
    if (!this.reduced) this.start();
  }

  setLabel(label) {
    if (this.name) this.name.textContent = label;
  }

  setProgress(value) {
    this.target = Math.min(1, Math.max(0, value));
    if (this.reduced) {
      this.progress = this.target;
      this.update();
      this.draw(true);
      return;
    }
    if (!this.running) this.start();
  }

  setCalloutState(index) {
    this.calloutNodes.forEach((node, i) => {
      node.classList.toggle("is-active", i === index);
    });
  }

  start() {
    if (this.reduced || this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  tick() {
    if (!this.running) return;
    const delta = this.target - this.progress;
    if (Math.abs(delta) < 0.00025) {
      this.progress = this.target;
    } else {
      this.progress += delta * 0.12;
    }
    this.update();
    this.draw();
    if (Math.abs(this.target - this.progress) < 0.00025) {
      this.running = false;
      this.raf = null;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  update() {
    if (!this.sequence) return;
    const nextFrame = this.sequence.frameAt(this.progress);
    if (this.sequence.setFocus) this.sequence.setFocus(nextFrame);
    if (nextFrame === this.lastFrame) return;
    this.frame = nextFrame;
    this.lastFrame = nextFrame;
    if (this.counter) {
      this.counter.textContent = pad(this.sequence.displayIndex(nextFrame));
    }
    if (this.onFrame) this.onFrame(nextFrame, this.progress);
  }

  resize() {
    if (!this.stage) return;
    const rect = this.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const pixelWidth = Math.round(this.width * this.dpr);
    const pixelHeight = Math.round(this.height * this.dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.lastDrawn = -1;
    this.draw(true);
  }

  draw(force = false) {
    if (!this.ctx || !this.width || !this.height) return;
    if (!force && this.frame === this.lastDrawn) return;
    this.lastDrawn = this.frame;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, w, h);

    const image = this.sequence
      ? this.sequence.nearest(this.frame) || this.poster
      : this.poster;

    if (imageReady(image)) {
      const [iw, ih] = imageSize(image);
      const scale = Math.max(w / iw, h / ih);
      const drawWidth = iw * scale;
      const drawHeight = ih * scale;
      const x = (w - drawWidth) / 2;
      const y = (h - drawHeight) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, x, y, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.resize);
    if (this.sequence) this.sequence.dispose();
    this.sequence = null;
    this.poster = null;
  }
}
