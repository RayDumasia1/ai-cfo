import { financialDataFreshness, legacyCashHealth, type FinancialDataFreshness } from "./calculations";
import { normalizedCashHealth } from "./normalizedCashHealth";
import type { FinancialMonth } from "./types";

export type ScenarioBaseline = {
  status: "ready" | "no_data" | "incomplete";
  contractVersion: 1 | 2 | null;
  currency: string;
  availableCash: number | null;
  monthlyCashCollected: number | null;
  monthlyOperatingCashPaid: number | null;
  monthsUsed: number;
  asOfDate: string | null;
  freshness: FinancialDataFreshness;
};

/** Build a serializable, account-scoped baseline for the client scenario tool. */
export function scenarioBaseline(
  currentCash: number | null,
  monthsNewestFirst: FinancialMonth[],
  now = new Date(),
): ScenarioBaseline {
  const latest = monthsNewestFirst[0];
  if (!latest) {
    return { status:"no_data", contractVersion:null, currency:"USD", availableCash:null,
      monthlyCashCollected:null, monthlyOperatingCashPaid:null, monthsUsed:0, asOfDate:null,
      freshness:"unknown" };
  }

  if (latest.data_contract_version === 2) {
    const metric = normalizedCashHealth(monthsNewestFirst);
    const ready = metric.cash.availableCash !== null
      && metric.operating.averageCashCollected !== null
      && metric.operating.averageCashPaid !== null;
    return {
      status: ready ? "ready" : "incomplete",
      contractVersion: 2,
      currency: metric.window.reportingCurrency ?? latest.reporting_currency ?? "USD",
      availableCash: metric.cash.availableCash,
      monthlyCashCollected: metric.operating.averageCashCollected,
      monthlyOperatingCashPaid: metric.operating.averageCashPaid,
      monthsUsed: metric.window.monthsUsed,
      asOfDate: metric.cash.asOfDate,
      freshness: financialDataFreshness(metric.window.periodEnd, now),
    };
  }

  const metric = legacyCashHealth(currentCash, monthsNewestFirst);
  const ready = currentCash !== null
    && metric.averageCashCollected !== null
    && metric.averageCashPaid !== null;
  return {
    status: ready ? "ready" : "incomplete",
    contractVersion: 1,
    currency: latest.reporting_currency ?? "USD",
    availableCash: currentCash,
    monthlyCashCollected: metric.averageCashCollected,
    monthlyOperatingCashPaid: metric.averageCashPaid,
    monthsUsed: metric.monthsUsed,
    asOfDate: latest.month_date,
    freshness: financialDataFreshness(latest.month_date, now),
  };
}
