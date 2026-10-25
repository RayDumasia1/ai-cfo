import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getRevenueVsBurnChartData } from "../lib/calculations";
import type { FinancialMonth } from "../lib/types";
import RevenueExpensesTooltip from "../app/components/RevenueExpensesTooltip";

// Inspect the chart configuration without pretending SSR verifies SVG geometry or pointer behavior.
vi.mock("recharts",()=>({
  ResponsiveContainer:({children}:{children?:ReactNode})=>createElement("div",null,children),
  LineChart:({children}:{children?:ReactNode})=>createElement("div",null,children),
  CartesianGrid:()=>null,
  YAxis:()=>null,
  Tooltip:()=>null,
  XAxis:({type,ticks,tickFormatter}:{type:string;ticks:number[];tickFormatter:(value:number)=>string})=>
    createElement("span",{"data-axis-type":type},ticks.map(tickFormatter).join(" | ")),
  Line:({name,connectNulls}:{name:string;connectNulls:boolean})=>
    createElement("span",{"data-series":name,"data-connect-nulls":String(connectNulls)}),
}));
import RevenueBurnChart from "../app/components/RevenueBurnChart";

const month=(date:string,revenue:number|null=200,expenses:number|null=100)=>({
  month_date:date,total_revenue:revenue,total_expenses:expenses,opening_cash:100,closing_cash:50,
}) as FinancialMonth;
const chart=(months:FinancialMonth[])=>getRevenueVsBurnChartData(months)!;
const html=(months:FinancialMonth[])=>renderToStaticMarkup(createElement(RevenueBurnChart,{months}));

describe("calendar-spaced revenue/expense chart data",()=>{
  it("inserts an explicit null November between October and December",()=>{
    const months=[month("2024-12-01"),month("2024-10-01")];
    const result=chart(months);
    expect(result.points.map(point=>point.monthDate)).toEqual(["2024-10-01","2024-11-01","2024-12-01"]);
    expect(result.points[1]).toMatchObject({revenue:null,expenses:null,difference:null,missingThrough:"2024-11-01"});
    expect(result.points[1].monthIndex-result.points[0].monthIndex).toBe(1);
    expect(result.points[2].monthIndex-result.points[1].monthIndex).toBe(1);
    expect(result.labels).toHaveLength(2);
    expect(months).toHaveLength(2);
    expect(result.missingMonths).toBe(1);
  });
  it("keeps very long gaps bounded while preserving actual calendar spacing",()=>{
    const result=chart([month("2100-01-01"),month("1900-01-01")]);
    expect(result.points).toHaveLength(3);
    expect(result.ticks).toHaveLength(3);
    expect(result.missingMonths).toBe(2399);
    expect(result.points[2].monthIndex-result.points[0].monthIndex).toBe(2400);
    expect(result.points[1]).toMatchObject({monthDate:"1900-02-01",missingThrough:"2099-12-01"});
  });
  it("handles year rollover and partial null fields independently from real zeros",()=>{
    const result=chart([month("2025-01-01",0,0),month("2024-11-01",null,50)]);
    expect(result.points.map(point=>point.label)).toEqual(["Nov 2024","Dec 2024","Jan 2025"]);
    expect(result.points[0]).toMatchObject({revenue:null,expenses:50,difference:null,missingThrough:null});
    expect(result.points[2]).toMatchObject({revenue:0,expenses:0,difference:0,missingThrough:null});
  });
});

describe("chart presentation",()=>{
  it("shows numeric calendar positions and explicitly disables connecting nulls for both series",()=>{
    const result=html([month("2024-12-01"),month("2024-10-01")]);
    expect(result).toContain('data-axis-type="number"');
    expect(result).toContain("Oct 2024 | Nov 2024 | Dec 2024");
    expect(result).toContain('data-series="Cash collected" data-connect-nulls="false"');
    expect(result).toContain('data-series="Cash paid" data-connect-nulls="false"');
    expect(result).toContain("1 missing month; gaps break the lines");
    expect(result).toContain("Cash Collected vs Cash Paid");
    expect(result).not.toContain("Burn Rate");
  });
  it.each([
    [200,100,"December 2025 cash collected exceeded cash paid by $100."],
    [100,200,"December 2025 cash paid exceeded cash collected by $100."],
    [100,100,"December 2025 cash collected equaled cash paid."],
    [0,0,"December 2025 cash collected equaled cash paid."],
    [null,100,"Cash collected was not provided for December 2025; comparison unavailable."],
    [100,null,"Cash paid was not provided for December 2025; comparison unavailable."],
    [null,null,"Cash collected and cash paid were not provided for December 2025; comparison unavailable."],
  ])("accurately describes revenue %s and expenses %s",(revenue,expenses,expected)=>{
    const result=html([month("2025-12-01",revenue as number|null,expenses as number|null)]);
    expect(result).toContain(expected);
    expect(result).not.toContain("cash flow");
  });
  it("describes only the latest month and uses cents when needed",()=>{
    expect(html([month("2025-12-01",100.25,100),month("2025-11-01",900,1)])).toContain("December 2025 cash collected exceeded cash paid by $0.25.");
  });
  it("keeps an upload link in the empty state",()=>{
    const result=html([]);
    expect(result).toContain("Cash Collected vs Cash Paid · No data yet");
    expect(result).toContain('href="/dashboard/financial-data"');
  });
});

describe("explicit chart tooltip values",()=>{
  const tooltip=(months:FinancialMonth[],index=0)=>renderToStaticMarkup(createElement(RevenueExpensesTooltip,{active:true,point:chart(months).points[index]}));
  it("shows exact amounts, cents and the signed revenue-minus-expenses difference",()=>{
    const result=tooltip([month("2025-12-01",1000.25,1200.5)]);
    expect(result).toContain("December 2025");
    expect(result).toContain("$1,000.25");
    expect(result).toContain("$1,200.50");
    expect(result).toContain("-$200.25");
  });
  it("distinguishes a missing metric from a zero metric",()=>{
    const result=tooltip([month("2025-12-01",null,0)]);
    expect(result).toContain("Not provided");
    expect(result).toContain("$0.00");
    expect(result).toContain("Not available");
  });
  it("describes an absent month even though both series are null",()=>{
    const result=tooltip([month("2024-12-01"),month("2024-10-01")],1);
    expect(result).toContain("November 2024");
    expect(result).toContain("No financial data provided for this month.");
    expect(result.match(/Not provided/g)).toHaveLength(2);
    expect(result).not.toContain("$0");
  });
  it("describes the full missing period for a multi-month gap",()=>{
    const result=tooltip([month("2025-06-01"),month("2025-01-01")],1);
    expect(result).toContain("February 2025–May 2025");
    expect(result).toContain("No financial data provided for this period.");
  });
  it("renders nothing without an active selected point",()=>{
    expect(renderToStaticMarkup(createElement(RevenueExpensesTooltip,{active:false,point:chart([month("2025-01-01")]).points[0]}))).toBe("");
    expect(renderToStaticMarkup(createElement(RevenueExpensesTooltip,{active:true}))).toBe("");
  });
});
