import {describe,expect,it} from "vitest";
import {alertEngine,financialDataAgeDays,legacyCashHealth,runoutDate} from "../lib/calculations";
import type {BusinessProfile,FinancialMonth} from "../lib/types";

const month=(date:string,collected:number|null,paid:number|null,cash=100)=>({
  month_date:date,total_revenue:collected,total_expenses:paid,closing_cash:cash,
  ar_outstanding:null,ap_outstanding:null,
}) as FinancialMonth;
const profile={runway_danger_threshold:3,runway_warning_threshold:6,burn_rate_warning_pct:0.2,
  min_cash_reserve:null} as BusinessProfile;

describe("FIN-02 legacy cash-health compatibility",()=>{
  it("separates spending coverage from conditional net-cash runway",()=>{
    const scenarioA=[month("2026-03-01",54_000,50_600),month("2026-02-01",54_000,50_600),month("2026-01-01",54_000,50_600)];
    const a=legacyCashHealth(190_200,scenarioA);
    expect(a.reportedSpendingCoverage).toBeCloseTo(3.7589);
    expect(a.estimatedNetCashFlow).toBe(3_400);
    expect(a.estimatedNetCashBurn).toBe(0);
    expect(a.estimatedRunway).toBeNull();

    const scenarioC=[month("2026-03-01",29_500,46_700),month("2026-02-01",29_500,46_700),month("2026-01-01",29_500,46_700)];
    const c=legacyCashHealth(20_400,scenarioC);
    expect(c.reportedSpendingCoverage).toBeCloseTo(0.4368);
    expect(c.estimatedNetCashBurn).toBe(17_200);
    expect(c.estimatedRunway).toBeCloseTo(1.186);
  });

  it("stops at gaps and blanks instead of selecting older values",()=>{
    expect(legacyCashHealth(900,[month("2026-03-01",100,200),month("2026-01-01",0,999)]).monthsUsed).toBe(1);
    expect(legacyCashHealth(900,[month("2026-03-01",null,200),month("2026-02-01",100,200)]).monthsUsed).toBe(0);
  });

  it("requires three current comparable months for runway alerts",()=>{
    const three=[month("2026-09-01",0,100,200),month("2026-08-01",0,100),month("2026-07-01",0,100)];
    expect(alertEngine(three,profile,new Date("2026-10-15T00:00:00Z")).map(a=>a.code)).toContain("RUNWAY_DANGER");
    expect(alertEngine(three.slice(0,2),profile,new Date("2026-10-15T00:00:00Z")).map(a=>a.code)).not.toContain("RUNWAY_DANGER");
    expect(alertEngine(three,profile,new Date("2027-02-15T00:00:00Z")).map(a=>a.code)).not.toContain("RUNWAY_DANGER");
  });

  it("uses month-end age and fractional-month depletion projection",()=>{
    expect(financialDataAgeDays("2026-09-01",new Date("2026-10-15T23:59:59Z"))).toBeCloseTo(15);
    expect(runoutDate(6.5,"2026-03-01")).toBe("October 2026");
  });
});
