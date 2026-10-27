// Explicitly opt in: $env:RUN_PREVIEW_REVIEW='1'; npx vitest run __tests__/forecastReviewPreview.test.ts
// Read-only checks against the confirmed preview project. No fixture writes.
import { beforeAll,describe,expect,it,vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getForecastCases,getForecastReviewEvidence,getForecastReviewQueue,getOwnerForecastReview } from "../lib/db";
let client:SupabaseClient,owner:string,other:string,version:string;
describe.skipIf(process.env.RUN_PREVIEW_REVIEW!=="1")("Supabase preview weekly review reads",()=>{
  beforeAll(async()=>{
    process.loadEnvFile(".env.local");
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL!;
    expect(new URL(url).hostname.split(".")[0]).toBe(process.env.PREVIEW_PROJECT_REF);
    owner=process.env.PREVIEW_TEST_ACCOUNT_A!;other=process.env.PREVIEW_TEST_ACCOUNT_B!;
    expect(owner).toBeTruthy();expect(other).toBeTruthy();expect(owner).not.toBe(other);
    client=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.from("cash_forecast_versions").select("id").eq("user_id",owner).in("status",["published","superseded"]).limit(1).single();
    if(error)throw error;version=data.id;
  });
  it("runs the actual queue adapter against preview without schema or grant errors",async()=>{
    for(const user of [owner,other]){
      const queue=await getForecastReviewQueue(user,new Date().toISOString().slice(0,10),client);
      expect(Array.isArray(queue.weeks)).toBe(true);expect(typeof queue.hasPublishedPlan).toBe("boolean");
      console.log(`Preview weekly review queue: ${queue.weeks.length} completed weeks; published plan: ${queue.hasPublishedPlan}.`);
    }
  });
  it("cannot read another account's forecast evidence through the service RPC",async()=>{
    await expect(getForecastReviewEvidence(other,version,"2026-10-05",client)).rejects.toMatchObject({code:"P0002"});
  });
  it("loads the E5 case adapter against the real preview schema",async()=>{
    const state=await getForecastCases(owner,null,client);
    expect(state.base?.status).toBe("published");expect(state.currentBaseId).toBe(state.base?.id);
    expect(Array.isArray(state.cases)).toBe(true);
    expect(state.bases.every(b=>b.status==="published"||b.status==="superseded")).toBe(true);
  });
  it("loads a reviewable week's DTO when preview has a closed week",async context=>{
    const queue=await getForecastReviewQueue(owner,new Date().toISOString().slice(0,10),client);
    if(!queue.weeks.length){context.skip();return;}
    const week=queue.weeks[0];const state=await getOwnerForecastReview(owner,week.versionId,week.weekStart,client);
    expect(state.evidence.version_id).toBe(week.versionId);expect(Array.isArray(state.history)).toBe(true);
    expect(state.evidence.evidence_token).toMatch(/^[a-f0-9]{32}$/);
  });
});
