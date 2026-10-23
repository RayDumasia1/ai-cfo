import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ upsertBusinessProfile: vi.fn() }));

import { createClient } from "../utils/supabase/server";
import { upsertBusinessProfile } from "../lib/db";
import { PATCH } from "../app/api/settings/route";

const getUser = vi.fn();
const client = { auth: { getUser } };
const user = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
const valid = { runway_warning_threshold: 6, runway_danger_threshold: 3, min_cash_reserve: 5000, burn_rate_warning_pct: 10 };
function request(body: string) {
  return new NextRequest("https://app.example.invalid/api/settings?user_id=another-user", { method: "PATCH", body });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
});
afterEach(() => vi.restoreAllMocks());

describe("financial threshold API validation", () => {
  it.each(["{", "null", "[]", "true", "5", '"text"', "{}"])("returns 400 for malformed or incomplete input: %s", async body => {
    const response = await PATCH(request(body), {});
    expect(response.status).toBe(400);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it.each(["runway_warning_threshold", "runway_danger_threshold", "min_cash_reserve", "burn_rate_warning_pct"])("rejects coercible non-number values for %s before writing", async field => {
    for (const value of [null, false, true, [], [4], "", "6", "Infinity", {}]) {
      const response = await PATCH(request(JSON.stringify({ ...valid, [field]: value })), {});
      expect(response.status, `${field}: ${JSON.stringify(value)}`).toBe(400);
    }
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it.each(["runway_warning_threshold", "runway_danger_threshold", "min_cash_reserve", "burn_rate_warning_pct"])("rejects a JSON number overflowing to Infinity for %s", async field => {
    // JSON.parse accepts this numeric literal but produces Infinity. Sending
    // JSON.stringify(Infinity) would instead test null, not the overflow case.
    const body = JSON.stringify({ ...valid, [field]: "overflow" }).replace('"overflow"', "1e400");
    expect((await PATCH(request(body), {})).status).toBe(400);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it.each([
    { runway_warning_threshold: 0 }, { runway_warning_threshold: -1 },
    { runway_danger_threshold: 0 }, { runway_danger_threshold: -1 },
    { min_cash_reserve: -1 }, { burn_rate_warning_pct: 0 }, { burn_rate_warning_pct: -1 },
    { runway_danger_threshold: 6 }, { runway_danger_threshold: 7 },
    { burn_rate_warning_pct: Number.MIN_VALUE },
  ])("rejects invalid ranges or percentage underflow: %j", async patch => {
    expect((await PATCH(request(JSON.stringify({ ...valid, ...patch })), {})).status).toBe(400);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it("keeps the current percentage conversion and writes only allowed fields for the authenticated account", async () => {
    const response = await PATCH(request(JSON.stringify({ ...valid, user_id: "another-user", business_name: "Injected", feature_tier: "advisory" })), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(upsertBusinessProfile).toHaveBeenCalledExactlyOnceWith(user.id, {
      runway_warning_threshold: 6, runway_danger_threshold: 3, min_cash_reserve: 5000, burn_rate_warning_pct: 0.1,
    }, client);
  });
  it("accepts zero cash reserve, fractional months, and percentage increases above 100", async () => {
    expect((await PATCH(request(JSON.stringify({ ...valid, runway_warning_threshold: 6.5,
      runway_danger_threshold: 2.5, min_cash_reserve: 0, burn_rate_warning_pct: 150 })), {})).status).toBe(200);
    expect(upsertBusinessProfile).toHaveBeenCalledWith(user.id, expect.objectContaining({ min_cash_reserve: 0, burn_rate_warning_pct: 1.5 }), client);
  });
  it.each(["missing", "invalid", "unverified"])("rejects %s authentication before parsing or writing thresholds", async condition => {
    getUser.mockResolvedValue({ data: { user: condition === "missing" ? null : condition === "unverified" ? { ...user, email_confirmed_at: null } : user },
      error: condition === "invalid" ? new Error("Invalid session") : null });
    const req = request(JSON.stringify(valid));
    const parse = vi.spyOn(req, "json");
    expect((await PATCH(req, {})).status).toBe(condition === "unverified" ? 403 : 401);
    expect(parse).not.toHaveBeenCalled();
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it.each([new Error("Internal database detail"), { code: "23514", message: "Internal database detail" }])("returns safe JSON on database failure", async failure => {
    vi.mocked(upsertBusinessProfile).mockRejectedValue(failure);
    const response = await PATCH(request(JSON.stringify(valid)), {});
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "Failed to save thresholds.", requestId: expect.any(String) });
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Internal database detail");
    expect(console.error).toHaveBeenCalledWith("settings:thresholds:save:error", expect.objectContaining({ userId: user.id, requestId: body.requestId }));
  });
});
