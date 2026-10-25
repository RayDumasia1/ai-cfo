import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

import { getPlanNotificationFeatures } from "../lib/db";

describe("saved billing plan notifications", () => {
  it("loads only supported registrations for the requested account", async () => {
    const result = { data: [
      { feature: "tier_growth" },
      { feature: "tier_advisory" },
      { feature: "unexpected" },
    ], error: null };
    const inFilter = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ in: inFilter }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(getPlanNotificationFeatures("account-a", { from } as never))
      .resolves.toEqual(["tier_growth", "tier_advisory"]);
    expect(from).toHaveBeenCalledWith("notify_me");
    expect(eq).toHaveBeenCalledWith("user_id", "account-a");
    expect(inFilter).toHaveBeenCalledWith("feature", ["tier_growth", "tier_advisory"]);
  });

  it("does not hide a database failure", async () => {
    const failure = new Error("Unavailable");
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: null, error: failure }) }) }) }),
    };
    await expect(getPlanNotificationFeatures("account-a", client as never)).rejects.toBe(failure);
  });
});
