import { describe, expect, it } from "vitest";
import type { ForecastCashItem } from "../lib/cashForecast";
import { calculateForecastVarianceReview, type ActualCashEvent,
  type ForecastVarianceReviewInput } from "../lib/forecastVariance";

const planned = (id: string, amount: number, direction: "inflow" | "outflow" = "inflow",
  expectedDate = "2026-11-03"): ForecastCashItem => ({
  id, description: id, amount, direction,
  category: direction === "inflow" ? "customer_receipt" : "operating_vendor_payment",
  expectedDate, status: "confirmed", confidence: "confirmed", sourceType: "manual",
  sourceUpdatedAt: "2026-11-01", amountIsEstimate: false, dateIsEstimate: false,
});

const actual = (id: string, amount: number, direction: "inflow" | "outflow" = "inflow",
  cashDate = "2026-11-03"): ActualCashEvent => ({
  id, amount, direction, cashDate, reportingCurrency: "USD", sourceType: "banking",
  sourceReference: `bank-${id}`,
});

const input = (overrides: Partial<ForecastVarianceReviewInput> = {}): ForecastVarianceReviewInput => ({
  weekStart: "2026-11-02", weekEnd: "2026-11-08", evaluationDate: "2026-11-09",
  reportingCurrency: "USD", minimumReserve: 25_000,
  actualOpeningCash: 50_000, actualClosingCash: 50_000,
  plannedItems: [], actualEvents: [], allocations: [],
  policy: { version: "variance-1", currencyPrecision: 2,
    absoluteAmountThreshold: 1_000, percentageOfPlannedThreshold: 0.1, timingDaysThreshold: 2 },
  ...overrides,
});

describe("FORECAST-01E2 actual-versus-plan engine", () => {
  it("combines partial receipts into one complete planned result", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 10_000, actualClosingCash: 19_000,
      plannedItems: [planned("invoice", 10_000)],
      actualEvents: [actual("deposit-a", 4_000), actual("deposit-b", 5_000)],
      allocations: [
        { id: "a", resolution: "matched", plannedItemId: "invoice", actualEventId: "deposit-a",
          plannedAmount: 4_000, actualAmount: 4_000, method: "user_confirmed", confidence: "confirmed" },
        { id: "b", resolution: "matched", plannedItemId: "invoice", actualEventId: "deposit-b",
          plannedAmount: 6_000, actualAmount: 5_000, method: "user_confirmed", confidence: "confirmed" },
      ],
    }));
    expect(result.valid).toBe(true);
    expect(result.coverage).toBe("complete");
    expect(result.summary).toMatchObject({ plannedAmountAllocated: 10_000,
      actualAmountAllocated: 9_000, netCashImpact: -1_000, unresolvedPlannedAmount: 0,
      unresolvedActualAmount: 0, materialVarianceCount: 1 });
    expect(result.variances.map(variance => variance.classification)).toEqual(["on_plan", "amount"]);
    expect(result.reconciliation).toMatchObject({ actualInflows: 9_000,
      calculatedClosingCash: 19_000, unexplainedDifference: 0, reconciled: true });
  });

  it("allocates one batched withdrawal across multiple planned payments", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 20_000, actualClosingCash: 15_000,
      plannedItems: [planned("bill-a", 2_000, "outflow"), planned("bill-b", 3_000, "outflow")],
      actualEvents: [actual("batch", 5_000, "outflow")],
      allocations: [
        { id: "a", resolution: "matched", plannedItemId: "bill-a", actualEventId: "batch",
          plannedAmount: 2_000, actualAmount: 2_000, method: "user_confirmed", confidence: "confirmed" },
        { id: "b", resolution: "matched", plannedItemId: "bill-b", actualEventId: "batch",
          plannedAmount: 3_000, actualAmount: 3_000, method: "user_confirmed", confidence: "confirmed" },
      ],
    }));
    expect(result.coverage).toBe("complete");
    expect(result.summary.netCashImpact).toBe(0);
    expect(result.variances.every(variance => variance.classification === "on_plan")).toBe(true);
  });

  it("keeps unmatched evidence partial instead of calling it performance", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: null, actualClosingCash: null,
      plannedItems: [planned("invoice", 10_000)],
      actualEvents: [actual("deposit", 8_000)],
    }));
    expect(result.valid).toBe(true);
    expect(result.coverage).toBe("partial");
    expect(result.variances).toEqual([]);
    expect(result.summary).toMatchObject({ unresolvedPlannedAmount: 10_000,
      unresolvedActualAmount: 8_000, netCashImpact: null });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "unresolved_evidence" }));
  });

  it("separates unplanned, missed, cancelled, amount and timing outcomes", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 100_000, actualClosingCash: 104_500,
      plannedItems: [planned("late", 5_000), planned("missed", 2_000), planned("cancelled", 1_000, "outflow")],
      actualEvents: [actual("late-actual", 4_500, "inflow", "2026-11-05"), actual("new", 1_000)],
      allocations: [
        { id: "late", resolution: "matched", plannedItemId: "late", actualEventId: "late-actual",
          plannedAmount: 5_000, actualAmount: 4_500, method: "source_identity", confidence: "confirmed" },
        { id: "missed", resolution: "missed", plannedItemId: "missed", actualEventId: null,
          plannedAmount: 2_000, actualAmount: 0, method: "user_confirmed", confidence: "confirmed" },
        { id: "cancelled", resolution: "cancelled", plannedItemId: "cancelled", actualEventId: null,
          plannedAmount: 1_000, actualAmount: 0, method: "user_confirmed", confidence: "confirmed" },
        { id: "new", resolution: "unplanned", plannedItemId: null, actualEventId: "new",
          plannedAmount: 0, actualAmount: 1_000, method: "user_confirmed", confidence: "confirmed" },
      ],
    }));
    expect(result.variances.map(variance => variance.classification)).toEqual([
      "amount_and_timing", "missed", "cancelled", "new_unplanned",
    ]);
    expect(result.variances.map(variance => variance.cashImpact)).toEqual([-500, -2_000, 1_000, 1_000]);
    expect(result.summary.netCashImpact).toBe(-500);
  });

  it("reports an explicit cash reconciliation difference", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 10_000, actualClosingCash: 13_000,
      actualEvents: [actual("deposit", 4_000)],
      allocations: [{ id: "new", resolution: "unplanned", plannedItemId: null,
        actualEventId: "deposit", plannedAmount: 0, actualAmount: 4_000,
        method: "user_confirmed", confidence: "confirmed" }],
    }));
    expect(result.reconciliation).toMatchObject({ calculatedClosingCash: 14_000,
      unexplainedDifference: -1_000, reconciled: false });
    expect(result.coverage).toBe("partial");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "unreconciled_cash" }));
  });

  it("rejects cross-direction, cross-currency, unknown and overallocated matches", () => {
    const result = calculateForecastVarianceReview(input({
      plannedItems: [planned("bill", 2_000, "outflow")],
      actualEvents: [{ ...actual("deposit", 1_000), reportingCurrency: "EUR" }],
      allocations: [{ id: "bad", resolution: "matched", plannedItemId: "bill",
        actualEventId: "deposit", plannedAmount: 2_001, actualAmount: 1_001,
        method: "deterministic_rule", confidence: "medium" }],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      "currency_mismatch", "direction_mismatch", "overallocated",
    ]));
  });

  it("keeps exact classification separate from versioned materiality", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 10_000, actualClosingCash: 10_950,
      plannedItems: [planned("invoice", 1_000)], actualEvents: [actual("deposit", 950)],
      allocations: [{ id: "match", resolution: "matched", plannedItemId: "invoice",
        actualEventId: "deposit", plannedAmount: 1_000, actualAmount: 950,
        method: "source_identity", confidence: "confirmed" }],
      policy: { version: "variance-2", currencyPrecision: 2,
        absoluteAmountThreshold: 100, percentageOfPlannedThreshold: 0.1, timingDaysThreshold: 2 },
    }));
    expect(result.variances[0]).toMatchObject({ classification: "amount",
      amountVariance: -50, material: false });
    expect(result.policyVersion).toBe("variance-2");
  });

  it("applies timing materiality without changing an exact on-amount result", () => {
    const result = calculateForecastVarianceReview(input({
      actualOpeningCash: 10_000, actualClosingCash: 11_000,
      plannedItems: [planned("invoice", 1_000, "inflow", "2026-11-03")],
      actualEvents: [actual("deposit", 1_000, "inflow", "2026-11-05")],
      allocations: [{ id: "match", resolution: "matched", plannedItemId: "invoice",
        actualEventId: "deposit", plannedAmount: 1_000, actualAmount: 1_000,
        method: "source_identity", confidence: "confirmed" }],
    }));
    expect(result.variances[0]).toMatchObject({ classification: "timing",
      amountVariance: 0, timingVarianceDays: 2, cashImpact: 0, material: true });
  });

  it("preserves allocation totals across deterministic partial-payment partitions", () => {
    for (let first = 0; first <= 1_000; first += 125) {
      const second = 1_000 - first;
      const result = calculateForecastVarianceReview(input({
        actualOpeningCash: 0, actualClosingCash: 1_000,
        plannedItems: [planned("invoice", 1_000)],
        actualEvents: [actual("a", first), actual("b", second)],
        allocations: [
          { id: "a", resolution: "matched", plannedItemId: "invoice", actualEventId: "a",
            plannedAmount: first, actualAmount: first, method: "user_confirmed", confidence: "confirmed" },
          { id: "b", resolution: "matched", plannedItemId: "invoice", actualEventId: "b",
            plannedAmount: second, actualAmount: second, method: "user_confirmed", confidence: "confirmed" },
        ],
      }));
      expect(result.valid).toBe(true);
      expect(result.coverage).toBe("complete");
      expect(result.summary.netCashImpact).toBe(0);
    }
  });
});
