import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestAlertDismissal, DISMISS_ALERT_ERROR, DATA_RELOAD_DISMISS_ERROR } from "../lib/alertDismissal";
import { isAlertSnoozed } from "../lib/calculations";
import DismissibleAlert from "../app/components/DismissibleAlert";
import type { Alert, DismissedAlert, SnoozeType } from "../lib/types";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
  fetchMock.mockResolvedValue(Response.json({ success: true }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("confirmed dismissal requests", () => {
  it("sends the alert code and selected snooze, requiring API confirmation", async () => {
    await expect(requestAlertDismissal("RUNWAY_WARNING", "7d")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/alerts/dismiss", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_code: "RUNWAY_WARNING", snooze_type: "7d" }),
    });
  });
  it.each([400, 401, 402, 403, 500])("does not confirm HTTP %s failure", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: "Internal detail" }, { status }));
    await expect(requestAlertDismissal("RUNWAY_WARNING", "24h")).rejects.toThrow(DISMISS_ALERT_ERROR);
  });
  it("gives actionable guidance when data-reload snoozing has no data version", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Conflict" }, { status: 409 }));
    await expect(requestAlertDismissal("RUNWAY_WARNING", "data_reload")).rejects.toThrow(DATA_RELOAD_DISMISS_ERROR);
  });
  it.each([null, {}, { success: false }, { success: "true" }])("does not confirm an invalid success response: %j", async value => {
    fetchMock.mockResolvedValue(Response.json(value));
    await expect(requestAlertDismissal("RUNWAY_WARNING", "24h")).rejects.toThrow(DISMISS_ALERT_ERROR);
  });
  it.each(["network", "HTML"])("does not confirm %s failure", async condition => {
    if (condition === "network") fetchMock.mockRejectedValue(new Error("Internal details"));
    else fetchMock.mockResolvedValue(new Response("<html>Sign in</html>"));
    await expect(requestAlertDismissal("RUNWAY_WARNING", "24h")).rejects.toThrow(DISMISS_ALERT_ERROR);
  });
});

function record(alert_code: string, snooze_type: SnoozeType): DismissedAlert {
  return { id: "test", user_id: "own-user", alert_code, snooze_type, data_version: "version-1",
    snooze_until: "2026-10-30T15:00:00Z", dismissed_at: "2026-10-23T15:00:00Z", created_at: "2026-10-23T15:00:00Z" };
}
describe("danger protection and snooze expiry", () => {
  it.each(["RUNWAY_DANGER", "CASH_BELOW_RESERVE"])("keeps %s visible even if a stored dismissal exists", alert_code => {
    for (const snooze_type of ["24h", "7d", "data_reload"] as const) {
      expect(isAlertSnoozed(alert_code, [record(alert_code, snooze_type)], "version-1")).toBe(false);
    }
  });
  it("expires data-reload snoozes on a new version and never hides with a null version", () => {
    const dismissal = record("RUNWAY_WARNING", "data_reload");
    expect(isAlertSnoozed("RUNWAY_WARNING", [dismissal], "version-1")).toBe(true);
    expect(isAlertSnoozed("RUNWAY_WARNING", [dismissal], "version-2")).toBe(false);
    expect(isAlertSnoozed("RUNWAY_WARNING", [{ ...dismissal, data_version: null }], null)).toBe(false);
  });
  it("expires timed snoozes at their server-generated deadline", () => {
    const dismissal = record("RUNWAY_WARNING", "24h");
    expect(isAlertSnoozed("RUNWAY_WARNING", [dismissal], null)).toBe(true);
    vi.setSystemTime(new Date(dismissal.snooze_until!));
    expect(isAlertSnoozed("RUNWAY_WARNING", [dismissal], null)).toBe(false);
  });
  it.each(["danger", "warning"] as const)("does not render a dismissal control for a protected code with severity %s", severity => {
    const alert: Alert = { code: "RUNWAY_DANGER", severity, title: "Test", message: "Test" };
    const html = renderToStaticMarkup(createElement(DismissibleAlert, { alert, snoozeType: "24h", onDismissed: () => {} }));
    expect(html).not.toContain('aria-label="Dismiss');
    expect(html).not.toContain("<button");
  });
  it("keeps a warning's accessible dismissal control", () => {
    const alert: Alert = { code: "RUNWAY_WARNING", severity: "warning", title: "Test", message: "Test" };
    const html = renderToStaticMarkup(createElement(DismissibleAlert, { alert, snoozeType: "7d", onDismissed: () => {} }));
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Dismiss for 7 days"');
    expect(html).toContain('aria-busy="false"');
  });
});
