/**
 * Pure financial calculation functions.
 *
 * Rules:
 *   - No UI imports, no React, no side effects.
 *   - Each function is independently testable with plain inputs.
 *   - When QuickBooks / banking data arrives, only the call-site in the
 *     page (or a future data-layer hook) changes — nothing here.
 */

import { DASHBOARD_MONTH_LIMIT } from "./financialImportPolicy";
import type {
  Alert,
  BusinessProfile,
  DismissedAlert,
  FinancialInput,
  FinancialMonth,
  FinancialSnapshot,
  RiskLevel,
} from "./types";

import { isProtectedAlertCode } from "./alertPolicy";

/** Shift the shortest decimal representation without multiplication/division noise. */
function scaleDecimal(value: number, exponent: number): number {
  const [coefficient, power = "0"] = String(value).split("e");
  return Number(`${coefficient}e${Number(power) + exponent}`);
}

export function percentageFromDecimal(value: number): number {
  return scaleDecimal(value, 2);
}

export function percentageToDecimal(value: number): number {
  return scaleDecimal(value, -2);
}

/**
 * Returns true when an alert is currently snoozed and should be hidden.
 *
 * Snooze logic by type:
 *   'data_reload' — snoozed while data_version matches the version at dismissal time.
 *   '24h' / '7d'  — snoozed while the current time is before snooze_until.
 *
 * Danger alert codes (RUNWAY_DANGER, CASH_BELOW_RESERVE) always return false —
 * they cannot be snoozed regardless of any dismissal record.
 */
export function isAlertSnoozed(
  alertCode: string,
  dismissedAlerts: DismissedAlert[],
  currentDataVersion: string | null
): boolean {
  if (isProtectedAlertCode(alertCode)) return false;

  const record = dismissedAlerts.find((d) => d.alert_code === alertCode);
  if (!record) return false;

  switch (record.snooze_type) {
    case "data_reload":
      return (
        record.data_version !== null &&
        record.data_version === currentDataVersion
      );
    case "24h":
    case "7d":
      if (!record.snooze_until) return false;
      return new Date() < new Date(record.snooze_until);
    default:
      return false;
  }
}

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
    ? new Date(Date.UTC(Number(anchorMonthDate.slice(0,4)),Number(anchorMonthDate.slice(5,7)),0,12))
    : new Date();
  date.setUTCDate(date.getUTCDate()+months*30.436875);
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

export type LegacyCashHealth = {
  monthsUsed: number;
  periodStart: string | null;
  periodEnd: string | null;
  averageCashCollected: number | null;
  averageCashPaid: number | null;
  estimatedNetCashFlow: number | null;
  estimatedNetCashBurn: number | null;
  reportedSpendingCoverage: number | null;
  estimatedRunway: number | null;
};

/**
 * FIN-02 compatibility model for the legacy monthly schema.
 *
 * The legacy columns contain reported cash collected/paid, despite their
 * historical revenue/expense names. Only the newest uninterrupted run of up
 * to three months is eligible. A blank required value stops the window rather
 * than being skipped or treated as zero.
 */
export function legacyCashHealth(
  cash: number | null,
  monthsNewestFirst: FinancialMonth[]
): LegacyCashHealth {
  const eligible: FinancialMonth[] = [];
  for (const month of monthsNewestFirst) {
    if (eligible.length === 3) break;
    const previous = eligible[eligible.length - 1];
    if (previous && !areConsecutiveFinancialMonths(previous.month_date, month.month_date)) break;
    if (month.total_revenue == null || month.total_expenses == null) break;
    eligible.push(month);
  }

  if (eligible.length === 0) {
    return { monthsUsed:0, periodStart:null, periodEnd:null, averageCashCollected:null,
      averageCashPaid:null, estimatedNetCashFlow:null, estimatedNetCashBurn:null,
      reportedSpendingCoverage:null, estimatedRunway:null };
  }

  const average = (values: number[]) => values.reduce((sum,value)=>sum+value,0)/values.length;
  const averageCashCollected = average(eligible.map(month=>month.total_revenue!));
  const averageCashPaid = average(eligible.map(month=>month.total_expenses!));
  const estimatedNetCashFlow = averageCashCollected-averageCashPaid;
  const estimatedNetCashBurn = Math.max(-estimatedNetCashFlow,0);
  const nonnegativeCash = cash == null ? null : Math.max(cash,0);

  return {
    monthsUsed:eligible.length,
    periodStart:eligible[eligible.length-1].month_date,
    periodEnd:eligible[0].month_date,
    averageCashCollected,
    averageCashPaid,
    estimatedNetCashFlow,
    estimatedNetCashBurn,
    reportedSpendingCoverage:nonnegativeCash != null && averageCashPaid > 0
      ? nonnegativeCash/averageCashPaid : null,
    estimatedRunway:nonnegativeCash != null && estimatedNetCashBurn > 0
      ? nonnegativeCash/estimatedNetCashBurn : null,
  };
}

/** Financial rows use first-of-month dates. Compare calendar keys without timezone arithmetic. */
export function areConsecutiveFinancialMonths(current?: string | null, previous?: string | null): boolean {
  const valid = (date: string | null | undefined): date is string =>
    typeof date === "string" && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(date);
  if (!valid(current) || !valid(previous)) return false;
  const index = (date: string) => Number(date.slice(0,4)) * 12 + Number(date.slice(5,7));
  return index(current) - index(previous) === 1;
}

/**
 * Current runway in months from closing cash and recent expenses (newest-first).
 * Mirrors RunwayCard: 3-month average burn, null when cash is unknown or
 * there is no positive burn to divide by.
 */
export function currentRunway(
  cash: number | null,
  monthsNewestFirst: FinancialMonth[],
  now = new Date()
): number | null {
  if ((financialDataAgeDays(monthsNewestFirst[0]?.month_date,now) ?? Infinity) > 90) return null;
  return legacyCashHealth(cash,monthsNewestFirst).estimatedRunway;
}

/** Age of the latest reported month measured from its calendar month-end. */
export function financialDataAgeDays(monthDate: string | null | undefined, now = new Date()): number | null {
  if (!monthDate || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(monthDate)) return null;
  const year=Number(monthDate.slice(0,4));
  const month=Number(monthDate.slice(5,7));
  const periodEnd=new Date(Date.UTC(year,month,0,23,59,59,999));
  return Math.max(0,(now.getTime()-periodEnd.getTime())/86_400_000);
}

export type FinancialDataFreshness = "current" | "stale" | "historical" | "unknown";

export function financialDataFreshness(monthDate: string | null | undefined, now = new Date()): FinancialDataFreshness {
  const age=financialDataAgeDays(monthDate,now);
  if (age==null) return "unknown";
  if (age>90) return "historical";
  if (age>45) return "stale";
  return "current";
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

export interface RevenueExpensesPoint {
  monthIndex: number;
  monthDate: string;
  label: string;
  revenue: number | null;
  expenses: number | null;
  difference: number | null;
  /** A presentation-only gap marker, never a persisted or zero-valued financial row. */
  missingThrough: string | null;
}

export function financialChartMonthLabel(index: number): string {
  const date = `${String(Math.floor(index / 12)).padStart(4,"0")}-${String(index % 12 + 1).padStart(2,"0")}-01`;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US",{month:"short",year:"numeric",timeZone:"UTC"});
}

export interface RevenueVsBurnChartData {
  labels: string[];
  /** Stored records plus one null marker per gap, on a calendar-proportional numeric axis. */
  points: RevenueExpensesPoint[];
  ticks: number[];
  /** Calendar months absent between the first and last displayed records. */
  missingMonths: number;
  /** null means the source month had no total_revenue recorded. */
  revenue: (number | null)[];
  /** null means the source month had no total_expenses recorded. */
  burn: (number | null)[];
  netCashFlow: (number | null)[];
}

/**
 * Prepares the latest twelve stored months of revenue and expenses for charting.
 * Input is newest-first (as returned by getFinancialMonths).
 * Output is sorted chronologically (oldest → newest) for left-to-right display.
 * Returns null when months is empty so the component can render a placeholder.
 */
export function getRevenueVsBurnChartData(
  months: FinancialMonth[]
): RevenueVsBurnChartData | null {
  if (months.length === 0) return null;

  const recent = months.slice(0, DASHBOARD_MONTH_LIMIT).reverse(); // oldest → newest

  const labels = recent.map((m) => {
    const d = new Date(m.month_date + "T12:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  });

  // Preserve null so the tooltip can display "—" instead of $0
  const revenue = recent.map((m) => m.total_revenue);
  const burn = recent.map((m) => m.total_expenses);
  const netCashFlow = recent.map((m) =>
    m.closing_cash != null && m.opening_cash != null
      ? m.closing_cash - m.opening_cash
      : null
  );

  const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const missingMonths = monthIndex(recent[recent.length - 1].month_date) - monthIndex(recent[0].month_date) + 1 - recent.length;
  const monthDate = (index: number) => `${String(Math.floor(index / 12)).padStart(4,"0")}-${String(index % 12 + 1).padStart(2,"0")}-01`;
  const points: RevenueExpensesPoint[] = [];
  for (let i = 0; i < recent.length; i++) {
    const month = recent[i];
    const index = monthIndex(month.month_date);
    const previous = recent[i-1];
    if (previous && index - monthIndex(previous.month_date) > 1) {
      const firstMissing = monthIndex(previous.month_date) + 1;
      points.push({monthIndex:firstMissing,monthDate:monthDate(firstMissing),label:financialChartMonthLabel(firstMissing),
        revenue:null,expenses:null,difference:null,missingThrough:monthDate(index-1)});
    }
    points.push({monthIndex:index,monthDate:month.month_date,label:labels[i],revenue:month.total_revenue,
      expenses:month.total_expenses,difference:month.total_revenue != null && month.total_expenses != null
        ? month.total_revenue - month.total_expenses : null,missingThrough:null});
  }
  const firstIndex = points[0].monthIndex;
  const lastIndex = points[points.length-1].monthIndex;
  // Keep tick generation bounded for very sparse, long historical ranges.
  const ticks = lastIndex-firstIndex < 24 ? Array.from({length:lastIndex-firstIndex+1},(_,i)=>firstIndex+i)
    : points.map(point=>point.monthIndex);
  return { labels, revenue, burn, netCashFlow, missingMonths, points, ticks };
}

/**
 * Alert engine — evaluates financial health rules and returns sorted alerts.
 * Severity order: danger → warning → success.
 * Inputs: newest-first months array + business profile.
 */
export function alertEngine(
  months: FinancialMonth[],
  profile: BusinessProfile,
  now = new Date()
): Alert[] {
  const alerts: Alert[] = [];

  const m0 = months[0];
  const m1 = months[1];
  const comparableMonths = areConsecutiveFinancialMonths(m0?.month_date, m1?.month_date);
  const dataAgeDays=financialDataAgeDays(m0?.month_date,now);
  if (dataAgeDays != null && dataAgeDays > 90) return [];

  // Derive shared metrics
  const cash = m0?.closing_cash ?? null;
  const cashHealth = legacyCashHealth(cash,months);
  const runway = cashHealth.monthsUsed === 3 && (dataAgeDays ?? Infinity) <= 90
    ? cashHealth.estimatedRunway : null;

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
    comparableMonths &&
    m0?.total_expenses != null &&
    m1?.total_expenses != null &&
    m1.total_expenses > 0
  ) {
    const burnChangePct = burnRateChangeMoM(m0.total_expenses, m1.total_expenses);
    if (burnChangePct > profile.burn_rate_warning_pct * 100) {
      alerts.push({
        code: "BURN_RATE_SPIKE",
        severity: "warning",
        title: "Cash spending increased",
        message: `Reported cash paid increased by ${burnChangePct.toFixed(1)}% last month, exceeding your ${(profile.burn_rate_warning_pct * 100).toFixed(0)}% warning threshold.`,
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
      title: "Receivables exceed cash",
      message: `Reported accounts receivable ($${m0.ar_outstanding.toLocaleString("en-US")}) exceeds current cash. Review aging and expected collection dates; this does not mean the full balance is currently available.`,
    });
  }

  // Rule 6 — REVENUE_GROWTH
  if (
    comparableMonths &&
    m0?.total_revenue != null &&
    m1?.total_revenue != null &&
    m1.total_revenue > 0
  ) {
    const revGrowth = (m0.total_revenue - m1.total_revenue) / m1.total_revenue;
    if (revGrowth > 0.05) {
      alerts.push({
        code: "REVENUE_GROWTH",
        severity: "success",
        title: "Cash collections increased",
        message: `Reported customer collections increased ${(revGrowth * 100).toFixed(1)}% last month. Review whether the change is recurring or timing-related.`,
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
  const spendingCoverage = input.monthlyExpenses > 0 ? position/input.monthlyExpenses : null;

  if (burn < 0) {
    return {
      cashPosition: position,
      burnRate: burn,
      averageCashPaid: input.monthlyExpenses,
      reportedSpendingCoverage: spendingCoverage,
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
      averageCashPaid: input.monthlyExpenses,
      reportedSpendingCoverage: spendingCoverage,
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
    averageCashPaid: input.monthlyExpenses,
    reportedSpendingCoverage: spendingCoverage,
    runwayMonths: runway,
    runoutDate: runout,
    riskLevel: risk,
    summary: `At your current pace, you have about ${runway.toFixed(1)} months of runway remaining. At this rate, you will run out of cash in ${runout}.`,
  };
}
