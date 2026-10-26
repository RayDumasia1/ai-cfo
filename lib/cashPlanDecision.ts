import type {ForecastCashItem} from "./cashForecast";

export type ForecastDecisionContext={
  versionId:string;
  asOfDate:string;
  startDate:string;
  startingCash:number;
  minimumReserve:number;
  currency:string;
  items:ForecastCashItem[];
};

export type WeeklyPlanDecision=
  | {type:"change_item";itemId:string;amount:number;expectedDate:string}
  | {type:"add_receipt";description:string;amount:number;expectedDate:string};

export function applyWeeklyPlanDecision(items:ForecastCashItem[],decision:WeeklyPlanDecision):ForecastCashItem[]{
  if(decision.type==="change_item")return items.map(item=>item.id===decision.itemId?{...item,amount:decision.amount,expectedDate:decision.expectedDate,amountIsEstimate:true,dateIsEstimate:true}:item);
  return [...items,{id:"temporary-decision-receipt",description:decision.description.trim()||"Temporary cash receipt",amount:decision.amount,direction:"inflow",category:"other_cash_in",expectedDate:decision.expectedDate,status:"expected",confidence:"medium",sourceType:"scenario",sourceUpdatedAt:null,amountIsEstimate:true,dateIsEstimate:true}];
}

export function validWeeklyPlanDecision(decision:WeeklyPlanDecision,items:ForecastCashItem[]):boolean{
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(decision.expectedDate)
    ? Date.parse(`${decision.expectedDate}T00:00:00Z`) : Number.NaN;
  const validDate = Number.isFinite(parsedDate)
    && new Date(parsedDate).toISOString().slice(0, 10) === decision.expectedDate;
  if(!Number.isFinite(decision.amount)||decision.amount<0||!validDate)return false;
  if(decision.type==="change_item")return items.some(item=>item.id===decision.itemId);
  return decision.description.trim().length>0&&decision.description.trim().length<=500;
}
