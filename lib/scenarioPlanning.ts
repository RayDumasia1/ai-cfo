import { financialDataFreshness, legacyCashHealth, type FinancialDataFreshness } from "./calculations";
import { normalizedCashHealth } from "./normalizedCashHealth";
import type { FinancialMonth } from "./types";
import type { ActionInsert } from "./types";

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

export type ScenarioActionOption = {
  key: "collections" | "spending" | "cash_receipt" | "cash_payment";
  label: string;
  prefill: Partial<ActionInsert>;
};

export type ScenarioActionInput = {
  currency: string;
  currentCollections: number;
  proposedCollections: number;
  currentSpending: number;
  proposedSpending: number;
  currentRunway: number | null;
  proposedRunway: number | null;
  eventType: "none" | "receipt" | "payment";
  eventAmount: number;
};

function scenarioMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style:"currency", currency,
    maximumFractionDigits:0 }).format(value);
}

function runwayContext(current: number | null, proposed: number | null): string {
  if (current !== null && proposed !== null) {
    return ` Estimated operating runway changes from ${current.toFixed(1)} to ${proposed.toFixed(1)} months.`;
  }
  if (current !== null && proposed === null) {
    return " The scenario removes the operating cash shortfall, so a depletion runway is no longer projected.";
  }
  if (current === null && proposed !== null) {
    return ` The scenario creates an operating cash shortfall with ${proposed.toFixed(1)} months of estimated runway.`;
  }
  return "";
}

function monetaryGoal(value: number, currency: string): Pick<Partial<ActionInsert>, "goal_value" | "goal_unit"> {
  return currency === "USD" ? { goal_value:Math.round(value), goal_unit:"usd" }
    : { goal_value:null, goal_unit:null };
}

/** Deterministic, editable action choices from one unsaved Starter scenario. */
export function scenarioActionOptions(input: ScenarioActionInput): ScenarioActionOption[] {
  const options: ScenarioActionOption[] = [];
  const collectionsChange = input.proposedCollections-input.currentCollections;
  const spendingChange = input.proposedSpending-input.currentSpending;
  const runway = runwayContext(input.currentRunway,input.proposedRunway);

  if (collectionsChange > 0) {
    options.push({ key:"collections", label:`Increase monthly cash from customers by ${scenarioMoney(collectionsChange,input.currency)}`,
      prefill:{ name:"Increase monthly cash from customers", goal_type:"revenue_increase",
        ...monetaryGoal(collectionsChange,input.currency),
        description:`Increase monthly cash received from customers from ${scenarioMoney(input.currentCollections,input.currency)} to ${scenarioMoney(input.proposedCollections,input.currency)}.${runway}` } });
  } else if (collectionsChange < 0) {
    options.push({ key:"collections", label:`Prepare for ${scenarioMoney(Math.abs(collectionsChange),input.currency)} less monthly customer cash`,
      prefill:{ name:"Prepare for lower customer cash receipts", goal_type:"risk_mitigation",
        ...monetaryGoal(Math.abs(collectionsChange),input.currency),
        description:`Prepare for monthly cash from customers decreasing from ${scenarioMoney(input.currentCollections,input.currency)} to ${scenarioMoney(input.proposedCollections,input.currency)}.${runway}` } });
  }

  if (spendingChange < 0) {
    options.push({ key:"spending", label:`Reduce monthly operating spending by ${scenarioMoney(Math.abs(spendingChange),input.currency)}`,
      prefill:{ name:"Reduce monthly operating spending", goal_type:"expense_reduction",
        ...monetaryGoal(Math.abs(spendingChange),input.currency),
        description:`Reduce monthly operating spending from ${scenarioMoney(input.currentSpending,input.currency)} to ${scenarioMoney(input.proposedSpending,input.currency)}.${runway}` } });
  } else if (spendingChange > 0) {
    options.push({ key:"spending", label:`Prepare for ${scenarioMoney(spendingChange,input.currency)} more monthly operating spending`,
      prefill:{ name:"Prepare for higher operating spending", goal_type:"risk_mitigation",
        ...monetaryGoal(spendingChange,input.currency),
        description:`Prepare for monthly operating spending increasing from ${scenarioMoney(input.currentSpending,input.currency)} to ${scenarioMoney(input.proposedSpending,input.currency)}.${runway}` } });
  }

  if (input.eventType === "receipt" && input.eventAmount > 0) {
    options.push({ key:"cash_receipt", label:`Secure a one-time ${scenarioMoney(input.eventAmount,input.currency)} cash receipt`,
      prefill:{ name:"Secure one-time cash receipt", goal_type:"risk_mitigation",
        ...monetaryGoal(input.eventAmount,input.currency),
        description:`Secure the one-time ${scenarioMoney(input.eventAmount,input.currency)} cash receipt used in this scenario.${runway}` } });
  } else if (input.eventType === "payment" && input.eventAmount > 0) {
    options.push({ key:"cash_payment", label:`Prepare for a one-time ${scenarioMoney(input.eventAmount,input.currency)} cash payment`,
      prefill:{ name:"Prepare for one-time cash payment", goal_type:"risk_mitigation",
        ...monetaryGoal(input.eventAmount,input.currency),
        description:`Prepare for the one-time ${scenarioMoney(input.eventAmount,input.currency)} cash payment used in this scenario.${runway}` } });
  }
  return options;
}

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
