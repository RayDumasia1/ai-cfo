import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({
  getSubscription: vi.fn(), getBillingDetails: vi.fn(), getUsage: vi.fn(),
  incrementUsage: vi.fn(), markWarningSent: vi.fn(),
}));
vi.mock("../lib/emailDelivery", () => ({ sendEmail: vi.fn(), escapeHtml: (value: string) => value }));

import { createClient } from "../utils/supabase/server";
import { getSubscription, getBillingDetails, getUsage, incrementUsage, markWarningSent } from "../lib/db";
import { sendEmail } from "../lib/emailDelivery";
import { POST as askCfo } from "../app/api/ask-cfo/route";
import { POST as insights } from "../app/api/insights/route";
import type { FeatureTier } from "../lib/featureGates";

const getUser = vi.fn();
const client = { auth: { getUser } };
const user = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
const routes = [{ name: "ask-cfo", handler: askCfo }, { name: "insights", handler: insights }];
function request(name: string) {
  return new NextRequest(`https://example.invalid/api/${name}?user_id=other`, {
    method: "POST", body: JSON.stringify({ user_id: "other", plan: "advisory", question: "Test only" }),
  });
}
function tier(feature_tier: FeatureTier) {
  vi.mocked(getSubscription).mockResolvedValue({ feature_tier } as never);
  vi.mocked(getBillingDetails).mockResolvedValue({ feature_tier, billing_period_start: "2026-10-01T00:00:00Z" } as never);
}
function expectNoUsageSideEffects() {
  expect(incrementUsage).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
  expect(markWarningSent).not.toHaveBeenCalled();
  expect(getUsage).not.toHaveBeenCalled();
  expect(getBillingDetails).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPERUSER_EMAILS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as never);
  tier("core");
  vi.mocked(getUsage).mockResolvedValue({ count: 0, usage_limit: 20, warning_sent_at: null });
  vi.mocked(sendEmail).mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe.each(routes)("unavailable $name usage contract", ({ name, handler }) => {
  it.each(["core", "growth", "advisory"] as const)("returns non-cacheable 501 for eligible %s without quota reads or writes", async value => {
    tier(value);
    const response = await handler(request(name), {});
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: name === "ask-cfo" ? "Ask CFO is coming soon. This endpoint is not yet implemented."
        : "AI Insights is coming soon. This endpoint is not yet implemented.",
      code: "FEATURE_NOT_IMPLEMENTED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const header of ["X-Usage-Used", "X-Usage-Limit", "X-Usage-Throttled"]) {
      expect(response.headers.has(header)).toBe(false);
    }
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith("own-user", client);
    expectNoUsageSideEffects();
  });
  it.each(["starter", "suspended"] as const)("preserves the feature gate for %s", async value => {
    tier(value);
    const response = await handler(request(name), {});
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: "Feature not available on your plan", current_tier: value, upgrade_to: "core" });
    expectNoUsageSideEffects();
  });
  it.each(["missing", "invalid", "unverified"])("blocks %s authentication before subscription/usage work", async kind => {
    getUser.mockResolvedValue({ data: { user: kind === "missing" ? null : {
      ...user, email_confirmed_at: kind === "unverified" ? null : user.email_confirmed_at,
    } }, error: kind === "invalid" ? new Error("Invalid session") : null });
    const response = await handler(request(name), {});
    expect(response.status).toBe(kind === "unverified" ? 403 : 401);
    expect(getSubscription).not.toHaveBeenCalled();
    expectNoUsageSideEffects();
  });
  it("fails closed on subscription lookup failure without usage work", async () => {
    vi.mocked(getSubscription).mockRejectedValue(new Error("Synthetic private subscription error"));
    const response = await handler(request(name), {});
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Internal server error", requestId: expect.any(String) });
    expectNoUsageSideEffects();
  });
  it("does not replace the unavailable result with a monthly-limit error", async () => {
    vi.mocked(getUsage).mockResolvedValue({ count: 20, usage_limit: 20, warning_sent_at: null });
    expect((await handler(request(name), {})).status).toBe(501);
    expectNoUsageSideEffects();
  });
  it("leaves allowances untouched across repeated requests", async () => {
    const responses = await Promise.all([handler(request(name), {}), handler(request(name), {})]);
    expect(responses.map(response => response.status)).toEqual([501, 501]);
    expectNoUsageSideEffects();
  });
});

describe("unavailable Ask CFO warning/throttle prevention", () => {
  it("does not send a Growth warning at the threshold", async () => {
    tier("growth");
    vi.mocked(getUsage).mockResolvedValue({ count: 99, usage_limit: 150, warning_sent_at: null });
    expect((await askCfo(request("ask-cfo"), {})).status).toBe(501);
    expectNoUsageSideEffects();
  });
  it("does not schedule a fair-use delay above the Growth limit", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    tier("growth");
    vi.mocked(getUsage).mockResolvedValue({ count: 150, usage_limit: 150, warning_sent_at: null });
    const pending = askCfo(request("ask-cfo"), {});
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(501);
    expect(timer).not.toHaveBeenCalledWith(expect.any(Function), 5000);
    expectNoUsageSideEffects();
  });
});
