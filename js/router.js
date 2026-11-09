/* AERO view routing.

   Two views share the page: home (the scrolling site) and hangar (the 3D
   showroom, full viewport). Section links like #materials are not routes, they
   are anchors inside home, so the router sends them home first and then scrolls.

   The hash is the single source of truth, which is what makes the browser's
   back and forward buttons work without any extra bookkeeping. */

const HOME = "home";
const ROUTES = new Set([HOME, "hangar"]);
const WIPE_MS = 800;

const routeFromHash = (hash) => {
  const key = (hash || "").replace(/^#/, "");
  return ROUTES.has(key) ? key : null;
};

export function createRouter({ views, onEnter, onLeave, reduced = false, scrollTo }) {
  const nodes = new Map(Object.entries(views));
  const wipe = document.createElement("div");
  wipe.className = "view-wipe";
  wipe.setAttribute("aria-hidden", "true");
  document.body.appendChild(wipe);

  let current = HOME;
  let busy = false;
  let pendingSection = null;
  let queued = null;

  const show = (name) => {
    for (const [key, node] of nodes) {
      const active = key === name;
      node.hidden = !active;
      node.classList.toggle("is-active", active);
      // Nothing in a hidden view should be reachable by Tab or a screen reader.
      node.inert = !active;
    }
    document.documentElement.dataset.view = name;
  };

  const settle = (name) => {
    show(name);
    current = name;
    onEnter?.(name);
    if (name === HOME && pendingSection) {
      const target = document.getElementById(pendingSection);
      pendingSection = null;
      if (target) requestAnimationFrame(() => scrollTo?.(target));
    }
  };

  async function go(name, { push = true, section = null } = {}) {
    const next = ROUTES.has(name) ? name : HOME;
    if (section) pendingSection = section;

    if (push) {
      const hash = `#${next === HOME && section ? section : next}`;
      if (window.location.hash !== hash) {
        window.history.pushState({ route: next, section }, "", hash);
      }
    }

    if (next === current) {
      if (next === HOME && pendingSection) settle(HOME);
      return;
    }
    if (busy) {
      // Back and forward in quick succession must not be swallowed; run the
      // latest request once the wipe finishes.
      queued = { name: next, section };
      return;
    }

    const from = current;
    onLeave?.(from);

    if (reduced) {
      settle(next);
      return;
    }

    busy = true;
    // A light wipe rather than a slide: the two views have nothing in common
    // spatially, so covering the swap reads better than moving between them.
    wipe.classList.add("is-on");
    await new Promise((resolve) => setTimeout(resolve, WIPE_MS * 0.45));
    settle(next);
    await new Promise((resolve) => setTimeout(resolve, WIPE_MS * 0.1));
    wipe.classList.remove("is-on");
    await new Promise((resolve) => setTimeout(resolve, WIPE_MS * 0.45));
    busy = false;
    if (queued) {
      const run = queued;
      queued = null;
      go(run.name, { push: false, section: run.section });
    }
  }

  const fromLocation = ({ push = false } = {}) => {
    const key = (window.location.hash || "").replace(/^#/, "");
    const route = routeFromHash(window.location.hash);
    if (route) return go(route, { push });
    // Any other hash is a section on the home view.
    return go(HOME, { push, section: key || null });
  };

  window.addEventListener("popstate", () => fromLocation({ push: false }));

  // One delegated listener covers the nav, the mobile menu, the hero CTA and
  // anything else that opts in with data-route.
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-route], [data-section]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    const route = link.dataset.route;
    const section = link.dataset.section;
    if (!route && !section) return;
    event.preventDefault();
    go(route || HOME, { section: section || null });
  });

  show(HOME);
  document.documentElement.dataset.view = HOME;

  return {
    go,
    fromLocation,
    get current() { return current; },
    isHangar: () => current === "hangar",
  };
}

/* The pill nav: a sliding indicator, an active tab that tracks either the
   route or the section in view, and a header that gets out of the way when
   you scroll down. */
export function createNav({ nav, indicator, header, router, reduced = false }) {
  if (!nav) return { setActive() {}, refresh() {} };
  const links = [...nav.querySelectorAll(".nav__link")];

  const move = (link) => {
    if (!indicator) return;
    if (!link) {
      indicator.style.opacity = "0";
      return;
    }
    const navBox = nav.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    indicator.style.opacity = "1";
    indicator.style.width = `${box.width}px`;
    indicator.style.transform = `translateX(${box.left - navBox.left}px)`;
  };

  const setActive = (key) => {
    let match = null;
    for (const link of links) {
      const own = link.dataset.route || link.dataset.section;
      const active = own === key;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
        match = link;
      } else {
        link.removeAttribute("aria-current");
      }
    }
    move(match);
  };

  // While scrolling home, the active tab follows the section crossing the
  // upper third of the viewport.
  const sections = links
    .filter((l) => l.dataset.section)
    .map((l) => ({ key: l.dataset.section, node: document.getElementById(l.dataset.section) }))
    .filter((entry) => entry.node);

  const syncToScroll = () => {
    if (router.isHangar()) return;
    const line = window.innerHeight * 0.34;
    let found = "home";
    for (const { key, node } of sections) {
      if (node.getBoundingClientRect().top <= line) found = key;
    }
    setActive(found);
  };

  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (header && !router.isHangar()) {
      const down = y > lastY && y > 160;
      header.classList.toggle("is-tucked", down && !reduced);
    }
    lastY = y;
    syncToScroll();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    const active = nav.querySelector(".nav__link.is-active");
    move(active);
  });

  return {
    setActive,
    refresh() {
      header?.classList.remove("is-tucked");
      if (router.isHangar()) setActive("hangar");
      else syncToScroll();
    },
  };
}
