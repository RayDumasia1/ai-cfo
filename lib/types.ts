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
