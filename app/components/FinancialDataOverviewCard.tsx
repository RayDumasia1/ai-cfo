import { CalendarRange } from "lucide-react";
import { financialDataProvenance, financialMonthLabel, type FinancialDataProvenanceMonth } from "@/lib/financialDataStatus";

function singleLabel(values:(string | number)[],label:(value:string | number)=>string) {
  return values.length === 1 ? label(values[0]) : values.length > 1 ? "Multiple" : "Not recorded";
}

export default function FinancialDataOverviewCard({months}:{months:FinancialDataProvenanceMonth[]}) {
  if (months.length === 0) return <section aria-labelledby="financial-data-overview-title" className="p-5" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <h2 id="financial-data-overview-title" className="flex items-center gap-2 text-sm font-medium" style={{color:"var(--ink)"}}><CalendarRange aria-hidden size={18} />Current financial data</h2>
    <p className="mt-3 text-sm" style={{color:"var(--dim)"}}>No financial data loaded yet.</p>
  </section>;
  const data = financialDataProvenance(months);
  const coverage = data.firstMonth && data.latestMonth
    ? `${financialMonthLabel(data.firstMonth)} – ${financialMonthLabel(data.latestMonth)}`
    : "Not recorded";
  const latestPeriod = data.latestPeriodStatus === "partial" && data.latestPeriodCutoff
    ? `Partial through ${new Date(`${data.latestPeriodCutoff}T12:00:00Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}`
    : data.latestPeriodStatus === "complete" ? "Complete month" : "Not recorded";
  const basis = singleLabel(data.accountingBases,value=>value === "unknown" ? "Unknown" : `${String(value)[0].toUpperCase()}${String(value).slice(1)} basis`);
  const currency = singleLabel(data.reportingCurrencies,String);
  const items = [
    ["Data through",data.latestMonth ? financialMonthLabel(data.latestMonth) : "Not recorded"],
    ["Coverage",`${coverage} · ${data.storedMonths} ${data.storedMonths === 1 ? "month" : "months"}`],
    ["Basis and currency",`${basis} · ${currency}`],
    ["Latest period",latestPeriod],
  ];
  return <section aria-labelledby="financial-data-overview-title" className="p-5" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <h2 id="financial-data-overview-title" className="flex items-center gap-2 text-sm font-medium" style={{color:"var(--ink)"}}><CalendarRange aria-hidden size={18} />Current financial data</h2>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label,value])=><div key={label} className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{color:"var(--dim)"}}>{label}</dt>
        <dd className="mt-1 text-sm" style={{color:"var(--ink)"}}>{value}</dd>
      </div>)}
    </dl>
  </section>;
}
