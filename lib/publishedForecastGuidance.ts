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
  needsInputReview: boolean;
  reserveGap: number | null;
  nextSteps: string[];
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
  const reserveGap=lowest!==null&&lowest<minimumReserve?minimumReserve-lowest:null;
  const explanation=lowest===null||lowestWeek===null||ending===null
    ? "The plan does not yet contain enough valid information to assess the next 13 weeks."
    : reserveGap!==null
      ? `The lowest projected balance is ${money(lowest)} during the week of ${date(lowestWeek)}. That is ${money(reserveGap)} below your protected reserve of ${money(minimumReserve)}. Projected ending cash is ${money(ending)}.`
      : `The lowest projected balance is ${money(lowest)} during the week of ${date(lowestWeek)}. Your protected reserve is ${money(minimumReserve)}, and projected ending cash is ${money(ending)}.`;
  if(!result.valid||lowest===null||lowestWeek===null||ending===null){severity="incomplete";headline="Your plan needs more information"}
  else if(lowest<0){severity="critical";headline="Your plan shows a potential cash shortfall"}
  else if(result.summary.firstReserveBreachWeek){severity="warning";headline="Cash may fall below the reserve you want to protect"}

  const lowWeekIndex=result.weeks.findIndex(week=>week.weekStart===lowestWeek);
  const includedIds=new Set(result.weeks.slice(0,lowWeekIndex<0?result.weeks.length:lowWeekIndex+1).flatMap(week=>week.itemIds));
  const drivers=items.filter(item=>item.direction==="outflow"&&item.amount!==null&&includedIds.has(item.id))
    .sort((a,b)=>(b.amount??0)-(a.amount??0)).slice(0,3);
  const limitations:string[]=[];
  const reviewSteps:string[]=[];
  if(result.freshness.startingCash!=="current"){
    limitations.push("your starting cash balance needs updating");
    reviewSteps.push("Update your starting cash balance.");
  }
  if(result.summary.unresolvedItemCount>0){
    limitations.push(`${result.summary.unresolvedItemCount} cash ${result.summary.unresolvedItemCount===1?"item needs":"items need"} an amount or date`);
    reviewSteps.push(`Complete ${result.summary.unresolvedItemCount} cash ${result.summary.unresolvedItemCount===1?"item":"items"} missing an amount or date.`);
  }
  if(result.summary.lowConfidenceItemCount>0){
    limitations.push(`${result.summary.lowConfidenceItemCount} uncertain cash ${result.summary.lowConfidenceItemCount===1?"item":"items"}`);
    reviewSteps.push(`Review ${result.summary.lowConfidenceItemCount} uncertain cash ${result.summary.lowConfidenceItemCount===1?"item":"items"}.`);
  }
  if(result.freshness.staleScheduledItemCount>0){
    limitations.push(`${result.freshness.staleScheduledItemCount} cash ${result.freshness.staleScheduledItemCount===1?"item has":"items have"} old evidence`);
    reviewSteps.push(`Refresh ${result.freshness.staleScheduledItemCount} cash ${result.freshness.staleScheduledItemCount===1?"item":"items"} based on old information.`);
  }
  const needsInputReview=limitations.length>0;
  const nextSteps=needsInputReview
    ? [...reviewSteps,"Publish the updated plan and recheck your cash outlook."]
    : severity==="warning"||severity==="critical"
      ? ["Test ways to keep more cash available.","Choose a response and turn it into an action.",`Review this plan again by ${date(addDays(evaluationDate,7))}.`]
      : ["Keep the planned dates and amounts current.",`Review this plan again by ${date(addDays(evaluationDate,7))}.`];
  return {
    severity,headline,explanation,drivers,
    confidenceNote:needsInputReview?`Before relying on this plan, review the inputs: ${limitations.join("; ")}.`:null,
    needsInputReview,
    reserveGap,
    nextSteps,
    nextReviewDate:addDays(evaluationDate,7),
  };
}
