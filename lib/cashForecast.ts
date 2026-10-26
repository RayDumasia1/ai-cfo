export const FORECAST_WEEK_COUNT = 13;

export type ForecastDirection = "inflow" | "outflow";
export type ForecastCategory =
  | "customer_receipt"
  | "operating_vendor_payment"
  | "payroll"
  | "tax"
  | "debt_principal"
  | "debt_interest"
  | "owner_distribution"
  | "asset_purchase"
  | "asset_proceeds"
  | "new_debt"
  | "owner_equity_funding"
  | "other_cash_in"
  | "other_cash_out";
export type ForecastItemStatus =
  | "expected"
  | "confirmed"
  | "paid"
  | "received"
  | "cancelled"
  | "excluded";
export type ForecastConfidence = "confirmed" | "high" | "medium" | "low" | "unknown";
export type ForecastCoverageStatus = "confirmed_complete" | "partial" | "unknown";

export type ForecastCashItem = {
  id: string;
  description: string;
  amount: number | null;
  direction: ForecastDirection;
  category: ForecastCategory;
  expectedDate: string | null;
  status: ForecastItemStatus;
  confidence: ForecastConfidence;
  sourceType: string;
  sourceUpdatedAt: string | null;
  amountIsEstimate: boolean;
  dateIsEstimate: boolean;
};

export type ForecastAssumption = {
  id: string;
  itemIds: string[];
  operation: "amount_multiplier" | "date_shift_days" | "exclude";
  value: number | null;
  rationale: string;
};

export type ForecastInput = {
  startDate: string;
  asOfDate: string;
  evaluationDate: string;
  startingAvailableCash: number;
  minimumReserve: number;
  reportingCurrency: string;
  currencyPrecision?: number;
  items: ForecastCashItem[];
  assumptions?: ForecastAssumption[];
  weekCoverage?: Array<{ weekStart: string; status: ForecastCoverageStatus }>;
  freshnessPolicy: {
    maxStartingCashAgeDays: number;
    maxItemSourceAgeDays: number;
  };
};

export type ForecastIssueCode =
  | "invalid_input"
  | "duplicate_item"
  | "duplicate_assumption"
  | "unknown_assumption_item"
  | "conflicting_assumption"
  | "missing_amount"
  | "missing_date"
  | "overdue"
  | "outside_horizon"
  | "inactive_status"
  | "stale_source";

export type ForecastIssue = {
  code: ForecastIssueCode;
  itemId: string | null;
  assumptionId: string | null;
  message: string;
};

export type ForecastWeek = {
  index: number;
  weekStart: string;
  weekEnd: string;
  beginningCash: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
  endingCash: number;
  operatingNetCashFlow: number;
  belowMinimumReserve: boolean;
  coverage: ForecastCoverageStatus;
  itemIds: string[];
  totalsByCategory: Partial<Record<ForecastCategory, number>>;
};

export type ForecastResult = {
  valid: boolean;
  errors: ForecastIssue[];
  warnings: ForecastIssue[];
  weeks: ForecastWeek[];
  summary: {
    lowestProjectedCash: number | null;
    lowestProjectedCashWeek: string | null;
    firstReserveBreachWeek: string | null;
    cumulativeOperatingNetCashFlow: number | null;
    endingCash: number | null;
    scheduledItemCount: number;
    unresolvedItemCount: number;
    lowConfidenceItemCount: number;
    weeksConfirmedComplete: number;
  };
  freshness: {
    startingCash: "current" | "stale" | "future" | "invalid";
    startingCashAgeDays: number | null;
    staleScheduledItemCount: number;
  };
};

export type ForecastVarianceInput = {
  id: string;
  resolution: "matched" | "cancelled" | "missed" | "unresolved" | "unplanned";
  plannedItemId: string | null;
  actualItemId: string | null;
  plannedAmount: number | null;
  actualAmount: number | null;
  plannedDate: string | null;
  actualDate: string | null;
};

export type ForecastVariance = ForecastVarianceInput & {
  classification:
    | "on_plan"
    | "amount"
    | "timing"
    | "amount_and_timing"
    | "new_unplanned"
    | "cancelled_or_missed"
    | "unresolved";
  amountVariance: number | null;
  timingVarianceDays: number | null;
};

const DAY_MS = 86_400_000;
const INFLOW_CATEGORIES = new Set<ForecastCategory>([
  "customer_receipt", "asset_proceeds", "new_debt", "owner_equity_funding", "other_cash_in",
]);
const OPERATING_CATEGORIES = new Set<ForecastCategory>([
  "customer_receipt", "operating_vendor_payment", "payroll",
]);

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function addDays(value: string, days: number): string {
  return new Date(dateValue(value)! + days * DAY_MS).toISOString().slice(0, 10);
}

function ageDays(older: string, newer: string): number | null {
  const olderValue = dateValue(older);
  const newerValue = dateValue(newer);
  return olderValue === null || newerValue === null ? null : Math.floor((newerValue - olderValue) / DAY_MS);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function expectedDirection(category: ForecastCategory): ForecastDirection {
  return INFLOW_CATEGORIES.has(category) ? "inflow" : "outflow";
}

function emptyResult(errors: ForecastIssue[], freshness: ForecastResult["freshness"]): ForecastResult {
  return {
    valid: false,
    errors,
    warnings: [],
    weeks: [],
    summary: {
      lowestProjectedCash: null,
      lowestProjectedCashWeek: null,
      firstReserveBreachWeek: null,
      cumulativeOperatingNetCashFlow: null,
      endingCash: null,
      scheduledItemCount: 0,
      unresolvedItemCount: 0,
      lowConfidenceItemCount: 0,
      weeksConfirmedComplete: 0,
    },
    freshness,
  };
}

function applyAssumptions(
  items: ForecastCashItem[],
  assumptions: ForecastAssumption[],
): { items: ForecastCashItem[]; errors: ForecastIssue[] } {
  const errors: ForecastIssue[] = [];
  const itemIds = new Set(items.map(item => item.id));
  const seenAssumptions = new Set<string>();
  const touched = new Set<string>();
  const result = items.map(item => ({ ...item }));
  const byId = new Map(result.map(item => [item.id, item]));

  for (const assumption of assumptions) {
    if (!assumption.id || seenAssumptions.has(assumption.id)) {
      errors.push({ code: "duplicate_assumption", itemId: null, assumptionId: assumption.id || null,
        message: "Assumption IDs must be unique and non-empty." });
      continue;
    }
    seenAssumptions.add(assumption.id);
    if (!assumption.rationale.trim()) {
      errors.push({ code: "invalid_input", itemId: null, assumptionId: assumption.id,
        message: "Every assumption requires a rationale." });
    }
    if (assumption.itemIds.length === 0) {
      errors.push({ code: "invalid_input", itemId: null, assumptionId: assumption.id,
        message: "Every assumption must identify at least one cash item." });
    }
    for (const itemId of assumption.itemIds) {
      if (!itemIds.has(itemId)) {
        errors.push({ code: "unknown_assumption_item", itemId, assumptionId: assumption.id,
          message: `Assumption ${assumption.id} references an unknown cash item.` });
        continue;
      }
      const touchKey = `${itemId}:${assumption.operation}`;
      if (touched.has(touchKey)) {
        errors.push({ code: "conflicting_assumption", itemId, assumptionId: assumption.id,
          message: `Multiple assumptions apply the same operation to cash item ${itemId}.` });
        continue;
      }
      touched.add(touchKey);
      const item = byId.get(itemId)!;
      if (assumption.operation === "exclude") {
        item.status = "excluded";
      } else if (assumption.operation === "amount_multiplier") {
        if (assumption.value === null || !Number.isFinite(assumption.value) || assumption.value < 0) {
          errors.push({ code: "invalid_input", itemId, assumptionId: assumption.id,
            message: "Amount multipliers must be finite and nonnegative." });
        } else if (item.amount !== null) {
          item.amount *= assumption.value;
          item.amountIsEstimate = true;
        }
      } else if (assumption.value === null || !Number.isInteger(assumption.value)) {
        errors.push({ code: "invalid_input", itemId, assumptionId: assumption.id,
          message: "Date shifts must use a whole number of days." });
      } else if (item.expectedDate && dateValue(item.expectedDate) !== null) {
        item.expectedDate = addDays(item.expectedDate, assumption.value);
        item.dateIsEstimate = true;
      }
    }
  }
  return { items: result, errors };
}

export function calculateCashForecast(input: ForecastInput): ForecastResult {
  const errors: ForecastIssue[] = [];
  const warnings: ForecastIssue[] = [];
  const startValue = dateValue(input.startDate);
  const asOfValue = dateValue(input.asOfDate);
  const evaluationValue = dateValue(input.evaluationDate);
  const startingAge = ageDays(input.asOfDate, input.evaluationDate);
  const freshness: ForecastResult["freshness"] = {
    startingCash: startingAge === null ? "invalid"
      : startingAge < 0 ? "future"
      : startingAge > input.freshnessPolicy.maxStartingCashAgeDays ? "stale" : "current",
    startingCashAgeDays: startingAge,
    staleScheduledItemCount: 0,
  };
  const precision = input.currencyPrecision ?? 2;

  if (startValue === null || asOfValue === null || evaluationValue === null) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Forecast start, as-of and evaluation dates must be valid ISO dates." });
  }
  if (startValue !== null && asOfValue !== null && startValue < asOfValue) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Forecast start cannot be earlier than the starting cash as-of date." });
  }
  if (asOfValue !== null && evaluationValue !== null && asOfValue > evaluationValue) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Starting cash cannot have a future as-of date." });
  }
  if (!Number.isFinite(input.startingAvailableCash)) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Starting available cash must be finite." });
  }
  if (!Number.isFinite(input.minimumReserve) || input.minimumReserve < 0) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Minimum reserve must be finite and nonnegative." });
  }
  if (!/^[A-Z]{3}$/.test(input.reportingCurrency)) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Reporting currency must be a three-letter uppercase code." });
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 4) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Currency precision must be a whole number from zero through four." });
  }
  if (!Number.isInteger(input.freshnessPolicy.maxStartingCashAgeDays)
      || input.freshnessPolicy.maxStartingCashAgeDays < 0
      || !Number.isInteger(input.freshnessPolicy.maxItemSourceAgeDays)
      || input.freshnessPolicy.maxItemSourceAgeDays < 0) {
    errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
      message: "Freshness thresholds must be nonnegative whole days." });
  }

  const ids = new Set<string>();
  for (const item of input.items) {
    if (!item.id || ids.has(item.id)) {
      errors.push({ code: "duplicate_item", itemId: item.id || null, assumptionId: null,
        message: "Cash item IDs must be unique and non-empty." });
    }
    ids.add(item.id);
    if (!item.description.trim() || !item.sourceType.trim()) {
      errors.push({ code: "invalid_input", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} requires a description and source type.` });
    }
    if (item.direction !== expectedDirection(item.category)) {
      errors.push({ code: "invalid_input", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} has a direction that conflicts with its category.` });
    }
    if (item.amount !== null && (!Number.isFinite(item.amount) || item.amount < 0)) {
      errors.push({ code: "invalid_input", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} amount must be nonnegative or missing.` });
    }
    if (item.expectedDate !== null && dateValue(item.expectedDate) === null) {
      errors.push({ code: "invalid_input", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} expected date is invalid.` });
    }
    if (item.sourceUpdatedAt !== null && dateValue(item.sourceUpdatedAt) === null) {
      errors.push({ code: "invalid_input", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} source date is invalid.` });
    }
  }

  const applied = applyAssumptions(input.items, input.assumptions ?? []);
  errors.push(...applied.errors);
  if (errors.length > 0 || startValue === null) return emptyResult(errors, freshness);

  const coverage = new Map<string, ForecastCoverageStatus>();
  for (const entry of input.weekCoverage ?? []) {
    if (dateValue(entry.weekStart) === null || coverage.has(entry.weekStart)
        || !(["confirmed_complete", "partial", "unknown"] as string[]).includes(entry.status)) {
      errors.push({ code: "invalid_input", itemId: null, assumptionId: null,
        message: "Week coverage entries must have unique valid week-start dates." });
    } else {
      coverage.set(entry.weekStart, entry.status);
    }
  }
  if (errors.length > 0) return emptyResult(errors, freshness);

  const scheduled = new Map<number, ForecastCashItem[]>();
  let unresolvedItemCount = 0;
  let lowConfidenceItemCount = 0;
  for (const item of applied.items) {
    if (item.status !== "expected" && item.status !== "confirmed") {
      warnings.push({ code: "inactive_status", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} is not included because its status is ${item.status}.` });
      continue;
    }
    if (item.amount === null) {
      unresolvedItemCount += 1;
      warnings.push({ code: "missing_amount", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} needs an amount before it can affect the forecast.` });
      continue;
    }
    if (item.expectedDate === null) {
      unresolvedItemCount += 1;
      warnings.push({ code: "missing_date", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} needs an expected date before it can affect the forecast.` });
      continue;
    }
    const itemDate = dateValue(item.expectedDate)!;
    const weekIndex = Math.floor((itemDate - startValue) / (7 * DAY_MS));
    if (weekIndex < 0) {
      unresolvedItemCount += 1;
      warnings.push({ code: "overdue", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} is overdue and was not moved into the current week.` });
      continue;
    }
    if (weekIndex >= FORECAST_WEEK_COUNT) {
      warnings.push({ code: "outside_horizon", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} is outside the 13-week horizon.` });
      continue;
    }
    const sourceAge = item.sourceUpdatedAt === null ? null : ageDays(item.sourceUpdatedAt, input.evaluationDate);
    if (sourceAge === null || sourceAge < 0 || sourceAge > input.freshnessPolicy.maxItemSourceAgeDays) {
      freshness.staleScheduledItemCount += 1;
      warnings.push({ code: "stale_source", itemId: item.id, assumptionId: null,
        message: `Cash item ${item.id} has missing, future or stale source evidence.` });
    }
    if (item.confidence === "low" || item.confidence === "unknown") lowConfidenceItemCount += 1;
    scheduled.set(weekIndex, [...(scheduled.get(weekIndex) ?? []), item]);
  }

  const weeks: ForecastWeek[] = [];
  let beginningCash = round(input.startingAvailableCash, precision);
  let lowestProjectedCash = Number.POSITIVE_INFINITY;
  let lowestProjectedCashWeek: string | null = null;
  let firstReserveBreachWeek: string | null = null;
  let cumulativeOperatingNetCashFlow = 0;
  let scheduledItemCount = 0;
  let weeksConfirmedComplete = 0;

  for (let index = 0; index < FORECAST_WEEK_COUNT; index += 1) {
    const weekStart = addDays(input.startDate, index * 7);
    const weekEnd = addDays(weekStart, 6);
    const weekItems = scheduled.get(index) ?? [];
    const totalsByCategory: Partial<Record<ForecastCategory, number>> = {};
    let totalInflows = 0;
    let totalOutflows = 0;
    let operatingNetCashFlow = 0;
    for (const item of weekItems) {
      const amount = round(item.amount!, precision);
      totalsByCategory[item.category] = round((totalsByCategory[item.category] ?? 0) + amount, precision);
      if (item.direction === "inflow") totalInflows += amount;
      else totalOutflows += amount;
      if (OPERATING_CATEGORIES.has(item.category)) {
        operatingNetCashFlow += item.direction === "inflow" ? amount : -amount;
      }
    }
    totalInflows = round(totalInflows, precision);
    totalOutflows = round(totalOutflows, precision);
    operatingNetCashFlow = round(operatingNetCashFlow, precision);
    const netCashFlow = round(totalInflows - totalOutflows, precision);
    const endingCash = round(beginningCash + netCashFlow, precision);
    const weekCoverage = coverage.get(weekStart) ?? "unknown";
    if (weekCoverage === "confirmed_complete") weeksConfirmedComplete += 1;
    if (endingCash < lowestProjectedCash) {
      lowestProjectedCash = endingCash;
      lowestProjectedCashWeek = weekStart;
    }
    if (firstReserveBreachWeek === null && endingCash < input.minimumReserve) {
      firstReserveBreachWeek = weekStart;
    }
    cumulativeOperatingNetCashFlow = round(cumulativeOperatingNetCashFlow + operatingNetCashFlow, precision);
    scheduledItemCount += weekItems.length;
    weeks.push({
      index, weekStart, weekEnd, beginningCash, totalInflows, totalOutflows, netCashFlow,
      endingCash, operatingNetCashFlow, belowMinimumReserve: endingCash < input.minimumReserve,
      coverage: weekCoverage, itemIds: weekItems.map(item => item.id), totalsByCategory,
    });
    beginningCash = endingCash;
  }

  return {
    valid: true,
    errors: [],
    warnings,
    weeks,
    summary: {
      lowestProjectedCash,
      lowestProjectedCashWeek,
      firstReserveBreachWeek,
      cumulativeOperatingNetCashFlow,
      endingCash: weeks.at(-1)!.endingCash,
      scheduledItemCount,
      unresolvedItemCount,
      lowConfidenceItemCount,
      weeksConfirmedComplete,
    },
    freshness,
  };
}

export function classifyForecastVariance(input: ForecastVarianceInput): ForecastVariance {
  if (input.resolution === "unplanned") {
    return { ...input, classification: "new_unplanned", amountVariance: input.actualAmount,
      timingVarianceDays: null };
  }
  if (input.resolution === "cancelled" || input.resolution === "missed") {
    return { ...input, classification: "cancelled_or_missed",
      amountVariance: input.plannedAmount === null ? null : -input.plannedAmount,
      timingVarianceDays: null };
  }
  if (input.resolution === "unresolved") {
    return { ...input, classification: "unresolved", amountVariance: null, timingVarianceDays: null };
  }
  const amountVariance = input.plannedAmount === null || input.actualAmount === null
    ? null : input.actualAmount - input.plannedAmount;
  const timingVarianceDays = input.plannedDate === null || input.actualDate === null
    ? null : ageDays(input.plannedDate, input.actualDate);
  if (amountVariance === null || timingVarianceDays === null) {
    return { ...input, classification: "unresolved", amountVariance, timingVarianceDays };
  }
  const amountChanged = Math.abs(amountVariance) > 0.005;
  const timingChanged = timingVarianceDays !== 0;
  return {
    ...input,
    classification: amountChanged && timingChanged ? "amount_and_timing"
      : amountChanged ? "amount" : timingChanged ? "timing" : "on_plan",
    amountVariance,
    timingVarianceDays,
  };
}
