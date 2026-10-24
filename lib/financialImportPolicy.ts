import type { BusinessProfileInsert } from "./types";

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
