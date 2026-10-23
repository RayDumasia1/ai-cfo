import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("../lib/db", () => ({ hasPaidSubscription: vi.fn() }));

import { createServerClient } from "@supabase/ssr";
import { hasPaidSubscription } from "../lib/db";
import { proxy } from "../proxy";

const cookieName = "sb-test-auth-token";
const options = { path: "/", httpOnly: true, secure: true, sameSite: "lax" as const };
const confirmedUser = { id: "test-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01" };
let currentUser: typeof confirmedUser | null;
let clearSession: boolean;
let writeCookies: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  currentUser = confirmedUser;
  clearSession = false;
  writeCookies = true;
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  // Exercise the real cookie adapter and Proxy together, replacing only the
  // provider. Values below are synthetic, and no Auth/DB requests are sent.
  vi.mocked(createServerClient).mockImplementation((_url, _key, config) => {
    const cookies = config!.cookies as CookieMethodsServer;
    return {
      auth: {
        getUser: async () => {
          if (writeCookies) {
            await cookies.setAll!([
              { name: cookieName, value: clearSession ? "" : "refreshed", options: { ...options, ...(clearSession ? { maxAge: 0 } : {}) } },
              { name: `${cookieName}.1`, value: "", options: { ...options, maxAge: 0 } },
            ], {});
          }
          return { data: { user: currentUser }, error: clearSession ? { code: "refresh_token_not_found" } : null };
        },
      },
    } as ReturnType<typeof createServerClient>;
  });
});

function request(path: string) {
  return new NextRequest(`https://app.example.invalid${path}`, {
    headers: { cookie: `${cookieName}=stale; ${cookieName}.1=old-chunk; theme=dark` },
  });
}

describe("Proxy session cookie propagation", () => {
  it.each(["/dashboard", "/auth/callback", "/api/auth/login", "/welcome"])("forwards refreshed cookies upstream and to the browser on %s", async path => {
    const response = await proxy(request(path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get(cookieName)).toMatchObject({ value: "refreshed", ...options });
    expect(response.cookies.get(`${cookieName}.1`)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("x-middleware-request-cookie")).toContain(`${cookieName}=refreshed`);
    expect(response.headers.get("x-middleware-request-cookie")).toContain("theme=dark");
    expect(response.cookies.has("theme")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("expires")).toBe("0");
  });

  it.each([
    { path: "/auth", verified: true, paid: true, destination: "/dashboard" },
    { path: "/dashboard", verified: true, paid: false, destination: "/welcome" },
    { path: "/dashboard", verified: false, paid: true, destination: "/auth/verify" },
  ])("retains cookie updates on redirects to $destination", async ({ path, verified, paid, destination }) => {
    if (!verified) currentUser = { ...confirmedUser, email_confirmed_at: "" };
    vi.mocked(hasPaidSubscription).mockResolvedValue(paid);
    const response = await proxy(request(path));
    expect(new URL(response.headers.get("location")!).pathname).toBe(destination);
    expect(response.cookies.get(cookieName)).toMatchObject({ value: "refreshed", ...options });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it.each(["/dashboard", "/auth", "/api/auth/login"])("clears rejected session cookies on %s", async path => {
    currentUser = null;
    clearSession = true;
    const response = await proxy(request(path));
    expect(response.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0, ...options });
    expect(response.cookies.get(`${cookieName}.1`)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(hasPaidSubscription).not.toHaveBeenCalled();
    if (path === "/dashboard") expect(response.headers.get("location")).toContain("/auth?reason=session_expired");
    else expect(response.headers.get("x-middleware-request-cookie")).not.toContain("stale");
  });

  it.each([403, 402])("retains session updates on a %s API response", async status => {
    if (status === 403) currentUser = { ...confirmedUser, email_confirmed_at: "" };
    else vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    const response = await proxy(request("/api/actions"));
    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
    expect(response.cookies.get(cookieName)?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("does not emit cookies when the provider makes no changes", async () => {
    writeCookies = false;
    expect((await proxy(request("/welcome"))).headers.get("set-cookie")).toBeNull();
  });

  it.each(["/api/public/founding-spots", "/api/stripe/webhook"])("keeps %s independent of browser sessions", async path => {
    const response = await proxy(request(path));
    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
