/* AERO gallery viewer.
   The ten still-only shoes get a pseudo-3D study: drag to tilt the still,
   move the pointer to inspect the detail crop, zoom to pan. No WebGL. */

let viewerCount = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class GalleryViewer {
  constructor({ mount, shoe, reduced = false }) {
    this.mount = mount;
    this.shoe = shoe;
    this.reduced = reduced;
    this.id = `gallery-${++viewerCount}`;
    this.ry = 0;
    this.rx = 0;
    this.panX = 0;
    this.panY = 0;
    this.zoomed = false;
    this.dragging = false;
    this.start = null;
    this.pointerId = null;
    this.render();
    this.bind();
  }

  render() {
    const still = this.shoe.assets?.still || "";
    const detail = this.shoe.assets?.detail || still;
    const detailUrl = new URL(detail, document.baseURI).href;
    const alt = `${this.shoe.name}, ${this.shoe.style.toLowerCase()}, studio still study`;

    this.mount.innerHTML = `
      <div class="gallery" style="--detail:url('${detailUrl}')">
        <div class="gallery__stage" tabindex="0" role="group" aria-label="${alt}. Drag or use the arrow keys to turn the still. Move the pointer to inspect the material." aria-describedby="${this.id}-hint">
          <div class="gallery__wash" style="background-image:url('${still}')" aria-hidden="true"></div>
          <div class="gallery__tilt">
            <img class="gallery__image" src="${still}" alt="${alt}" width="1600" height="893" draggable="false" decoding="async">
            <span class="gallery__lens" aria-hidden="true"></span>
          </div>
          <span class="gallery__corner gallery__corner--tl" aria-hidden="true"></span>
          <span class="gallery__corner gallery__corner--tr" aria-hidden="true"></span>
          <span class="gallery__corner gallery__corner--bl" aria-hidden="true"></span>
          <span class="gallery__corner gallery__corner--br" aria-hidden="true"></span>
        </div>
        <div class="gallery__bar">
          <p class="gallery__hint" id="${this.id}-hint">Drag to turn / move to inspect</p>
          <div class="gallery__controls">
            <button class="gallery__control" type="button" data-turn="-1" aria-label="Turn the still left">Left</button>
            <button class="gallery__control" type="button" data-turn="1" aria-label="Turn the still right">Right</button>
            <button class="gallery__control" type="button" data-zoom aria-pressed="false" aria-label="Zoom the still">Zoom</button>
            <button class="gallery__control" type="button" data-reset aria-label="Reset the still view">Reset</button>
          </div>
        </div>
      </div>
    `;

    this.gallery = this.mount.querySelector(".gallery");
    this.stage = this.mount.querySelector(".gallery__stage");
    this.tilt = this.mount.querySelector(".gallery__tilt");
    this.lens = this.mount.querySelector(".gallery__lens");
    this.zoomButton = this.mount.querySelector("[data-zoom]");

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  bind() {
    this.stage.addEventListener("pointerdown", this.onPointerDown);
    this.stage.addEventListener("pointermove", this.onPointerMove);
    this.stage.addEventListener("pointerup", this.onPointerUp);
    this.stage.addEventListener("pointercancel", this.onPointerUp);
    this.stage.addEventListener("pointerleave", (event) => {
      if (!this.dragging) this.lens.style.opacity = "";
      if (event.pointerType === "mouse" && !this.dragging) this.resetLens();
    });
    this.stage.addEventListener("keydown", this.onKeyDown);

    this.mount.querySelectorAll("[data-turn]").forEach((button) => {
      button.addEventListener("click", () => {
        this.ry = clamp(this.ry + Number(button.dataset.turn) * 5, -18, 18);
        this.apply();
      });
    });

    this.zoomButton.addEventListener("click", () => {
      this.zoomed = !this.zoomed;
      this.gallery.classList.toggle("is-zoomed", this.zoomed);
      this.zoomButton.setAttribute("aria-pressed", String(this.zoomed));
      if (!this.zoomed) {
        this.panX = 0;
        this.panY = 0;
        this.apply();
      }
    });

    this.mount.querySelector("[data-reset]").addEventListener("click", () => this.reset());
  }

  resetLens() {
    this.lens.style.left = "50%";
    this.lens.style.top = "50%";
    this.tilt.style.setProperty("--mx", "50%");
    this.tilt.style.setProperty("--my", "50%");
  }

  reset() {
    this.ry = 0;
    this.rx = 0;
    this.panX = 0;
    this.panY = 0;
    this.zoomed = false;
    this.gallery.classList.remove("is-zoomed");
    this.zoomButton.setAttribute("aria-pressed", "false");
    this.apply();
    this.resetLens();
  }

  apply() {
    this.tilt.style.setProperty("--rx", `${this.rx.toFixed(2)}deg`);
    this.tilt.style.setProperty("--ry", `${this.ry.toFixed(2)}deg`);
    this.tilt.style.setProperty("--pan-x", `${this.panX.toFixed(1)}px`);
    this.tilt.style.setProperty("--pan-y", `${this.panY.toFixed(1)}px`);
  }

  onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.stage.classList.add("is-dragging");
    this.stage.setPointerCapture?.(event.pointerId);
    this.start = {
      x: event.clientX,
      y: event.clientY,
      ry: this.ry,
      rx: this.rx,
      panX: this.panX,
      panY: this.panY,
    };
  }

  onPointerMove(event) {
    const rect = this.stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    this.lens.style.left = `${x * 100}%`;
    this.lens.style.top = `${y * 100}%`;
    this.tilt.style.setProperty("--mx", `${x * 100}%`);
    this.tilt.style.setProperty("--my", `${y * 100}%`);

    if (!this.dragging || !this.start) return;
    const dx = event.clientX - this.start.x;
    const dy = event.clientY - this.start.y;

    if (this.zoomed) {
      this.panX = clamp(this.start.panX + dx, -140, 140);
      this.panY = clamp(this.start.panY + dy, -90, 90);
    } else {
      this.ry = clamp(this.start.ry + dx * 0.085, -18, 18);
      this.rx = clamp(this.start.rx - dy * 0.055, -10, 10);
    }
    this.apply();
  }

  onPointerUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.stage.classList.remove("is-dragging");
    if (this.pointerId !== null) this.stage.releasePointerCapture?.(this.pointerId);
    this.pointerId = null;
    this.start = null;
    if (event.pointerType === "touch") this.resetLens();
  }

  onKeyDown(event) {
    const key = event.key;
    let handled = true;
    if (key === "ArrowLeft") this.ry = clamp(this.ry - 4, -18, 18);
    else if (key === "ArrowRight") this.ry = clamp(this.ry + 4, -18, 18);
    else if (key === "ArrowUp") this.rx = clamp(this.rx - 3, -10, 10);
    else if (key === "ArrowDown") this.rx = clamp(this.rx + 3, -10, 10);
    else if (key === "Home") this.reset();
    else if (key === "+" || key === "=") {
      this.zoomed = true;
      this.gallery.classList.add("is-zoomed");
      this.zoomButton.setAttribute("aria-pressed", "true");
    } else if (key === "-") {
      this.zoomed = false;
      this.gallery.classList.remove("is-zoomed");
      this.zoomButton.setAttribute("aria-pressed", "false");
      this.panX = 0;
      this.panY = 0;
    } else handled = false;

    if (handled) {
      event.preventDefault();
      this.apply();
    }
  }

  destroy() {
    this.stage.removeEventListener("pointerdown", this.onPointerDown);
    this.stage.removeEventListener("pointermove", this.onPointerMove);
    this.stage.removeEventListener("pointerup", this.onPointerUp);
    this.stage.removeEventListener("pointercancel", this.onPointerUp);
    this.stage.removeEventListener("keydown", this.onKeyDown);
    this.mount.innerHTML = "";
  }
}
