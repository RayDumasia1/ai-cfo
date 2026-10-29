import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { authorizeOwnedMonthly,prepareOwnedFinancialImport,upsertBusinessProfile,getOrCreateBusinessProfile,clearFinancialData,updateAlertPreferences,completeOwnedOnboarding } from "../lib/db";
import { monthlySelection,monthlyErrorResponse,MonthlyAuthorityError,validateOwnerWriteContext } from "../lib/monthlyAuthority";
const actor="10000000-0000-4000-8000-000000000001",org="20000000-0000-4000-8000-000000000001",other="20000000-0000-4000-8000-000000000002";
const context=()=>({actorId:actor,organizationId:org,businessProfileId:"30000000-0000-4000-8000-000000000001",membershipId:"40000000-0000-4000-8000-000000000001",
  accessRevision:1,membershipRevision:1,policyVersion:"org-owner-write-1",capability:"financial.months.write",entitlementTier:"core",entitlementSource:"legacy_subscription",dataVersion:null,businessName:null});
const rpc=vi.fn(),from=vi.fn(),client={rpc,from};
beforeEach(()=>{vi.resetAllMocks();rpc.mockResolvedValue({data:{authorized:true,actorId:actor,organizationId:org},error:null});});
describe("D3 authority adapters and error boundaries",()=>{
  it("requires an explicit single selector and rejects duplicates without fallback",()=>{
    expect(monthlySelection(new URLSearchParams())).toBeNull();expect(monthlySelection(new URLSearchParams({organization_id:org}))).toBe(org);
    for(const p of ["organization_id=bad","organization_id=","organization_id="+org+"&organization_id="+org])expect(()=>monthlySelection(new URLSearchParams(p))).toThrow("invalid_request");
  });
  it("binds the full closed context including scope, revisions and capability",()=>{
    expect(validateOwnerWriteContext(context(),actor,org)).toEqual(context());
    for(const patch of [{actorId:"other"},{organizationId:other},{businessProfileId:"bad"},{policyVersion:"old"},{capability:"financial.months.read"},{accessRevision:0},{membershipRevision:NaN},{entitlementTier:"suspended"}])expect(()=>validateOwnerWriteContext({...context(),...patch},actor,org)).toThrow("unavailable");
  });
  it("sends no client identity, paid tier or role and treats preflight as non-mutating",async()=>{
    await authorizeOwnedMonthly(actor,org,client as never);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("owned_monthly_operation",{p_operation:"authorize",p_organization_id:org});expect(from).not.toHaveBeenCalled();
    rpc.mockResolvedValue({data:{authorized:true,actorId:"other",organizationId:org},error:null});await expect(authorizeOwnedMonthly(actor,org,client as never)).rejects.toThrow("unavailable");
  });
  it("validates prepared state and scope, strips workbook-controlled settings",async()=>{
    rpc.mockResolvedValue({data:{context:context(),unchanged:false,reviewState:{state_version:"a".repeat(32),months:[]}},error:null});
    await prepareOwnedFinancialImport(actor,[],{business_name:"Demo",min_cash_reserve:99},"replace_all",client as never,org);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("owned_monthly_operation",{p_operation:"review",p_organization_id:org,p_months:[],p_profile:{business_name:"Demo"},p_mode:"replace_all"});
    rpc.mockResolvedValue({data:{context:{...context(),actorId:"other"},unchanged:false,reviewState:{state_version:"a".repeat(32),months:[]}},error:null});
    await expect(prepareOwnedFinancialImport(actor,[],{},"replace_all",client as never,org)).rejects.toThrow("unavailable");
  });
  it("does not fall back to service or raw DML when migration or authority fails",async()=>{
    for(const [code,reason] of [["PGRST202","unavailable"],["42501","unauthorized"],["P0402","subscription_required"],["P0002","not_found"],["55P03","busy"],["40P01","busy"]]){
      rpc.mockResolvedValue({data:null,error:{code,message:"sensitive internal detail"}});
      await expect(clearFinancialData(actor,client as never,org)).rejects.toMatchObject({reason});
    }
    expect(from).not.toHaveBeenCalled();
  });
  it("uses checked RPCs for profile mutation and bootstrap",async()=>{
    rpc.mockResolvedValue({data:{user_id:actor,business_name:"Demo"},error:null});
    await upsertBusinessProfile(actor,{business_name:"Demo"},client as never,org);
    expect(rpc).toHaveBeenCalledWith("update_owned_business_profile",{p_patch:{business_name:"Demo"},p_organization_id:org});
    const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:null,error:null})};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);from.mockReturnValue(query);
    await getOrCreateBusinessProfile(actor,client as never);expect(rpc).toHaveBeenCalledWith("ensure_owned_business_profile");
  });
  it("moves onboarding and snooze changes through narrow authenticated authority",async()=>{
    rpc.mockResolvedValue({data:{success:true,actorId:actor,organizationId:org},error:null});
    await updateAlertPreferences(actor,{snooze_duration:"7d"},client as never);
    expect(rpc).toHaveBeenCalledWith("update_owned_profile_preferences",{p_snooze_duration:"7d"});
    await completeOwnedOnboarding(actor,client as never);
    expect(rpc).toHaveBeenCalledWith("update_owned_profile_preferences",{p_complete_onboarding:true});
    expect(from).not.toHaveBeenCalled();
  });
  it("maps retryable contention and access failures without leaking database messages",()=>{
    for(const reason of ["unauthorized","not_found","subscription_required","changed","busy","invalid_request","unavailable"] as const){
      const out=monthlyErrorResponse(new MonthlyAuthorityError(reason));expect(out?.status).toBeGreaterThanOrEqual(400);expect(JSON.stringify(out)).not.toContain("SQL");
    }
    expect(monthlyErrorResponse(new Error("untrusted"))).toBeNull();
  });
});
