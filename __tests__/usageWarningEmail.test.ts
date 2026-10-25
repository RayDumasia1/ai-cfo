import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
vi.mock("../lib/db", () => ({ consumeUsage: vi.fn(), markWarningSent: vi.fn() }));

import { consumeUsage, markWarningSent } from "../lib/db";
import { checkAndIncrementUsage } from "../lib/usageGate";
const client = {} as SupabaseClient;
const period = new Date("2026-10-01T00:00:00Z");
const check = () => checkAndIncrementUsage("own-user", "person@example.invalid", "ask_cfo_questions", "growth", period, client);
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  vi.mocked(consumeUsage).mockResolvedValue({ allowed: true, throttled: false,
    count: 100, usage_limit: 150, warning_sent_at: null });
  send.mockResolvedValue({ data: { id: "email_test" }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("usage warning email acceptance", () => {
  it("marks an accepted warning only after the provider acknowledges it", async () => {
    expect(await check()).toMatchObject({ allowed: true, used: 100 });
    expect(markWarningSent).toHaveBeenCalledWith("own-user", "ask_cfo_questions", period, client);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(markWarningSent).mock.invocationCallOrder[0]);
  });
  it.each(["rejected", "exception", "unconfirmed"])("does not mark a %s warning or block usage", async reason => {
    if (reason === "rejected") send.mockResolvedValue({ data: null, error: { name: "validation_error" } });
    if (reason === "exception") send.mockRejectedValue(new Error("Network error"));
    if (reason === "unconfirmed") send.mockResolvedValue({ data: {}, error: null });
    expect(await check()).toMatchObject({ allowed: true, used: 100 });
    expect(consumeUsage).toHaveBeenCalledOnce();
    expect(markWarningSent).not.toHaveBeenCalled();
  });
  it("retries on the next eligible request after failure and stops once marked", async () => {
    vi.mocked(consumeUsage)
      .mockResolvedValueOnce({ allowed: true, throttled: false, count: 100, usage_limit: 150, warning_sent_at: null })
      .mockResolvedValueOnce({ allowed: true, throttled: false, count: 101, usage_limit: 150, warning_sent_at: null })
      .mockResolvedValueOnce({ allowed: true, throttled: false, count: 102, usage_limit: 150, warning_sent_at: "2026-10-01T12:00:00Z" });
    send.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded" } });
    await check(); await check(); await check();
    expect(send).toHaveBeenCalledTimes(2);
    expect(markWarningSent).toHaveBeenCalledOnce();
    expect(send.mock.calls[1][0].subject).toContain("101 of your 150");
  });
  it("keeps usage successful when accepted-email bookkeeping fails", async () => {
    vi.mocked(markWarningSent).mockRejectedValue(new Error("Internal database detail"));
    expect(await check()).toMatchObject({ allowed: true, used: 100 });
    expect(console.error).toHaveBeenCalledWith("usageGate:warning:markFailed", { metric: "ask_cfo_questions" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Internal database detail");
  });
  it.each(["below threshold", "already marked"])("does not send for %s usage", async state => {
    vi.mocked(consumeUsage).mockResolvedValue({ allowed: true, throttled: false,
      count: state === "below threshold" ? 99 : 100,
      usage_limit: 150, warning_sent_at: state === "already marked" ? "2026-10-01" : null });
    await check();
    expect(send).not.toHaveBeenCalled();
    expect(markWarningSent).not.toHaveBeenCalled();
  });
  it("escapes the usage billing URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", 'https://app.example.invalid/a&b"');
    await check();
    expect(send.mock.calls[0][0].html).toContain("a&amp;b&quot;/dashboard/settings?tab=billing");
  });
});
