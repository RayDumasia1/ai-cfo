import type { BusinessProfileInsert } from "./types";

export type FinancialImportMode = "update_months" | "replace_all";
export const DEFAULT_IMPORT_MODE: FinancialImportMode = "update_months";
export function isFinancialImportMode(value: unknown): value is FinancialImportMode {
  return value === "update_months" || value === "replace_all";
}

export interface FinancialImportResult {
  replaced: boolean;
  months_imported: number;
  mode: FinancialImportMode;
  months_total: number;
  date_from: string;
  date_to: string;
  current_cash: number | null;
}

export function isFinancialImportResult(value: unknown, mode: FinancialImportMode, count: number): value is FinancialImportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const month = /^\d{4}-(0[1-9]|1[0-2])-01$/;
  return result.mode === mode && typeof result.replaced === "boolean" && result.months_imported === count &&
    typeof result.months_total === "number" && Number.isSafeInteger(result.months_total) && result.months_total >= count &&
    (mode !== "replace_all" || result.months_total === count) &&
    typeof result.date_from === "string" && month.test(result.date_from) &&
    typeof result.date_to === "string" && month.test(result.date_to) && result.date_from <= result.date_to &&
    (result.current_cash === null || (typeof result.current_cash === "number" && Number.isFinite(result.current_cash)));
}

// Workbook templates may contain sample settings. They must never overwrite
// account preferences, including on an account's first financial upload.
export const WORKBOOK_THRESHOLD_FIELDS = [
  "min_cash_reserve", "runway_warning_threshold", "runway_danger_threshold",
  "burn_rate_warning_pct", "invoice_overdue_days",
] as const;

export const WORKBOOK_THRESHOLD_WARNING =
  "Workbook alert thresholds were ignored. Manage your alert thresholds in Settings.";

export const WORKBOOK_BUSINESS_FIELDS = [
  "business_name", "industry", "accounting_system", "employee_count",
] as const;

export const WORKBOOK_BUSINESS_WARNING =
  "Workbook business details only fill empty fields during onboarding. Existing account details are preserved.";

export function importedBusinessDetails(profile: Partial<Omit<BusinessProfileInsert, "user_id">>) {
  const details = { ...profile };
  for (const field of WORKBOOK_THRESHOLD_FIELDS) delete details[field];
  return details;
}
