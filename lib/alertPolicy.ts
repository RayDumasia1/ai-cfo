import type { AlertCode } from "./types";

const PROTECTED = new Set(["RUNWAY_DANGER", "CASH_BELOW_RESERVE",
  "OPERATING_RUNWAY_DANGER", "AVAILABLE_CASH_BELOW_RESERVE"]);
const DISMISSIBLE = new Set(["RUNWAY_WARNING", "BURN_RATE_SPIKE", "HIGH_AR", "REVENUE_GROWTH",
  "OPERATING_RUNWAY_WARNING", "OPERATING_SPENDING_INCREASE", "CUSTOMER_COLLECTIONS_INCREASE"]);

export function isProtectedAlertCode(value: unknown): boolean {
  return typeof value === "string" && PROTECTED.has(value);
}

export function isDismissibleAlertCode(value: unknown): value is AlertCode {
  return typeof value === "string" && DISMISSIBLE.has(value);
}
