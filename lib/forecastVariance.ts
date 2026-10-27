import type { ForecastCashItem, ForecastDirection } from "./cashForecast";

export type ActualCashEvent = {
  id: string;
  amount: number;
  direction: ForecastDirection;
  cashDate: string;
  reportingCurrency: string;
  sourceType: string;
  sourceReference: string;
};

export type ForecastMatchResolution = "matched" | "cancelled" | "missed" | "unplanned" | "unresolved";
export type ForecastMatchMethod = "source_identity" | "deterministic_rule" | "user_confirmed" | "advisor_confirmed";

export type ForecastVarianceAllocation = {
  id: string;
  resolution: ForecastMatchResolution;
  plannedItemId: string | null;
  actualEventId: string | null;
  plannedAmount: number;
  actualAmount: number;
  method: ForecastMatchMethod;
  confidence: "confirmed" | "high" | "medium" | "low" | "unknown";
};

export type ForecastVariancePolicy = {
  version: string;
  currencyPrecision: number;
  absoluteAmountThreshold: number;
  percentageOfPlannedThreshold: number;
  timingDaysThreshold: number;
};

export type ForecastVarianceReviewInput = {
  weekStart: string;
  weekEnd: string;
  evaluationDate: string;
  reportingCurrency: string;
  minimumReserve: number;
  actualOpeningCash: number | null;
  actualClosingCash: number | null;
  plannedItems: ForecastCashItem[];
  actualEvents: ActualCashEvent[];
  allocations: ForecastVarianceAllocation[];
  policy: ForecastVariancePolicy;
};

export type ForecastVarianceReviewIssue = {
  code: "invalid_input" | "duplicate_id" | "unknown_reference" | "direction_mismatch"
    | "currency_mismatch" | "overallocated" | "unresolved_evidence" | "unreconciled_cash";
  allocationId: string | null;
  plannedItemId: string | null;
  actualEventId: string | null;
  message: string;
};

export type CalculatedForecastVariance = ForecastVarianceAllocation & {
  classification: "on_plan" | "amount" | "timing" | "amount_and_timing"
    | "new_unplanned" | "cancelled" | "missed" | "unresolved";
  amountVariance: number | null;
  timingVarianceDays: number | null;
  cashImpact: number | null;
  material: boolean;
};

export type ForecastVarianceReviewResult = {
  valid: boolean;
  errors: ForecastVarianceReviewIssue[];
  warnings: ForecastVarianceReviewIssue[];
  variances: CalculatedForecastVariance[];
  coverage: "complete" | "partial" | "unknown";
  reconciliation: {
    actualOpeningCash: number | null;
    actualInflows: number;
    actualOutflows: number;
    calculatedClosingCash: number | null;
    actualClosingCash: number | null;
    unexplainedDifference: number | null;
    reconciled: boolean;
  };
  summary: {
    plannedAmountAllocated: number;
    actualAmountAllocated: number;
    netCashImpact: number | null;
    materialVarianceCount: number;
    unresolvedPlannedAmount: number;
    unresolvedActualAmount: number;
    closingCashBelowReserve: boolean | null;
  };
  policyVersion: string;
};

const DAY_MS = 86_400_000;
const MONEY_TOLERANCE = 0.005;

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function signed(direction: ForecastDirection, amount: number): number {
  return direction === "inflow" ? amount : -amount;
}

function issue(
  code: ForecastVarianceReviewIssue["code"],
  message: string,
  allocation?: ForecastVarianceAllocation,
): ForecastVarianceReviewIssue {
  return { code, allocationId: allocation?.id ?? null, plannedItemId: allocation?.plannedItemId ?? null,
    actualEventId: allocation?.actualEventId ?? null, message };
}

function emptyResult(input: ForecastVarianceReviewInput, errors: ForecastVarianceReviewIssue[]): ForecastVarianceReviewResult {
  return {
    valid: false, errors, warnings: [], variances: [], coverage: "unknown",
    reconciliation: { actualOpeningCash: input.actualOpeningCash, actualInflows: 0, actualOutflows: 0,
      calculatedClosingCash: null, actualClosingCash: input.actualClosingCash,
      unexplainedDifference: null, reconciled: false },
    summary: { plannedAmountAllocated: 0, actualAmountAllocated: 0, netCashImpact: null,
      materialVarianceCount: 0, unresolvedPlannedAmount: 0, unresolvedActualAmount: 0,
      closingCashBelowReserve: null },
    policyVersion: input.policy.version,
  };
}

export function calculateForecastVarianceReview(input: ForecastVarianceReviewInput): ForecastVarianceReviewResult {
  const errors: ForecastVarianceReviewIssue[] = [];
  const warnings: ForecastVarianceReviewIssue[] = [];
  const weekStart = dateValue(input.weekStart);
  const weekEnd = dateValue(input.weekEnd);
  const evaluationDate = dateValue(input.evaluationDate);
  const precision = input.policy.currencyPrecision;

  if (weekStart === null || weekEnd === null || evaluationDate === null || weekEnd < weekStart
      || evaluationDate <= weekEnd || !/^[A-Z]{3}$/.test(input.reportingCurrency)
      || !Number.isFinite(input.minimumReserve) || input.minimumReserve < 0
      || !input.policy.version.trim() || !Number.isInteger(precision) || precision < 0 || precision > 4
      || !Number.isFinite(input.policy.absoluteAmountThreshold) || input.policy.absoluteAmountThreshold < 0
      || !Number.isFinite(input.policy.percentageOfPlannedThreshold)
      || input.policy.percentageOfPlannedThreshold < 0
      || !Number.isInteger(input.policy.timingDaysThreshold) || input.policy.timingDaysThreshold < 0) {
    errors.push(issue("invalid_input", "Review dates, currency, reserve and materiality policy must be valid."));
  }
  if ((input.actualOpeningCash === null) !== (input.actualClosingCash === null)
      || (input.actualOpeningCash !== null && (!Number.isFinite(input.actualOpeningCash) || input.actualOpeningCash < 0))
      || (input.actualClosingCash !== null && (!Number.isFinite(input.actualClosingCash) || input.actualClosingCash < 0))) {
    errors.push(issue("invalid_input", "Opening and closing cash must both be supplied as nonnegative values or both omitted."));
  }

  const planned = new Map<string, ForecastCashItem>();
  for (const item of input.plannedItems) {
    if (!item.id || planned.has(item.id)) errors.push(issue("duplicate_id", "Planned item IDs must be unique."));
    planned.set(item.id, item);
    const expectedDate = item.expectedDate === null ? null : dateValue(item.expectedDate);
    if (item.amount === null || !Number.isFinite(item.amount) || item.amount < 0 || expectedDate === null
        || expectedDate < weekStart! || expectedDate > weekEnd!) {
      errors.push({ ...issue("invalid_input", "Planned items require valid amounts and dates."), plannedItemId: item.id });
    }
  }

  const actual = new Map<string, ActualCashEvent>();
  for (const event of input.actualEvents) {
    if (!event.id || actual.has(event.id)) errors.push(issue("duplicate_id", "Actual event IDs must be unique."));
    actual.set(event.id, event);
    const cashDate = dateValue(event.cashDate);
    if (!Number.isFinite(event.amount) || event.amount < 0 || cashDate === null || cashDate! < weekStart!
        || cashDate! > weekEnd! || !event.sourceType.trim() || !event.sourceReference.trim()) {
      errors.push({ ...issue("invalid_input", "Actual events require an amount, source and cash date within the reviewed week."), actualEventId: event.id });
    }
    if (event.reportingCurrency !== input.reportingCurrency) {
      errors.push({ ...issue("currency_mismatch", "Actual-event currency must match the reviewed plan."), actualEventId: event.id });
    }
  }

  const allocationIds = new Set<string>();
  const plannedAllocated = new Map<string, number>();
  const actualAllocated = new Map<string, number>();
  for (const allocation of input.allocations) {
    if (!allocation.id || allocationIds.has(allocation.id)) errors.push(issue("duplicate_id", "Allocation IDs must be unique.", allocation));
    allocationIds.add(allocation.id);
    if (!Number.isFinite(allocation.plannedAmount) || allocation.plannedAmount < 0
        || !Number.isFinite(allocation.actualAmount) || allocation.actualAmount < 0) {
      errors.push(issue("invalid_input", "Allocated amounts must be finite and nonnegative.", allocation));
    }
    const plannedItem = allocation.plannedItemId ? planned.get(allocation.plannedItemId) : null;
    const actualEvent = allocation.actualEventId ? actual.get(allocation.actualEventId) : null;
    if (allocation.plannedItemId && !plannedItem || allocation.actualEventId && !actualEvent) {
      errors.push(issue("unknown_reference", "Allocation references must belong to this review.", allocation));
    }
    const shapeValid = allocation.resolution === "matched"
      ? Boolean(plannedItem && actualEvent)
      : allocation.resolution === "cancelled" || allocation.resolution === "missed"
        ? Boolean(plannedItem && !allocation.actualEventId && allocation.actualAmount === 0)
        : allocation.resolution === "unplanned"
          ? Boolean(!allocation.plannedItemId && actualEvent && allocation.plannedAmount === 0)
          : Boolean(plannedItem || actualEvent);
    if (!shapeValid) errors.push(issue("invalid_input", "Allocation references do not match its resolution.", allocation));
    if (plannedItem && actualEvent && plannedItem.direction !== actualEvent.direction) {
      errors.push(issue("direction_mismatch", "Planned and actual cash directions must match.", allocation));
    }
    if (plannedItem) plannedAllocated.set(plannedItem.id,
      (plannedAllocated.get(plannedItem.id) ?? 0) + allocation.plannedAmount);
    if (actualEvent) actualAllocated.set(actualEvent.id,
      (actualAllocated.get(actualEvent.id) ?? 0) + allocation.actualAmount);
  }

  for (const item of input.plannedItems) {
    if ((plannedAllocated.get(item.id) ?? 0) - (item.amount ?? 0) > MONEY_TOLERANCE) {
      errors.push({ ...issue("overallocated", "Allocations exceed the planned item amount."), plannedItemId: item.id });
    }
  }
  for (const event of input.actualEvents) {
    if ((actualAllocated.get(event.id) ?? 0) - event.amount > MONEY_TOLERANCE) {
      errors.push({ ...issue("overallocated", "Allocations exceed the actual event amount."), actualEventId: event.id });
    }
  }
  if (errors.length > 0) return emptyResult(input, errors);

  const variances: CalculatedForecastVariance[] = input.allocations.map(allocation => {
    const plannedItem = allocation.plannedItemId ? planned.get(allocation.plannedItemId)! : null;
    const actualEvent = allocation.actualEventId ? actual.get(allocation.actualEventId)! : null;
    const unresolved = allocation.resolution === "unresolved";
    const amountVariance = unresolved ? null : round(allocation.actualAmount - allocation.plannedAmount, precision);
    const timingVarianceDays = allocation.resolution === "matched"
      ? Math.round((dateValue(actualEvent!.cashDate)! - dateValue(plannedItem!.expectedDate!)!) / DAY_MS)
      : null;
    const direction = actualEvent?.direction ?? plannedItem?.direction ?? null;
    const cashImpact = unresolved || direction === null ? null
      : round(signed(direction, allocation.actualAmount) - signed(direction, allocation.plannedAmount), precision);
    const classification: CalculatedForecastVariance["classification"] = unresolved ? "unresolved"
      : allocation.resolution === "unplanned" ? "new_unplanned"
      : allocation.resolution === "cancelled" ? "cancelled"
      : allocation.resolution === "missed" ? "missed"
      : Math.abs(amountVariance!) > MONEY_TOLERANCE && timingVarianceDays !== 0 ? "amount_and_timing"
      : Math.abs(amountVariance!) > MONEY_TOLERANCE ? "amount"
      : timingVarianceDays !== 0 ? "timing" : "on_plan";
    const percentage = allocation.plannedAmount > MONEY_TOLERANCE && amountVariance !== null
      ? Math.abs(amountVariance) / allocation.plannedAmount : 0;
    const materialAmount = cashImpact !== null && Math.abs(cashImpact) > MONEY_TOLERANCE
      && (Math.abs(cashImpact) + MONEY_TOLERANCE >= input.policy.absoluteAmountThreshold
        || percentage + Number.EPSILON >= input.policy.percentageOfPlannedThreshold);
    const materialTiming = timingVarianceDays !== null && timingVarianceDays !== 0
      && Math.abs(timingVarianceDays) >= input.policy.timingDaysThreshold;
    const material = materialAmount || materialTiming;
    return { ...allocation, classification, amountVariance, timingVarianceDays, cashImpact, material };
  });

  let unresolvedPlannedAmount = 0;
  for (const item of input.plannedItems) {
    unresolvedPlannedAmount += Math.max(0, (item.amount ?? 0) - (plannedAllocated.get(item.id) ?? 0));
  }
  let unresolvedActualAmount = 0;
  for (const event of input.actualEvents) {
    unresolvedActualAmount += Math.max(0, event.amount - (actualAllocated.get(event.id) ?? 0));
  }
  unresolvedPlannedAmount = round(unresolvedPlannedAmount, precision);
  unresolvedActualAmount = round(unresolvedActualAmount, precision);
  const unresolvedAllocations = variances.filter(variance => variance.classification === "unresolved").length;
  if (unresolvedPlannedAmount > MONEY_TOLERANCE || unresolvedActualAmount > MONEY_TOLERANCE || unresolvedAllocations > 0) {
    warnings.push(issue("unresolved_evidence", "Some planned or actual cash remains unresolved."));
  }

  const actualInflows = round(input.actualEvents.filter(event => event.direction === "inflow")
    .reduce((sum, event) => sum + event.amount, 0), precision);
  const actualOutflows = round(input.actualEvents.filter(event => event.direction === "outflow")
    .reduce((sum, event) => sum + event.amount, 0), precision);
  const calculatedClosingCash = input.actualOpeningCash === null ? null
    : round(input.actualOpeningCash + actualInflows - actualOutflows, precision);
  const unexplainedDifference = calculatedClosingCash === null || input.actualClosingCash === null ? null
    : round(input.actualClosingCash - calculatedClosingCash, precision);
  const reconciled = unexplainedDifference !== null && Math.abs(unexplainedDifference) <= MONEY_TOLERANCE;
  if (unexplainedDifference !== null && !reconciled) {
    warnings.push(issue("unreconciled_cash", "Opening cash and actual movements do not reconcile to closing cash."));
  }
  const hasEvidence = input.actualEvents.length > 0 || input.actualOpeningCash !== null || input.allocations.length > 0;
  const coverage = reconciled && unresolvedPlannedAmount <= MONEY_TOLERANCE
      && unresolvedActualAmount <= MONEY_TOLERANCE && unresolvedAllocations === 0
    ? "complete" : hasEvidence ? "partial" : "unknown";
  const resolvedCashImpacts = variances.map(variance => variance.cashImpact).filter((value): value is number => value !== null);

  return {
    valid: true, errors: [], warnings, variances, coverage,
    reconciliation: { actualOpeningCash: input.actualOpeningCash, actualInflows, actualOutflows,
      calculatedClosingCash, actualClosingCash: input.actualClosingCash, unexplainedDifference, reconciled },
    summary: {
      plannedAmountAllocated: round(input.allocations.reduce((sum, allocation) => sum + allocation.plannedAmount, 0), precision),
      actualAmountAllocated: round(input.allocations.reduce((sum, allocation) => sum + allocation.actualAmount, 0), precision),
      netCashImpact: unresolvedAllocations > 0 || unresolvedPlannedAmount > MONEY_TOLERANCE
        || unresolvedActualAmount > MONEY_TOLERANCE
        ? null : round(resolvedCashImpacts.reduce((sum, value) => sum + value, 0), precision),
      materialVarianceCount: variances.filter(variance => variance.material).length,
      unresolvedPlannedAmount,
      unresolvedActualAmount,
      closingCashBelowReserve: input.actualClosingCash === null ? null : input.actualClosingCash < input.minimumReserve,
    },
    policyVersion: input.policy.version,
  };
}
