import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { verify } = vi.hoisted(() => ({ verify:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend:class { webhooks={verify}; } }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient:vi.fn() }));
import { createServiceClient } from "../utils/supabase/service";
import { POST } from "../app/api/resend/webhook/route";

const rpc=vi.fn();
function request(body="raw signed body") {
  return new Request("https://app.example.invalid/api/resend/webhook",{
    method:"POST",body,headers:{"svix-id":"evt_1","svix-timestamp":"123","svix-signature":"sig_1"},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_WEBHOOK_SECRET","whsec_test");
  vi.spyOn(console,"error").mockImplementation(()=>{});
  verify.mockReturnValue({type:"email.delivered",created_at:"2026-10-25T12:01:00Z",data:{email_id:"email_1"}});
  rpc.mockResolvedValue({data:{matched:true,applied:true},error:null});
  vi.mocked(createServiceClient).mockReturnValue({rpc} as unknown as ReturnType<typeof createServiceClient>);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe("Resend webhook",()=>{
  it("verifies the raw body and records the provider event",async()=>{
    const response=await POST(request());
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith({payload:"raw signed body",headers:{id:"evt_1",timestamp:"123",signature:"sig_1"},webhookSecret:"whsec_test"});
    expect(rpc).toHaveBeenCalledWith("record_email_delivery_event",{
      p_event_id:"evt_1",p_provider_message_id:"email_1",p_event_type:"email.delivered",p_event_at:"2026-10-25T12:01:00Z",
    });
  });
  it("rejects an invalid signature before database access",async()=>{
    verify.mockImplementation(()=>{throw new Error("invalid")});
    expect((await POST(request())).status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("asks Resend to retry when the provider ID is not recorded yet",async()=>{
    rpc.mockResolvedValue({data:{matched:false,applied:false},error:null});
    expect((await POST(request())).status).toBe(500);
  });
  it("acknowledges irrelevant signed events without database work",async()=>{
    verify.mockReturnValue({type:"email.opened",created_at:"2026-10-25T12:01:00Z",data:{email_id:"email_1"}});
    expect((await POST(request())).status).toBe(200);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
