import type { FinancialMonthInsert, BusinessProfileInsert } from "./types";
import type { ImportNotice } from "./importNotices";

export interface ParseResult {
  months: Omit<FinancialMonthInsert, "user_id" | "business_id">[];
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>;
  errors: string[];
  warnings: string[];
  notices?: ImportNotice[];
  contractVersion?: 1 | 2;
}
