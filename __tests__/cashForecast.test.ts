import { describe, expect, it } from "vitest";
import {
  calculateCashForecast,
  classifyForecastVariance,
  FORECAST_WEEK_COUNT,
  type ForecastCashItem,
  type ForecastInput,
} from "../lib/cashForecast";

function item(overrides: Partial<ForecastCashItem> = {}): ForecastCashItem {
  return {
    id: "receipt-1",
    description: "Customer receipt",
    amount: 20_000,
    direction: "inflow",
    category: "customer_receipt",
    expectedDate: "2026-11-03",
    status: "expected",
    confidence: "high",
    sourceType: "spreadsheet",
    sourceUpdatedAt: "2026-11-01",
    amountIsEstimate: false,
    dateIsEstimate: false,
    ...overrides,
  };
}

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    startDate: "2026-11-02",
    asOfDate: "2026-11-01",
    evaluationDate: "2026-11-02",
    startingAvailableCash: 100_000,
    minimumReserve: 25_000,
    reportingCurrency: "USD",
    items: [],
    freshnessPolicy: { maxStartingCashAgeDays: 3, maxItemSourceAgeDays: 7 },
    ...overrides,
  };
}

describe("FORECAST-01B deterministic 13-week cash engine", () => {
  it("rolls beginning and ending cash through exactly thirteen weeks", () => {
    const result = calculateCashForecast(input({
      items: [
        item(),
        item({ id: "vendor-1", description: "Vendor payment", amount: 10_000,
          direction: "outflow", category: "operating_vendor_payment", expectedDate: "2026-11-06" }),
        item({ id: "payroll-1", description: "Payroll", amount: 30_000,
          direction: "outflow", category: "payroll", expectedDate: "2026-11-10" }),
        item({ id: "funding-1", description: "Owner funding", amount: 50_000,
          category: "owner_equity_funding", expectedDate: "2026-11-10" }),
      ],
      weekCoverage: [{ weekStart: "2026-11-02", status: "confirmed_complete" }],
    }));

    expect(result.valid).toBe(true);
    expect(result.weeks).toHaveLength(FORECAST_WEEK_COUNT);
    expect(result.weeks[0]).toMatchObject({ beginningCash: 100_000, totalInflows: 20_000,
      totalOutflows: 10_000, endingCash: 110_000, operatingNetCashFlow: 10_000,
      coverage: "confirmed_complete" });
    expect(result.weeks[1]).toMatchObject({ beginningCash: 110_000, totalInflows: 50_000,
      totalOutflows: 30_000, endingCash: 130_000, operatingNetCashFlow: -30_000,
      coverage: "unknown" });
    expect(result.summary).toMatchObject({ endingCash: 130_000, scheduledItemCount: 4,
      cumulativeOperatingNetCashFlow: -20_000, weeksConfirmedComplete: 1 });
  });

  it("keeps non-operating funding out of operating cash flow", () => {
    const result = calculateCashForecast(input({ items: [item({
      id: "debt", description: "New loan", amount: 75_000, category: "new_debt",
    })] }));
    expect(result.weeks[0].netCashFlow).toBe(75_000);
    expect(result.weeks[0].operatingNetCashFlow).toBe(0);
    expect(result.summary.cumulativeOperatingNetCashFlow).toBe(0);
  });

  it("finds the lowest cash point and first strict reserve breach", () => {
    const result = calculateCashForecast(input({
      startingAvailableCash: 40_000,
      items: [
        item({ id: "week-1", description: "Tax payment", amount: 15_000,
          direction: "outflow", category: "tax" }),
        item({ id: "week-2", description: "Debt payment", amount: 2_000,
          direction: "outflow", category: "debt_principal", expectedDate: "2026-11-12" }),
      ],
    }));
    expect(result.weeks[0].endingCash).toBe(25_000);
    expect(result.weeks[0].belowMinimumReserve).toBe(false);
    expect(result.weeks[1].endingCash).toBe(23_000);
    expect(result.summary).toMatchObject({ lowestProjectedCash: 23_000,
      lowestProjectedCashWeek: "2026-11-09", firstReserveBreachWeek: "2026-11-09" });
  });

  it("does not silently move overdue, undated, missing, inactive, or outside-horizon items", () => {
    const result = calculateCashForecast(input({ items: [
      item({ id: "overdue", expectedDate: "2026-10-31" }),
      item({ id: "undated", expectedDate: null }),
      item({ id: "unknown-amount", amount: null }),
      item({ id: "cancelled", status: "cancelled" }),
      item({ id: "later", expectedDate: "2027-03-01" }),
    ] }));
    expect(result.valid).toBe(true);
    expect(result.summary).toMatchObject({ scheduledItemCount: 0, unresolvedItemCount: 3 });
    expect(result.warnings.map(warning => warning.code)).toEqual([
      "overdue", "missing_date", "missing_amount", "inactive_status", "outside_horizon",
    ]);
    expect(result.summary.endingCash).toBe(100_000);
  });

  it("keeps a confirmed zero distinct from a missing amount", () => {
    const result = calculateCashForecast(input({ items: [
      item({ id: "zero", amount: 0, confidence: "confirmed" }),
      item({ id: "missing", amount: null }),
    ] }));
    expect(result.summary.scheduledItemCount).toBe(1);
    expect(result.summary.unresolvedItemCount).toBe(1);
    expect(result.weeks[0].itemIds).toEqual(["zero"]);
  });

  it("applies named assumptions to copies without mutating source items", () => {
    const source = item();
    const result = calculateCashForecast(input({
      items: [source],
      assumptions: [
        { id: "downside", itemIds: [source.id], operation: "amount_multiplier", value: 0.5,
          rationale: "Collect half of the expected receipt" },
        { id: "delay", itemIds: [source.id], operation: "date_shift_days", value: 14,
          rationale: "Customer may pay two weeks late" },
      ],
    }));
    expect(result.valid).toBe(true);
    expect(result.weeks[0].totalInflows).toBe(0);
    expect(result.weeks[2].totalInflows).toBe(10_000);
    expect(source).toMatchObject({ amount: 20_000, expectedDate: "2026-11-03",
      amountIsEstimate: false, dateIsEstimate: false });
  });

  it("rejects conflicting assumptions and invalid category direction", () => {
    const result = calculateCashForecast(input({
      items: [item({ direction: "outflow" })],
      assumptions: [
        { id: "a", itemIds: ["receipt-1"], operation: "exclude", value: null, rationale: "One" },
        { id: "b", itemIds: ["receipt-1"], operation: "exclude", value: null, rationale: "Two" },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.code)).toContain("invalid_input");
    expect(result.errors.map(error => error.code)).toContain("conflicting_assumption");
    expect(result.weeks).toEqual([]);
  });

  it("reports stale starting cash and item evidence from caller-supplied policy", () => {
    const result = calculateCashForecast(input({
      asOfDate: "2026-10-20",
      items: [item({ sourceUpdatedAt: "2026-10-20" })],
    }));
    expect(result.freshness).toEqual({ startingCash: "stale", startingCashAgeDays: 13,
      staleScheduledItemCount: 1 });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "stale_source" }));
  });

  it("rejects a future starting-cash balance", () => {
    const result = calculateCashForecast(input({
      asOfDate: "2026-11-03",
      evaluationDate: "2026-11-02",
      startDate: "2026-11-03",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_input",
      message: "Starting cash cannot have a future as-of date.",
    }));
  });

  it.each([
    ["matched", 100, 100, "2026-11-03", "2026-11-03", "on_plan"],
    ["matched", 100, 90, "2026-11-03", "2026-11-03", "amount"],
    ["matched", 100, 100, "2026-11-03", "2026-11-10", "timing"],
    ["matched", 100, 90, "2026-11-03", "2026-11-10", "amount_and_timing"],
    ["unplanned", null, 90, null, "2026-11-10", "new_unplanned"],
    ["missed", 100, null, "2026-11-03", null, "cancelled_or_missed"],
    ["unresolved", 100, null, "2026-11-03", null, "unresolved"],
  ] as const)("classifies %s forecast variance", (resolution, plannedAmount, actualAmount,
    plannedDate, actualDate, classification) => {
    expect(classifyForecastVariance({ id: "variance", resolution, plannedItemId: "planned",
      actualItemId: actualAmount === null ? null : "actual", plannedAmount, actualAmount,
      plannedDate, actualDate }).classification).toBe(classification);
  });
});
