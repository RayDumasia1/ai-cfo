import { describe,expect,it } from "vitest";
import { calculateForecastCase,caseWarningText,parseCaseSubmission } from "../lib/forecastCases";
import { caseBase,caseIds,caseSubmission } from "./fixtures/forecastCases";
describe("Saved cash-case calculations",()=>{
  it("changes timing and amount on a common base without mutating source items",()=>{
    const before=structuredClone(caseBase),result=calculateForecastCase(caseBase,caseSubmission.assumptions,"2026-10-27");
    expect(result.baseResult.summary.endingCash).toBe(500);expect(result.caseResult.summary).toMatchObject({endingCash:300,lowestProjectedCash:-500,firstReserveBreachWeek:"2026-11-02"});
    expect(result.caseResult.weeks[1]).toMatchObject({endingCash:-500,totalInflows:0,totalOutflows:1500});
    expect(result.caseResult.weeks[2].totalInflows).toBe(800);expect(caseBase).toEqual(before);
    expect(result.baseResult.weeks.map(w=>w.weekStart)).toEqual(result.caseResult.weeks.map(w=>w.weekStart));
  });
  it("retains exact zero and excludes only the explicitly selected item",()=>{
    const zero=calculateForecastCase(caseBase,[{...caseSubmission.assumptions[0],value:0}],"2026-10-27");expect(zero.caseResult.summary.endingCash).toBe(-500);
    const omit=calculateForecastCase(caseBase,[{...caseSubmission.assumptions[0],operation:"exclude",value:null,itemIds:[caseIds.bill]}],"2026-10-27");expect(omit.caseResult.summary.endingCash).toBe(2000);
  });
  it("reports cash shifted out of the horizon as excluded and keeps stale evidence visible",()=>{
    const calculation=calculateForecastCase(caseBase,[{...caseSubmission.assumptions[1],value:100}],"2026-11-20");
    expect(calculation.caseResult.summary.endingCash).toBe(-500);expect(caseWarningText(calculation.caseResult,caseBase.items)).toContain("Customer receipt falls outside the 13-week window and is excluded.");
    expect(calculation.baseResult.freshness.startingCash).toBe("stale");
  });
  it("requires names, valid scope, bounded assumptions and nonconflicting operations",()=>{
    expect(parseCaseSubmission(caseSubmission)).toMatchObject({caseType:"downside",name:"Delayed collections"});
    expect(()=>parseCaseSubmission({...caseSubmission,name:" "})).toThrow();
    expect(()=>parseCaseSubmission({...caseSubmission,assumptions:[{...caseSubmission.assumptions[0],value:11}]})).toThrow();
    expect(()=>calculateForecastCase(caseBase,[{...caseSubmission.assumptions[0],itemIds:[caseIds.request]}],"2026-10-27")).toThrow(/active items/);
    expect(()=>calculateForecastCase(caseBase,[caseSubmission.assumptions[0],{...caseSubmission.assumptions[0],id:caseIds.request}],"2026-10-27")).toThrow(/only one change/);
  });
});
