/* Saved shoes, kept next to the bag in localStorage.

   cart.js owns "aero:bag:v1"; this owns "aero:wishlist:v1" and follows the same
   read/write-through shape so both survive a blocked or full storage. */

const STORAGE_KEY = "aero:wishlist:v1";

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const write = (ids) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or a full quota: the session keeps working, it just will
    // not survive a reload.
  }
};

export function createWishlist({ announce } = {}) {
  let ids = read();
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn([...ids]));

  return {
    has: (id) => ids.includes(id),
    list: () => [...ids],
    count: () => ids.length,

    toggle(shoe) {
      const id = typeof shoe === "string" ? shoe : shoe?.id;
      if (!id) return false;
      const saved = ids.includes(id);
      ids = saved ? ids.filter((entry) => entry !== id) : [...ids, id];
      write(ids);
      emit();
      const name = typeof shoe === "string" ? id : shoe.name;
      announce?.(saved ? `${name} removed from saved.` : `${name} saved.`);
      return !saved;
    },

    subscribe(fn) {
      listeners.add(fn);
      fn([...ids]);
      return () => listeners.delete(fn);
    },
  };
}
