import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getCurrentCashPosition } from "../lib/db";
import { alertEngine, areConsecutiveFinancialMonths } from "../lib/calculations";
import type { BusinessProfile, FinancialMonth } from "../lib/types";
import BurnRateCard from "../app/components/BurnRateCard";
import RunwayCard from "../app/components/RunwayCard";
import CashPositionCard from "../app/components/CashPositionCard";

const month=(date:string,cash:number,expenses:number,revenue:number)=>({month_date:date,closing_cash:cash,total_expenses:expenses,total_revenue:revenue,ar_outstanding:null}) as FinancialMonth;
const profile={runway_danger_threshold:3,runway_warning_threshold:6,burn_rate_warning_pct:0.2,min_cash_reserve:2000} as BusinessProfile;
const current=month("2025-04-01",900,200,200);
const previous=month("2025-02-01",800,100,100);
const query={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn()};
const client={from:vi.fn(()=>query)} as unknown as SupabaseClient;
const clean=(html:string)=>html.replace(/<!--.*?-->/g,"");
beforeEach(()=>{
  vi.clearAllMocks();
  for(const name of ["select","eq","order"] as const)query[name].mockReturnValue(query);
  query.limit.mockResolvedValue({data:[current,previous],error:null});
});

describe("calendar-based month-over-month comparisons",()=>{
  it.each([
    ["2025-01-01","2024-12-01",true], ["2025-03-01","2025-02-01",true],
    ["2025-04-01","2025-02-01",false], ["2025-03-01","2025-03-01",false],
    ["2025-02-01","2025-03-01",false], ["bad","2025-02-01",false],
    ["2025-13-01","2025-12-01",false], ["2025-03-02","2025-02-01",false],
    ["2025-03-01",null,false],
  ])("checks calendar adjacency for %s and %s",(current,previous,expected)=>{
    expect(areConsecutiveFinancialMonths(current as string,previous as string|null)).toBe(expected);
  });
  it("does not report February cash as March when April is the latest month",async()=>{
    const cash=await getCurrentCashPosition("own-account",client);
    expect(cash).toEqual({cash:900,month:"2025-04-01",previousCash:null});
    const html=renderToStaticMarkup(createElement(CashPositionCard,{initialData:cash}));
    expect(html).not.toContain("+$100 vs last month");
    expect(html).toContain("Previous-month cash unavailable");
  });
  it("suppresses misleading burn/runway changes across a gap while retaining current metrics",()=>{
    const months=[current,previous];
    const burn=clean(renderToStaticMarkup(createElement(BurnRateCard,{months})));
    const runway=clean(renderToStaticMarkup(createElement(RunwayCard,{months,cash:900})));
    expect(burn).toContain("$150/mo");
    expect(runway).toContain("6.0 months");
    for(const html of [burn,runway]) {
      expect(html).toContain("Previous-month data unavailable");
      expect(html).not.toContain("vs last month");
    }
  });
  it("suppresses only comparative alerts across gaps, retaining current-state alerts",()=>{
    const codes=alertEngine([current,previous],profile).map(alert=>alert.code);
    expect(codes).not.toContain("BURN_RATE_SPIKE");
    expect(codes).not.toContain("REVENUE_GROWTH");
    expect(codes).toContain("CASH_BELOW_RESERVE");
  });
  it.each([["2025-04-01","2025-03-01"],["2025-01-01","2024-12-01"]])("keeps genuine consecutive comparisons for %s after %s",async(currentDate,previousDate)=>{
    const months=[{...current,month_date:currentDate},{...previous,month_date:previousDate}];
    query.limit.mockResolvedValue({data:months,error:null});
    const cash=await getCurrentCashPosition("own-account",client);
    expect(cash?.previousCash).toBe(800);
    expect(renderToStaticMarkup(createElement(CashPositionCard,{initialData:cash}))).toContain("+$100 vs last month");
    expect(clean(renderToStaticMarkup(createElement(BurnRateCard,{months})))).toContain("100.0% vs last month");
    expect(clean(renderToStaticMarkup(createElement(RunwayCard,{months,cash:900})))).toContain("months vs last month");
    expect(alertEngine(months,profile).map(alert=>alert.code)).toEqual(expect.arrayContaining(["BURN_RATE_SPIKE","REVENUE_GROWTH"]));
  });
  it("does not present a percentage change from zero expenses as zero percent",()=>{
    const months=[current,{...previous,month_date:"2025-03-01",total_expenses:0}];
    const html=clean(renderToStaticMarkup(createElement(BurnRateCard,{months})));
    expect(html).not.toContain("0.0% vs last month");
    expect(html).toContain("Percentage change unavailable");
  });
});
