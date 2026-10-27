import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only",()=>({}));
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../utils/supabase/service",()=>({createServiceClient:vi.fn()}));
vi.mock("../lib/db",()=>({getSubscription:vi.fn(),hasPaidSubscription:vi.fn(),getForecastReviewQueue:vi.fn(),getForecastReviewEvidence:vi.fn(),
  getForecastReviewReplay:vi.fn(),getOwnerForecastReview:vi.fn(),recordManualForecastActual:vi.fn(),saveForecastReview:vi.fn()}));
vi.mock("../lib/forecastWorkflow",async importOriginal=>({...await importOriginal<typeof import("../lib/forecastWorkflow")>(),todayIso:()=>"2026-10-27"}));
import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { getForecastReviewEvidence, getForecastReviewQueue, getForecastReviewReplay, getOwnerForecastReview,
  getSubscription,hasPaidSubscription,recordManualForecastActual,saveForecastReview } from "../lib/db";
import { GET,POST } from "../app/api/forecast-review/route";
import { rawReviewEvidence,reviewFixtureResult,reviewIds,reviewSubmission,ownerReviewState } from "./fixtures/forecastReview";
import { REVIEW_POLICY } from "../lib/forecastReviewWorkflow";
const getUser=vi.fn(),client={auth:{getUser}},admin={from:vi.fn()};
const req=(body:unknown)=>new NextRequest("https://example.invalid/api/forecast-review",{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
beforeEach(()=>{
  vi.resetAllMocks();vi.spyOn(console,"error").mockImplementation(()=>{});
  vi.mocked(createClient).mockResolvedValue(client as never);vi.mocked(createServiceClient).mockReturnValue(admin as never);
  getUser.mockResolvedValue({data:{user:{id:reviewIds.owner,email:"owner@example.invalid",email_confirmed_at:"2026-01-01"}},error:null});
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);vi.mocked(getSubscription).mockResolvedValue({feature_tier:"growth"} as never);
  vi.mocked(getForecastReviewEvidence).mockResolvedValue(structuredClone(rawReviewEvidence));
  vi.mocked(getOwnerForecastReview).mockResolvedValue(structuredClone(ownerReviewState));
  vi.mocked(getForecastReviewReplay).mockResolvedValue(null);
  vi.mocked(saveForecastReview).mockResolvedValue({review_id:reviewIds.review,revision:1,coverage:"complete",replayed:false});
  vi.mocked(recordManualForecastActual).mockResolvedValue({event_id:reviewIds.actual,revision:1,replayed:false});
});
afterEach(()=>vi.restoreAllMocks());

describe("Growth weekly review API boundary",()=>{
  it.each(["unauthenticated","unverified","unpaid","starter","core","suspended"])("rejects %s before creating a service client",async condition=>{
    if(condition==="unauthenticated")getUser.mockResolvedValue({data:{user:null},error:null});
    else if(condition==="unverified")getUser.mockResolvedValue({data:{user:{id:reviewIds.owner,email:"owner@example.invalid"}},error:null});
    else if(condition==="unpaid")vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    else vi.mocked(getSubscription).mockResolvedValue({feature_tier:condition} as never);
    const r=await POST(req(reviewSubmission),{});
    expect(r.status).toBe(condition==="unauthenticated"?401:condition==="unverified"?403:402);
    expect(createServiceClient).not.toHaveBeenCalled();expect(saveForecastReview).not.toHaveBeenCalled();
  });
  it("loads only the authenticated owner's queue and weekly evidence",async()=>{
    vi.mocked(getForecastReviewQueue).mockResolvedValue({weeks:[],hasPublishedPlan:true});
    expect((await GET(new NextRequest("https://example.invalid/api/forecast-review?userId=someone-else"),{})).status).toBe(200);
    expect(getForecastReviewQueue).toHaveBeenCalledWith(reviewIds.owner,"2026-10-27",admin);
    expect((await GET(new NextRequest(`https://example.invalid/api/forecast-review?versionId=${reviewIds.version}&weekStart=2026-10-05`),{})).status).toBe(200);
    expect(getOwnerForecastReview).toHaveBeenCalledWith(reviewIds.owner,reviewIds.version,"2026-10-05",admin,undefined);
  });
  it("calculates on the server and ignores submitted results, actor and matching authority",async()=>{
    const r=await POST(req({...reviewSubmission,action:"calculate",userId:"other",result:{summary:{netCashImpact:999999}},
      allocations:reviewSubmission.allocations.map(a=>({...a,method:"advisor_confirmed",confidence:"unknown"}))}),{});
    expect(r.status).toBe(200);const {result}=await r.json();
    expect(result.summary.netCashImpact).toBe(-100);expect(result.variances[0].method).toBe("user_confirmed");
    expect(saveForecastReview).not.toHaveBeenCalled();
  });
  it("cannot present unconfirmed cash activity as a complete review",async()=>{
    const r=await POST(req({...reviewSubmission,action:"calculate",activityConfirmed:false}),{});
    expect(r.status).toBe(200);const {result}=await r.json();expect(result.coverage).toBe("partial");expect(result.summary.netCashImpact).toBeNull();
    const missingBalances=await POST(req({...reviewSubmission,action:"calculate",openingCash:null,closingCash:null}),{});
    expect((await missingBalances.json()).result).toMatchObject({coverage:"partial",summary:{netCashImpact:null}});
  });
  it("saves only a server-calculated command for the session owner",async()=>{
    const r=await POST(req({...reviewSubmission,userId:"other"}),{});expect(r.status).toBe(200);
    expect(saveForecastReview).toHaveBeenCalledWith(expect.objectContaining({userId:reviewIds.owner,result:reviewFixtureResult,
      policy:{...REVIEW_POLICY,ownerActivityConfirmed:true}}),admin);
  });
  it("replays the original committed result without recalculating from changed evidence",async()=>{
    vi.mocked(getForecastReviewReplay).mockResolvedValue({version:reviewIds.version,week:reviewSubmission.weekStart,token:reviewSubmission.evidenceToken,
      allocations:reviewSubmission.allocations,policy:{...REVIEW_POLICY,ownerActivityConfirmed:true},opening:5000,closing:5900,result:reviewFixtureResult});
    const r=await POST(req(reviewSubmission),{});expect(r.status).toBe(200);expect(getForecastReviewEvidence).not.toHaveBeenCalled();
    expect(saveForecastReview).toHaveBeenCalledWith(expect.objectContaining({result:reviewFixtureResult,requestKey:reviewIds.request}),admin);
    expect((await POST(req({...reviewSubmission,closingCash:0}),{})).status).toBe(409);
  });
  it.each(["stale","excess","opposite","unknown"])("rejects %s evidence without saving",async condition=>{
    const body=structuredClone(reviewSubmission);
    if(condition==="stale")body.evidenceToken="b".repeat(32);
    if(condition==="excess")body.allocations[0].actualAmount=901;
    if(condition==="opposite")vi.mocked(getForecastReviewEvidence).mockResolvedValue({...rawReviewEvidence,actual_events:rawReviewEvidence.actual_events.map(a=>({...a,direction:"outflow"}))});
    if(condition==="unknown")body.allocations[0].actualEventId="90000000-0000-4000-8000-000000000001";
    expect((await POST(req(body),{})).status).toBe(condition==="stale"?409:400);expect(saveForecastReview).not.toHaveBeenCalled();
  });
  it("bounds requests and rejects invalid values before touching storage",async()=>{
    const oversized=await POST(req({...reviewSubmission,padding:"x".repeat(262144)}),{});expect(oversized.status).toBe(400);
    for(const invalid of [{openingCash:""},{closingCash:null},{activityConfirmed:undefined},{allocations:[{}]}]){
      expect((await POST(req({...reviewSubmission,...invalid}),{})).status).toBe(400);
    }
    expect(saveForecastReview).not.toHaveBeenCalled();
  });
  it("records a manual entry with server-owned source identity and currency",async()=>{
    const body={action:"record_actual",versionId:reviewIds.version,weekStart:"2026-10-05",requestKey:reviewIds.request,correctionId:null,
      description:"Customer payment",cashDate:"2026-10-06",amount:900,direction:"inflow",note:"Statement",userId:"other",source_type:"banking",reporting_currency:"EUR"};
    expect((await POST(req(body),{})).status).toBe(200);
    expect(recordManualForecastActual).toHaveBeenCalledWith(reviewIds.owner,reviewIds.business,expect.objectContaining({source_type:"manual",manual_entry:true,
      reporting_currency:"USD",source_connection:"owner-manual",source_event_id:reviewIds.request,lineage:{description:"Customer payment",note:"Statement"}}),null,admin);
    expect((await POST(req({...body,cashDate:"2026-10-12"}),{})).status).toBe(400);
  });
  it("returns safe errors for unexpected storage failures and conflicts",async()=>{
    vi.mocked(saveForecastReview).mockRejectedValue({code:"40001",message:"private details"});
    const conflict=await POST(req(reviewSubmission),{});expect(conflict.status).toBe(409);expect(JSON.stringify(await conflict.json())).not.toContain("private");
    vi.mocked(saveForecastReview).mockRejectedValue(new Error("private database details"));
    const error=await POST(req(reviewSubmission),{});expect(error.status).toBe(500);expect(await error.json()).toEqual({error:"Internal server error",requestId:expect.any(String)});
  });
  it("rejects a cash category that disagrees with the actual direction",async()=>{
    expect((await POST(req({action:"record_actual",versionId:reviewIds.version,weekStart:"2026-10-05",requestKey:reviewIds.request,correctionId:null,
      description:"Payment",cashDate:"2026-10-06",amount:100,direction:"inflow",category:"payroll",note:""}),{})).status).toBe(400);
    expect(recordManualForecastActual).not.toHaveBeenCalled();
  });
  it("corrects manual evidence under its original identity and safely retries after the head changed",async()=>{
    const body={action:"record_actual",versionId:reviewIds.version,weekStart:"2026-10-05",requestKey:reviewIds.request,correctionId:reviewIds.actual,
      description:"Corrected deposit",cashDate:"2026-10-08",amount:950,direction:"inflow",category:"customer_receipt",note:"Statement amount corrected"};
    expect((await POST(req(body),{})).status).toBe(200);
    expect(recordManualForecastActual).toHaveBeenLastCalledWith(reviewIds.owner,reviewIds.business,expect.objectContaining({source_event_id:"manual-receipt",amount:950,category:"customer_receipt"}),reviewIds.actual,admin);
    vi.mocked(getForecastReviewEvidence).mockResolvedValue({...rawReviewEvidence,actual_events:[]});
    const lookup={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{source_event_id:"manual-receipt",source_connection:"owner-manual",source_type:"manual",business_id:reviewIds.business},error:null})};
    admin.from.mockReturnValue(lookup);
    expect((await POST(req(body),{})).status).toBe(200);
    expect(lookup.eq).toHaveBeenCalledWith("user_id",reviewIds.owner);
    lookup.maybeSingle.mockResolvedValue({data:null,error:null} as never);
    expect((await POST(req(body),{})).status).toBe(400);
  });
});
