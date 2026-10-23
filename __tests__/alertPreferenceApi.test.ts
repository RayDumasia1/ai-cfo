import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ getAlertPreferences: vi.fn(), updateAlertPreferences: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { getAlertPreferences, updateAlertPreferences } from "../lib/db";
import { GET, PATCH } from "../app/api/settings/preferences/route";

const getUser = vi.fn();
const client = { auth: { getUser } };
const user = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
function request(body = '{"snooze_duration":"24h"}') {
  return new NextRequest("https://app.example.invalid/api/settings/preferences?user_id=another-user", { method: "PATCH", body });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(getAlertPreferences).mockResolvedValue({ snooze_duration: "24h" });
});
afterEach(() => vi.restoreAllMocks());

describe("account-scoped preferences API", () => {
  it("reads only the authenticated account and disables response caching", async () => {
    const response = await GET(request(), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snooze_duration: "24h" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getAlertPreferences).toHaveBeenCalledExactlyOnceWith(user.id, client);
    expect(updateAlertPreferences).not.toHaveBeenCalled();
  });
  it.each(["data_reload", "24h", "7d"] as const)("saves only %s for the authenticated account", async snooze_duration => {
    const response = await PATCH(request(JSON.stringify({ snooze_duration, user_id: "another-user", feature_tier: "advisory" })), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(updateAlertPreferences).toHaveBeenCalledExactlyOnceWith(user.id, { snooze_duration }, client);
  });
  it.each(["{", "null", "[]", "true", "1", '"text"', "{}",
    '{"snooze_duration":null}', '{"snooze_duration":[]}', '{"snooze_duration":true}',
    '{"snooze_duration":"forever"}', '{"snooze_duration":"24H"}'])("rejects invalid JSON/body/value before writes: %s", async body => {
    expect((await PATCH(request(body), {})).status).toBe(400);
    expect(updateAlertPreferences).not.toHaveBeenCalled();
  });
  it.each(["missing", "invalid", "unverified"])("rejects %s Auth before reading or writing preferences", async condition => {
    getUser.mockResolvedValue({ data: { user: condition === "missing" ? null : condition === "unverified" ? { ...user, email_confirmed_at: null } : user },
      error: condition === "invalid" ? new Error("Invalid session") : null });
    const expected = condition === "unverified" ? 403 : 401;
    expect((await GET(request(), {})).status).toBe(expected);
    expect((await PATCH(request(), {})).status).toBe(expected);
    expect(getAlertPreferences).not.toHaveBeenCalled();
    expect(updateAlertPreferences).not.toHaveBeenCalled();
  });
  it.each(["GET", "PATCH"])("returns safe JSON on %s database failure", async method => {
    const failure = { message: "Internal database detail" };
    if (method === "GET") vi.mocked(getAlertPreferences).mockRejectedValue(failure);
    else vi.mocked(updateAlertPreferences).mockRejectedValue(failure);
    const response = await (method === "GET" ? GET(request(), {}) : PATCH(request(), {}));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("Internal database detail");
    expect(console.error).toHaveBeenCalledWith(`settings:preferences:${method === "GET" ? "load" : "save"}:error`, { userId: user.id, requestId: body.requestId });
  });
  it("rejects an invalid stored preference instead of returning unrecognized UI state", async () => {
    vi.mocked(getAlertPreferences).mockResolvedValue({ snooze_duration: "forever" } as never);
    expect((await GET(request(), {})).status).toBe(500);
    expect(updateAlertPreferences).not.toHaveBeenCalled();
  });
});
