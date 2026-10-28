import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../lib/db",()=>({getSubscription:vi.fn()}));
import { createClient } from "../utils/supabase/server";
import { getSubscription } from "../lib/db";
import { POST } from "../app/api/integrations/quickbooks/route";
const getUser=vi.fn(),client={auth:{getUser}};
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv("SUPERUSER_EMAILS","");vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({data:{user:{id:"owner",email:"owner@example.invalid",email_confirmed_at:"2026-01-01"}},error:null});
  vi.mocked(getSubscription).mockResolvedValue({feature_tier:"core"} as never);
});
afterEach(()=>vi.unstubAllEnvs());
describe("QuickBooks remains unavailable until the live connector exists",()=>{
  it.each(["core","growth","advisory"])("returns explicit no-store 501 for %s without processing a submitted ledger",async tier=>{
    vi.mocked(getSubscription).mockResolvedValue({feature_tier:tier} as never);
    const response=await POST(new NextRequest("https://example.invalid/api/integrations/quickbooks",{method:"POST",body:JSON.stringify({action:"publish",user_id:"other",months:[{closing_cash:999999}]})}),{});
    expect(response.status).toBe(501);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({error:"QuickBooks sync is coming soon. This endpoint is not yet implemented.",code:"FEATURE_NOT_IMPLEMENTED"});
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith("owner",client);
  });
  it("retains the Core feature gate",async()=>{
    vi.mocked(getSubscription).mockResolvedValue({feature_tier:"starter"} as never);
    expect((await POST(new NextRequest("https://example.invalid/api/integrations/quickbooks",{method:"POST"}),{})).status).toBe(402);
  });
  it("rejects unauthenticated callers before reading subscription state",async()=>{
    getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await POST(new NextRequest("https://example.invalid/api/integrations/quickbooks",{method:"POST"}),{})).status).toBe(401);
    expect(getSubscription).not.toHaveBeenCalled();
  });
});
