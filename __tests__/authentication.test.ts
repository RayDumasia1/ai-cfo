import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/middleware", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("../lib/db", () => ({
  hasPaidSubscription: vi.fn(), getSubscription: vi.fn(), getOrCreateBusinessProfile: vi.fn(),
  upsertBusinessProfile: vi.fn(), logDataImport: vi.fn(),
}));
vi.mock("../lib/excelParser", () => ({ parseExcelBuffer: vi.fn() }));
vi.mock("../lib/stripe", () => ({
  stripe: { billingPortal: { sessions: { create: vi.fn() } }, invoices: { list: vi.fn() } },
}));

import { createClient } from "../utils/supabase/server";
import { createClient as createMiddlewareClient } from "../utils/supabase/middleware";
import { createServiceClient } from "../utils/supabase/service";
import { hasPaidSubscription, getSubscription } from "../lib/db";
import { stripe } from "../lib/stripe";
import { parseExcelBuffer } from "../lib/excelParser";
import { requireAuth } from "../lib/apiAuth";
import { proxy } from "../proxy";
import { POST as importData } from "../app/api/import/route";
import { POST as portal } from "../app/api/stripe/portal/route";
import { GET as invoices } from "../app/api/billing/invoices/route";
import { GET as subscription } from "../app/api/subscription/route";

const getUser = vi.fn();
const from = vi.fn();
const eq = vi.fn();
const client = { auth: { getUser }, from };

function user(confirmed: string | undefined = "2026-10-01T00:00:00Z"): User {
  return { id: "own_user", email: "test@example.invalid", email_confirmed_at: confirmed } as User;
}
function session(value: User | null, error: Error | null = null) {
  getUser.mockResolvedValue({ data: { user: value }, error });
}
function request(path = "/api/subscription") {
  return new NextRequest(`https://app.example.invalid${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  session(user());
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createMiddlewareClient).mockReturnValue({
    supabase: client, finishResponse: (response?: NextResponse) => response ?? NextResponse.next(),
  } as unknown as ReturnType<typeof createMiddlewareClient>);
  const builder = {
    select: vi.fn(() => builder), eq,
    maybeSingle: vi.fn(async () => ({ data: { stripe_customer_id: "cus_own" }, error: null })),
  };
  eq.mockReturnValue(builder);
  from.mockReturnValue(builder);
  vi.mocked(createServiceClient).mockReturnValue({ from } as unknown as ReturnType<typeof createServiceClient>);
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(getSubscription).mockResolvedValue({ plan: "core", status: "active" } as never);
  vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({ url: "https://billing.example.invalid/own" } as never);
  vi.mocked(stripe.invoices.list).mockResolvedValue({ data: [] } as never);
});

afterEach(() => vi.restoreAllMocks());

describe("verified-email API authorization", () => {
  it("rejects an unauthenticated request without entering its handler", async () => {
    session(null);
    const handler = vi.fn(async () => Response.json({ success: true }));
    expect((await requireAuth(handler)(request(), {})).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a user returned with an authentication error", async () => {
    session(user(), new Error("Invalid session"));
    expect((await subscription(request(), {})).status).toBe(401);
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("rejects an unverified session before reading subscription data", async () => {
    session({ ...user(), email_confirmed_at: undefined });
    const response = await subscription(request(), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("does not mistake phone confirmation for email verification", async () => {
    session({ ...user(), email_confirmed_at: undefined, confirmed_at: "2026-10-01T00:00:00Z", phone_confirmed_at: "2026-10-01T00:00:00Z" });
    expect((await subscription(request(), {})).status).toBe(403);
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("does not trust editable user metadata claiming email verification", async () => {
    session({ ...user(), email_confirmed_at: undefined, user_metadata: { email_verified: true } });
    expect((await subscription(request(), {})).status).toBe(403);
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("uses the authenticated account and forwards route context after verification", async () => {
    const ctx = { params: Promise.resolve({ id: "action_123" }) };
    const handler = vi.fn(async () => Response.json({ success: true }));
    const req = request("/api/subscription?user_id=someone_else");
    expect((await requireAuth(handler)(req, ctx)).status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, expect.objectContaining({ userId: "own_user", supabase: client }), ctx);
  });

  it.each(["portal", "invoices", "import"])("blocks direct %s handler access before external or data work", async route => {
    session({ ...user(), email_confirmed_at: undefined });
    const req = new NextRequest("https://app.example.invalid/api/import", { method: "POST", body: new FormData() });
    const formData = vi.spyOn(req, "formData");
    const response = route === "portal" ? await portal() : route === "invoices" ? await invoices() : await importData(req);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(stripe.invoices.list).not.toHaveBeenCalled();
  });

  it.each(["portal", "invoices", "import"])("rejects auth errors in direct %s handlers", async route => {
    session(user(), new Error("Invalid session"));
    const response = route === "portal" ? await portal() : route === "invoices" ? await invoices() : await importData(new NextRequest("https://app.example.invalid/api/import", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["portal", "invoices"])("preserves verified %s requests scoped to the signed-in account", async route => {
    const response = route === "portal" ? await portal() : await invoices();
    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("user_id", "own_user");
    expect(route === "portal" ? stripe.billingPortal.sessions.create : stripe.invoices.list)
      .toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_own" }));
  });

  it("allows a verified import request to reach file validation", async () => {
    const req = new NextRequest("https://app.example.invalid/api/import", { method: "POST", body: new FormData() });
    const response = await importData(req);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "No file provided" });
    expect(parseExcelBuffer).not.toHaveBeenCalled();
  });
});

describe("proxy email-verification and billing boundaries", () => {
  it.each(["/api/import", "/api/data", "/api/actions", "/api/stripe/checkout", "/api/stripe/portal", "/api/auth/password", "/api/notify-me", "/api/alerts/dismiss"])("rejects unverified sessions on %s", async path => {
    session({ ...user(), email_confirmed_at: undefined });
    const response = await proxy(request(path));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(hasPaidSubscription).not.toHaveBeenCalled();
  });

  it.each(["/auth/signup", "/auth/verify", "/auth/callback", "/auth/reset-password", "/api/auth/login", "/api/auth/logout"])("leaves recovery/verification path %s reachable", async path => {
    session({ ...user(), email_confirmed_at: undefined });
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    expect(hasPaidSubscription).not.toHaveBeenCalled();
  });

  it.each(["/api/auth/logout-other", "/api/auth/login-other"])("does not exempt unrelated paths by prefix: %s", async path => {
    session({ ...user(), email_confirmed_at: undefined });
    expect((await proxy(request(path))).status).toBe(403);
  });

  it.each(["/api/public/founding-spots", "/api/stripe/webhook"])("does not let user cookies interfere with public/signed endpoint %s", async path => {
    getUser.mockRejectedValue(new Error("Auth provider unavailable"));
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("redirects an unverified dashboard request to verification", async () => {
    session({ ...user(), email_confirmed_at: undefined });
    const response = await proxy(request("/dashboard"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/auth/verify");
  });

  it("still requires a paid subscription after verification", async () => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    expect((await proxy(request("/api/actions"))).status).toBe(402);
    expect(hasPaidSubscription).toHaveBeenCalledWith("own_user", client);
  });

  it("keeps checkout reachable for a verified account choosing its first plan", async () => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    expect((await proxy(request("/api/stripe/checkout"))).headers.get("x-middleware-next")).toBe("1");
    expect(hasPaidSubscription).not.toHaveBeenCalled();
  });

  it("allows a verified account without a subscription to register interest from welcome", async () => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    const response = await proxy(request("/api/notify-me"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(hasPaidSubscription).not.toHaveBeenCalled();
  });

  it.each(["/api/notify-me-other", "/api/notify-me/other", "/api/actions", "/api/import", "/api/data", "/api/alerts/dismiss"])("preserves the paid-subscription boundary on %s", async path => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    expect((await proxy(request(path))).status).toBe(402);
  });

  it("keeps paid verified dashboard access and no-store headers", async () => {
    const response = await proxy(request("/dashboard"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
