import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("../lib/db", () => ({ getBusinessProfile: vi.fn(), hasPaidSubscription: vi.fn(), getSubscription: vi.fn(), quickBooksLifecycle: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { getBusinessProfile, getSubscription, hasPaidSubscription, quickBooksLifecycle } from "../lib/db";
import { GET as status, POST } from "../app/api/integrations/quickbooks/connection/route";
import { GET as callback } from "../app/api/integrations/quickbooks/callback/route";
import { oauthHash, oauthNonce, openTokens, quickBooksConfig, sealTokens } from "../lib/quickbooks";
const origin = "https://preview.invalid", nonce = oauthNonce(), state = oauthNonce();
const c = { id: "connection", businessId: "business", generation: "generation", realmId: "123", environment: "sandbox" as const, companyName: "Sandbox company", status: "connected" as const, operationId: "op", credentialRevision: 1, connectedAt: "2026-10-28", disconnectedAt: null };
const getUser = vi.fn(), fetcher = vi.fn(), lifecycle = vi.mocked(quickBooksLifecycle);
function request(action: string, at = origin, body?: object) { return new NextRequest(`${origin}/api/integrations/quickbooks/connection`, { method: "POST", headers: { Origin: at }, body: JSON.stringify(body ?? { action }) }); }
function cb(query = `state=${state}&code=private-code&realmId=123`, cookie: string | null = nonce) { return new NextRequest(`${origin}/api/integrations/quickbooks/callback?${query}`, { headers: cookie ? { Cookie: `elidan_qbo_nonce=${cookie}` } : {} }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher);
  for (const [key, value] of Object.entries({ SUPERUSER_EMAILS: "", QUICKBOOKS_CLIENT_ID: "client", QUICKBOOKS_CLIENT_SECRET: "private-secret", QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_REDIRECT_URI: `${origin}/api/integrations/quickbooks/callback`, QUICKBOOKS_ACTIVE_TOKEN_KEY_ID: "k1", QUICKBOOKS_TOKEN_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 1).toString("base64") }) })) vi.stubEnv(key, value);
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser } } as never);
  getUser.mockResolvedValue({ data: { user: { id: "owner", email: "owner@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  vi.mocked(getBusinessProfile).mockResolvedValue({ id: "business" } as never); vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "core" } as never); vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  lifecycle.mockResolvedValue(c);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("QuickBooks HTTP authorization boundary", () => {
  it("requires a verified session before connection work", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await POST(request("connect"), {})).status).toBe(401); expect(lifecycle).not.toHaveBeenCalled();
    getUser.mockResolvedValue({ data: { user: { id: "owner", email: "unverified" } } }); expect((await callback(cb(), {})).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces paid Core, current workspace, origin and request shape before provider calls", async () => {
    expect((await POST(request("connect", "https://attacker.invalid"), {})).status).toBe(403);
    expect((await POST(request("connect", origin, { action: "connect", businessId: "other" }), {})).status).toBe(400);
    vi.mocked(hasPaidSubscription).mockResolvedValue(false); expect((await POST(request("connect"), {})).status).toBe(402);
    vi.mocked(hasPaidSubscription).mockResolvedValue(true); vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "starter" } as never); expect((await POST(request("connect"), {})).status).toBe(402);
    vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "core" } as never); vi.mocked(getBusinessProfile).mockResolvedValue(null); expect((await POST(request("connect"), {})).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled(); expect(lifecycle).not.toHaveBeenCalled();
  });
  it("stores only nonce hashes and sets the browser-binding cookie", async () => {
    const r = await POST(request("connect"), {}); expect(r.status).toBe(200);
    const url = new URL((await r.json()).authorizationUrl); const stateValue = url.searchParams.get("state")!;
    const cookie = r.headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=lax");
    const browser = cookie.match(/elidan_qbo_nonce=([^;]+)/)![1];
    expect(lifecycle).toHaveBeenCalledWith("owner", "business", "start", { stateHash: oauthHash(stateValue), browserHash: oauthHash(browser) }, expect.anything());
    expect(JSON.stringify(lifecycle.mock.calls)).not.toContain("private-secret"); expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("returns only safe metadata even when a service response contains credentials", async () => {
    lifecycle.mockResolvedValue({ ...c, envelope: { ciphertext: "private-ciphertext" } } as never);
    const r = await status(request("read"), {}); const data = await r.json();
    expect(data.syncAvailable).toBe(false); expect(data.connection.companyName).toBe("Sandbox company");
    expect(JSON.stringify(data)).not.toMatch(/ciphertext|generation|realmId|operationId|private-/);
  });
  it("rejects absent nonce and repeated callback parameters without exchanging tokens", async () => {
    for (const req of [cb(undefined, null), cb(`state=${state}&state=${state}&code=x&realmId=123`), cb("state=bad&code=x&realmId=123")]) expect((await callback(req, {})).headers.get("location")).toBe(`${origin}/dashboard/settings?tab=connections&quickbooks=failed`);
    expect(fetcher).not.toHaveBeenCalled(); expect(lifecycle).not.toHaveBeenCalled();
  });
  it("consumes state before exchange, encrypts tokens and verifies the bound company", async () => {
    const order: string[] = []; lifecycle.mockImplementation(async (_a, _b, action) => { order.push(action); return c; });
    fetcher.mockImplementation(async (url: string) => { order.push(url.includes("tokens/bearer") ? "token" : "company"); return url.includes("tokens/bearer") ? Response.json({ token_type: "bearer", access_token: "private-access", refresh_token: "private-refresh", expires_in: 3600, x_refresh_token_expires_in: 86400 }) : Response.json({ CompanyInfo: { Id: "123", CompanyName: "Test company" } }); });
    const r = await callback(cb(), {}); expect(order).toEqual(["claim", "token", "store_grant", "company", "verify"]);
    expect(r.headers.get("location")).toBe(`${origin}/dashboard/settings?tab=connections&quickbooks=connected`); expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    const input = lifecycle.mock.calls.find(call => call[2] === "store_grant")![3];
    expect(JSON.stringify(input)).not.toMatch(/private-access|private-refresh/);
    expect(openTokens(input.envelope as never, { businessId: "business", connectionId: "connection", generation: "generation", realmId: "123", environment: "sandbox" }, quickBooksConfig()).refreshToken).toBe("private-refresh");
  });
  it("does not exchange replayed, mismatched or expired intents", async () => {
    lifecycle.mockRejectedValue(Object.assign(new Error("invalid intent"), { code: "55000" }));
    const r = await callback(cb(), {}); expect(r.headers.get("location")).toContain("quickbooks=failed"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("consumes an authorized denial and never reflects Intuit error descriptions", async () => {
    const r = await callback(cb(`state=${state}&error=access_denied&error_description=private-text`), {});
    expect(r.headers.get("location")).toContain("quickbooks=cancelled"); expect(lifecycle.mock.calls[0][2]).toBe("cancel_intent"); expect(fetcher).not.toHaveBeenCalled(); expect(await r.text()).not.toContain("private-text");
  });
  it("retains a failed exchange as requiring attention without retrying the code", async () => {
    fetcher.mockRejectedValue(new Error("private-refresh details")); const r = await callback(cb(), {});
    expect(fetcher).toHaveBeenCalledTimes(1); expect(lifecycle.mock.calls.map(c => c[2])).toEqual(["claim", "fail"]); expect(r.headers.get("location")).toContain("quickbooks=failed"); expect(await r.text()).not.toContain("private-");
  });
  it("allows downgrade disconnect and retains revocation retry if the provider is unavailable", async () => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(false); vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "starter" } as never);
    const t = { accessToken: "a", refreshToken: "r", accessExpiresAt: "2099-01-01", refreshExpiresAt: "2099-02-01", hardExpiresAt: null };
    lifecycle.mockResolvedValue({ ...c, generation: "new-generation", credentialGeneration: "generation", status: "revoking", envelope: sealTokens(t, { businessId: "business", connectionId: "connection", generation: "generation", realmId: "123", environment: "sandbox" }, quickBooksConfig()) });
    fetcher.mockRejectedValue(new Error("down")); expect((await POST(request("disconnect"), {})).status).toBe(200);
    expect(lifecycle.mock.calls.map(c => c[2])).toEqual(["disconnect_claim", "disconnect_fail"]); expect(hasPaidSubscription).not.toHaveBeenCalled();
  });
  it("still fences local access when the encryption configuration is unavailable", async () => {
    vi.stubEnv("QUICKBOOKS_TOKEN_KEYS", "");
    lifecycle.mockResolvedValue({ ...c, status: "revoking", envelope: { version: 1 } } as never);
    const r = await POST(request("disconnect"), {}); expect(r.status).toBe(200);
    expect(lifecycle.mock.calls.map(c => c[2])).toEqual(["disconnect_claim", "disconnect_fail"]); expect(fetcher).not.toHaveBeenCalled();
  });
  it("stores the rotated refresh grant and marks failures without leaking provider details", async () => {
    const t = { accessToken: "a", refreshToken: "r", accessExpiresAt: "2099-01-01", refreshExpiresAt: "2099-02-01", hardExpiresAt: null };
    lifecycle.mockResolvedValue({ ...c, status: "refreshing", envelope: sealTokens(t, { businessId: "business", connectionId: "connection", generation: "generation", realmId: "123", environment: "sandbox" }, quickBooksConfig()) });
    fetcher.mockResolvedValue(Response.json({ token_type: "bearer", access_token: "new-a", refresh_token: "new-r", expires_in: 3600, x_refresh_token_expires_in: 86400 }));
    expect((await POST(request("refresh"), {})).status).toBe(200); expect(lifecycle.mock.calls.map(c => c[2])).toEqual(["refresh_claim", "refresh_finish"]);
    lifecycle.mockClear(); fetcher.mockRejectedValue(new Error("private-details")); const r = await POST(request("refresh"), {}); expect(r.status).toBe(502); expect(lifecycle.mock.calls.map(c => c[2])).toEqual(["refresh_claim", "fail"]); expect(await r.text()).not.toContain("private-details");
  });
});
