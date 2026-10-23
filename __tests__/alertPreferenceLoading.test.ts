import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AlertPreferencesCard from "../app/components/settings/AlertPreferencesCard";
import { loadAlertPreference, saveAlertPreference, LOAD_PREFERENCES_ERROR, SAVE_PREFERENCES_ERROR } from "../lib/alertPreferences";
import type { SnoozeType } from "../lib/types";

const fetchMock = vi.fn();
const getItem = vi.fn();
const removeItem = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { localStorage: { getItem, removeItem } });
  getItem.mockReturnValue("7d");
  fetchMock.mockResolvedValue(Response.json({ snooze_duration: "24h" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("account-scoped preference loading", () => {
  it("uses the server value without reading or migrating the browser-wide legacy value", async () => {
    expect(await loadAlertPreference()).toBe("24h");
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith("elidan_snooze_duration");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/settings/preferences", { cache: "no-store" });
  });
  it("reads each signed-in account's server response without an automatic preference write", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ snooze_duration: "24h" }))
      .mockResolvedValueOnce(Response.json({ snooze_duration: "data_reload" }));
    expect(await loadAlertPreference()).toBe("24h");
    expect(await loadAlertPreference()).toBe("data_reload");
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== "PATCH")).toBe(true);
    expect(getItem).not.toHaveBeenCalled();
  });
  it.each(["blocked storage", "removal failure"])("loads from the server despite %s", async condition => {
    if (condition === "blocked storage") {
      vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get() { throw new Error("Storage blocked"); } }));
    } else removeItem.mockImplementation(() => { throw new Error("Storage blocked"); });
    expect(await loadAlertPreference()).toBe("24h");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 402, 500])("does not fall back to another account's browser value on HTTP %s", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: "Internal detail" }, { status }));
    await expect(loadAlertPreference()).rejects.toThrow(LOAD_PREFERENCES_ERROR);
    expect(getItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([null, {}, { snooze_duration: "forever" }, { snooze_duration: null }])("rejects an invalid server response: %j", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(loadAlertPreference()).rejects.toThrow(LOAD_PREFERENCES_ERROR);
  });
  it("allows a later retry after a network failure without persisting a fallback", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));
    await expect(loadAlertPreference()).rejects.toThrow(LOAD_PREFERENCES_ERROR);
    expect(await loadAlertPreference()).toBe("24h");
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== "PATCH")).toBe(true);
  });
  it("does not treat login HTML as preferences", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Sign in</html>"));
    await expect(loadAlertPreference()).rejects.toThrow(LOAD_PREFERENCES_ERROR);
  });
  it("starts with save disabled while the account preference is loading", () => {
    const html = renderToStaticMarkup(createElement(AlertPreferencesCard));
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled");
    expect(html).toContain("Save preferences");
    expect(html).not.toContain('role="radiogroup"');
  });
});

describe("explicit preference saves", () => {
  it.each(["data_reload", "24h", "7d"] as const)("saves %s only with a confirmed response", async value => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    await expect(saveAlertPreference(value)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/settings/preferences", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snooze_duration: value }),
    });
  });
  it.each(["rejected", "network failure", "unconfirmed", "HTML"])("does not claim a saved preference on %s", async condition => {
    if (condition === "rejected") fetchMock.mockResolvedValue(Response.json({ error: "Internal detail" }, { status: 500 }));
    if (condition === "network failure") fetchMock.mockRejectedValue(new Error("Internal network detail"));
    if (condition === "unconfirmed") fetchMock.mockResolvedValue(Response.json({ success: false }));
    if (condition === "HTML") fetchMock.mockResolvedValue(new Response("<html>Sign in</html>"));
    await expect(saveAlertPreference("7d")).rejects.toThrow(SAVE_PREFERENCES_ERROR);
  });
  it("rejects an invalid runtime value without making a request", async () => {
    await expect(saveAlertPreference("forever" as SnoozeType)).rejects.toThrow(SAVE_PREFERENCES_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
