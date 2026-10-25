import {
  financialDataProvenance,
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
  const rows = [
    ["Source",joinedLabels(provenance.sourceTypes,value=>SOURCE_LABELS[value])],
    ["Latest uploaded file",importStatus.filename ?? "Not recorded"],
    ["Data model",joinedLabels(provenance.contractVersions,value=>value === 2 ? "Elidan cash model v2" : "Legacy model v1")],
    ["Latest successful import",importStatus.available ? importTime(importStatus.lastImportedAt) : "Temporarily unavailable"],
  ];
  return <details className="p-5" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <summary className="cursor-pointer text-sm font-medium" style={{color:"var(--ink)"}}>Source details</summary>
    <p className="mt-2 text-xs" style={{color:"var(--dim)"}}>Technical details about the records Elidan is analyzing.</p>
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {rows.map(([label,value])=><div key={label} className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-[0.08em]" style={{color:"var(--dim)"}}>{label}</dt>
        <dd className="mt-1 break-words text-sm" style={{color:"var(--ink)"}}>{value}</dd>
      </div>)}
    </dl>
  </details>;
}
