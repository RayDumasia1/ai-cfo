import { beforeEach,describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../lib/db",()=>({getSubscription:vi.fn(),hasPaidSubscription:vi.fn(),getForecastCases:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:vi.fn((url:string)=>{throw new Error(`redirect:${url}`);})}));
import { createClient } from "../utils/supabase/server";
import { getSubscription,hasPaidSubscription,getForecastCases } from "../lib/db";
import ForecastCasesPage from "../app/dashboard/forecast-cases/page";
import { caseIds,emptyCases } from "./fixtures/forecastCases";
const getUser=vi.fn(),client={auth:{getUser}};
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({data:{user:{id:caseIds.owner,email:"owner@example.invalid",email_confirmed_at:"2026-01-01"}},error:null});
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);vi.mocked(getSubscription).mockResolvedValue({feature_tier:"growth"} as never);vi.mocked(getForecastCases).mockResolvedValue(structuredClone(emptyCases));
});
describe("Saved-case page boundary",()=>{
  it.each(["missing","unverified","unpaid"])("rejects %s before loading case data",async kind=>{
    if(kind==="missing")getUser.mockResolvedValue({data:{user:null},error:null});
    if(kind==="unverified")getUser.mockResolvedValue({data:{user:{id:caseIds.owner,email:"owner@example.invalid"}},error:null});
    if(kind==="unpaid")vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    await expect(ForecastCasesPage()).rejects.toThrow("redirect:");expect(getForecastCases).not.toHaveBeenCalled();
  });
  it("offers Core upgrade context without loading Growth case evidence",async()=>{
    vi.mocked(getSubscription).mockResolvedValue({feature_tier:"core"} as never);const html=renderToStaticMarkup(await ForecastCasesPage());
    expect(html).toContain("Saved cases are available on Growth");expect(getForecastCases).not.toHaveBeenCalled();
  });
  it("loads the authenticated Growth account and shows its shared base",async()=>{
    const html=renderToStaticMarkup(await ForecastCasesPage());expect(html).toContain("Base plan 1");expect(html).toContain("No cases saved for this base yet");
    expect(getForecastCases).toHaveBeenCalledWith(caseIds.owner,null,client);
  });
});
