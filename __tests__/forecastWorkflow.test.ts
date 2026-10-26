import {describe,expect,it} from "vitest";
import {FORECAST_CATEGORIES,forecastCategoriesFor,forecastConfidenceExplanation,forecastConfidenceSummary,forecastItemOwnerGuidance,forecastItemReviewReasons,forecastSaferTiming,forecastSetupProgress,parseForecastDraftDiscardResult,parseForecastItem} from "../lib/forecastWorkflow";

describe("FORECAST-01D manual workflow validation",()=>{
 it("keeps every engine category direction explicit",()=>{
  expect(new Set(FORECAST_CATEGORIES.map(c=>c.value)).size).toBe(13);
  expect(FORECAST_CATEGORIES.find(c=>c.value==="customer_receipt")?.direction).toBe("inflow");
  expect(FORECAST_CATEGORIES.find(c=>c.value==="payroll")?.direction).toBe("outflow");
 });
 it("groups owner choices by cash direction without changing category meaning",()=>{
  expect(forecastCategoriesFor("inflow")).toHaveLength(5);
  expect(forecastCategoriesFor("outflow")).toHaveLength(8);
  expect(forecastCategoriesFor("inflow").every(c=>c.direction==="inflow")).toBe(true);
  expect(forecastCategoriesFor("outflow").every(c=>c.direction==="outflow")).toBe(true);
 });
 it("guides setup from starting cash through cash items to review",()=>{
  expect(forecastSetupProgress({hasVersion:false,itemCount:0,valid:false,warningCount:0})).toMatchObject({step:1,readyToPublish:false});
  expect(forecastSetupProgress({hasVersion:true,itemCount:0,valid:true,warningCount:0})).toMatchObject({step:2,readyToPublish:false});
  expect(forecastSetupProgress({hasVersion:true,itemCount:2,valid:true,warningCount:0})).toEqual({step:3,label:"Review and publish",readyToPublish:true});
  expect(forecastSetupProgress({hasVersion:true,itemCount:2,valid:false,warningCount:1})).toEqual({step:3,label:"Review items that need attention",readyToPublish:false});
 });
 it("normalizes a valid manual item without trusting direction",()=>{
  expect(parseForecastItem({description:" Payroll ",amount:"12500",category:"payroll",expectedDate:"2026-11-01",confidence:"high"})).toEqual({ok:true,value:{id:undefined,description:"Payroll",amount:12500,direction:"outflow",category:"payroll",expectedDate:"2026-11-01",status:"expected",confidence:"high",amountIsEstimate:false,dateIsEstimate:false}});
 });
 it.each([{amount:-1},{amount:"nope"},{amount:""},{expectedDate:"11/1/2026"},{category:"profit"},{description:""}])("rejects invalid item input %o",override=>{
  expect(parseForecastItem({description:"Receipt",amount:100,category:"customer_receipt",expectedDate:"2026-11-01",...override}).ok).toBe(false);
 });
 it("accepts only the database draft-discard result contract",()=>{
  expect(parseForecastDraftDiscardResult({discarded:true,reason:null})).toEqual({discarded:true,reason:null});
  expect(parseForecastDraftDiscardResult({discarded:false,reason:"changed"})).toEqual({discarded:false,reason:"changed"});
  expect(parseForecastDraftDiscardResult({discarded:false,reason:"linked_action"})).toEqual({discarded:false,reason:"linked_action"});
  expect(parseForecastDraftDiscardResult({discarded:true,reason:"changed"})).toBeNull();
  expect(parseForecastDraftDiscardResult({discarded:false,reason:null})).toBeNull();
  expect(parseForecastDraftDiscardResult({discarded:false,reason:"other"})).toBeNull();
 });
 it("identifies evidence that needs attention without changing its confidence",()=>{
  const item={id:"invoice",description:"Customer payment",amount:1000,direction:"inflow" as const,category:"customer_receipt" as const,expectedDate:"2026-11-01",status:"expected" as const,confidence:"low" as const,sourceType:"manual",sourceUpdatedAt:"2026-10-01",amountIsEstimate:false,dateIsEstimate:false};
  expect(forecastItemReviewReasons(item,"2026-10-26")).toEqual([
   "Amount or date needs confirmation","Information needs refreshing",
  ]);
  expect(item.confidence).toBe("low");
  expect(forecastItemReviewReasons({...item,confidence:"confirmed",sourceUpdatedAt:"2026-10-26"},"2026-10-26")).toEqual([]);
  expect(forecastItemReviewReasons({...item,amount:null,expectedDate:null,confidence:"high",sourceUpdatedAt:null},"2026-10-26")).toEqual([
   "Amount or date needed","Information needs refreshing",
  ]);
 });
 it("translates internal confidence into owner language and useful next checks",()=>{
  expect(forecastConfidenceSummary("low")).toBe("Needs confirmation");
  expect(forecastConfidenceSummary("confirmed")).toBe("Confirmed");
  expect(forecastConfidenceExplanation("unknown")).toContain("stay marked Needs confirmation after you save it");
  const receipt=forecastItemOwnerGuidance("customer_receipt","inflow");
  expect(receipt.check).toContain("Confirm when the customer expects to pay.");
  expect(receipt.ifUnconfirmed).toContain("arrives later");
  const payroll=forecastItemOwnerGuidance("payroll","outflow");
  expect(payroll.check[0]).toContain("payroll register");
  expect(payroll.ifUnconfirmed).toContain("higher reasonable amount");
  expect(forecastSaferTiming("2026-11-02","inflow")).toEqual({date:"2026-11-16",label:"Plan for this cash to arrive 2 weeks later"});
  expect(forecastSaferTiming("2026-11-02","outflow")).toEqual({date:"2026-10-26",label:"Plan for this cash to leave 1 week earlier"});
  expect(forecastSaferTiming("not-a-date","inflow")).toBeNull();
 });
});
