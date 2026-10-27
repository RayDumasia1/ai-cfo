import { describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getForecastCases } from "../lib/db";
import { caseIds } from "./fixtures/forecastCases";
function fixture(count:number){
  const rows=Array.from({length:count},(_,n)=>({id:`80000000-0000-4000-8000-${String(n).padStart(12,"0")}`,description:`Receipt ${n}`,amount:1,direction:"inflow",category:"customer_receipt",expected_date:"2026-10-27",status:"confirmed",confidence:"confirmed",source_type:"manual",source_updated_at:"2026-10-26",amount_is_estimated:false,date_is_estimated:false}));
  const range=vi.fn(async(start:number,end:number)=>({data:rows.slice(start,end+1),error:null}));
  const from=vi.fn((table:string)=>{
    let cases=false;
    const q={select:vi.fn((fields:string)=>{cases=fields.includes("case_request_payload");return q;}),eq:vi.fn().mockReturnThis(),in:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range,
      maybeSingle:vi.fn(async()=>({data:{id:caseIds.forecast,reporting_currency:"USD"},error:null})),
      limit:vi.fn(async()=>({data:cases?[]:[{id:caseIds.base,version_number:1,status:"published",start_date:"2026-10-26",as_of_date:"2026-10-26",starting_included_cash:1000,minimum_reserve:400,formula_policy_version:"forecast-1"}],error:null}))};
    expect(["cash_forecasts","cash_forecast_versions","cash_forecast_items"]).toContain(table);return q;
  });
  return {client:{from} as unknown as SupabaseClient,range};
}
describe("Case source pagination",()=>{
  it("includes every immutable base item beyond PostgREST's default page",async()=>{
    const {client,range}=fixture(1001);const state=await getForecastCases(caseIds.owner,null,client);
    expect(state.base?.items).toHaveLength(1001);expect(range.mock.calls).toEqual([[0,999],[1000,1999]]);
  });
  it("fails explicitly above the supported bound instead of comparing a truncated base",async()=>{
    const {client}=fixture(2001);await expect(getForecastCases(caseIds.owner,null,client)).rejects.toMatchObject({code:"54000"});
  });
});
