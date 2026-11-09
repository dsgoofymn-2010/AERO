/* AERO bag.
   Front-end only. Items persist in localStorage, quantities are capped at nine,
   and checkout is a clearly labelled demo. */

import { SHOES, SIZES, formatPrice, getShoe } from "./data.js";

const STORAGE_KEY = "aero:bag:v1";
const MAX_QTY = 9;

const read = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && SHOES.some((shoe) => shoe.id === item.shoeId) && SIZES.includes(Number(item.size)))
      .map((item) => ({
        shoeId: item.shoeId,
        size: Number(item.size),
        qty: Math.min(MAX_QTY, Math.max(1, Number(item.qty) || 1)),
      }));
  } catch {
    return [];
  }
};

const write = (items) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* Private mode can refuse storage. The bag still works for this session. */
  }
};

const keyFor = (shoeId, size) => `${shoeId}-${size}`;

export function createCart({ announce, onLock, onUnlock } = {}) {
  const el = {
    toggle: document.getElementById("bagToggle"),
    count: document.getElementById("bagCount"),
    menuCount: document.getElementById("menuBagCount"),
    drawer: document.getElementById("cartDrawer"),
    overlay: document.getElementById("cartOverlay"),
    close: document.getElementById("cartClose"),
    items: document.getElementById("cartItems"),
    empty: document.getElementById("cartEmpty"),
    subtotal: document.getElementById("cartSubtotal"),
    inlineCount: document.getElementById("cartCountInline"),
    checkout: document.getElementById("checkoutButton"),
    browse: document.getElementById("cartBrowse"),
    checkoutDialog: document.getElementById("checkoutDialog"),
    checkoutSummary: document.getElementById("checkoutSummary"),
    closeCheckout: document.getElementById("closeCheckout"),
    live: document.getElementById("liveRegion"),
  };

  if (!el.drawer) {
    return {
      add() {},
      open() {},
      close() {},
      toggle() {},
      getCount: () => 0,
      getSubtotal: () => 0,
    };
  }

  let items = read();
  let isOpen = false;
  let lastFocus = null;
  let closeTimer = 0;
  let locked = false;

  const lock = () => {
    if (locked) return;
    locked = true;
    if (onLock) onLock();
    else document.body.classList.add("is-locked");
  };

  const unlock = () => {
    if (!locked) return;
    locked = false;
    if (onUnlock) onUnlock();
    else document.body.classList.remove("is-locked");
  };

  const say = (message) => {
    if (announce) announce(message);
    if (el.live) el.live.textContent = message;
  };

  const count = () => items.reduce((total, item) => total + item.qty, 0);
  const subtotal = () => items.reduce((total, item) => total + getShoe(item.shoeId).price * item.qty, 0);

  const focusables = () =>
    [...el.drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (node) => node.offsetParent !== null,
    );

  const sync = () => {
    const total = count();
    const value = subtotal();

    if (el.count) el.count.textContent = String(total);
    if (el.menuCount) el.menuCount.textContent = `(${total})`;
    if (el.inlineCount) el.inlineCount.textContent = `(${total})`;
    if (el.subtotal) el.subtotal.textContent = formatPrice(value);
    if (el.checkout) el.checkout.disabled = items.length === 0;
    if (el.empty) el.empty.hidden = items.length > 0;
    if (el.items) el.items.hidden = items.length === 0;

    if (el.toggle) {
      el.toggle.setAttribute("aria-label", `Open bag, ${total} ${total === 1 ? "item" : "items"}`);
    }

    if (el.items) {
      el.items.innerHTML = items
        .map((item) => {
          const shoe = getShoe(item.shoeId);
          const key = keyFor(item.shoeId, item.size);
          return `
            <li class="cart-item" data-key="${key}">
              <img class="cart-item__image" src="${shoe.assets.stillMobile}" alt="${shoe.name} in ${shoe.colorway}" width="76" height="76" loading="lazy" decoding="async">
              <div class="cart-item__main">
                <p class="cart-item__name">${shoe.name}</p>
                <p class="cart-item__meta">EU ${item.size} / ${shoe.style}</p>
                <p class="cart-item__price">${formatPrice(shoe.price * item.qty)}</p>
              </div>
              <div class="cart-item__side">
                <div class="qty" role="group" aria-label="Quantity for ${shoe.name}, EU ${item.size}">
                  <button type="button" data-action="minus" data-key="${key}" aria-label="Decrease quantity" ${item.qty <= 1 ? "disabled" : ""}>−</button>
                  <span aria-live="polite">${item.qty}</span>
                  <button type="button" data-action="plus" data-key="${key}" aria-label="Increase quantity" ${item.qty >= MAX_QTY ? "disabled" : ""}>+</button>
                </div>
                <button class="cart-item__remove" type="button" data-action="remove" data-key="${key}">Remove</button>
              </div>
            </li>
          `;
        })
        .join("");
    }

    write(items);
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    window.clearTimeout(closeTimer);
    if (el.overlay) el.overlay.hidden = false;
    el.drawer.removeAttribute("inert");
    el.drawer.setAttribute("aria-hidden", "false");
    lock();
    requestAnimationFrame(() => {
      el.overlay?.classList.add("is-open");
      el.drawer.classList.add("is-open");
    });
    window.setTimeout(() => el.close?.focus(), 80);
    say(`Bag opened. ${count()} ${count() === 1 ? "item" : "items"}.`);
  };

  const close = ({ restore = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    el.drawer.classList.remove("is-open");
    el.overlay?.classList.remove("is-open");
    el.drawer.setAttribute("aria-hidden", "true");
    closeTimer = window.setTimeout(() => {
      el.drawer.setAttribute("inert", "");
      if (el.overlay) el.overlay.hidden = true;
    }, 480);
    if (!el.checkoutDialog?.open) unlock();
    if (restore && lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus({ preventScroll: true });
    }
    lastFocus = null;
  };

  const toggle = () => (isOpen ? close() : open());

  const add = (shoe, size) => {
    const numericSize = Number(size);
    if (!shoe || !SIZES.includes(numericSize)) return count();
    const existing = items.find((item) => item.shoeId === shoe.id && item.size === numericSize);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + 1);
    } else {
      items.push({ shoeId: shoe.id, size: numericSize, qty: 1 });
    }
    sync();
    say(`${shoe.name}, EU ${numericSize}, added to the bag.`);
    return count();
  };

  const update = (key, action) => {
    const item = items.find((entry) => keyFor(entry.shoeId, entry.size) === key);
    if (!item) return;
    const shoe = getShoe(item.shoeId);
    if (action === "plus") item.qty = Math.min(MAX_QTY, item.qty + 1);
    if (action === "minus") item.qty = Math.max(1, item.qty - 1);
    if (action === "remove") {
      items = items.filter((entry) => entry !== item);
      say(`${shoe.name}, EU ${item.size}, removed from the bag.`);
    } else {
      say(`${shoe.name}, EU ${item.size}, quantity ${item.qty}.`);
    }
    sync();
    if (items.length === 0) {
      window.setTimeout(() => el.close?.focus(), 0);
    }
  };

  el.toggle?.addEventListener("click", open);
  el.close?.addEventListener("click", () => close());
  el.overlay?.addEventListener("click", () => close());
  el.browse?.addEventListener("click", () => {
    close({ restore: false });
    const collection = document.getElementById("collection");
    if (collection) {
      collection.scrollIntoView({ behavior: "smooth", block: "start" });
      const first = collection.querySelector(".card");
      if (first) window.setTimeout(() => first.focus({ preventScroll: true }), 600);
    }
  });

  el.items?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    update(button.dataset.key, button.dataset.action);
  });

  el.checkout?.addEventListener("click", () => {
    if (!items.length) return;
    const total = count();
    close({ restore: false });
    if (el.checkoutSummary) {
      el.checkoutSummary.textContent = `${total} ${total === 1 ? "item" : "items"} / ${formatPrice(subtotal())}`;
    }
    lock();
    el.checkoutDialog?.showModal();
    el.closeCheckout?.focus();
  });

  el.closeCheckout?.addEventListener("click", () => el.checkoutDialog?.close());
  el.checkoutDialog?.addEventListener("close", () => {
    unlock();
  });
  el.checkoutDialog?.addEventListener("cancel", () => {
    unlock();
  });

  el.drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables();
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

  sync();

  return {
    add,
    open,
    close,
    toggle,
    getCount: count,
    getSubtotal: subtotal,
  };
}
