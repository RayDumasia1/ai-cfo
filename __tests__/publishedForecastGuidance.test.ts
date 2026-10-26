import {describe,expect,it} from "vitest";
import type {ForecastResult} from "../lib/cashForecast";
import {buildPublishedForecastGuidance} from "../lib/publishedForecastGuidance";

function result(overrides:Partial<ForecastResult["summary"]>={}):ForecastResult{return {
 valid:true,errors:[],warnings:[],freshness:{startingCash:"current",startingCashAgeDays:0,staleScheduledItemCount:0},
 weeks:[
  {index:0,weekStart:"2026-10-26",weekEnd:"2026-11-01",beginningCash:50000,totalInflows:10000,totalOutflows:20000,netCashFlow:-10000,endingCash:40000,operatingNetCashFlow:-10000,belowMinimumReserve:false,coverage:"unknown",itemIds:["payroll"],totalsByCategory:{payroll:20000}},
  {index:1,weekStart:"2026-11-02",weekEnd:"2026-11-08",beginningCash:40000,totalInflows:0,totalOutflows:25000,netCashFlow:-25000,endingCash:15000,operatingNetCashFlow:-25000,belowMinimumReserve:true,coverage:"unknown",itemIds:["vendor"],totalsByCategory:{operating_vendor_payment:25000}},
 ],
 summary:{lowestProjectedCash:15000,lowestProjectedCashWeek:"2026-11-02",firstReserveBreachWeek:"2026-11-02",cumulativeOperatingNetCashFlow:-35000,endingCash:15000,scheduledItemCount:2,unresolvedItemCount:0,lowConfidenceItemCount:0,weeksConfirmedComplete:0,...overrides},
};}
const items=[
 {id:"payroll",description:"Payroll",amount:20000,direction:"outflow" as const,expectedDate:"2026-10-30"},
 {id:"vendor",description:"Key vendor",amount:25000,direction:"outflow" as const,expectedDate:"2026-11-03"},
 {id:"later",description:"Later payment",amount:50000,direction:"outflow" as const,expectedDate:"2027-01-01"},
];

describe("published weekly-plan guidance",()=>{
 it("explains a reserve risk and ranks only planned cash out through the low point",()=>{
  const guidance=buildPublishedForecastGuidance({result:result(),items,minimumReserve:25000,evaluationDate:"2026-10-26",reportingCurrency:"USD"});
  expect(guidance.severity).toBe("warning");
  expect(guidance.headline).toContain("reserve");
  expect(guidance.drivers.map(item=>item.id)).toEqual(["vendor","payroll"]);
  expect(guidance.nextReviewDate).toBe("2026-11-02");
 });
 it("escalates negative cash without overstating confidence",()=>{
  const forecast=result({lowestProjectedCash:-5000,endingCash:-5000,unresolvedItemCount:1,lowConfidenceItemCount:2});
  forecast.freshness.startingCash="stale";
  const guidance=buildPublishedForecastGuidance({result:forecast,items,minimumReserve:25000,evaluationDate:"2026-10-26",reportingCurrency:"USD"});
  expect(guidance.severity).toBe("critical");
  expect(guidance.confidenceNote).toContain("1 unresolved item");
  expect(guidance.confidenceNote).toContain("2 low-confidence items");
  expect(guidance.confidenceNote).toContain("starting cash balance");
 });
 it("reports a plan above reserve as positive",()=>{
  const guidance=buildPublishedForecastGuidance({result:result({lowestProjectedCash:30000,firstReserveBreachWeek:null,endingCash:32000}),items,minimumReserve:25000,evaluationDate:"2026-10-26",reportingCurrency:"USD"});
  expect(guidance.severity).toBe("positive");
  expect(guidance.headline).toContain("stays above");
 });
});
