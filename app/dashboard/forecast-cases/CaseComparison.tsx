import type { CaseBase } from "@/lib/forecastCases";
import { caseWarningText } from "@/lib/forecastCases";
import type { ForecastResult } from "@/lib/cashForecast";
import { reviewDateLabel as date,reviewMoneyLabel } from "../forecast-review/ReviewResult";
export type CaseColumn={label:string;result:ForecastResult;date:string};
export default function CaseComparison({base,baseResult,columns}:{base:CaseBase;baseResult:ForecastResult;columns:CaseColumn[]}){
  const money=(value:number|null)=>value===null?"Unknown":reviewMoneyLabel(value,base.currency);
  const all=[{label:`Base plan ${base.versionNumber}`,result:baseResult,date:base.asOfDate},...columns];
  return <section className="space-y-5" aria-label="Cash case comparison">
    <div className="grid gap-4 md:grid-cols-3">{all.map((c,index)=><div key={c.label} className="rounded-lg border border-line bg-bg p-4">
      <h3 className="text-sm font-medium text-ink">{c.label}</h3><dl className="mt-3 space-y-3 text-sm">
        <div><dt className="text-xs text-dim">Lowest projected weekly cash</dt><dd className="mt-1 text-lg font-medium text-ink">{money(c.result.summary.lowestProjectedCash)}</dd></div>
        <div><dt className="text-xs text-dim">Projected closing cash after 13 weeks</dt><dd>{money(c.result.summary.endingCash)}</dd></div>
        <div><dt className="text-xs text-dim">First week below reserve</dt><dd>{c.result.summary.firstReserveBreachWeek?date(c.result.summary.firstReserveBreachWeek):"None in this window"}</dd></div>
        {index>0&&<div><dt className="text-xs text-dim">Ending cash difference from base</dt><dd>{money(c.result.summary.endingCash===null||baseResult.summary.endingCash===null?null:c.result.summary.endingCash-baseResult.summary.endingCash)}</dd></div>}
      </dl>{index>0&&<p className="mt-3 text-xs text-dim">Calculated {date(c.date)}</p>}
      <p className="mt-3 text-xs text-dim">{c.result.summary.unresolvedItemCount} unresolved items · {c.result.summary.lowConfidenceItemCount} items need confirmation</p>
    </div>)}</div>
    <div className="overflow-x-auto rounded-md border border-line" role="region" tabIndex={0} aria-label="Weekly cash comparison table"><table className="w-full min-w-[560px] text-left text-sm">
      <caption className="sr-only">Weekly closing available cash for cases using the same base dates and starting cash</caption>
      <thead className="bg-bg"><tr><th className="p-3 font-medium" scope="col">Week starting</th>{all.map(c=><th key={c.label} scope="col" className="p-3 font-medium">{c.label}</th>)}</tr></thead>
      <tbody>{baseResult.weeks.map((w,i)=><tr key={w.weekStart} className="border-t border-line"><th scope="row" className="p-3 font-normal">{date(w.weekStart)}</th>
        {all.map(c=><td key={c.label} className="p-3">{money(c.result.weeks[i]?.endingCash??null)}{c.result.weeks[i]?.belowMinimumReserve&&<span className="mt-1 block text-xs text-ink">Below reserve</span>}</td>)}
      </tr>)}</tbody></table></div>
    {all.map(c=>{const warnings=caseWarningText(c.result,base.items);return warnings.length>0?<details key={c.label} className="rounded-md border border-line p-4">
      <summary className="cursor-pointer text-sm text-teal">Evidence and timing notes: {c.label} ({warnings.length})</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-dim">{warnings.map(w=><li key={w}>{w}</li>)}</ul>
    </details>:null;})}
    <p className="text-xs text-dim">All cases use {money(base.startingCash)} starting available cash as of {date(base.asOfDate)}, a {money(base.minimumReserve)} reserve, and the same 13-week window. Projections include only the listed cash items; an empty week is not confirmed zero activity. Funding and asset activity stay separate from operating cash flow. Moving cash outside this window excludes it from these totals; it does not mean the payment or receipt occurred.</p>
  </section>;
}
