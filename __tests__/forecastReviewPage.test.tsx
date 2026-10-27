import { beforeEach,describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../lib/db",()=>({getSubscription:vi.fn(),hasPaidSubscription:vi.fn(),getForecastReviewQueue:vi.fn(),
  getForecastReviewHandoff:vi.fn(),getBusinessProfile:vi.fn(),getLatestForecastCash:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:vi.fn((url:string)=>{throw new Error(`redirect:${url}`);})}));
vi.mock("../app/dashboard/forecast/ForecastClient",()=>({default:()=> <div>Weekly plan editor</div>}));
import { createClient } from "../utils/supabase/server";
import { getSubscription,hasPaidSubscription,getForecastReviewQueue,getForecastReviewHandoff } from "../lib/db";
import ForecastReviewPage from "../app/dashboard/forecast-review/page";
import ForecastPage from "../app/dashboard/forecast/page";
import { reviewIds } from "./fixtures/forecastReview";
const getUser=vi.fn(),client={auth:{getUser}};
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({data:{user:{id:reviewIds.owner,email:"owner@example.invalid",email_confirmed_at:"2026-01-01"}},error:null});
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);vi.mocked(getSubscription).mockResolvedValue({feature_tier:"growth"} as never);
  vi.mocked(getForecastReviewQueue).mockResolvedValue({weeks:[],hasPublishedPlan:false});
});
describe("Weekly review page and next-plan boundary",()=>{
  it.each(["missing","unverified","unpaid"])("rejects %s before loading the queue",async kind=>{
    if(kind==="missing")getUser.mockResolvedValue({data:{user:null},error:null});
    if(kind==="unverified")getUser.mockResolvedValue({data:{user:{id:reviewIds.owner,email:"owner@example.invalid"}},error:null});
    if(kind==="unpaid")vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    await expect(ForecastReviewPage()).rejects.toThrow("redirect:");expect(getForecastReviewQueue).not.toHaveBeenCalled();
  });
  it("offers Core owners upgrade context and their existing plan without reading Growth evidence",async()=>{
    vi.mocked(getSubscription).mockResolvedValue({feature_tier:"core"} as never);
    const html=renderToStaticMarkup(await ForecastReviewPage());expect(html).toContain("available on Growth");expect(html).toContain("Open weekly cash plan");
    expect(getForecastReviewQueue).not.toHaveBeenCalled();
  });
  it("loads Growth's queue only for the authenticated account",async()=>{
    const html=renderToStaticMarkup(await ForecastReviewPage());expect(html).toContain("Publish a weekly cash plan first");
    expect(getForecastReviewQueue).toHaveBeenCalledWith(reviewIds.owner,expect.any(String),client);
  });
  it("uses an owner-scoped review handoff and warns before relying on a partial review",async()=>{
    vi.mocked(getForecastReviewHandoff).mockResolvedValue({id:reviewIds.review,weekStart:"2026-10-05",coverage:"partial",closingCash:5900});
    const html=renderToStaticMarkup(await ForecastPage({searchParams:Promise.resolve({review:reviewIds.review})}));
    expect(getForecastReviewHandoff).toHaveBeenCalledWith(reviewIds.owner,reviewIds.review,client);
    expect(html).toContain("That review is partial");expect(html).toContain("Weekly plan editor");
  });
});
