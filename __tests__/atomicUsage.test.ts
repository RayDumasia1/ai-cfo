import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("../lib/emailDelivery", () => ({ sendEmail, escapeHtml: (value: string) => value }));

import { consumeUsage } from "../lib/db";
import { checkAndIncrementUsage } from "../lib/usageGate";

const period = new Date("2026-10-01T00:00:00Z");

describe("atomic usage database adapter", () => {
  const rpc = vi.fn();
  const client = { rpc } as unknown as SupabaseClient;

  beforeEach(() => vi.resetAllMocks());

  it("returns the database's committed quota decision and count", async () => {
    rpc.mockResolvedValue({ data: { allowed: true, throttled: false, count: 20,
      usage_limit: 20, warning_sent_at: null }, error: null });

    await expect(consumeUsage("own-user", "ask_cfo_questions", period,
      new Date("2026-11-01T00:00:00Z"), 20, false, client)).resolves.toEqual({
      allowed: true, throttled: false, count: 20, usage_limit: 20, warning_sent_at: null,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("consume_usage", {
      p_user_id: "own-user", p_metric: "ask_cfo_questions",
      p_period_start: "2026-10-01T00:00:00.000Z", p_period_end: "2026-11-01T00:00:00.000Z",
      p_usage_limit: 20, p_allow_overage: false,
    });
  });

  it("does not call the database for unlimited usage", async () => {
    await expect(consumeUsage("own-user", "ai_insight_runs", period,
      new Date("2026-11-01T00:00:00Z"), null, false, client)).resolves.toMatchObject({
      allowed: true, count: 0, usage_limit: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { allowed: true, throttled: false, count: -1, usage_limit: 20, warning_sent_at: null },
    { allowed: true, throttled: false, count: 1, usage_limit: 999, warning_sent_at: null },
  ])("rejects a malformed atomic result: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(consumeUsage("own-user", "ask_cfo_questions", period,
      new Date("2026-11-01T00:00:00Z"), 20, false, client)).rejects.toThrow("Invalid usage consumption result");
  });

  it("propagates database failures", async () => {
    const error = new Error("Synthetic database failure");
    rpc.mockResolvedValue({ data: null, error });
    await expect(consumeUsage("own-user", "ask_cfo_questions", period,
      new Date("2026-11-01T00:00:00Z"), 20, false, client)).rejects.toBe(error);
  });
});

describe("atomic usage gate decisions", () => {
  const rpc = vi.fn();
  const client = { rpc } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.resetAllMocks();
    sendEmail.mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  it("returns a hard-limit response without inventing another usage unit", async () => {
    rpc.mockResolvedValue({ data: { allowed: false, throttled: false, count: 20,
      usage_limit: 20, warning_sent_at: null }, error: null });
    const result = await checkAndIncrementUsage(
      "own-user", "person@example.invalid", "ask_cfo_questions", "core", period, client
    );
    expect(result).toMatchObject({ allowed: false, throttled: false, used: 20, limit: 20 });
    expect(result.response?.status).toBe(429);
    expect(await result.response?.json()).toMatchObject({ used: 20, limit: 20 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses the committed overage count and applies the Growth throttle", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: { allowed: true, throttled: true, count: 151,
      usage_limit: 150, warning_sent_at: "2026-10-20T00:00:00Z" }, error: null });
    const pending = checkAndIncrementUsage(
      "own-user", "person@example.invalid", "ask_cfo_questions", "growth", period, client
    );
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ allowed: true, throttled: true, used: 151, limit: 150 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps unlimited tiers untracked", async () => {
    await expect(checkAndIncrementUsage(
      "own-user", "person@example.invalid", "ai_insight_runs", "growth", period, client
    )).resolves.toEqual({ allowed: true, throttled: false, used: 0, limit: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

