import {describe,expect,it} from "vitest";
import {applyWeeklyPlanDecision,validWeeklyPlanDecision,type WeeklyPlanDecision} from "../lib/cashPlanDecision";
import type {ForecastCashItem} from "../lib/cashForecast";

const items:ForecastCashItem[]=[{id:"bill",description:"Vendor bill",amount:20000,direction:"outflow",category:"operating_vendor_payment",expectedDate:"2026-11-02",status:"expected",confidence:"high",sourceType:"manual",sourceUpdatedAt:"2026-10-26",amountIsEstimate:false,dateIsEstimate:false}];

describe("weekly plan decision copy",()=>{
 it("changes one item without mutating the published inputs",()=>{
  const decision:WeeklyPlanDecision={type:"change_item",itemId:"bill",amount:15000,expectedDate:"2026-11-09"};
  const changed=applyWeeklyPlanDecision(items,decision);
  expect(changed[0]).toMatchObject({amount:15000,expectedDate:"2026-11-09",amountIsEstimate:true,dateIsEstimate:true});
  expect(items[0]).toMatchObject({amount:20000,expectedDate:"2026-11-02",amountIsEstimate:false});
  expect(validWeeklyPlanDecision(decision,items)).toBe(true);
 });
 it("adds a temporary receipt without changing the saved plan",()=>{
  const decision:WeeklyPlanDecision={type:"add_receipt",description:"Credit line",amount:25000,expectedDate:"2026-11-05"};
  const changed=applyWeeklyPlanDecision(items,decision);
  expect(changed).toHaveLength(2);
  expect(changed[1]).toMatchObject({direction:"inflow",category:"other_cash_in",amount:25000});
  expect(items).toHaveLength(1);
 });
 it("rejects invalid amounts, dates, and unknown item references",()=>{
  expect(validWeeklyPlanDecision({type:"change_item",itemId:"missing",amount:1,expectedDate:"2026-11-01"},items)).toBe(false);
  expect(validWeeklyPlanDecision({type:"add_receipt",description:"Loan",amount:-1,expectedDate:"2026-11-01"},items)).toBe(false);
  expect(validWeeklyPlanDecision({type:"add_receipt",description:"Loan",amount:1,expectedDate:"11/1/2026"},items)).toBe(false);
  expect(validWeeklyPlanDecision({type:"add_receipt",description:"Loan",amount:1,expectedDate:"2026-13-40"},items)).toBe(false);
 });
});
