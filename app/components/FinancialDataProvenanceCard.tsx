import { Database } from "lucide-react";
import {
  financialDataProvenance,
  financialMonthLabel,
  type FinancialDataProvenanceMonth,
  type FinancialImportStatus,
} from "@/lib/financialDataStatus";

const SOURCE_LABELS: Record<FinancialDataProvenanceMonth["source_type"],string> = {
  legacy_spreadsheet:"Legacy spreadsheet",
  spreadsheet:"Elidan spreadsheet",
  quickbooks:"QuickBooks",
  manual:"Manual entry",
  other:"Other source",
};

function joinedLabels<T extends string | number>(values:T[], label:(value:T)=>string) {
  return values.length === 1 ? label(values[0]) : values.length > 1 ? "Multiple" : "Not recorded";
}

function importTime(value:string | null) {
  return value ? `${new Date(value).toLocaleString("en-US",{
    month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC",
  })} UTC` : "No successful import recorded";
}

export default function FinancialDataProvenanceCard({months,importStatus}:{
  months:FinancialDataProvenanceMonth[];
  importStatus:FinancialImportStatus;
}) {
  if (months.length === 0) return null;
  const provenance = financialDataProvenance(months);
  const coverage = provenance.firstMonth && provenance.latestMonth
    ? provenance.firstMonth === provenance.latestMonth
      ? financialMonthLabel(provenance.firstMonth)
      : `${financialMonthLabel(provenance.firstMonth)} – ${financialMonthLabel(provenance.latestMonth)}`
    : "Not recorded";
  const latestPeriod = provenance.latestPeriodStatus === "partial" && provenance.latestPeriodCutoff
    ? `Partial through ${new Date(`${provenance.latestPeriodCutoff}T12:00:00Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}`
    : provenance.latestPeriodStatus === "complete" ? "Complete month" : "Not recorded";
  const rows = [
    ["Source",joinedLabels(provenance.sourceTypes,value=>SOURCE_LABELS[value])],
    ["Latest uploaded file",importStatus.filename ?? "Not recorded"],
    ["Date coverage",`${coverage} · ${provenance.storedMonths} stored ${provenance.storedMonths === 1 ? "month" : "months"}`],
    ["Latest period",latestPeriod],
    ["Accounting basis",joinedLabels(provenance.accountingBases,value=>value === "unknown" ? "Unknown" : `${value[0].toUpperCase()}${value.slice(1)} basis`)],
    ["Reporting currency",joinedLabels(provenance.reportingCurrencies,value=>value)],
    ["Data model",joinedLabels(provenance.contractVersions,value=>value === 2 ? "Elidan cash model v2" : "Legacy model v1")],
    ["Latest successful import",importStatus.available ? importTime(importStatus.lastImportedAt) : "Temporarily unavailable"],
  ];
  return <section aria-labelledby="financial-data-provenance-title" className="p-6" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <h2 id="financial-data-provenance-title" className="flex items-center gap-2 text-sm font-medium" style={{color:"var(--ink)"}}>
      <Database aria-hidden size={18} />About your financial data
    </h2>
    <p className="mt-2 text-xs" style={{color:"var(--dim)"}}>Use these details to confirm which records Elidan is analyzing.</p>
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {rows.map(([label,value])=><div key={label} className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-[0.08em]" style={{color:"var(--dim)"}}>{label}</dt>
        <dd className="mt-1 break-words text-sm" style={{color:"var(--ink)"}}>{value}</dd>
      </div>)}
    </dl>
  </section>;
}
