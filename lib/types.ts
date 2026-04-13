/** Raw financial data collected from the user (or, later, from QuickBooks/banking). */
export type FinancialInput = {
  cashBalance: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
};

export type RiskLevel = "Low" | "Medium" | "High" | "Healthy";

/** All derived metrics produced by calculateFinancials(). */
export type FinancialSnapshot = {
  /** Current cash on hand. Passthrough today; aggregated across accounts when live data arrives. */
  cashPosition: number;
  /** Net monthly cash flow. Positive = burning, negative = generating. */
  burnRate: number;
  /** Months until cash reaches zero. Null when not burning (profitable or break-even). */
  runwayMonths: number | null;
  /** Calendar month cash runs out, e.g. "August 2027". Null when not burning. */
  runoutDate: string | null;
  riskLevel: RiskLevel;
  summary: string;
};

// ─── Database row types ───────────────────────────────────────────────────────
// Mirror the Supabase schema exactly. All date/timestamptz columns are returned
// as ISO strings by the JS client. Nullable columns are typed `| null`.

export type BusinessProfile = {
  id: string;
  user_id: string;
  business_name: string | null;
  industry: string | null;
  accounting_system: string | null;
  employee_count: number | null;
  min_cash_reserve: number | null;
  runway_warning_threshold: number;
  runway_danger_threshold: number;
  burn_rate_warning_pct: number;
  invoice_overdue_days: number;
  created_at: string;
  updated_at: string;
};

export type FinancialMonth = {
  id: string;
  user_id: string;
  business_id: string | null;
  /** ISO date string, first day of the month — e.g. "2026-04-01" */
  month_date: string;
  opening_cash: number | null;
  closing_cash: number | null;
  total_revenue: number | null;
  total_expenses: number | null;
  payroll: number | null;
  ar_outstanding: number | null;
  ap_outstanding: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseCategory = {
  id: string;
  user_id: string;
  business_id: string | null;
  month_date: string;
  category: string;
  amount: number;
  notes: string | null;
  created_at: string;
};

export type DataImport = {
  id: string;
  user_id: string;
  import_type: "excel" | "csv" | "quickbooks" | "manual";
  filename: string | null;
  months_imported: number | null;
  status: "pending" | "success" | "error";
  error_message: string | null;
  created_at: string;
};

/** Insert shapes — omit server-generated fields */
export type BusinessProfileInsert = Omit<BusinessProfile, "id" | "created_at" | "updated_at">;
export type FinancialMonthInsert  = Omit<FinancialMonth,  "id" | "created_at" | "updated_at">;
export type ExpenseCategoryInsert = Omit<ExpenseCategory, "id" | "created_at">;
export type DataImportInsert      = Omit<DataImport,      "id" | "created_at">;
