import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "../utils/supabase/service";
import { GET } from "../app/api/cron/email-outbox/route";

const rpc = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const builder = { update, eq };
const row = {
  id: 41, email:"person@example.invalid", feature:"tier_growth",
  message_type:"feature_customer_confirmation", attempts:1, created_at:"2026-10-25T12:00:00Z", user_id:"user-41",
};
function request(secret="cron-test") {
  return new Request("https://app.example.invalid/api/cron/email-outbox", { headers:{authorization:`Bearer ${secret}`} });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET","cron-test");
  vi.spyOn(console,"error").mockImplementation(() => {});
  update.mockReturnValue(builder); eq.mockReturnValue(builder);
  rpc.mockResolvedValue({data:[row],error:null});
  vi.mocked(createServiceClient).mockReturnValue({rpc,from:()=>builder} as unknown as ReturnType<typeof createServiceClient>);
  send.mockResolvedValue({data:{id:"email_provider_41"},error:null});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("email outbox worker", () => {
  it.each([undefined,"wrong"])("rejects a missing or invalid cron secret", async secret => {
    const headers = secret ? {authorization:`Bearer ${secret}`} : undefined;
    const response = await GET(new Request("https://app.example.invalid/api/cron/email-outbox",{headers}));
    expect(response.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("claims, sends idempotently, and records provider acceptance", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({claimed:1,accepted:1,deferred:0,permanentFailures:0});
    expect(rpc).toHaveBeenCalledWith("claim_email_outbox_batch",{p_limit:20});
    expect(send).toHaveBeenCalledWith(expect.objectContaining({to:"person@example.invalid"}),{idempotencyKey:"email-outbox/41"});
    expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"sent",provider_message_id:"email_provider_41",next_attempt_at:null}));
  });
  it("defers retryable failures without exposing provider details", async () => {
    send.mockResolvedValue({data:null,error:{statusCode:503,message:"pretend-secret"}});
    const response = await GET(request());
    expect(await response.json()).toEqual({claimed:1,accepted:0,deferred:1,permanentFailures:0});
    expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"failed",last_failure_reason:"provider_rejected"}));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("pretend-secret");
  });
  it.each([
    [{...row,attempts:5},{statusCode:503}],
    [row,{statusCode:422}],
  ])("stops retrying exhausted and permanent failures", async (claimed,error) => {
    rpc.mockResolvedValue({data:[claimed],error:null});
    send.mockResolvedValue({data:null,error});
    const response=await GET(request());
    expect(await response.json()).toEqual({claimed:1,accepted:0,deferred:0,permanentFailures:1});
    expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"permanent_failed",next_attempt_at:null}));
  });
  it("returns 500 when the queue cannot be claimed", async () => {
    rpc.mockResolvedValue({data:null,error:{message:"private detail"}});
    const response=await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private detail");
    expect(send).not.toHaveBeenCalled();
  });
});
