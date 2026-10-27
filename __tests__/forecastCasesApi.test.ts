import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only",()=>({}));
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../utils/supabase/service",()=>({createServiceClient:vi.fn()}));
vi.mock("../lib/db",()=>({getSubscription:vi.fn(),hasPaidSubscription:vi.fn(),getForecastCases:vi.fn(),getForecastCaseReplay:vi.fn(),saveForecastCase:vi.fn()}));
vi.mock("../lib/forecastWorkflow",async original=>({...await original<typeof import("../lib/forecastWorkflow")>(),todayIso:()=>"2026-10-27"}));
import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { getSubscription,hasPaidSubscription,getForecastCases,getForecastCaseReplay,saveForecastCase } from "../lib/db";
import { GET,POST } from "../app/api/forecast-cases/route";
import { GET as coreForecast } from "../app/api/cash-forecast/route";
import { caseIds,caseSubmission,emptyCases,fixtureCaseCalculation } from "./fixtures/forecastCases";
const getUser=vi.fn(),client={auth:{getUser}},admin={from:vi.fn()};
const req=(body:unknown)=>new NextRequest("https://example.invalid/api/forecast-cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.resetAllMocks();vi.spyOn(console,"error").mockImplementation(()=>{});vi.mocked(createClient).mockResolvedValue(client as never);vi.mocked(createServiceClient).mockReturnValue(admin as never);
  getUser.mockResolvedValue({data:{user:{id:caseIds.owner,email:"owner@example.invalid",email_confirmed_at:"2026-01-01"}},error:null});
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);vi.mocked(getSubscription).mockResolvedValue({feature_tier:"growth"} as never);
  vi.mocked(getForecastCases).mockResolvedValue(structuredClone(emptyCases));vi.mocked(getForecastCaseReplay).mockResolvedValue(null);
  vi.mocked(saveForecastCase).mockResolvedValue({version_id:caseIds.saved,version_number:2,replayed:false});
});
afterEach(()=>vi.restoreAllMocks());
describe("Growth saved-case API",()=>{
  it.each(["missing","unverified","unpaid","starter","core","suspended"])("blocks %s before service access",async condition=>{
    if(condition==="missing")getUser.mockResolvedValue({data:{user:null},error:null});
    else if(condition==="unverified")getUser.mockResolvedValue({data:{user:{id:caseIds.owner,email:"owner@example.invalid"}},error:null});
    else if(condition==="unpaid")vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    else vi.mocked(getSubscription).mockResolvedValue({feature_tier:condition} as never);
    expect((await POST(req(caseSubmission),{})).status).toBe(condition==="missing"?401:condition==="unverified"?403:402);expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("loads only the session owner's selected base and calculates a fresh common baseline",async()=>{
    const r=await GET(new NextRequest(`https://example.invalid/api/forecast-cases?baseVersionId=${caseIds.base}&userId=other`),{});
    expect(r.status).toBe(200);expect(getForecastCases).toHaveBeenCalledWith(caseIds.owner,caseIds.base,admin);
    expect((await r.json()).baseResult.summary.endingCash).toBe(500);
  });
  it("ignores submitted results and actor IDs when calculating and saving",async()=>{
    const r=await POST(req({...caseSubmission,userId:"other",result:{endingCash:999999}}),{});expect(r.status).toBe(200);
    expect(saveForecastCase).toHaveBeenCalledWith(caseIds.owner,expect.objectContaining({baseVersionId:caseIds.base,name:"Delayed collections"}),fixtureCaseCalculation,admin);
  });
  it("calculates without writing a version",async()=>{
    const r=await POST(req({...caseSubmission,action:"calculate"}),{});expect(r.status).toBe(200);
    expect((await r.json()).calculation.caseResult.summary.endingCash).toBe(300);expect(saveForecastCase).not.toHaveBeenCalled();
  });
  it("replays the original saved calculation after the base or evaluation date changes",async()=>{
    const {action,requestKey,...input}=caseSubmission;void action;void requestKey;
    vi.mocked(getForecastCaseReplay).mockResolvedValue({...input,...fixtureCaseCalculation});
    expect((await POST(req(caseSubmission),{})).status).toBe(200);expect(getForecastCases).not.toHaveBeenCalled();
    expect((await POST(req({...caseSubmission,name:"Changed name"}),{})).status).toBe(409);
  });
  it("rejects invalid, foreign and conflicting assumptions before saving",async()=>{
    for(const assumptions of [[{...caseSubmission.assumptions[0],value:11}],
      [{...caseSubmission.assumptions[0],itemIds:[caseIds.request]}],
      [caseSubmission.assumptions[0],{...caseSubmission.assumptions[0],id:caseIds.request}]]){
      expect((await POST(req({...caseSubmission,assumptions}),{})).status).toBe(400);
    }
    expect(saveForecastCase).not.toHaveBeenCalled();
    expect((await POST(req({...caseSubmission,padding:"x".repeat(262144)}),{})).status).toBe(400);
  });
  it("maps stale-base conflicts safely without revealing database details",async()=>{
    vi.mocked(saveForecastCase).mockRejectedValue({code:"40001",message:"private failure"});const r=await POST(req(caseSubmission),{});
    expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toContain("private");
  });
  it("keeps the Core forecast on its base even when a case has the highest version number",async()=>{
    vi.mocked(getSubscription).mockResolvedValue({feature_tier:"core"} as never);let filter:string|null=null;
    const versionQuery={select:vi.fn().mockReturnThis(),eq:vi.fn((key:string,value:string)=>{if(key==="case_type")filter=value;return versionQuery;}),
      in:vi.fn().mockReturnThis(),order:vi.fn(async()=>({data:filter==="base"?[{id:caseIds.base,status:"published"}]:[{id:caseIds.saved,status:"published"},{id:caseIds.base,status:"published"}],error:null}))};
    const forecastQuery={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:{id:caseIds.forecast},error:null}))};
    const itemQuery={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn(async()=>({data:[],error:null}))};
    admin.from.mockImplementation((table:string)=>table==="cash_forecasts"?forecastQuery:table==="cash_forecast_versions"?versionQuery:itemQuery);
    const response=await coreForecast(new NextRequest("https://example.invalid/api/cash-forecast"),{});
    expect(response.status).toBe(200);expect((await response.json()).version.id).toBe(caseIds.base);
  });
});
