import { describe, expect, it } from "vitest";
import { normalizedCashHealth, operatingCashMetrics } from "../lib/normalizedCashHealth";
import type { FinancialMonth } from "../lib/types";

function month(monthDate: string, collected: number, paid: number, cash = 90_000): FinancialMonth {
  return {
    id: monthDate,
    user_id: "scenario-parity-user",
    business_id: null,
    month_date: monthDate,
    opening_cash: cash - collected + paid,
    closing_cash: cash,
    total_revenue: collected,
    total_expenses: paid,
    payroll: null,
    ar_outstanding: null,
    ap_outstanding: null,
    notes: null,
    data_contract_version: 2,
    source_type: "spreadsheet",
    accounting_basis: "cash",
    reporting_currency: "USD",
    period_status: "complete",
    period_cutoff_date: null,
    opening_included_cash: cash - collected + paid,
    closing_included_cash: cash,
    closing_unavailable_cash: 0,
    cash_collected_from_customers: collected,
    operating_cash_paid: paid,
    owner_draws_paid: 0,
    debt_principal_paid: 0,
    debt_interest_paid: 0,
    investing_cash_paid: 0,
    investing_cash_received: 0,
    debt_funding_received: 0,
    owner_funding_received: 0,
    other_cash_inflows: 0,
    other_cash_outflows: 0,
    closing_taxes_reserved: null,
    ar_expected_within_30_days: null,
    ap_due_within_30_days: null,
    available_credit: null,
    credit_currently_drawn: null,
    lowest_observed_cash: null,
    cash_reconciliation_difference: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("FIN-03C1 scenario calculation parity", () => {
  it("uses the same operating calculation for dashboard records and scenarios", () => {
    const dashboard = normalizedCashHealth([
      month("2026-09-01", 40_000, 55_000),
      month("2026-08-01", 45_000, 55_000),
      month("2026-07-01", 50_000, 55_000),
    ]);
    const scenario = operatingCashMetrics(90_000, 45_000, 55_000);

    expect(dashboard.operating).toEqual(scenario);
    expect(scenario.averageNetCashFlow).toBe(-10_000);
    expect(scenario.cashCoverageMonths).toBeCloseTo(90_000 / 55_000);
    expect(scenario.estimatedRunwayMonths).toBe(9);
  });

  it("distinguishes cash-generating, break-even, and cash-consuming scenarios", () => {
    expect(operatingCashMetrics(60_000, 70_000, 50_000).direction).toBe("cash_generating");
    expect(operatingCashMetrics(60_000, 50_000, 50_000).direction).toBe("break_even");
    expect(operatingCashMetrics(60_000, 40_000, 50_000)).toMatchObject({
      direction: "cash_consuming",
      averageCashBurn: 10_000,
      estimatedRunwayMonths: 6,
    });
  });

  it("keeps zero spending and zero available cash distinct", () => {
    expect(operatingCashMetrics(50_000, 0, 0)).toMatchObject({
      direction: "break_even",
      cashCoverageMonths: null,
      estimatedRunwayMonths: null,
    });
    expect(operatingCashMetrics(0, 0, 10_000)).toMatchObject({
      cashCoverageMonths: 0,
      estimatedRunwayMonths: 0,
    });
  });
});
