type StorageKind = "localStorage" | "sessionStorage";

const memoryFallback: Record<StorageKind, Map<string, string>> = {
  localStorage: new Map(),
  sessionStorage: new Map(),
};

function browserStorage(kind: StorageKind): Storage | null {
  try { return window[kind]; }
  catch { return null; }
}

export function readBrowserValue(kind: StorageKind, key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = browserStorage(kind)?.getItem(key);
    if (stored !== null && stored !== undefined) return stored;
  } catch {
    // Access may be blocked by browser privacy policy.
  }
  return memoryFallback[kind].get(key) ?? null;
}

export function writeBrowserValue(kind: StorageKind, key: string, value: string): void {
  if (typeof window === "undefined") return;
  memoryFallback[kind].set(key, value);
  try { browserStorage(kind)?.setItem(key, value); }
  catch {
    // Quota and privacy failures fall back to memory.
  }
}

export function removeBrowserValue(kind: StorageKind, key: string): void {
  if (typeof window === "undefined") return;
  memoryFallback[kind].delete(key);
  try { browserStorage(kind)?.removeItem(key); }
  catch {
    // Logout and UI behavior must continue when removal is blocked.
  }
}

export function readBrowserBoolean(kind: StorageKind, key: string, fallback: boolean): boolean {
  const value = readBrowserValue(kind, key);
  return value === "true" ? true : value === "false" ? false : fallback;
}

export function resetBrowserStorageFallback(): void {
  memoryFallback.localStorage.clear();
  memoryFallback.sessionStorage.clear();
}
