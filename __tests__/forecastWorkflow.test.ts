import {describe,expect,it} from "vitest";
import {FORECAST_CATEGORIES,forecastCategoriesFor,forecastSetupProgress,parseForecastItem} from "../lib/forecastWorkflow";

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
});
