import { History } from "lucide-react";
import type { FinancialImportHistory, FinancialImportHistoryItem } from "@/lib/financialDataStatus";

function importDate(value:string) {
  return `${new Date(value).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"})} UTC`;
}

function sourceLabel(item:FinancialImportHistoryItem) {
  if (item.import_type === "quickbooks") return "QuickBooks";
  if (item.import_type === "csv") return "CSV upload";
  return "Spreadsheet upload";
}

function statusLabel(status:FinancialImportHistoryItem["status"]) {
  return status === "success" ? "Successful" : status === "error" ? "Failed" : "Processing";
}

function statusColor(status:FinancialImportHistoryItem["status"]) {
  return status === "success" ? "var(--success)" : status === "error" ? "var(--danger)" : "var(--warning)";
}

function ImportStatus({status}:{status:FinancialImportHistoryItem["status"]}) {
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{color:statusColor(status)}}>
    <span aria-hidden className="h-2 w-2 rounded-full" style={{background:statusColor(status)}} />{statusLabel(status)}
  </span>;
}

export default function RecentFinancialImportsCard({history}:{history:FinancialImportHistory}) {
  return <section aria-labelledby="recent-imports-title" className="p-6" style={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)"}}>
    <h2 id="recent-imports-title" className="flex items-center gap-2 text-sm font-medium" style={{color:"var(--ink)"}}><History aria-hidden size={18} />Recent imports</h2>
    <p className="mt-2 text-xs" style={{color:"var(--dim)"}}>A record of recent import attempts. Uploaded files are not stored for download or restoration.</p>
    {!history.available ? <p className="mt-4 text-sm" role="status" style={{color:"var(--dim)"}}>Import history is temporarily unavailable.</p>
      : history.imports.length === 0 ? <p className="mt-4 text-sm" style={{color:"var(--dim)"}}>No import history yet.</p>
      : <>
        <div className="mt-4 hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Recent financial data imports</caption>
            <thead><tr style={{borderBottom:"1px solid var(--line)"}}>
              {['Imported','Source or file','Result','Months'].map(label=><th key={label} scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-[0.08em]" style={{color:"var(--dim)"}}>{label}</th>)}
            </tr></thead>
            <tbody>{history.imports.map(item=><tr key={item.id} style={{borderBottom:"1px solid var(--line)"}}>
              <td className="px-3 py-3 whitespace-nowrap" style={{color:"var(--ink)"}}>{importDate(item.created_at)}</td>
              <td className="max-w-xs px-3 py-3"><span className="block break-words" style={{color:"var(--ink)"}}>{item.filename ?? sourceLabel(item)}</span><span className="text-xs" style={{color:"var(--dim)"}}>{sourceLabel(item)}</span></td>
              <td className="px-3 py-3"><ImportStatus status={item.status} /></td>
              <td className="px-3 py-3" style={{color:"var(--ink)"}}>{item.months_imported ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-3 sm:hidden">{history.imports.map(item=><li key={item.id} className="p-4" style={{background:"var(--row-alt)",border:"1px solid var(--line)",borderRadius:"var(--radius-md)"}}>
          <div className="flex items-start justify-between gap-3"><p className="break-all text-sm font-medium" style={{color:"var(--ink)"}}>{item.filename ?? sourceLabel(item)}</p><ImportStatus status={item.status} /></div>
          <p className="mt-1 text-xs" style={{color:"var(--dim)"}}>{sourceLabel(item)} · {importDate(item.created_at)}</p>
          <p className="mt-2 text-xs" style={{color:"var(--ink)"}}>Months imported: {item.months_imported ?? "—"}</p>
        </li>)}</ul>
      </>}
  </section>;
}
