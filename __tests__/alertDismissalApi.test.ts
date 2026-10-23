import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ dismissAlert: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { dismissAlert } from "../lib/db";
import { POST } from "../app/api/alerts/dismiss/route";

const getUser = vi.fn();
const from = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const client = { auth: { getUser }, from };
const user = { id: "own-user", email_confirmed_at: "2026-10-01T00:00:00Z" };
const version = "2026-10-23T12:00:00Z";
const body = { alert_code: "RUNWAY_WARNING", snooze_type: "24h" };
function request(value = JSON.stringify(body)) {
  return new NextRequest("https://app.example.invalid/api/alerts/dismiss?user_id=another-user", { method: "POST", body: value });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  const builder = { select: vi.fn(() => builder), eq, maybeSingle };
  from.mockReturnValue(builder); eq.mockReturnValue(builder);
  maybeSingle.mockResolvedValue({ data: { data_version: version }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("alert dismissal API", () => {
  it.each(["{", "null", "[]", "true", "{}", '{"alert_code":true,"snooze_type":"24h"}',
    '{"alert_code":["RUNWAY_WARNING"],"snooze_type":"24h"}', '{"alert_code":"UNKNOWN","snooze_type":"24h"}',
    '{"alert_code":"RUNWAY_WARNING","snooze_type":"forever"}', '{"alert_code":"RUNWAY_WARNING","snooze_type":["24h"]}',
    '{"alert_code":"RUNWAY_WARNING","snooze_type":true}'])("rejects invalid input before database work: %s", async value => {
    expect((await POST(request(value), {})).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(dismissAlert).not.toHaveBeenCalled();
  });
  it.each(["RUNWAY_DANGER", "CASH_BELOW_RESERVE"])("never dismisses protected alert %s", async alert_code => {
    for (const snooze_type of ["24h", "7d", "data_reload"]) {
      expect((await POST(request(JSON.stringify({ alert_code, snooze_type })), {})).status).toBe(403);
    }
    expect(from).not.toHaveBeenCalled();
    expect(dismissAlert).not.toHaveBeenCalled();
  });
  it.each(["RUNWAY_WARNING", "BURN_RATE_SPIKE", "HIGH_AR", "REVENUE_GROWTH"])("dismisses supported code %s", async alert_code => {
    expect((await POST(request(JSON.stringify({ ...body, alert_code })), {})).status).toBe(200);
    expect(dismissAlert).toHaveBeenCalledWith(user.id, expect.objectContaining({ alert_code }), client);
  });
  it.each([
    ["24h", "2026-10-24T15:00:00.000Z"], ["7d", "2026-10-30T15:00:00.000Z"], ["data_reload", null],
  ])("computes %s snooze state on the server and ignores client identity/version/expiry", async (snooze_type, snooze_until) => {
    const response = await POST(request(JSON.stringify({ ...body, snooze_type, user_id: "another-user", data_version: "forged", snooze_until: "2099-01-01" })), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(eq).toHaveBeenCalledWith("user_id", user.id);
    expect(dismissAlert).toHaveBeenCalledExactlyOnceWith(user.id, {
      alert_code: "RUNWAY_WARNING", snooze_type, snooze_until, data_version: version,
    }, client);
  });
  it.each([null, { data_version: null }])("refuses an ineffective data-reload snooze when the profile/version is missing: %j", async data => {
    maybeSingle.mockResolvedValue({ data, error: null });
    expect((await POST(request(JSON.stringify({ ...body, snooze_type: "data_reload" })), {})).status).toBe(409);
    expect(dismissAlert).not.toHaveBeenCalled();
  });
  it("preserves timed snoozes when no data version exists", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await POST(request(), {})).status).toBe(200);
    expect(dismissAlert).toHaveBeenCalledWith(user.id, expect.objectContaining({ data_version: null }), client);
  });
  it.each(["lookup", "write"])("returns safe failure for a %s error", async operation => {
    const failure = { message: "Internal database detail" };
    if (operation === "lookup") maybeSingle.mockResolvedValue({ data: null, error: failure });
    else vi.mocked(dismissAlert).mockRejectedValue(failure);
    const response = await POST(request(), {});
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result).toMatchObject({ error: "Failed to dismiss alert.", requestId: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("Internal database detail");
    if (operation === "lookup") expect(dismissAlert).not.toHaveBeenCalled();
  });
  it.each(["missing", "invalid", "unverified"])("blocks %s Auth before input or data work", async condition => {
    getUser.mockResolvedValue({ data: { user: condition === "missing" ? null : condition === "unverified" ? { ...user, email_confirmed_at: null } : user },
      error: condition === "invalid" ? new Error("Invalid session") : null });
    const req = request();
    const parse = vi.spyOn(req, "json");
    expect((await POST(req, {})).status).toBe(condition === "unverified" ? 403 : 401);
    expect(parse).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(dismissAlert).not.toHaveBeenCalled();
  });
});
