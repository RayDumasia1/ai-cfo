import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizationUrl, companyInfo, oauthHash, oauthNonce, openTokens, quickBooksConfig, requestTokens, revokeTokens, sealTokens, validOAuthNonce, type CredentialScope } from "../lib/quickbooks";
const env = { NODE_ENV: "development", QUICKBOOKS_CLIENT_ID: "client", QUICKBOOKS_CLIENT_SECRET: "secret", QUICKBOOKS_REDIRECT_URI: "http://localhost:3000/api/integrations/quickbooks/callback", QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_ACTIVE_TOKEN_KEY_ID: "k1", QUICKBOOKS_TOKEN_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 1).toString("base64") }) };
const scope: CredentialScope = { businessId: "business", connectionId: "connection", generation: "epoch", realmId: "123", environment: "sandbox" };
const tokens = { accessToken: "private-access", refreshToken: "private-refresh", accessExpiresAt: "2026-10-28T11:00:00Z", refreshExpiresAt: "2026-12-28T11:00:00Z", hardExpiresAt: null };
const fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe("QuickBooks credential boundary", () => {
  it("requires explicit sandbox configuration and an exact safe callback", () => {
    expect(quickBooksConfig(env).origin).toBe("http://localhost:3000");
    for (const patch of [{ QUICKBOOKS_ENVIRONMENT: "production" }, { NODE_ENV: "production" }, { QUICKBOOKS_REDIRECT_URI: "https://test.invalid/evil" }, { QUICKBOOKS_REDIRECT_URI: "https://test.invalid/api/integrations/quickbooks/callback?next=evil" }, { QUICKBOOKS_TOKEN_KEYS: "{}" }, { QUICKBOOKS_CLIENT_SECRET: "" }]) expect(() => quickBooksConfig({ ...env, ...patch })).toThrow("SETUP_REQUIRED");
    expect(quickBooksConfig({ ...env, NODE_ENV: "production", QUICKBOOKS_REDIRECT_URI: "https://preview.invalid/api/integrations/quickbooks/callback" }).origin).toBe("https://preview.invalid");
  });
  it("encrypts nondeterministically and authenticates every scope field", () => {
    const config = quickBooksConfig(env), sealed = sealTokens(tokens, scope, config);
    expect(openTokens(sealed, scope, config)).toEqual(tokens);
    expect(JSON.stringify(sealed)).not.toContain("private-"); expect(sealTokens(tokens, scope, config)).not.toEqual(sealed);
    for (const field of ["businessId", "connectionId", "generation", "realmId", "environment"]) expect(() => openTokens(sealed, { ...scope, [field]: "other" }, config)).toThrow("INVALID_RESPONSE");
    expect(() => openTokens({ ...sealed, tag: Buffer.alloc(16).toString("base64") }, scope, config)).toThrow("INVALID_RESPONSE");
  });
  it("opens retained keys and reseals under the active rotation key", () => {
    const old = quickBooksConfig(env), sealed = sealTokens(tokens, scope, old);
    const next = quickBooksConfig({ ...env, QUICKBOOKS_ACTIVE_TOKEN_KEY_ID: "k2", QUICKBOOKS_TOKEN_KEYS: JSON.stringify({ k1: old.keys.k1.toString("base64"), k2: Buffer.alloc(32, 2).toString("base64") }) });
    expect(sealTokens(openTokens(sealed, scope, next), scope, next).keyId).toBe("k2");
    expect(() => openTokens(sealed, scope, { ...next, keys: { k2: next.keys.k2 } })).toThrow("INVALID_RESPONSE");
  });
  it("uses independent high entropy nonces and only the accounting authorization endpoint", () => {
    const nonce = oauthNonce(); expect(validOAuthNonce(nonce)).toBe(true); expect(oauthNonce()).not.toBe(nonce);
    expect(oauthHash(nonce)).toMatch(/^[a-f0-9]{64}$/); expect(validOAuthNonce("x")).toBe(false);
    const url = new URL(authorizationUrl(nonce, quickBooksConfig(env)));
    expect(url.origin).toBe("https://appcenter.intuit.com"); expect(url.searchParams.get("state")).toBe(nonce);
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting"); expect(url.href).not.toContain("secret");
  });
});
describe("fixed Intuit HTTP adapter", () => {
  it("exchanges a code once, requests absolute refresh expiry and retains provider durations", async () => {
    fetcher.mockResolvedValue(Response.json({ token_type: "bearer", access_token: "a", refresh_token: "r", expires_in: 3600, x_refresh_token_expires_in: 86400, x_refresh_token_hard_expires_in: 7200 }));
    const t = await requestTokens(quickBooksConfig(env), { code: "code" }, 0);
    expect(t).toEqual({ accessToken: "a", refreshToken: "r", accessExpiresAt: "1970-01-01T01:00:00.000Z", refreshExpiresAt: "1970-01-01T02:00:00.000Z", hardExpiresAt: "1970-01-01T02:00:00.000Z" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]; expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(init.headers["x-include-refresh-token-hard-expires-in"]).toBe("true"); expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    expect(new URLSearchParams(init.body).get("redirect_uri")).toBe(env.QUICKBOOKS_REDIRECT_URI);
  });
  it("uses the latest rotated token and never extends the prior absolute expiry", async () => {
    fetcher.mockResolvedValue(Response.json({ token_type: "bearer", access_token: "new", refresh_token: "rotated", expires_in: 3600, x_refresh_token_expires_in: 86400 }));
    const t = await requestTokens(quickBooksConfig(env), { refreshToken: "latest" }, 0, "1970-01-01T03:00:00Z");
    expect(t.refreshToken).toBe("rotated"); expect(t.refreshExpiresAt).toBe("1970-01-01T03:00:00.000Z");
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get("refresh_token")).toBe("latest");
  });
  it.each([400, 401, 429, 500])("does not retry or disclose provider response on HTTP %s", async status => {
    fetcher.mockResolvedValue(new Response("private-refresh upstream details", { status }));
    await expect(requestTokens(quickBooksConfig(env), { code: "code" })).rejects.toThrow(status < 429 ? "INVALID_GRANT" : "PROVIDER_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fails safely on ambiguous network errors and malformed/oversized credentials", async () => {
    fetcher.mockRejectedValue(new Error("private-refresh")); await expect(requestTokens(quickBooksConfig(env), { code: "code" })).rejects.toThrow("PROVIDER_UNAVAILABLE");
    fetcher.mockResolvedValue(Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600 })); await expect(requestTokens(quickBooksConfig(env), { code: "code" })).rejects.toThrow("INVALID_RESPONSE");
    fetcher.mockResolvedValue(new Response("x".repeat(262145))); await expect(requestTokens(quickBooksConfig(env), { code: "code" })).rejects.toThrow("INVALID_RESPONSE");
  });
  it("confirms company identity using only the sandbox company endpoint", async () => {
    fetcher.mockResolvedValue(Response.json({ CompanyInfo: { Id: "1", CompanyName: "Test company" } }));
    expect(await companyInfo(quickBooksConfig(env), "123", "a")).toEqual({ name: "Test company", currency: null });
    expect(fetcher.mock.calls[0][0]).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123");
    await expect(companyInfo(quickBooksConfig(env), "../evil", "a")).rejects.toThrow("INVALID_RESPONSE");
    fetcher.mockResolvedValue(Response.json({ Fault: { type: "AUTHENTICATION" } })); await expect(companyInfo(quickBooksConfig(env), "123", "a")).rejects.toThrow("INVALID_RESPONSE");
  });
  it("revokes the refresh grant using the fixed JSON endpoint", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 200 })); await revokeTokens(quickBooksConfig(env), "r");
    expect(fetcher.mock.calls[0][0]).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke"); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token: "r" });
  });
});
