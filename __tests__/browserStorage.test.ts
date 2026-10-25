import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBrowserBoolean,
  readBrowserValue,
  removeBrowserValue,
  resetBrowserStorageFallback,
  writeBrowserValue,
} from "../lib/browserStorage";

function storage(overrides: Partial<Storage> = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
    ...overrides,
  };
}

beforeEach(() => resetBrowserStorageFallback());
afterEach(() => vi.unstubAllGlobals());

describe("safe browser storage", () => {
  it("does not retain values in a server process", () => {
    writeBrowserValue("localStorage", "account", "private");
    expect(readBrowserValue("localStorage", "account")).toBeNull();
  });

  it("uses native storage when available", () => {
    const localStorage = storage();
    vi.stubGlobal("window", { localStorage, sessionStorage: storage() });
    writeBrowserValue("localStorage", "key", "value");
    expect(localStorage.getItem("key")).toBe("value");
    expect(readBrowserValue("localStorage", "key")).toBe("value");
  });

  it("continues with memory when the storage property is blocked", () => {
    const blocked = Object.defineProperty({}, "sessionStorage", {
      get() { throw new Error("Storage blocked"); },
    });
    vi.stubGlobal("window", blocked);
    writeBrowserValue("sessionStorage", "session", "123");
    expect(readBrowserValue("sessionStorage", "session")).toBe("123");
    removeBrowserValue("sessionStorage", "session");
    expect(readBrowserValue("sessionStorage", "session")).toBeNull();
  });

  it("continues after quota and removal failures", () => {
    const localStorage = storage({
      setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
      removeItem: () => { throw new Error("Removal blocked"); },
    });
    vi.stubGlobal("window", { localStorage, sessionStorage: storage() });
    writeBrowserValue("localStorage", "optional", "true");
    expect(readBrowserBoolean("localStorage", "optional", false)).toBe(true);
    removeBrowserValue("localStorage", "optional");
    expect(readBrowserBoolean("localStorage", "optional", false)).toBe(false);
  });

  it("falls back safely for corrupt boolean values", () => {
    const localStorage = storage();
    localStorage.setItem("preference", "not-a-boolean");
    vi.stubGlobal("window", { localStorage, sessionStorage: storage() });
    expect(readBrowserBoolean("localStorage", "preference", true)).toBe(true);
    expect(readBrowserBoolean("localStorage", "preference", false)).toBe(false);
  });

  it("keeps account-scoped keys isolated", () => {
    vi.stubGlobal("window", { localStorage: storage(), sessionStorage: storage() });
    writeBrowserValue("localStorage", "banner_user_a", "true");
    expect(readBrowserBoolean("localStorage", "banner_user_a", false)).toBe(true);
    expect(readBrowserBoolean("localStorage", "banner_user_b", false)).toBe(false);
  });
});
