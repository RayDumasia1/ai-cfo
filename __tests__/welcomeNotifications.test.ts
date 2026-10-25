import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerFeatureNotification, NOTIFY_REGISTRATION_ERROR } from "../lib/notifyRegistration";
import { ComingSoonCard } from "../app/welcome/WelcomeClient";
import { ComingSoonPlanAction } from "../app/components/billing/PlanComparisonCard";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json({ success: true }));
});
afterEach(() => vi.unstubAllGlobals());

describe("welcome registration response handling", () => {
  it("posts the selected feature and confirms a saved registration", async () => {
    await expect(registerFeatureNotification("test@example.invalid", "tier_growth")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/notify-me", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.invalid", feature: "tier_growth" }),
    });
  });
  it.each([400, 401, 402, 403, 500])("surfaces a safe failure for HTTP %s instead of silently succeeding", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: "Internal server details" }, { status }));
    await expect(registerFeatureNotification("test@example.invalid", "tier_growth")).rejects.toThrow(NOTIFY_REGISTRATION_ERROR);
  });
  it.each([null, {}, { success: false }, { success: "true" }])("does not claim success for an unconfirmed response: %j", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(registerFeatureNotification("test@example.invalid", "tier_growth")).rejects.toThrow(NOTIFY_REGISTRATION_ERROR);
  });
  it("handles a login/SSO HTML response without claiming registration success", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 }));
    await expect(registerFeatureNotification("test@example.invalid", "tier_growth")).rejects.toThrow(NOTIFY_REGISTRATION_ERROR);
  });
  it("turns network failure into a retryable user-facing error", async () => {
    fetchMock.mockRejectedValue(new Error("Internal network details"));
    await expect(registerFeatureNotification("test@example.invalid", "tier_growth")).rejects.toThrow(NOTIFY_REGISTRATION_ERROR);
  });
});

const props = {
  tier: { key: "tier_growth" as const, name: "Growth", price: 199, features: [] },
  notified: false, pending: false, disabled: false, onNotify: () => {},
};
describe("welcome notification card feedback", () => {
  it("shows an error tied to the still-available retry button", () => {
    const html = renderToStaticMarkup(createElement(ComingSoonCard, { ...props, error: NOTIFY_REGISTRATION_ERROR }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="tier_growth-notify-error"');
    expect(html).toContain('aria-describedby="tier_growth-notify-error"');
    expect(html).toContain("Please try again.");
    expect(html).toContain("Notify me when available");
    expect(html).not.toContain("disabled");
  });
  it("announces loading and disables the pending button", () => {
    const html = renderToStaticMarkup(createElement(ComingSoonCard, { ...props, pending: true }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Adding you...");
    expect(html).toContain("disabled");
  });
  it("prevents another card submission while one is pending", () => {
    const html = renderToStaticMarkup(createElement(ComingSoonCard, { ...props, disabled: true }));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("Adding you...");
  });
  it("announces confirmed success instead of displaying stale errors", () => {
    const html = renderToStaticMarkup(createElement(ComingSoonCard, { ...props, notified: true, error: NOTIFY_REGISTRATION_ERROR }));
    expect(html).toContain('role="status"');
    expect(html).toContain("on the list");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Notify me when available");
  });
});

describe("billing plan notification feedback", () => {
  it("offers notification registration for an unavailable plan", () => {
    const html = renderToStaticMarkup(createElement(ComingSoonPlanAction, {
      plan: "growth",
      userEmail: "test@example.invalid",
    }));
    expect(html).toContain("Coming soon");
    expect(html).toContain("Notify me");
    expect(html).toContain('aria-busy="false"');
  });
});
