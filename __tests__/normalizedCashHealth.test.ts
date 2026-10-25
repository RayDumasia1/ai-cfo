import { describe, expect, it } from "vitest";
import { normalizedCashHealth } from "../lib/normalizedCashHealth";
import type { FinancialMonth } from "../lib/types";

function month(date: string, overrides: Partial<FinancialMonth> = {}): FinancialMonth {
  return {
    id: date, user_id: "user", business_id: null, month_date: date,
    opening_cash: 100, closing_cash: 90, total_revenue: 80, total_expenses: 90,
    payroll: null, ar_outstanding: null, ap_outstanding: null, notes: null,
    data_contract_version: 2, source_type: "spreadsheet", accounting_basis: "cash",
    reporting_currency: "USD", period_status: "complete", period_cutoff_date: null,
    opening_included_cash: 100, closing_included_cash: 90, closing_unavailable_cash: 10,
    cash_collected_from_customers: 80, operating_cash_paid: 90,
    owner_draws_paid: 0, debt_principal_paid: 0, debt_interest_paid: 0,
    investing_cash_paid: 0, investing_cash_received: 0, debt_funding_received: 0,
    owner_funding_received: 0, other_cash_inflows: 0, other_cash_outflows: 0,
    closing_taxes_reserved: null, ar_expected_within_30_days: null,
    ap_due_within_30_days: null, available_credit: null, credit_currently_drawn: null,
    lowest_observed_cash: null, cash_reconciliation_difference: 0,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("FIN-03A normalized cash health", () => {
  it("calculates available cash and a standard operating window", () => {
    const result = normalizedCashHealth([
      month("2026-03-01", { closing_included_cash: 120, closing_unavailable_cash: 20 }),
      month("2026-02-01", { cash_collected_from_customers: 70, operating_cash_paid: 90 }),
      month("2026-01-01", { cash_collected_from_customers: 60, operating_cash_paid: 90 }),
    ]);

    expect(result.cash).toEqual({ asOfDate: "2026-03-31", includedCash: 120,
      unavailableCash: 20, availableCash: 100, unavailableReason: null });
    expect(result.window).toMatchObject({ monthsUsed: 3, history: "standard",
      periodStart: "2026-01-01", periodEnd: "2026-03-01" });
    expect(result.operating.averageCashCollected).toBe(70);
    expect(result.operating.averageCashPaid).toBe(90);
    expect(result.operating.averageCashBurn).toBe(20);
    expect(result.operating.direction).toBe("cash_consuming");
    expect(result.operating.cashCoverageMonths).toBeCloseTo(1.1111);
    expect(result.operating.estimatedRunwayMonths).toBe(5);
  });

  it("does not treat funding or investing proceeds as operating cash", () => {
    const result = normalizedCashHealth([
      month("2026-03-01", { cash_collected_from_customers: 30, operating_cash_paid: 45,
        owner_funding_received: 50, investing_cash_received: 25 }),
    ]);
    expect(result.operating.averageNetCashFlow).toBe(-15);
    expect(result.operating.averageCashBurn).toBe(15);
  });

  it("does not add classified non-operating payments without recurrence metadata", () => {
    const result = normalizedCashHealth([
      month("2026-03-01", { cash_collected_from_customers: 60, operating_cash_paid: 50,
        owner_draws_paid: 20, debt_principal_paid: 10, investing_cash_paid: 30 }),
    ]);
    expect(result.operating.averageNetCashFlow).toBe(10);
    expect(result.operating.direction).toBe("cash_generating");
    expect(result.operating.estimatedRunwayMonths).toBeNull();
  });

  it.each([
    [80, 90, "cash_consuming", 10],
    [90, 90, "break_even", 0],
    [100, 90, "cash_generating", 0],
  ] as const)("classifies operating direction", (collected, paid, direction, burn) => {
    const result = normalizedCashHealth([month("2026-03-01", {
      cash_collected_from_customers: collected, operating_cash_paid: paid,
    })]);
    expect(result.operating.direction).toBe(direction);
    expect(result.operating.averageCashBurn).toBe(burn);
  });

  it("uses partial-period cash but excludes the partial month from averages", () => {
    const result = normalizedCashHealth([
      month("2026-04-01", { period_status: "partial", period_cutoff_date: "2026-04-10",
        closing_included_cash: 70, closing_unavailable_cash: 5 }),
      month("2026-03-01"), month("2026-02-01"), month("2026-01-01"),
    ]);
    expect(result.cash).toMatchObject({ asOfDate: "2026-04-10", availableCash: 65 });
    expect(result.window).toMatchObject({ monthsUsed: 3, periodStart: "2026-01-01",
      periodEnd: "2026-03-01" });
  });

  it("does not combine partial-period cash with a run rate that skips the latest completed month", () => {
    const result = normalizedCashHealth([
      month("2026-04-01", { period_status: "partial", period_cutoff_date: "2026-04-10" }),
      month("2026-02-01"), month("2026-01-01"),
    ]);
    expect(result.cash.asOfDate).toBe("2026-04-10");
    expect(result.window).toMatchObject({ monthsUsed: 0, stoppedBecause: "month_gap" });
    expect(result.operating.direction).toBe("unavailable");
  });

  it("rejects a partial cutoff outside its reporting month", () => {
    const result = normalizedCashHealth([month("2026-04-01", {
      period_status: "partial", period_cutoff_date: "2026-05-01",
    })]);
    expect(result.cash.unavailableReason).toBe("invalid_period");
  });

  it.each([
    [{ reporting_currency: "CAD" }, "currency_changed"],
    [{ accounting_basis: "accrual" as const }, "accounting_basis_changed"],
    [{ source_type: "quickbooks" as const }, "source_changed"],
    [{ cash_reconciliation_difference: null }, "reconciliation_unknown"],
  ] as const)("does not combine partial cash with an incompatible completed window", (override, reason) => {
    const result = normalizedCashHealth([
      month("2026-04-01", { period_status: "partial", period_cutoff_date: "2026-04-10", ...override }),
      month("2026-03-01"),
    ]);
    expect(result.window).toMatchObject({ monthsUsed: 0, stoppedBecause: reason });
  });

  it("stops at gaps rather than selecting older months", () => {
    const result = normalizedCashHealth([
      month("2026-03-01"), month("2026-01-01"), month("2025-12-01"),
    ]);
    expect(result.window).toMatchObject({ monthsUsed: 1, history: "limited",
      stoppedBecause: "month_gap" });
  });

  it.each([
    [month("2026-02-01", { reporting_currency: "CAD" }), "currency_changed"],
    [month("2026-02-01", { accounting_basis: "accrual" }), "accounting_basis_changed"],
    [month("2026-02-01", { source_type: "quickbooks" }), "source_changed"],
  ] as const)("stops before incompatible periods", (older, reason) => {
    const result = normalizedCashHealth([month("2026-03-01"), older]);
    expect(result.window.monthsUsed).toBe(1);
    expect(result.window.stoppedBecause).toBe(reason);
  });

  it.each([
    [month("2026-03-01", { cash_reconciliation_difference: null }), "reconciliation_unknown"],
    [month("2026-03-01", { cash_reconciliation_difference: 1.01 }), "reconciliation_out_of_tolerance"],
    [month("2026-03-01", { cash_collected_from_customers: null }), "invalid_required_value"],
    [month("2026-03-01", { operating_cash_paid: -1 }), "invalid_required_value"],
  ] as const)("returns no operating result for unusable latest completed data", (input, reason) => {
    const result = normalizedCashHealth([input]);
    expect(result.window).toMatchObject({ monthsUsed: 0, history: "unavailable",
      stoppedBecause: reason });
    expect(result.operating.direction).toBe("unavailable");
  });

  it("keeps negative available cash visible but floors ratio numerators at zero", () => {
    const result = normalizedCashHealth([month("2026-03-01", {
      closing_included_cash: -25, closing_unavailable_cash: 0,
    })]);
    expect(result.cash.availableCash).toBe(-25);
    expect(result.operating.cashCoverageMonths).toBe(0);
    expect(result.operating.estimatedRunwayMonths).toBe(0);
  });

  it("keeps confirmed zero distinct from unavailable", () => {
    const zero = normalizedCashHealth([month("2026-03-01", {
      cash_collected_from_customers: 0, operating_cash_paid: 0,
    })]);
    expect(zero.operating).toMatchObject({ averageCashCollected: 0, averageCashPaid: 0,
      averageNetCashFlow: 0, direction: "break_even" });
    expect(zero.operating.cashCoverageMonths).toBeNull();

    const missing = normalizedCashHealth([month("2026-03-01", {
      cash_collected_from_customers: null,
    })]);
    expect(missing.operating.direction).toBe("unavailable");
  });

  it("does not silently calculate current v2 metrics from a latest legacy month", () => {
    const result = normalizedCashHealth([
      month("2026-03-01", { data_contract_version: 1, period_status: "unknown",
        source_type: "legacy_spreadsheet" }),
      month("2026-02-01"),
    ]);
    expect(result.cash.unavailableReason).toBe("latest_month_is_legacy");
    expect(result.window.monthsUsed).toBe(0);
    expect(result.window.stoppedBecause).toBe("legacy_month");
  });

  it("sorts a caller-owned array without mutating it", () => {
    const inputs = [month("2026-01-01"), month("2026-03-01"), month("2026-02-01")];
    const originalOrder = inputs.map(input => input.month_date);
    const result = normalizedCashHealth(inputs);
    expect(result.window.monthsUsed).toBe(3);
    expect(inputs.map(input => input.month_date)).toEqual(originalOrder);
  });
});
