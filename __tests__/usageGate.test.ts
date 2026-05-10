import { describe, it, expect, vi, afterEach } from "vitest";

// Suppress supabase client initialisation so lib/db.ts can be imported in Node
vi.mock("../lib/supabase", () => ({ supabase: {} }));

import { USAGE_LIMITS } from "../lib/featureGates";
import { getBillingPeriodStart } from "../lib/db";

// ─── USAGE_LIMITS ─────────────────────────────────────────────────────────────

describe("USAGE_LIMITS", () => {
  describe("ask_cfo_questions", () => {
    it("starter → 0", () =>
      expect(USAGE_LIMITS.starter.ask_cfo_questions).toBe(0));
    it("core → 20", () =>
      expect(USAGE_LIMITS.core.ask_cfo_questions).toBe(20));
    it("growth → 150", () =>
      expect(USAGE_LIMITS.growth.ask_cfo_questions).toBe(150));
    it("advisory → null (unlimited)", () =>
      expect(USAGE_LIMITS.advisory.ask_cfo_questions).toBeNull());
  });

  describe("ai_insight_runs", () => {
    it("core → 3", () =>
      expect(USAGE_LIMITS.core.ai_insight_runs).toBe(3));
    it("growth → null (unlimited)", () =>
      expect(USAGE_LIMITS.growth.ai_insight_runs).toBeNull());
  });
});

// ─── getBillingPeriodStart ─────────────────────────────────────────────────────

describe("getBillingPeriodStart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("created on 14th, today is 20th of same month → period starts 14th this month", () => {
    // Fix today to 2026-05-20
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));

    const createdAt = new Date("2026-04-14T00:00:00Z");
    const result = getBillingPeriodStart(createdAt);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(4); // May = 4
    expect(result.getUTCDate()).toBe(14);
  });

  it("created on 14th, today is 5th of next month → period starts 14th of last month", () => {
    // Fix today to 2026-05-05 (before the 14th)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T10:00:00Z"));

    const createdAt = new Date("2026-04-14T00:00:00Z");
    const result = getBillingPeriodStart(createdAt);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(3); // April = 3
    expect(result.getUTCDate()).toBe(14);
  });

  it("created on 31st, today is Mar 15 → period starts Feb 28 (last month, clamped)", () => {
    // Today is March 15. Billing day = 31. March has 31 days so billingDayThisMonth = 31.
    // Today (15) < 31, so period started last month (February).
    // February has 28 days, so billingDayLastMonth = min(31, 28) = 28.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:00:00Z"));

    const createdAt = new Date("2026-01-31T00:00:00Z");
    const result = getBillingPeriodStart(createdAt);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // February = 1
    expect(result.getUTCDate()).toBe(28);
  });
});
