import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BurnRateCard from "../app/components/BurnRateCard";
import CashOutCard from "../app/components/CashOutCard";
import CashPositionCard from "../app/components/CashPositionCard";
import RunwayCard from "../app/components/RunwayCard";
import { alertEngine, currentRunway, runoutDate } from "../lib/calculations";
import { isAlertSnoozed } from "../lib/calculations";
import { isDismissibleAlertCode, isProtectedAlertCode } from "../lib/alertPolicy";
import { alertToActionPrefill } from "../lib/actions";
import type { BusinessProfile, FinancialMonth } from "../lib/types";

function month(date:string,overrides:Partial<FinancialMonth>={}):FinancialMonth {
  return {id:date,user_id:"user",business_id:null,month_date:date,opening_cash:100_000,
    closing_cash:70_000,total_revenue:40_000,total_expenses:55_000,payroll:null,
    ar_outstanding:null,ap_outstanding:null,notes:null,data_contract_version:2,
    source_type:"spreadsheet",accounting_basis:"cash",reporting_currency:"USD",
    period_status:"complete",period_cutoff_date:null,opening_included_cash:85_000,
    closing_included_cash:70_000,closing_unavailable_cash:10_000,
    cash_collected_from_customers:40_000,operating_cash_paid:55_000,owner_draws_paid:0,
    debt_principal_paid:0,debt_interest_paid:0,investing_cash_paid:0,
    investing_cash_received:0,debt_funding_received:0,owner_funding_received:0,
    other_cash_inflows:0,other_cash_outflows:0,closing_taxes_reserved:null,
    ar_expected_within_30_days:null,ap_due_within_30_days:null,available_credit:null,
    credit_currently_drawn:null,lowest_observed_cash:null,cash_reconciliation_difference:0,
    created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",...overrides};
}

const months=[month("2026-09-01"),month("2026-08-01"),month("2026-07-01")];
const profile={min_cash_reserve:65_000,runway_warning_threshold:6,
  runway_danger_threshold:3,burn_rate_warning_pct:0.05} as BusinessProfile;
const render=(component:ReturnType<typeof createElement>)=>renderToStaticMarkup(component)
  .replace(/<!--.*?-->/g,"");

describe("FIN-03B normalized dashboard",()=>{
  it("uses available cash and owner-friendly operating labels for v2 data",()=>{
    const html=[
      render(createElement(CashPositionCard,{initialData:{cash:70_000,month:"2026-09-01",previousCash:70_000},months,minCashReserve:65_000})),
      render(createElement(BurnRateCard,{cash:70_000,months})),
      render(createElement(RunwayCard,{cash:70_000,months})),
      render(createElement(CashOutCard,{cash:70_000,months})),
    ].join(" ");
    expect(html).toContain("Available Cash");
    expect(html).toContain("$60,000");
    expect(html).toContain("$10,000 unavailable");
    expect(html).toContain("Operating Cash Buffer");
    expect(html).toContain("Operating Cash Trend");
    expect(html).toContain("$15,000/mo shortfall");
    expect(html).toContain("Operating Runway");
    expect(html).toContain("4.0 months");
    expect(html).toContain("Operating spending outpaced collections");
  });

  it("keeps funding and investing activity out of customer-facing operating results",()=>{
    const funded=months.map((item,index)=>({...item,owner_funding_received:index===0?500_000:0,
      debt_funding_received:index===0?250_000:0,investing_cash_received:index===0?100_000:0}));
    expect(currentRunway(70_000,funded,new Date("2026-10-15T00:00:00Z"))).toBe(4);
    const html=render(createElement(RunwayCard,{cash:70_000,months:funded}));
    expect(html).toContain("$15,000/mo shortfall");
  });

  it("uses normalized runway and available cash for v2 alerts",()=>{
    const alerts=alertEngine(months,profile,new Date("2026-10-15T00:00:00Z"));
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({code:"OPERATING_RUNWAY_WARNING",title:"Operating runway below 6 months"}),
      expect.objectContaining({code:"AVAILABLE_CASH_BELOW_RESERVE",title:"Available cash below minimum reserve"}),
    ]));
    expect(alerts.map(alert=>alert.code)).not.toContain("HIGH_AR");
  });

  it("requires three eligible v2 months and current data for runway alerts",()=>{
    expect(alertEngine(months.slice(0,2),profile,new Date("2026-10-15T00:00:00Z"))
      .map(alert=>alert.code)).not.toContain("OPERATING_RUNWAY_WARNING");
    expect(alertEngine(months,profile,new Date("2027-02-15T00:00:00Z"))).toEqual([]);
  });

  it("uses distinct v2 alert identities and preserves danger-alert protection",()=>{
    const changing=[
      month("2026-09-01",{operating_cash_paid:60_000,cash_collected_from_customers:42_000}),
      month("2026-08-01",{operating_cash_paid:50_000,cash_collected_from_customers:38_000}),
      month("2026-07-01",{operating_cash_paid:50_000,cash_collected_from_customers:38_000}),
    ];
    const alerts=alertEngine(changing,profile,new Date("2026-10-15T00:00:00Z"));
    expect(alerts.map(alert=>alert.code)).toEqual(expect.arrayContaining([
      "OPERATING_SPENDING_INCREASE","CUSTOMER_COLLECTIONS_INCREASE",
    ]));
    expect(isProtectedAlertCode("OPERATING_RUNWAY_DANGER")).toBe(true);
    expect(isProtectedAlertCode("AVAILABLE_CASH_BELOW_RESERVE")).toBe(true);
    expect(isDismissibleAlertCode("OPERATING_RUNWAY_WARNING")).toBe(true);
    expect(isAlertSnoozed("OPERATING_RUNWAY_DANGER",[{
      id:"dismissal",user_id:"user",alert_code:"OPERATING_RUNWAY_DANGER",
      dismissed_at:"2026-10-01",snooze_until:"2099-01-01",snooze_type:"7d",
      data_version:null,created_at:"2026-10-01",
    }],null)).toBe(false);
  });

  it("warns when the newest complete month has confirmed zero collections after a positive month",()=>{
    const zero=[
      month("2026-09-01",{cash_collected_from_customers:0}),
      month("2026-08-01",{cash_collected_from_customers:38_000}),
      month("2026-07-01",{cash_collected_from_customers:36_000}),
    ];
    expect(alertEngine(zero,profile,new Date("2026-10-15T00:00:00Z"))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code:"CUSTOMER_COLLECTIONS_ZERO",severity:"warning",title:"No customer cash collected",
        message:expect.stringContaining("September 2026 reports no customer cash collected, following $38,000"),
      }),
    ]));
    expect(isDismissibleAlertCode("CUSTOMER_COLLECTIONS_ZERO")).toBe(true);
  });

  it("does not warn for consistently zero, partial, missing-comparison, or stale collections",()=>{
    const codes=(data:FinancialMonth[],now=new Date("2026-10-15T00:00:00Z"))=>alertEngine(data,profile,now).map(item=>item.code);
    expect(codes(months.map(item=>({...item,cash_collected_from_customers:0})))).not.toContain("CUSTOMER_COLLECTIONS_ZERO");
    expect(codes([month("2026-09-01",{period_status:"partial",period_cutoff_date:"2026-09-20",cash_collected_from_customers:0}),...months.slice(1)]))
      .not.toContain("CUSTOMER_COLLECTIONS_ZERO");
    expect(codes([month("2026-09-01",{cash_collected_from_customers:0})])).not.toContain("CUSTOMER_COLLECTIONS_ZERO");
    expect(codes([month("2026-09-01",{cash_collected_from_customers:0}),month("2026-08-01")],new Date("2027-02-15T00:00:00Z")))
      .not.toContain("CUSTOMER_COLLECTIONS_ZERO");
  });

  it("offers operating-specific actions for normalized risk alerts",()=>{
    const alert=alertEngine(months,profile,new Date("2026-10-15T00:00:00Z"))
      .find(item=>item.code==="OPERATING_RUNWAY_WARNING")!;
    expect(alertToActionPrefill(alert)).toMatchObject({
      name:"Improve operating cash runway",linked_alert_code:"OPERATING_RUNWAY_WARNING",
    });
  });

  it("uses partial-period available cash but complete months for operating results",()=>{
    const partial=month("2026-10-01",{period_status:"partial",period_cutoff_date:"2026-10-20",
      closing_included_cash:50_000,closing_unavailable_cash:5_000});
    const data=[partial,...months];
    const cash=render(createElement(CashPositionCard,{initialData:null,months:data}));
    const trend=render(createElement(RunwayCard,{cash:null,months:data}));
    expect(cash).toContain("$45,000");
    expect(cash).toContain("Oct 20, 2026");
    expect(trend).toContain("$15,000/mo shortfall");
  });

  it("does not treat unknown unavailable cash as zero",()=>{
    const unknown=[month("2026-09-01",{closing_unavailable_cash:null})];
    const cash=render(createElement(CashPositionCard,{initialData:{cash:70_000,month:"2026-09-01",previousCash:null},months:unknown}));
    expect(cash).toContain("Included or unavailable cash is missing");
    expect(cash).not.toContain("$70,000");
  });

  it("uses a partial cash cutoff as the depletion projection anchor",()=>{
    expect(runoutDate(0.5,"2026-04-10")).toBe("April 2026");
  });
});
