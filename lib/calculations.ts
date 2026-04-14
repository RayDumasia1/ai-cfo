/**
 * Pure financial calculation functions.
 *
 * Rules:
 *   - No UI imports, no React, no side effects.
 *   - Each function is independently testable with plain inputs.
 *   - When QuickBooks / banking data arrives, only the call-site in the
 *     page (or a future data-layer hook) changes — nothing here.
 */

import type { FinancialInput, FinancialSnapshot, RiskLevel } from "./types";

/**
 * Current cash position.
 * Today: returns cashBalance directly.
 * Future: will aggregate across multiple bank/QuickBooks accounts.
 */
export function cashPosition(cashBalance: number): number {
  return cashBalance;
}

/**
 * Net monthly burn rate.
 * Positive  → company is burning cash.
 * Zero      → break-even.
 * Negative  → company is generating more than it spends.
 */
export function burnRate(monthlyExpenses: number, monthlyRevenue: number): number {
  return monthlyExpenses - monthlyRevenue;
}

/**
 * Months of runway remaining.
 * Precondition: burn must be > 0 (call calculateFinancials() for the
 * full workflow that handles break-even and profitable cases).
 */
export function runwayMonths(cashBalance: number, burn: number): number {
  return cashBalance / burn;
}

/**
 * Calendar month when cash reaches zero.
 * Returns a formatted string e.g. "August 2027".
 * Uses Math.floor so 4.9 months → month 4, not month 5.
 */
export function runoutDate(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + Math.floor(months));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Risk classification based on runway length.
 * Precondition: months must be > 0.
 */
export function riskLevel(months: number): RiskLevel {
  if (months >= 6) return "Low";
  if (months >= 3) return "Medium";
  return "High";
}

/**
 * 3-month rolling average of total expenses, newest-first.
 * Null values (missing data) are excluded from the average.
 * Returns null when there are no non-null expense values to average.
 */
export function monthlyBurnRate(
  expensesNewestFirst: (number | null)[]
): number | null {
  const sample = expensesNewestFirst
    .slice(0, 3)
    .filter((v): v is number => v !== null);
  if (sample.length === 0) return null;
  return sample.reduce((sum, v) => sum + v, 0) / sample.length;
}

/**
 * Month-over-month percentage change in burn rate.
 * Positive → burn increased. Negative → burn decreased.
 * Returns 0 when previousExpenses is 0 to avoid division-by-zero.
 */
export function burnRateChangeMoM(
  currentExpenses: number,
  previousExpenses: number
): number {
  if (previousExpenses === 0) return 0;
  return ((currentExpenses - previousExpenses) / previousExpenses) * 100;
}

/**
 * Master aggregator — the single function the UI calls.
 * Handles all edge cases (profitable, break-even, burning) and
 * returns a fully-populated FinancialSnapshot.
 */
export function calculateFinancials(input: FinancialInput): FinancialSnapshot {
  const position = cashPosition(input.cashBalance);
  const burn = burnRate(input.monthlyExpenses, input.monthlyRevenue);

  if (burn < 0) {
    return {
      cashPosition: position,
      burnRate: burn,
      runwayMonths: null,
      runoutDate: null,
      riskLevel: "Healthy",
      summary:
        "You are currently generating more revenue than expenses each month. You are not burning cash at your current pace.",
    };
  }

  if (burn === 0) {
    return {
      cashPosition: position,
      burnRate: burn,
      runwayMonths: null,
      runoutDate: null,
      riskLevel: "Healthy",
      summary:
        "You are currently break-even. Your cash position is stable as long as revenue and expenses stay at this level.",
    };
  }

  // burn > 0: company is burning cash
  const runway = runwayMonths(position, burn);
  const runout = runoutDate(runway);
  const risk = riskLevel(runway);

  return {
    cashPosition: position,
    burnRate: burn,
    runwayMonths: runway,
    runoutDate: runout,
    riskLevel: risk,
    summary: `At your current pace, you have about ${runway.toFixed(1)} months of runway remaining. At this rate, you will run out of cash in ${runout}.`,
  };
}
