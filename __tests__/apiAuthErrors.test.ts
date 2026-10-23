import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ getSubscription: vi.fn() }));

import { createClient } from "../utils/supabase/server";
import { getSubscription } from "../lib/db";
import { requireAuth } from "../lib/apiAuth";
import { GET as subscription } from "../app/api/subscription/route";

const getUser = vi.fn();
const client = { auth: { getUser } };
const req = () => new NextRequest("https://example.invalid/api/subscription?private=do-not-log");
const sensitiveFailure = "private provider details do-not-log";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({ data: { user: {
    id: "own-user", email: "private@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z",
  } }, error: null });
});
afterEach(() => vi.restoreAllMocks());

async function expectSafeFailure(response: Response, phase: "authentication" | "handler") {
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toEqual({ error: "Internal server error", requestId: expect.any(String) });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(console.error).toHaveBeenCalledExactlyOnceWith("requireAuth:error", {
    requestId: body.requestId, phase,
  });
  const output = JSON.stringify([body, vi.mocked(console.error).mock.calls]);
  expect(output).not.toContain("private");
  expect(output).not.toContain("do-not-log");
}

describe("authenticated API error boundary", () => {
  it.each([new Error(sensitiveFailure), { message: sensitiveFailure }, sensitiveFailure, null])(
    "converts an asynchronous handler rejection into safe JSON (%#)", async failure => {
      const handler = vi.fn(async () => { await Promise.resolve(); throw failure; });
      await expectSafeFailure(await requireAuth(handler)(req(), {}), "handler");
      expect(handler).toHaveBeenCalledOnce();
    }
  );

  it("contains a synchronous handler throw", async () => {
    const handler = vi.fn((): Promise<Response> => { throw new Error(sensitiveFailure); });
    await expectSafeFailure(await requireAuth(handler)(req(), {}), "handler");
  });

  it.each(["client", "user"])("contains a rejected authentication %s operation without entering the handler", async stage => {
    if (stage === "client") vi.mocked(createClient).mockRejectedValue(new Error(sensitiveFailure));
    else getUser.mockRejectedValue(new Error(sensitiveFailure));
    const handler = vi.fn(async () => Response.json({ success: true }));
    await expectSafeFailure(await requireAuth(handler)(req(), {}), "authentication");
    expect(handler).not.toHaveBeenCalled();
  });

  it("contains a real subscription route's rejected database lookup", async () => {
    vi.mocked(getSubscription).mockRejectedValue(new Error(sensitiveFailure));
    await expectSafeFailure(await subscription(req(), {}), "handler");
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith("own-user", client);
  });

  it.each([400, 403, 409, 503])("preserves a deliberate handler response with status %s", async status => {
    const response = Response.json({ error: "Expected route response" }, {
      status, headers: { "X-Route-Header": "preserved" },
    });
    expect(await requireAuth(async () => response)(req(), {})).toBe(response);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("preserves successful response cookies, headers, and dynamic route context", async () => {
    const response = Response.json({ success: true }, { headers: { "Set-Cookie": "test=value; HttpOnly" } });
    const ctx = { params: Promise.resolve({ id: "action-id" }) };
    const handler = vi.fn(async () => response);
    const request = req();
    expect(await requireAuth(handler)(request, ctx)).toBe(response);
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, {
      userId: "own-user", email: "private@example.invalid", supabase: client,
    }, ctx);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["redirect", "notFound"])("allows Next.js %s control flow to reach the framework", async kind => {
    const handler = async (): Promise<Response> => {
      await Promise.resolve();
      if (kind === "redirect") redirect("/welcome");
      notFound();
    };
    await expect(requireAuth(handler)(req(), {})).rejects.toThrow(kind === "redirect" ? "NEXT_REDIRECT" : "NEXT_HTTP_ERROR_FALLBACK");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("preserves framework control flow raised during session-client creation", async () => {
    vi.mocked(createClient).mockImplementation(async () => { redirect("/auth"); });
    const handler = vi.fn(async () => Response.json({ success: true }));
    await expect(requireAuth(handler)(req(), {})).rejects.toThrow("NEXT_REDIRECT");
    expect(handler).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
