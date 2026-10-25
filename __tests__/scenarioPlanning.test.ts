import { describe, expect, it } from "vitest";
import { scenarioActionOptions, scenarioBaseline } from "../lib/scenarioPlanning";
import type { FinancialMonth } from "../lib/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ManualCalculator from "../app/components/ManualCalculator";
import ScenarioSummaryCard from "../app/components/ScenarioSummaryCard";
import { validateActionCreate } from "../lib/actions";

function row(overrides: Partial<FinancialMonth> = {}): FinancialMonth {
  return {
    id:"row",user_id:"account-a",business_id:null,month_date:"2026-09-01",
    opening_cash:100_000,closing_cash:90_000,total_revenue:45_000,total_expenses:55_000,
    payroll:null,ar_outstanding:null,ap_outstanding:null,notes:null,data_contract_version:2,
    source_type:"spreadsheet",accounting_basis:"cash",reporting_currency:"USD",
    period_status:"complete",period_cutoff_date:null,opening_included_cash:100_000,
    closing_included_cash:90_000,closing_unavailable_cash:10_000,
    cash_collected_from_customers:45_000,operating_cash_paid:55_000,
    owner_draws_paid:0,debt_principal_paid:0,debt_interest_paid:0,investing_cash_paid:0,
    investing_cash_received:0,debt_funding_received:0,owner_funding_received:0,
    other_cash_inflows:0,other_cash_outflows:0,closing_taxes_reserved:null,
    ar_expected_within_30_days:null,ap_due_within_30_days:null,available_credit:null,
    credit_currently_drawn:null,lowest_observed_cash:null,cash_reconciliation_difference:0,
    created_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z",...overrides,
  };
}

describe("FIN-03C2 scenario baseline", () => {
  it("builds a v2 baseline from available cash and normalized operating averages", () => {
    const rows=[row(),row({id:"aug",month_date:"2026-08-01",cash_collected_from_customers:40_000}),
      row({id:"jul",month_date:"2026-07-01",cash_collected_from_customers:50_000})];
    expect(scenarioBaseline(999_999,rows,new Date("2026-10-15T00:00:00Z"))).toMatchObject({
      status:"ready",contractVersion:2,currency:"USD",availableCash:80_000,
      monthlyCashCollected:45_000,monthlyOperatingCashPaid:55_000,monthsUsed:3,freshness:"current",
    });
  });

  it("uses the FIN-02 compatibility baseline for legacy records", () => {
    const legacy=[row({data_contract_version:1,source_type:"legacy_spreadsheet",accounting_basis:null,
      closing_included_cash:null,closing_unavailable_cash:null,cash_collected_from_customers:null,
      operating_cash_paid:null,cash_reconciliation_difference:null})];
    expect(scenarioBaseline(75_000,legacy,new Date("2026-10-15T00:00:00Z"))).toMatchObject({
      status:"ready",contractVersion:1,availableCash:75_000,monthlyCashCollected:45_000,
      monthlyOperatingCashPaid:55_000,monthsUsed:1,
    });
  });

  it("returns explicit no-data and incomplete states", () => {
    expect(scenarioBaseline(null,[]).status).toBe("no_data");
    expect(scenarioBaseline(null,[row({closing_included_cash:null})]).status).toBe("incomplete");
  });

  it("uses a partial latest cash balance but completed months for operating averages", () => {
    const rows=[row({id:"oct",month_date:"2026-10-01",period_status:"partial",period_cutoff_date:"2026-10-15",
      closing_included_cash:70_000,closing_unavailable_cash:5_000}),row(),
      row({id:"aug",month_date:"2026-08-01"}),row({id:"jul",month_date:"2026-07-01"})];
    expect(scenarioBaseline(null,rows,new Date("2026-10-20T00:00:00Z"))).toMatchObject({
      status:"ready",availableCash:65_000,monthsUsed:3,asOfDate:"2026-10-15",
    });
  });

  it("renders the saved baseline controls without exposing account identifiers", () => {
    const baseline=scenarioBaseline(null,[row(),row({id:"aug",month_date:"2026-08-01"}),
      row({id:"jul",month_date:"2026-07-01"})],new Date("2026-10-15T00:00:00Z"));
    const html=renderToStaticMarkup(createElement(ManualCalculator,{baseline,hasData:true,bare:true}));
    expect(html).toContain("Starting point from your financial data");
    expect(html).toContain("Expected monthly cash from customers");
    expect(html).toContain("Current: $55,000");
    expect(html).toContain("one-time cash event");
    expect(html).not.toContain("account-a");
  });

  it("links the compact dashboard scenario summary to the dedicated workflow", () => {
    const baseline=scenarioBaseline(null,[row(),row({id:"aug",month_date:"2026-08-01"}),
      row({id:"jul",month_date:"2026-07-01"})],new Date("2026-10-15T00:00:00Z"));
    const html=renderToStaticMarkup(createElement(ScenarioSummaryCard,{baseline}));
    expect(html).toContain("Plan a cash scenario");
    expect(html).toContain("Starting from Sep 30, 2026 · 3 complete months");
    expect(html).toContain('href="/dashboard/scenarios"');
    expect(html).not.toContain("Expected monthly cash from customers");
  });

  it("creates one editable action choice per meaningful scenario assumption", () => {
    const options=scenarioActionOptions({currency:"USD",currentCollections:40_000,
      proposedCollections:45_000,currentSpending:50_000,proposedSpending:47_000,
      currentRunway:6,proposedRunway:10,eventType:"receipt",eventAmount:20_000});
    expect(options.map(option=>option.key)).toEqual(["collections","spending","cash_receipt"]);
    expect(options[0].prefill).toMatchObject({name:"Increase monthly cash from customers",
      goal_type:"revenue_increase",goal_value:5_000,goal_unit:"usd"});
    expect(options[1].prefill).toMatchObject({name:"Reduce monthly operating spending",
      goal_type:"expense_reduction",goal_value:3_000,goal_unit:"usd"});
    expect(options[2].prefill.description).toContain("$20,000");
    for (const option of options) {
      expect(validateActionCreate(option.prefill).ok).toBe(true);
    }
  });

  it("rounds scenario-generated USD action goals to owner-facing whole dollars", () => {
    const [option]=scenarioActionOptions({currency:"USD",currentCollections:40_000,
      proposedCollections:40_000,currentSpending:44_166.666666666664,proposedSpending:40_000,
      currentRunway:1.4,proposedRunway:null,eventType:"none",eventAmount:0});
    expect(option.prefill.goal_value).toBe(4_167);
    expect(option.prefill.description).toContain("$44,167 to $40,000");
  });

  it("frames adverse assumptions as risk preparation and does not misuse alert linkage", () => {
    const options=scenarioActionOptions({currency:"USD",currentCollections:40_000,
      proposedCollections:35_000,currentSpending:50_000,proposedSpending:55_000,
      currentRunway:6,proposedRunway:2,eventType:"payment",eventAmount:10_000});
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.prefill.goal_type).toBe("risk_mitigation");
      expect(option.prefill.linked_alert_code).toBeUndefined();
    }
  });

  it("omits action choices when the scenario has no changes", () => {
    expect(scenarioActionOptions({currency:"USD",currentCollections:40_000,
      proposedCollections:40_000,currentSpending:50_000,proposedSpending:50_000,
      currentRunway:6,proposedRunway:6,eventType:"none",eventAmount:0})).toEqual([]);
  });

  it("does not record non-USD values in the USD-only action goal field", () => {
    const [option]=scenarioActionOptions({currency:"CAD",currentCollections:40_000,
      proposedCollections:45_000,currentSpending:50_000,proposedSpending:50_000,
      currentRunway:6,proposedRunway:8,eventType:"none",eventAmount:0});
    expect(option.prefill).toMatchObject({goal_value:null,goal_unit:null});
    expect(option.prefill.description).toContain("CA$40,000 to CA$45,000");
  });
});
