import type { ForecastResult } from "./cashForecast";

export type GuidanceCashItem = {
  id: string;
  description: string;
  amount: number | null;
  direction: "inflow" | "outflow";
  expectedDate: string | null;
};

export type PublishedForecastGuidance = {
  severity: "positive" | "warning" | "critical" | "incomplete";
  headline: string;
  explanation: string;
  drivers: GuidanceCashItem[];
  confidenceNote: string | null;
  nextReviewDate: string;
};

const addDays=(iso:string,days:number)=>new Date(Date.parse(`${iso}T00:00:00Z`)+days*86_400_000).toISOString().slice(0,10);

export function buildPublishedForecastGuidance(input:{
  result:ForecastResult;
  items:GuidanceCashItem[];
  minimumReserve:number;
  evaluationDate:string;
  reportingCurrency:string;
}):PublishedForecastGuidance {
  const {result,items,minimumReserve,evaluationDate,reportingCurrency}=input;
  const money=(amount:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:reportingCurrency,maximumFractionDigits:0}).format(amount);
  const date=(iso:string)=>new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
  const lowest=result.summary.lowestProjectedCash;
  const lowestWeek=result.summary.lowestProjectedCashWeek;
  const ending=result.summary.endingCash;
  let severity:PublishedForecastGuidance["severity"]="positive";
  let headline="Your plan stays above your cash reserve";
  const explanation=lowest===null||lowestWeek===null||ending===null
    ? "The plan does not yet contain enough valid information to assess the next 13 weeks."
    : `The lowest projected balance is ${money(lowest)} during the week of ${date(lowestWeek)}. Your protected reserve is ${money(minimumReserve)}, and projected ending cash is ${money(ending)}.`;
  if(!result.valid||lowest===null||lowestWeek===null||ending===null){severity="incomplete";headline="Your plan needs more information"}
  else if(lowest<0){severity="critical";headline="Your plan shows a potential cash shortfall"}
  else if(result.summary.firstReserveBreachWeek){severity="warning";headline="Cash may fall below the reserve you want to protect"}

  const lowWeekIndex=result.weeks.findIndex(week=>week.weekStart===lowestWeek);
  const includedIds=new Set(result.weeks.slice(0,lowWeekIndex<0?result.weeks.length:lowWeekIndex+1).flatMap(week=>week.itemIds));
  const drivers=items.filter(item=>item.direction==="outflow"&&item.amount!==null&&includedIds.has(item.id))
    .sort((a,b)=>(b.amount??0)-(a.amount??0)).slice(0,3);
  const limitations:string[]=[];
  if(result.summary.unresolvedItemCount>0)limitations.push(`${result.summary.unresolvedItemCount} unresolved ${result.summary.unresolvedItemCount===1?"item":"items"}`);
  if(result.summary.lowConfidenceItemCount>0)limitations.push(`${result.summary.lowConfidenceItemCount} low-confidence ${result.summary.lowConfidenceItemCount===1?"item":"items"}`);
  if(result.freshness.startingCash!=="current")limitations.push("a starting cash balance that needs updating");
  if(result.freshness.staleScheduledItemCount>0)limitations.push(`${result.freshness.staleScheduledItemCount} cash ${result.freshness.staleScheduledItemCount===1?"item":"items"} with stale evidence`);
  return {
    severity,headline,explanation,drivers,
    confidenceNote:limitations.length?`Review ${limitations.join(", ")} before relying on this plan.`:null,
    nextReviewDate:addDays(evaluationDate,7),
  };
}
