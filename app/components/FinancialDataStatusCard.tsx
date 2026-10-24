import Link from "next/link";
import { AlertTriangle, Database } from "lucide-react";
import { financialDataCoverage, financialMonthLabel, type FinancialImportStatus } from "@/lib/financialDataStatus";

export default function FinancialDataStatusCard({months,importStatus,showAction=true}:{
  months:string[]; importStatus:FinancialImportStatus; showAction?:boolean;
}) {
  const coverage = financialDataCoverage(months);
  return <section aria-label="Financial data status" className="p-6" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <h2 className="flex items-center gap-2 text-sm font-medium" style={{color:"var(--ink)"}}><Database aria-hidden size={18} />Financial data</h2>
    <p className="mt-3 text-sm" style={{color:"var(--ink)"}}>{coverage.latestMonth ? `Data through ${financialMonthLabel(coverage.latestMonth)}` : "No financial data loaded yet."}</p>
    <p className="mt-1 text-xs" style={{color:"var(--dim)"}}>{!importStatus.available ? "Last import status is temporarily unavailable." : importStatus.lastImportedAt
      ? `Last successful import: ${new Date(importStatus.lastImportedAt).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"})} UTC`
      : "No successful import recorded."}</p>
    {coverage.missingMonths.length > 0 && <p className="mt-3 flex gap-2 text-sm" style={{color:"var(--ink)"}}>
      <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" style={{color:"var(--warning)"}} />
      <span>Missing in the displayed date range: {coverage.missingMonths.slice(0,3).map(financialMonthLabel).join(", ")}{coverage.missingMonths.length > 3 ? ` and ${coverage.missingMonths.length-3} more` : ""}.</span>
    </p>}
    {showAction && <Link href="/dashboard/financial-data" className="mt-4 inline-block text-sm font-medium underline" style={{color:"var(--teal)"}}>Update financial data</Link>}
  </section>;
}
