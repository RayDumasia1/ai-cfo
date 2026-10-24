import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("../lib/db", () => ({ upsertBusinessProfile: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { upsertBusinessProfile } from "../lib/db";
import { GET, PATCH } from "../app/api/account/route";

const getUser = vi.fn();
const from = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const client = { auth: { getUser }, from };
const user = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
function request(body: unknown = { business_name: "Acme" }) {
  return new NextRequest("https://example.invalid/api/account?user_id=other", { method: "PATCH", body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as never);
  from.mockReturnValue({ select }); select.mockReturnValue({ eq }); eq.mockReturnValue({ maybeSingle });
  maybeSingle.mockResolvedValue({ data: { business_name: "Acme", created_at: "2026-10-01T00:00:00Z" }, error: null });
  vi.mocked(upsertBusinessProfile).mockResolvedValue({ user_id: user.id, business_name: "Acme" } as never);
  // Legacy update-only behavior can return no error even when no row matched.
  vi.mocked(createServiceClient).mockReturnValue({ from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("account profile API", () => {
  it.each([null, [], true, 2, "text", {}, { business_name: null }, { business_name: {} },
    { business_name: 123 }, { business_name: "x".repeat(201) }])("rejects invalid body %# before profile writes", async body => {
    expect((await PATCH(request(body), {})).status).toBe(400);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    const req = new NextRequest("https://example.invalid/api/account", { method: "PATCH", body: "{" });
    expect((await PATCH(req, {})).status).toBe(400);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it("writes only the normalized name and validated account with the session client", async () => {
    const response = await PATCH(request({ business_name: "  Acme  ", user_id: "other", min_cash_reserve: 999, plan: "advisory", email: "other@example.invalid" }), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, business_name: "Acme" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upsertBusinessProfile).toHaveBeenCalledExactlyOnceWith(user.id, { business_name: "Acme" }, client);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("creates a missing profile through upsert rather than confirming a zero-row update", async () => {
    expect((await PATCH(request(), {})).status).toBe(200);
    expect(upsertBusinessProfile).toHaveBeenCalledExactlyOnceWith(user.id, { business_name: "Acme" }, client);
  });
  it("preserves clearing the name using an empty string", async () => {
    vi.mocked(upsertBusinessProfile).mockResolvedValue({ user_id: user.id, business_name: null } as never);
    const response = await PATCH(request({ business_name: "  " }), {});
    expect(await response.json()).toEqual({ success: true, business_name: null });
    expect(upsertBusinessProfile).toHaveBeenCalledWith(user.id, { business_name: null }, client);
  });
  it("accepts a 200-character normalized name", async () => {
    const name = "x".repeat(200);
    vi.mocked(upsertBusinessProfile).mockResolvedValue({ user_id: user.id, business_name: name } as never);
    expect((await PATCH(request({ business_name: ` ${name} ` }), {})).status).toBe(200);
  });
  it.each([null, { user_id: "other", business_name: "Acme" }, { user_id: user.id, business_name: "Stale name" }])("does not confirm missing/mismatched persisted data %#", async value => {
    vi.mocked(upsertBusinessProfile).mockResolvedValue(value as never);
    expect((await PATCH(request(), {})).status).toBe(500);
  });
  it("returns only the authenticated account's profile fields with no caching", async () => {
    const response = await GET(request(), {});
    expect(await response.json()).toEqual({ business_name: "Acme", email: user.email, created_at: "2026-10-01T00:00:00Z" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(eq).toHaveBeenCalledExactlyOnceWith("user_id", user.id);
    expect(select).toHaveBeenCalledExactlyOnceWith("business_name, created_at");
  });
  it("returns empty profile metadata without creating a profile during GET", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await (await GET(request(), {})).json()).toEqual({ business_name: null, email: user.email, created_at: null });
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
  it.each(["missing", "invalid", "unverified"])("blocks %s sessions before profile operations", async kind => {
    getUser.mockResolvedValue({ data: { user: kind === "missing" ? null : {
      ...user, email_confirmed_at: kind === "unverified" ? null : user.email_confirmed_at,
    } }, error: kind === "invalid" ? new Error("Synthetic session error") : null });
    expect((await PATCH(request(), {})).status).toBe(kind === "unverified" ? 403 : 401);
    expect((await GET(request(), {})).status).toBe(kind === "unverified" ? 403 : 401);
    expect(upsertBusinessProfile).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it.each(["load", "save"])("keeps %s failures safe and correlated", async phase => {
    if (phase === "save") vi.mocked(upsertBusinessProfile).mockRejectedValue({ message: "Synthetic private DB error" });
    else maybeSingle.mockResolvedValue({ data: null, error: { message: "Synthetic private DB error" } });
    const response = await (phase === "save" ? PATCH(request(), {}) : GET(request(), {}));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.requestId).toEqual(expect.any(String));
    expect(console.error).toHaveBeenCalledWith(`account:profile:${phase}:error`, { requestId: body.requestId, userId: user.id });
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain("Synthetic private DB error");
  });
});
