import type { RevenueExpensesPoint } from "@/lib/calculations";
import { financialMonthLabel } from "@/lib/financialDataStatus";

function currency(value: number | null): string {
  return value === null ? "Not provided" : new Intl.NumberFormat("en-US",{
    style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2,
  }).format(value);
}

export default function RevenueExpensesTooltip({active,point}:{active?:boolean;point?:RevenueExpensesPoint}) {
  if (!active || !point) return null;
  const label = financialMonthLabel(point.monthDate);
  return <div className="max-w-xs p-3 text-xs" style={{background:"var(--surface)",border:"1px solid var(--line)",
    borderRadius:"var(--radius-md)",boxShadow:"var(--shadow-md)",color:"var(--ink)"}}>
    <p className="mb-2 font-medium">{label}{point.missingThrough && point.missingThrough !== point.monthDate ? `–${financialMonthLabel(point.missingThrough)}` : ""}</p>
    {point.missingThrough && <p className="mb-2">No financial data provided for {point.missingThrough === point.monthDate ? "this month" : "this period"}.</p>}
    <p>Cash collected: {currency(point.revenue)}</p>
    <p>Cash paid: {currency(point.expenses)}</p>
    <p className="mt-2">Net reported cash: {point.difference === null ? "Not available" : currency(point.difference)}</p>
  </div>;
}
