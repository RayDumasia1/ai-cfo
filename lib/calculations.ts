/**
 * Pure financial calculation functions.
 *
 * Rules:
 *   - No UI imports, no React, no side effects.
 *   - Each function is independently testable with plain inputs.
 *   - When QuickBooks / banking data arrives, only the call-site in the
 *     page (or a future data-layer hook) changes — nothing here.
 */

import type {
  Alert,
  BusinessProfile,
  FinancialInput,
  FinancialMonth,
  FinancialSnapshot,
  RiskLevel,
} from "./types";

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
 * Returns a formatted string e.g. "March 2026".
 * Uses Math.floor so 4.9 months → month 4, not month 5.
 *
 * @param months      - Runway in months (from runwayMonths()).
 * @param anchorMonthDate - ISO date string of the most recent data month
 *   (e.g. "2025-12-01"). When provided, projects forward from that month
 *   rather than from today. Omit for real-time manual calculations where
 *   today is the correct anchor.
 */
export function runoutDate(months: number, anchorMonthDate?: string): string {
  const date = anchorMonthDate
    ? new Date(anchorMonthDate + "T12:00:00Z") // noon UTC avoids DST/timezone shifts
    : new Date();
  date.setUTCMonth(date.getUTCMonth() + Math.floor(months));
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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
 * Month-over-month change in runway, measured in months.
 * Positive → runway improved. Negative → runway declined.
 * Uses the same burn rate for both months so the only variable is cash balance,
 * isolating the effect of cash movement from any change in spend pattern.
 * Returns null when fewer than 2 months of cash data are available.
 */
export function runwayChangeMoM(
  currentCash: number,
  previousCash: number,
  burn: number
): number | null {
  if (burn <= 0) return null;
  return runwayMonths(currentCash, burn) - runwayMonths(previousCash, burn);
}

export interface RevenueVsBurnChartData {
  labels: string[];
  revenue: number[];
  burn: number[];
  netCashFlow: number[];
}

/**
 * Prepares the last 6 months of revenue and burn data for charting.
 * Input is newest-first (as returned by getFinancialMonths).
 * Output is sorted chronologically (oldest → newest) for left-to-right display.
 */
export function getRevenueVsBurnChartData(
  months: FinancialMonth[]
): RevenueVsBurnChartData {
  const recent = months.slice(0, 6).reverse(); // oldest → newest

  const labels = recent.map((m) => {
    const d = new Date(m.month_date + "T12:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  });

  const revenue = recent.map((m) => m.total_revenue ?? 0);
  const burn = recent.map((m) => m.total_expenses ?? 0);
  const netCashFlow = recent.map((m) => (m.closing_cash ?? 0) - (m.opening_cash ?? 0));

  return { labels, revenue, burn, netCashFlow };
}

/**
 * Alert engine — evaluates financial health rules and returns sorted alerts.
 * Severity order: danger → warning → success.
 * Inputs: newest-first months array + business profile.
 */
export function alertEngine(
  months: FinancialMonth[],
  profile: BusinessProfile
): Alert[] {
  const alerts: Alert[] = [];

  const m0 = months[0];
  const m1 = months[1];

  // Derive shared metrics
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);
  const cash = m0?.closing_cash ?? null;

  const runway =
    cash != null && avgBurn != null && avgBurn > 0
      ? runwayMonths(cash, avgBurn)
      : null;

  // Rule 1 — RUNWAY_DANGER
  if (runway != null && runway < profile.runway_danger_threshold) {
    alerts.push({
      code: "RUNWAY_DANGER",
      severity: "danger",
      title: "Critical runway alert",
      message: `You have ${runway.toFixed(1)} months of runway remaining — below your ${profile.runway_danger_threshold}-month danger threshold. Immediate action required.`,
    });
  }
  // Rule 2 — RUNWAY_WARNING (only if not already danger)
  else if (
    runway != null &&
    runway < profile.runway_warning_threshold
  ) {
    alerts.push({
      code: "RUNWAY_WARNING",
      severity: "warning",
      title: `Runway below ${profile.runway_warning_threshold} months`,
      message: `Current runway is ${runway.toFixed(1)} months. Consider reducing burn or raising capital before reaching the ${profile.runway_danger_threshold}-month danger threshold.`,
    });
  }

  // Rule 3 — BURN_RATE_SPIKE
  if (
    m0?.total_expenses != null &&
    m1?.total_expenses != null &&
    m1.total_expenses > 0
  ) {
    const burnChangePct = burnRateChangeMoM(m0.total_expenses, m1.total_expenses);
    if (burnChangePct > profile.burn_rate_warning_pct * 100) {
      alerts.push({
        code: "BURN_RATE_SPIKE",
        severity: "warning",
        title: "Burn rate spike detected",
        message: `Monthly expenses increased by ${burnChangePct.toFixed(1)}% last month, exceeding your ${(profile.burn_rate_warning_pct * 100).toFixed(0)}% warning threshold.`,
      });
    }
  }

  // Rule 4 — CASH_BELOW_RESERVE
  if (
    cash != null &&
    profile.min_cash_reserve != null &&
    cash < profile.min_cash_reserve
  ) {
    alerts.push({
      code: "CASH_BELOW_RESERVE",
      severity: "danger",
      title: "Cash below minimum reserve",
      message: `Current cash ($${cash.toLocaleString("en-US")}) is below your minimum reserve of $${profile.min_cash_reserve.toLocaleString("en-US")}.`,
    });
  }

  // Rule 5 — HIGH_AR
  if (
    m0?.ar_outstanding != null &&
    cash != null &&
    m0.ar_outstanding > cash
  ) {
    alerts.push({
      code: "HIGH_AR",
      severity: "warning",
      title: "High accounts receivable",
      message: `Accounts receivable ($${m0.ar_outstanding.toLocaleString("en-US")}) exceeds your current cash balance. Consider accelerating collections.`,
    });
  }

  // Rule 6 — REVENUE_GROWTH
  if (
    m0?.total_revenue != null &&
    m1?.total_revenue != null &&
    m1.total_revenue > 0
  ) {
    const revGrowth = (m0.total_revenue - m1.total_revenue) / m1.total_revenue;
    if (revGrowth > 0.05) {
      alerts.push({
        code: "REVENUE_GROWTH",
        severity: "success",
        title: "Revenue growth",
        message: `Revenue grew ${(revGrowth * 100).toFixed(1)}% last month. Strong momentum — keep it up.`,
      });
    }
  }

  // Sort: danger first, then warning, then success
  const order: Record<string, number> = { danger: 0, warning: 1, success: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return alerts;
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
