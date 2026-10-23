import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { POST } from "../app/api/notify-me/route";

const upsert = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();
const select = vi.fn();
function request(body = JSON.stringify({ email: "person@example.invalid", feature: "cfo_call" })) {
  return new NextRequest("https://app.example.invalid/api/notify-me", { method: "POST", body });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const builder = { upsert, select, maybeSingle };
  upsert.mockReturnValue(builder); select.mockReturnValue(builder);
  maybeSingle.mockResolvedValue({ data: { email: "person@example.invalid" }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "own-user" } }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser } } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createServiceClient).mockReturnValue({ from: () => builder } as unknown as ReturnType<typeof createServiceClient>);
  send.mockResolvedValue({ data: { id: "email_test" }, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("notify-me registration", () => {
  it.each(["null", "[]", "true", "{", "{}", JSON.stringify({ email: "invalid", feature: "cfo_call" }),
    JSON.stringify({ email: "person@example.invalid", feature: "unknown" }),
    JSON.stringify({ email: "<b>x</b>@example.invalid", feature: "cfo_call" }),
    JSON.stringify({ email: `${"a".repeat(255)}@example.invalid`, feature: "cfo_call" })])("rejects invalid input without data or email work: %s", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("escapes HTML-sensitive email characters and scopes attribution to Auth", async () => {
    const response = await POST(request(JSON.stringify({ email: " o'connor&co@example.invalid ", feature: "cfo_call", user_id: "another-user" })));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ email: "o'connor&co@example.invalid", feature: "cfo_call", user_id: "own-user" }, { onConflict: "email,feature", ignoreDuplicates: true });
    const payload = send.mock.calls[0][0];
    expect(payload.to).toBe("hello@elidan.ai");
    expect(payload.html).toContain("o&#39;connor&amp;co@example.invalid");
    expect(payload.html).not.toContain("o'connor&co@example.invalid");
  });
  it("does not send another support email for an ignored duplicate", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "auth error"])("does not trust account attribution for %s requests", async condition => {
    getUser.mockResolvedValue({ data: { user: condition === "anonymous" ? null : { id: "untrusted" } }, error: condition === "auth error" ? new Error("Invalid session") : null });
    expect((await POST(request())).status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null }), expect.anything());
  });
  it.each(["provider rejection", "exception"])("preserves saved registration and logs %s without exposing provider details", async condition => {
    if (condition === "exception") send.mockRejectedValue(new Error("pretend-secret"));
    else send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "pretend-secret" } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(upsert).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("pretend-secret");
  });
  it("does not send email when registration fails", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "Internal database detail" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Internal database detail");
    expect(send).not.toHaveBeenCalled();
  });
});
