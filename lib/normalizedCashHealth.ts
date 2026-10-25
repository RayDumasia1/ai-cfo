import type { FinancialMonth } from "./types";

export const CASH_RECONCILIATION_TOLERANCE = 1;

export type CashDirection =
  | "cash_consuming"
  | "break_even"
  | "cash_generating"
  | "unavailable";

export type CashUnavailableReason =
  | "no_data"
  | "latest_month_is_legacy"
  | "invalid_period"
  | "missing_cash"
  | "invalid_cash";

export type WindowStopReason =
  | "end_of_data"
  | "month_limit"
  | "legacy_month"
  | "partial_period"
  | "invalid_period"
  | "missing_required_value"
  | "invalid_required_value"
  | "reconciliation_unknown"
  | "reconciliation_out_of_tolerance"
  | "month_gap"
  | "currency_changed"
  | "accounting_basis_changed"
  | "source_changed";

export type NormalizedCashHealth = {
  cash: {
    asOfDate: string | null;
    includedCash: number | null;
    unavailableCash: number | null;
    availableCash: number | null;
    unavailableReason: CashUnavailableReason | null;
  };
  window: {
    monthsUsed: number;
    history: "unavailable" | "limited" | "standard";
    periodStart: string | null;
    periodEnd: string | null;
    reportingCurrency: string | null;
    accountingBasis: FinancialMonth["accounting_basis"];
    sourceType: FinancialMonth["source_type"] | null;
    stoppedBecause: WindowStopReason;
  };
  operating: {
    averageCashCollected: number | null;
    averageCashPaid: number | null;
    averageNetCashFlow: number | null;
    averageCashBurn: number | null;
    direction: CashDirection;
    cashCoverageMonths: number | null;
    estimatedRunwayMonths: number | null;
  };
};

const EMPTY_RESULT: NormalizedCashHealth = {
  cash: {
    asOfDate: null,
    includedCash: null,
    unavailableCash: null,
    availableCash: null,
    unavailableReason: "no_data",
  },
  window: {
    monthsUsed: 0,
    history: "unavailable",
    periodStart: null,
    periodEnd: null,
    reportingCurrency: null,
    accountingBasis: null,
    sourceType: null,
    stoppedBecause: "end_of_data",
  },
  operating: {
    averageCashCollected: null,
    averageCashPaid: null,
    averageNetCashFlow: null,
    averageCashBurn: null,
    direction: "unavailable",
    cashCoverageMonths: null,
    estimatedRunwayMonths: null,
  },
};

function validMonthDate(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value);
}

function monthIndex(value: string): number {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
}

function previousCalendarMonth(newer: string, older: string): boolean {
  return validMonthDate(newer) && validMonthDate(older)
    && monthIndex(newer) - monthIndex(older) === 1;
}

function monthEnd(value: string): string | null {
  if (!validMonthDate(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${value.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function nonnegative(value: number | null): value is number {
  return finite(value) && value >= 0;
}

function reconciliationIssue(month: FinancialMonth): WindowStopReason | null {
  if (month.cash_reconciliation_difference === null) return "reconciliation_unknown";
  if (!finite(month.cash_reconciliation_difference)) return "invalid_required_value";
  return Math.abs(month.cash_reconciliation_difference) > CASH_RECONCILIATION_TOLERANCE
    ? "reconciliation_out_of_tolerance"
    : null;
}

function cloneEmpty(): NormalizedCashHealth {
  return {
    cash: { ...EMPTY_RESULT.cash },
    window: { ...EMPTY_RESULT.window },
    operating: { ...EMPTY_RESULT.operating },
  };
}

function cashFromLatest(month: FinancialMonth): NormalizedCashHealth["cash"] {
  if (month.data_contract_version !== 2) {
    return { ...EMPTY_RESULT.cash, unavailableReason: "latest_month_is_legacy" };
  }
  if (month.period_status !== "complete" && month.period_status !== "partial") {
    return { ...EMPTY_RESULT.cash, unavailableReason: "invalid_period" };
  }
  if (month.period_status === "partial"
      && (!month.period_cutoff_date
        || !/^\d{4}-\d{2}-\d{2}$/.test(month.period_cutoff_date)
        || month.period_cutoff_date.slice(0, 7) !== month.month_date.slice(0, 7))) {
    return { ...EMPTY_RESULT.cash, unavailableReason: "invalid_period" };
  }
  const asOfDate = month.period_status === "partial" ? month.period_cutoff_date : monthEnd(month.month_date);
  if (!asOfDate || !finite(month.closing_included_cash) || !finite(month.closing_unavailable_cash)) {
    return { ...EMPTY_RESULT.cash, asOfDate, unavailableReason: "missing_cash" };
  }
  if (month.closing_unavailable_cash < 0
      || month.closing_unavailable_cash > Math.max(month.closing_included_cash, 0)) {
    return { ...EMPTY_RESULT.cash, asOfDate, unavailableReason: "invalid_cash" };
  }
  return {
    asOfDate,
    includedCash: month.closing_included_cash,
    unavailableCash: month.closing_unavailable_cash,
    availableCash: month.closing_included_cash - month.closing_unavailable_cash,
    unavailableReason: null,
  };
}

function rowIssue(month: FinancialMonth): WindowStopReason | null {
  if (!validMonthDate(month.month_date)) return "invalid_period";
  if (month.data_contract_version !== 2) return "legacy_month";
  if (month.period_status === "partial") return "partial_period";
  if (month.period_status !== "complete" || month.period_cutoff_date !== null) return "invalid_period";
  if (!month.reporting_currency || !month.accounting_basis) return "missing_required_value";
  if (month.source_type === "legacy_spreadsheet") return "invalid_required_value";
  if (!nonnegative(month.cash_collected_from_customers)
      || !nonnegative(month.operating_cash_paid)) return "invalid_required_value";
  return reconciliationIssue(month);
}

/**
 * FIN-03A classified cash engine.
 *
 * It calculates only what contract-v2 data supports without assumptions:
 * operating cash flow, operating cash coverage and conditional operating
 * runway. Non-operating movements remain excluded because v2 records their
 * classification but not whether each movement is recurring.
 */
export function normalizedCashHealth(
  months: FinancialMonth[],
  monthLimit = 3,
): NormalizedCashHealth {
  const result = cloneEmpty();
  const ordered = [...months]
    .filter(month => validMonthDate(month.month_date))
    .sort((a, b) => b.month_date.localeCompare(a.month_date));
  const latest = ordered[0];
  if (!latest) return result;

  result.cash = cashFromLatest(latest);
  if (!Number.isInteger(monthLimit) || monthLimit < 1) return result;

  let startIndex = 0;
  if (latest.data_contract_version === 2 && latest.period_status === "partial") startIndex = 1;
  const candidate = ordered[startIndex];
  if (!candidate) {
    result.window.stoppedBecause = latest.period_status === "partial" ? "partial_period" : "end_of_data";
    return result;
  }
  if (startIndex === 1 && !previousCalendarMonth(latest.month_date, candidate.month_date)) {
    result.window.stoppedBecause = "month_gap";
    return result;
  }
  if (startIndex === 1) {
    const partialIssue = reconciliationIssue(latest);
    if (partialIssue) {
      result.window.stoppedBecause = partialIssue;
      return result;
    }
    if (!latest.reporting_currency || !latest.accounting_basis
        || latest.source_type === "legacy_spreadsheet") {
      result.window.stoppedBecause = "missing_required_value";
      return result;
    }
    if (latest.reporting_currency !== candidate.reporting_currency) {
      result.window.stoppedBecause = "currency_changed";
      return result;
    }
    if (latest.accounting_basis !== candidate.accounting_basis) {
      result.window.stoppedBecause = "accounting_basis_changed";
      return result;
    }
    if (latest.source_type !== candidate.source_type) {
      result.window.stoppedBecause = "source_changed";
      return result;
    }
  }

  const eligible: FinancialMonth[] = [];
  let stoppedBecause: WindowStopReason = "end_of_data";
  for (let index = startIndex; index < ordered.length; index++) {
    if (eligible.length === monthLimit) {
      stoppedBecause = "month_limit";
      break;
    }
    const month = ordered[index];
    const issue = rowIssue(month);
    if (issue) {
      stoppedBecause = issue;
      break;
    }
    const previous = eligible[eligible.length - 1];
    if (previous && !previousCalendarMonth(previous.month_date, month.month_date)) {
      stoppedBecause = "month_gap";
      break;
    }
    const first = eligible[0];
    if (first && month.reporting_currency !== first.reporting_currency) {
      stoppedBecause = "currency_changed";
      break;
    }
    if (first && month.accounting_basis !== first.accounting_basis) {
      stoppedBecause = "accounting_basis_changed";
      break;
    }
    if (first && month.source_type !== first.source_type) {
      stoppedBecause = "source_changed";
      break;
    }
    eligible.push(month);
  }

  if (eligible.length === 0) {
    result.window.stoppedBecause = stoppedBecause;
    return result;
  }

  const first = eligible[0];
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const averageCashCollected = average(eligible.map(month => month.cash_collected_from_customers!));
  const averageCashPaid = average(eligible.map(month => month.operating_cash_paid!));
  const averageNetCashFlow = averageCashCollected - averageCashPaid;
  const averageCashBurn = Math.max(-averageNetCashFlow, 0);
  const availableForRatios = result.cash.availableCash === null
    ? null
    : Math.max(result.cash.availableCash, 0);

  result.window = {
    monthsUsed: eligible.length,
    history: eligible.length >= 3 ? "standard" : "limited",
    periodStart: eligible[eligible.length - 1].month_date,
    periodEnd: first.month_date,
    reportingCurrency: first.reporting_currency,
    accountingBasis: first.accounting_basis,
    sourceType: first.source_type,
    stoppedBecause,
  };
  result.operating = {
    averageCashCollected,
    averageCashPaid,
    averageNetCashFlow,
    averageCashBurn,
    direction: averageNetCashFlow < 0
      ? "cash_consuming"
      : averageNetCashFlow > 0 ? "cash_generating" : "break_even",
    cashCoverageMonths: availableForRatios !== null && averageCashPaid > 0
      ? availableForRatios / averageCashPaid : null,
    estimatedRunwayMonths: availableForRatios !== null && averageCashBurn > 0
      ? availableForRatios / averageCashBurn : null,
  };
  return result;
}
