import { calculateCashForecast, type ForecastAssumption, type ForecastCashItem, type ForecastResult } from "./cashForecast";
import { FORECAST_FRESHNESS_POLICY } from "./forecastWorkflow";
import { isReviewId } from "./forecastReviewWorkflow";

export type ForecastCaseType="downside"|"upside";
export type CaseAssumption=ForecastAssumption & {name:string};
export type CaseBase={id:string;forecastId:string;versionNumber:number;status:"published"|"superseded";
  startDate:string;asOfDate:string;startingCash:number;minimumReserve:number;currency:string;formulaPolicyVersion:string;items:ForecastCashItem[]};
export type CaseCalculation={baseResult:ForecastResult;caseResult:ForecastResult;evaluationDate:string};
export type SavedForecastCase={id:string;versionNumber:number;caseType:ForecastCaseType;name:string;status:"published"|"superseded";
  createdAt:string;assumptions:CaseAssumption[];calculation:CaseCalculation};
export type ForecastCasesState={base:CaseBase|null;currentBaseId:string|null;
  bases:Array<{id:string;versionNumber:number;startDate:string;status:string}>;cases:SavedForecastCase[]};
export type ForecastCasesView=ForecastCasesState & {baseResult:ForecastResult|null;evaluationDate:string};
export function forecastCasesView(state:ForecastCasesState,evaluationDate:string):ForecastCasesView{
  return {...state,evaluationDate,baseResult:state.base?calculateForecastCase(state.base,[],evaluationDate).baseResult:null};
}
export class ForecastCaseInputError extends Error {}
export function parseCaseSubmission(body:Record<string,unknown>) {
  if(!isReviewId(body.baseVersionId)||!isReviewId(body.requestKey)||!["downside","upside"].includes(String(body.caseType)))
    throw new ForecastCaseInputError("Choose a published base plan and a downside or upside case.");
  if(typeof body.name!=="string"||!body.name.trim()||body.name.trim().length>120)
    throw new ForecastCaseInputError("Give the case a name of 120 characters or fewer.");
  if(!Array.isArray(body.assumptions)||body.assumptions.length<1||body.assumptions.length>50)
    throw new ForecastCaseInputError("Add between 1 and 50 explicit assumptions.");
  const assumptions:CaseAssumption[]=body.assumptions.map((entry:unknown)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new ForecastCaseInputError("Invalid assumption.");
    const a=entry as Record<string,unknown>;
    if(!isReviewId(a.id)||typeof a.name!=="string"||!a.name.trim()||a.name.trim().length>120
      ||typeof a.rationale!=="string"||!a.rationale.trim()||a.rationale.trim().length>2000
      ||!Array.isArray(a.itemIds)||a.itemIds.length<1||a.itemIds.length>2000||!a.itemIds.every(isReviewId)
      ||new Set(a.itemIds).size!==a.itemIds.length||!["amount_multiplier","date_shift_days","exclude"].includes(String(a.operation)))
      throw new ForecastCaseInputError("Each assumption needs a name, selected items and an explanation.");
    if(a.operation==="exclude"?a.value!==null:typeof a.value!=="number"||!Number.isFinite(a.value)
      ||(a.operation==="amount_multiplier"?(a.value<0||a.value>10||Number(a.value.toFixed(6))!==a.value):!Number.isInteger(a.value)||Math.abs(a.value)>365))
      throw new ForecastCaseInputError("Use 0–1000% of the base amount, a whole-day shift within one year, or an exclusion.");
    return {id:a.id,name:a.name.trim(),rationale:a.rationale.trim(),itemIds:a.itemIds as string[],
      operation:a.operation as CaseAssumption["operation"],value:a.value as number|null};
  });
  if(new Set(assumptions.map(a=>a.id)).size!==assumptions.length)throw new ForecastCaseInputError("Assumption identifiers must be unique.");
  return {baseVersionId:body.baseVersionId,requestKey:body.requestKey,caseType:body.caseType as ForecastCaseType,name:body.name.trim(),assumptions};
}
export function calculateForecastCase(base:CaseBase,assumptions:CaseAssumption[],evaluationDate:string):CaseCalculation {
  if(assumptions.some(a=>a.itemIds.some(id=>!base.items.some(i=>i.id===id&&["expected","confirmed"].includes(i.status)))))
    throw new ForecastCaseInputError("Assumptions must reference active items in the selected base plan.");
  const input={startDate:base.startDate,asOfDate:base.asOfDate,evaluationDate,startingAvailableCash:base.startingCash,
    minimumReserve:base.minimumReserve,reportingCurrency:base.currency,items:base.items,freshnessPolicy:FORECAST_FRESHNESS_POLICY};
  const baseResult=calculateCashForecast(input),caseResult=calculateCashForecast({...input,assumptions});
  if(!baseResult.valid||!caseResult.valid)throw new ForecastCaseInputError("Check the assumptions. Each item can have only one change of each kind, and all amounts and dates must be valid.");
  return {baseResult,caseResult,evaluationDate};
}
export function caseWarningText(result:ForecastResult,items:ForecastCashItem[]):string[] {
  const labels={missing_amount:"needs an amount",missing_date:"needs a cash date",overdue:"falls before this plan’s starting date and is excluded",
    outside_horizon:"falls outside the 13-week window and is excluded",inactive_status:"is inactive and is excluded",stale_source:"has evidence that needs refreshing"};
  return [...new Set(result.warnings.map(w=>`${items.find(i=>i.id===w.itemId)?.description??"A cash item"} ${labels[w.code as keyof typeof labels]??"needs checking"}.`))];
}
