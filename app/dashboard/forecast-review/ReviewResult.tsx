import type { OwnerReviewEvidence } from "@/lib/forecastReviewWorkflow";
import { REVIEW_POLICY, reviewResultGuidance } from "@/lib/forecastReviewWorkflow";
import type { ForecastVariancePolicy, ForecastVarianceReviewResult } from "@/lib/forecastVariance";

export const reviewMoneyLabel=(value:number,currency:string)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:4,
}).format(value);
export const reviewDateLabel=(date:string)=>new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const outcomes={on_plan:"As planned",amount:"Amount changed",timing:"Date changed",amount_and_timing:"Amount and date changed",
  new_unplanned:"Not in the plan",cancelled:"Cancelled",missed:"Did not happen this week",unresolved:"Needs checking"};

export default function ReviewResult({result,evidence,policy=REVIEW_POLICY}:{result:ForecastVarianceReviewResult;evidence:OwnerReviewEvidence;policy?:ForecastVariancePolicy}) {
  const guidance=reviewResultGuidance(result),money=(v:number)=>reviewMoneyLabel(v,evidence.reporting_currency);
  const cash=result.reconciliation;
  return <section aria-label="Weekly review result" className="space-y-5">
    <div className="rounded-lg border border-line bg-bg p-5">
      <h3 className="text-lg font-medium text-ink">{guidance.title}</h3>
      <p className="mt-2 text-sm text-ink">{guidance.detail}</p>
      <p className="mt-2 text-sm text-dim">{guidance.next}</p>
    </div>
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Recorded cash in" value={money(cash.actualInflows)}/>
      <Metric label="Recorded cash out" value={money(cash.actualOutflows)}/>
      <Metric label="Closing cash" value={cash.actualClosingCash===null?"Not supplied":money(cash.actualClosingCash)}/>
      <Metric label="Cash effect versus plan" value={result.summary.netCashImpact===null?"Not yet established":money(result.summary.netCashImpact)}/>
    </dl>
    <p className="text-sm text-dim">Opening cash + recorded cash in − recorded cash out = {cash.calculatedClosingCash===null?"unknown closing cash":money(cash.calculatedClosingCash)}.
      {cash.unexplainedDifference!==null?` Difference from the closing balance you entered: ${money(cash.unexplainedDifference)}.`:" Add opening and closing balances to check reconciliation."}
      {" "}A positive cash effect means more cash remained than in the allocated plan; a negative effect means less remained.</p>
    {(result.summary.unresolvedPlannedAmount>0 || result.summary.unresolvedActualAmount>0) && <p className="text-sm text-ink">
      Still to explain: {money(result.summary.unresolvedPlannedAmount)} of planned activity and {money(result.summary.unresolvedActualAmount)} of actual activity.
    </p>}
    {result.variances.length===0?<p className="text-sm text-dim">No match decisions have been recorded for this week.</p>:
      <div className="overflow-x-auto rounded-md border border-line" tabIndex={0} role="region" aria-label="Cash differences table">
        <table className="w-full min-w-[700px] text-left text-sm">
          <caption className="sr-only">Exact differences for each recorded match decision</caption>
          <thead className="bg-bg text-xs text-dim"><tr>{["Item","What changed","Planned allocation","Actual allocation","Timing","Cash effect"].map(h=><th key={h} scope="col" className="p-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{result.variances.map(v=>{
            const planned=evidence.planned_items.find(i=>i.id===v.plannedItemId),actual=evidence.actual_events.find(i=>i.id===v.actualEventId);
            return <tr key={v.id} className="border-t border-line align-top">
              <th scope="row" className="p-3 font-normal text-ink">{planned?.description??actual?.description??"Earlier cash evidence"}<p className="mt-1 text-xs text-dim">{(v as typeof v & {rationale?:string}).rationale}</p></th>
              <td className="p-3">{outcomes[v.classification]}{v.material&&<p className="mt-1 text-xs text-ink">Needs attention</p>}</td>
              <td className="p-3">{money(v.plannedAmount)}</td><td className="p-3">{money(v.actualAmount)}</td>
              <td className="p-3">{v.timingVarianceDays===null?"—":v.timingVarianceDays===0?"Same day":`${Math.abs(v.timingVarianceDays)} days ${v.timingVarianceDays>0?"later":"earlier"}`}</td>
              <td className="p-3">{v.cashImpact===null?"Unresolved":money(v.cashImpact)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    <p className="text-xs text-dim">“Needs attention” flags a cash difference of at least {money(policy.absoluteAmountThreshold)}, at least {policy.percentageOfPlannedThreshold*100}% of its planned allocation, or a date difference of at least {policy.timingDaysThreshold} days. Smaller exact differences remain visible. Manual entries are owner-supplied evidence.</p>
  </section>;
}
function Metric({label,value}:{label:string;value:string}) {
  return <div><dt className="text-xs text-dim">{label}</dt><dd className="mt-1 text-lg font-medium text-ink">{value}</dd></div>;
}
