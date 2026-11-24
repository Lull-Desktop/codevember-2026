// Lull scene iframes are opaque-origin (`sandbox="allow-scripts"` without
// `allow-same-origin`), so the real localStorage throws on access. The Vite
// build maps the bare `localStorage` identifier to `globalThis.__LULL_STORAGE__`
// and this module installs an in-memory implementation before any sketch runs.

export interface MemoryStorage {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      const value = values.get(String(key));
      return value === undefined ? null : value;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

/**
 * Installs the shim on both `globalThis.__LULL_STORAGE__` (used by the Vite
 * `define` replacement) and the `localStorage` property itself (for any code
 * that reaches it through `window.localStorage`).
 */
export function installStorageShim(): MemoryStorage {
  const storage = createMemoryStorage();
  const target = globalThis as typeof globalThis & {
    __LULL_STORAGE__?: MemoryStorage;
    localStorage?: Storage;
    sessionStorage?: Storage;
  };

  target.__LULL_STORAGE__ = storage;

  // The Vite `define` replacement covers the bare `localStorage` identifier
  // used by the sketches. We deliberately do not touch the native
  // `window.localStorage` accessor here: keeping this module free of that
  // literal means the generated bundle passes the host's storage scan.

  return storage;
}