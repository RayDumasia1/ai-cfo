import { isFinancialImportMode, type FinancialImportMode } from "./financialImportPolicy";
import { DASHBOARD_MONTH_LIMIT } from "./financialImportPolicy";
import { WORKBOOK_BUSINESS_WARNING, WORKBOOK_THRESHOLD_WARNING } from "./financialImportPolicy";
import { isImportNotice, type ImportNotice } from "./importNotices";

export interface ImportReviewState { state_version: string; months: string[]; }
export interface ImportReview {
  filename: string;
  mode: FinancialImportMode;
  incomingMonths: string[];
  addedMonths: string[];
  updatedMonths: string[];
  removedMonths: string[];
  olderMonths: string[];
  outsideDashboardMonths: string[];
  currentLatestMonth: string | null;
  resultingLatestMonth: string;
  resultingMonthsTotal: number;
  dashboardMonthsLimit: number;
  warnings: string[];
  notices?: ImportNotice[];
}

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function monthLabel(index: number): string {
  const date = `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}-01`;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

/** Compress consecutive missing months into ranges without hiding which dates are affected. */
function monthRanges(indices: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const first = indices[i];
    while (i + 1 < indices.length && indices[i + 1] === indices[i] + 1) i++;
    const last = indices[i];
    ranges.push(first === last ? monthLabel(first) : `${monthLabel(first)}–${monthLabel(last)}`);
  }
  return ranges.join(", ");
}

function missingMonthNotices(dates: string[], current: Set<string>, mode: FinancialImportMode): ImportNotice[] {
  if (dates.length < 2) return [];
  const uploaded = new Set(dates.map(monthIndex));
  const saved = new Set([...current].map(monthIndex));
  const kept: number[] = [];
  const removed: number[] = [];
  const gaps: number[] = [];
  // Only internal gaps count: a partial year or single-month correction is valid.
  for (let index = monthIndex(dates[0]) + 1; index < monthIndex(dates[dates.length - 1]); index++) {
    if (uploaded.has(index)) continue;
    if (!saved.has(index)) gaps.push(index);
    else if (mode === "update_months") kept.push(index);
    else removed.push(index);
  }
  const notices: ImportNotice[] = [];
  if (kept.length) notices.push({code:"missing_kept", category:"info", title:"Saved months will be kept",
    message:`Missing from this file: ${monthRanges(kept)}. Your saved data for these months will be kept.`});
  if (removed.length) notices.push({code:"missing_removed", category:"danger", title:"Missing saved months will be removed",
    message:`Missing from this file: ${monthRanges(removed)}. Your saved data for these months will be removed because Replace all is selected.`});
  if (gaps.length) notices.push({code:"missing_gap", category:"warning", title:"Missing months",
    message:`Missing from this file: ${monthRanges(gaps)}. No saved data exists for these months; your financial timeline will contain gaps. Missing values will not be filled with zero.`});
  return notices;
}

/** Known routine notes can be disclosed; unknown warnings always stay visible. */
function warningNotice(message: string): ImportNotice {
  if (message === WORKBOOK_THRESHOLD_WARNING || message === WORKBOOK_BUSINESS_WARNING) {
    return {code:"account_settings", category:"info", title:"Workbook settings", message};
  }
  return {code:"workbook_warning", category:"warning", title:"Check your workbook", message};
}

export function getImportReviewNotices(review: ImportReview): ImportNotice[] {
  const notices = [...(review.notices ?? [])];
  // Compatibility with older review responses and previously unclassified messages.
  for (const warning of review.warnings) {
    if (!notices.some(notice => notice.message === warning)) notices.push(warningNotice(warning));
  }
  return notices;
}

export function buildImportReview(filename: string, mode: FinancialImportMode, incoming: string[], state: ImportReviewState, warnings: string[], parserNotices: ImportNotice[] = []): ImportReview {
  const current = new Set(state.months);
  const dates = [...incoming].sort();
  const uploaded = new Set(dates);
  const resulting = [...new Set(mode === "replace_all" ? dates : [...state.months, ...dates])].sort();
  const latest = [...state.months].sort().at(-1) ?? null;
  const visible = new Set(resulting.slice(-DASHBOARD_MONTH_LIMIT));
  const missing = missingMonthNotices(dates, current, mode);
  return {
    filename, mode, incomingMonths: dates,
    addedMonths: dates.filter(date => !current.has(date)),
    updatedMonths: dates.filter(date => current.has(date)),
    removedMonths: mode === "replace_all" ? state.months.filter(date => !uploaded.has(date)).sort() : [],
    olderMonths: dates.filter(date => latest !== null && date < latest),
    outsideDashboardMonths: dates.filter(date => !visible.has(date)),
    currentLatestMonth: latest, resultingLatestMonth: resulting.at(-1)!,
    resultingMonthsTotal: resulting.length, dashboardMonthsLimit: DASHBOARD_MONTH_LIMIT,
    warnings: [...warnings, ...missing.map(notice => notice.message),
      ...(missing.length ? ["You can continue with this upload, or cancel and correct the workbook."] : [])],
    notices: [...warnings.map(message => parserNotices.find(notice => notice.message === message) ?? warningNotice(message)),
      ...missing, ...(missing.length ? [{code:"missing_continue",category:"info" as const,title:"Your choice",
        message:"You can continue with this upload, or cancel and correct the workbook."}] : [])],
  };
}

export function isMonthList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(v)) &&
    new Set(value).size === value.length;
}

export function isImportReview(value: unknown, mode: FinancialImportMode): value is ImportReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const lists = ["incomingMonths", "addedMonths", "updatedMonths", "removedMonths", "olderMonths", "outsideDashboardMonths"] as const;
  if (!isFinancialImportMode(v.mode) || v.mode !== mode || typeof v.filename !== "string" || !v.filename ||
    !lists.every(field => isMonthList(v[field])) || !Array.isArray(v.warnings) || !v.warnings.every(w => typeof w === "string") ||
    (v.notices !== undefined && (!Array.isArray(v.notices) || !v.notices.every(isImportNotice)))) return false;
  const review = value as ImportReview;
  const incoming = new Set(review.incomingMonths);
  const added = new Set(review.addedMonths);
  return incoming.size > 0 && review.addedMonths.length + review.updatedMonths.length === incoming.size &&
    review.addedMonths.every(v => incoming.has(v)) && review.updatedMonths.every(v => incoming.has(v) && !added.has(v)) &&
    review.removedMonths.every(v => !incoming.has(v)) && (mode === "replace_all" || review.removedMonths.length === 0) &&
    review.olderMonths.every(v => incoming.has(v)) && review.outsideDashboardMonths.every(v => incoming.has(v)) &&
    Number.isSafeInteger(review.resultingMonthsTotal) && review.resultingMonthsTotal >= incoming.size &&
    review.dashboardMonthsLimit === DASHBOARD_MONTH_LIMIT &&
    isMonthList([review.resultingLatestMonth]) &&
    (review.currentLatestMonth === null || isMonthList([review.currentLatestMonth]));
}

export function importReviewAction(review: ImportReview): string {
  const count = review.incomingMonths.length;
  const months = `${count} month${count === 1 ? "" : "s"}`;
  if (review.mode === "replace_all") return `Replace all data with ${months}`;
  if (review.updatedMonths.length === 0) return `Add ${months}`;
  if (review.addedMonths.length === 0) return `Update ${months}`;
  return `Import ${months}`;
}
