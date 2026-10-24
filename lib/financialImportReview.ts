import { isFinancialImportMode, type FinancialImportMode } from "./financialImportPolicy";
import { DASHBOARD_MONTH_LIMIT } from "./financialImportPolicy";

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
}

export function buildImportReview(filename: string, mode: FinancialImportMode, incoming: string[], state: ImportReviewState, warnings: string[]): ImportReview {
  const current = new Set(state.months);
  const dates = [...incoming].sort();
  const uploaded = new Set(dates);
  const resulting = [...new Set(mode === "replace_all" ? dates : [...state.months, ...dates])].sort();
  const latest = [...state.months].sort().at(-1) ?? null;
  const visible = new Set(resulting.slice(-DASHBOARD_MONTH_LIMIT));
  return {
    filename, mode, incomingMonths: dates,
    addedMonths: dates.filter(date => !current.has(date)),
    updatedMonths: dates.filter(date => current.has(date)),
    removedMonths: mode === "replace_all" ? state.months.filter(date => !uploaded.has(date)).sort() : [],
    olderMonths: dates.filter(date => latest !== null && date < latest),
    outsideDashboardMonths: dates.filter(date => !visible.has(date)),
    currentLatestMonth: latest, resultingLatestMonth: resulting.at(-1)!,
    resultingMonthsTotal: resulting.length, dashboardMonthsLimit: DASHBOARD_MONTH_LIMIT,
    warnings: [...warnings],
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
    !lists.every(field => isMonthList(v[field])) || !Array.isArray(v.warnings) || !v.warnings.every(w => typeof w === "string")) return false;
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
