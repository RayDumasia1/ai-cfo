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

const rpc = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();
const select = vi.fn();
function request(body = JSON.stringify({ email: "person@example.invalid", feature: "cfo_call" })) {
  return new NextRequest("https://app.example.invalid/api/notify-me", { method: "POST", body });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const builder = { update, eq, select, maybeSingle };
  update.mockReturnValue(builder); eq.mockReturnValue(builder); select.mockReturnValue(builder);
  maybeSingle.mockResolvedValue({ data: { email: "person@example.invalid" }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "own-user" } }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser } } as unknown as Awaited<ReturnType<typeof createClient>>);
  rpc.mockResolvedValue({data:{inserted:true,outbox:[{id:1,message_type:"feature_customer_confirmation"},{id:2,message_type:"feature_internal_notification"}]},error:null});
  vi.mocked(createServiceClient).mockReturnValue({ rpc, from: () => builder } as unknown as ReturnType<typeof createServiceClient>);
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
    expect(rpc).toHaveBeenCalledWith("register_feature_notification",{p_email:"o'connor&co@example.invalid",p_feature:"cfo_call",p_user_id:"own-user"});
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].to).toBe("o'connor&co@example.invalid");
    expect(send.mock.calls[0][0].subject).toBe("You're on the list for CFO assistance");
    expect(send.mock.calls[0][0].html).toContain("CFO assistance");
    expect(send.mock.calls[1][0].html).toContain("o&#39;connor&amp;co@example.invalid");
  });
  it("does not send another support email for an ignored duplicate", async () => {
    rpc.mockResolvedValue({data:{inserted:false,outbox:[]},error:null});
    expect((await POST(request())).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "auth error"])("does not trust account attribution for %s requests", async condition => {
    getUser.mockResolvedValue({ data: { user: condition === "anonymous" ? null : { id: "untrusted" } }, error: condition === "auth error" ? new Error("Invalid session") : null });
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("register_feature_notification",expect.objectContaining({p_user_id:null}));
  });
  it.each(["provider rejection", "exception"])("preserves saved registration and logs %s without exposing provider details", async condition => {
    if (condition === "exception") send.mockRejectedValue(new Error("pretend-secret"));
    else send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "pretend-secret" } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("pretend-secret");
  });
  it("does not send email when registration fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Internal database detail" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Internal database detail");
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { inserted: true, outbox: [] },
    { inserted: false, outbox: [{ id: 1, message_type: "feature_customer_confirmation" }] },
    { inserted: true, outbox: [{ id: 1, message_type: "feature_customer_confirmation" }, { id: 2, message_type: "feature_customer_confirmation" }] },
  ])("fails closed when the registration RPC returns inconsistent work: %j", async registration => {
    rpc.mockResolvedValue({ data: registration, error: null });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });
});
