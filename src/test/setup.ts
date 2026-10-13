// LocalStorage polyfill for node test environment
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

// Minimal document DOM mock for node test environment
if (typeof (globalThis as any).document === "undefined") {
  const attributes = new Map<string, string>();
  const classList = new Set<string>();

  (globalThis as any).document = {
    documentElement: {
      classList: {
        add: (cls: string) => classList.add(cls),
        remove: (cls: string) => classList.delete(cls),
        contains: (cls: string) => classList.has(cls),
        toggle: (cls: string, force?: boolean) => {
          if (force === true) classList.add(cls);
          else if (force === false) classList.delete(cls);
          else if (classList.has(cls)) classList.delete(cls);
          else classList.add(cls);
        },
      },
      setAttribute: (key: string, val: string) => attributes.set(key, val),
      getAttribute: (key: string) => attributes.get(key) ?? null,
      removeAttribute: (key: string) => attributes.delete(key),
    },
    getElementById: () => null,
    body: {
      appendChild: () => {},
      style: {},
    },
  };
}
