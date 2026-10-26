import { describe, expect, it } from "vitest";
import { assessFinancialContextReadiness } from "../lib/financialContextReadiness";
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

describe("provider-neutral financial context readiness", () => {
  it("makes existing monthly history useful without requiring a provider or forecast", () => {
    const result = assessFinancialContextReadiness({
      months: [month("2026-09-01"), month("2026-08-01"), month("2026-07-01")],
      evaluationDate: "2026-10-02",
      currentDataMaxAgeDays: 90,
      liquidityDetailAvailable: false,
      forecast: null,
    });
    expect(result).toMatchObject({ contextLevel: "monthly_history", dataVersion: 2,
      freshness: "current", sourcePeriods: { start: "2026-07-01", end: "2026-09-01", monthsUsed: 3 } });
    expect(result.capabilities.historical_cash_guidance.status).toBe("ready");
    expect(result.capabilities.current_cash_guidance.status).toBe("ready");
    expect(result.capabilities.ai_insights).toMatchObject({ status: "ready",
      supportedUses: expect.arrayContaining(["month-over-month operating patterns"]) });
    expect(result.capabilities.thirteen_week_forecast).toMatchObject({
      status: "enrichment_needed",
      missingInputs: ["starting available cash", "dated expected receipts", "dated expected payments"],
    });
  });

  it("limits stale history without discarding supported historical guidance", () => {
    const result = assessFinancialContextReadiness({
      months: [month("2025-01-01")], evaluationDate: "2026-10-25", currentDataMaxAgeDays: 90,
      liquidityDetailAvailable: false, forecast: null,
    });
    expect(result.freshness).toBe("historical");
    expect(result.capabilities.historical_cash_guidance.status).toBe("ready");
    expect(result.capabilities.current_cash_guidance).toMatchObject({ status: "limited",
      missingInputs: ["updated current cash data"] });
    expect(result.capabilities.ai_insights.status).toBe("limited");
  });

  it("requests only targeted forecast enrichment", () => {
    const result = assessFinancialContextReadiness({
      months: [month("2026-09-01")], evaluationDate: "2026-10-02", currentDataMaxAgeDays: 90,
      liquidityDetailAvailable: true,
      forecast: { ready: false, hasPublishedCases: false,
        missingInputs: ["next payroll date", "expected dates for two open invoices"] },
    });
    expect(result.contextLevel).toBe("monthly_with_liquidity");
    expect(result.capabilities.thirteen_week_forecast).toMatchObject({
      status: "enrichment_needed",
      supportedUses: ["historical context while forecast inputs are collected"],
      missingInputs: ["next payroll date", "expected dates for two open invoices"],
    });
  });

  it("elevates readiness when a base forecast and cases exist", () => {
    const result = assessFinancialContextReadiness({
      months: [month("2026-09-01")], evaluationDate: "2026-10-02", currentDataMaxAgeDays: 90,
      liquidityDetailAvailable: true,
      forecast: { ready: true, hasPublishedCases: true, missingInputs: [] },
    });
    expect(result.contextLevel).toBe("forecast_cases");
    expect(result.capabilities.thirteen_week_forecast.status).toBe("ready");
    expect(result.capabilities.forecast_case_comparison.status).toBe("ready");
  });

  it("returns explicit unavailable states when no normalized history exists", () => {
    const result = assessFinancialContextReadiness({
      months: [], evaluationDate: "2026-10-02", currentDataMaxAgeDays: 90,
      liquidityDetailAvailable: false, forecast: null,
    });
    expect(result).toMatchObject({ contextLevel: "none", dataVersion: null, freshness: "unavailable" });
    expect(result.capabilities.historical_cash_guidance.status).toBe("unavailable");
    expect(result.capabilities.ai_insights.status).toBe("unavailable");
  });
});
