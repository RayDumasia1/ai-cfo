import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("../lib/db", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/db")>(),
  hasPaidSubscription: vi.fn(),
}));

import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { hasPaidSubscription, clearFinancialData } from "../lib/db";
import { DELETE } from "../app/api/data/route";

const getUser = vi.fn();
const rpc = vi.fn();
const from = vi.fn(() => { throw new Error("Clearing must use the transaction RPC"); });
const service = { rpc, from } as unknown as SupabaseClient;
const user = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
function request() {
  return new NextRequest("https://app.example.invalid/api/data?user_id=another-account", {
    method: "DELETE", body: JSON.stringify({ user_id: "another-account" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser }, from, rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createServiceClient).mockReturnValue(service);
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  rpc.mockResolvedValue({ data: { cleared: true,actorId:user.id,organizationId:"20000000-0000-4000-8000-000000000001" }, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("atomic clear-data route", () => {
  it.each(["missing", "invalid", "unverified", "unpaid"])("blocks %s access before service-role work", async condition => {
    if (condition === "missing") getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (condition === "invalid") getUser.mockResolvedValue({ data: { user }, error: new Error("Invalid session") });
    if (condition === "unverified") getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
    if (condition === "unpaid") rpc.mockResolvedValue({data:null,error:{code:"P0402"}});
    const response = await DELETE(request(), {});
    expect(response.status).toBe(condition === "unpaid" ? 402 : condition === "unverified" ? 403 : 401);
    expect(createServiceClient).not.toHaveBeenCalled();
    if(condition!=="unpaid")expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("clears only the validated account through one RPC, ignoring supplied account IDs", async () => {
    const response = await DELETE(request(), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("owned_monthly_operation", { p_operation:"clear",p_organization_id:null,p_request_id:expect.any(String) });
    expect(hasPaidSubscription).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["database error", "missing migration", "lost response"])("returns a safe error with no destructive fallback on %s", async reason => {
    if (reason === "lost response") rpc.mockRejectedValue(new Error("Internal network detail"));
    else rpc.mockResolvedValue({ data: null, error: { message: "Internal database detail", code: "test" } });
    const response = await DELETE(request(), {});
    expect(response.status).toBe(reason==="lost response"?500:503);
    const body = await response.json();
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.detail).toBeUndefined();
    expect(body.error).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("Internal");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("owned_monthly_operation", { p_operation:"clear",p_organization_id:null,p_request_id:expect.any(String) });
    expect(from).not.toHaveBeenCalled();
  });

  it("delegates target entitlement to SQL rather than checking a personal plan", async () => {
    vi.mocked(hasPaidSubscription).mockRejectedValue(new Error("Subscription lookup failed"));
    const response = await DELETE(request(), {});
    expect(response.status).toBe(200);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(hasPaidSubscription).not.toHaveBeenCalled();
  });

  it("rejects an unconfirmed RPC response instead of reporting success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await DELETE(request(), {})).status).toBe(503);
  });
});

describe("clearFinancialData adapter", () => {
  it("propagates the database failure", async () => {
    const failure = { code: "test", message: "Clear failed" };
    rpc.mockResolvedValue({ data: null, error: failure });
    await expect(clearFinancialData(user.id, service)).rejects.toMatchObject({reason:"unavailable"});
  });

  it.each([null, {}, { cleared: false }, { cleared: "true" }])("rejects an invalid acknowledgement: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(clearFinancialData(user.id, service)).rejects.toMatchObject({reason:"unavailable"});
  });
});
