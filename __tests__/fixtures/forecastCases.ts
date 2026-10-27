import { calculateForecastCase,forecastCasesView,type CaseBase,type ForecastCasesState,type SavedForecastCase } from "../../lib/forecastCases";
export const caseIds={owner:"10000000-0000-4000-8000-000000000001",base:"20000000-0000-4000-8000-000000000001",forecast:"30000000-0000-4000-8000-000000000001",
  receipt:"40000000-0000-4000-8000-000000000001",bill:"40000000-0000-4000-8000-000000000002",saved:"50000000-0000-4000-8000-000000000001",request:"60000000-0000-4000-8000-000000000001"};
export const caseBase:CaseBase={id:caseIds.base,forecastId:caseIds.forecast,versionNumber:1,status:"published",startDate:"2026-10-26",asOfDate:"2026-10-26",
  startingCash:1000,minimumReserve:400,currency:"USD",formulaPolicyVersion:"forecast-1",items:[
    {id:caseIds.receipt,description:"Customer receipt",amount:1000,direction:"inflow",category:"customer_receipt",expectedDate:"2026-10-27",status:"confirmed",confidence:"confirmed",sourceType:"manual",sourceUpdatedAt:"2026-10-26",amountIsEstimate:false,dateIsEstimate:false},
    {id:caseIds.bill,description:"Supplier payment",amount:1500,direction:"outflow",category:"operating_vendor_payment",expectedDate:"2026-11-03",status:"confirmed",confidence:"confirmed",sourceType:"manual",sourceUpdatedAt:"2026-10-26",amountIsEstimate:false,dateIsEstimate:false}]};
export const caseSubmission={action:"save",requestKey:caseIds.request,baseVersionId:caseIds.base,caseType:"downside" as const,name:"Delayed collections",assumptions:[
  {id:"70000000-0000-4000-8000-000000000001",name:"Lower receipt",operation:"amount_multiplier" as const,value:0.8,itemIds:[caseIds.receipt],rationale:"Customer expects a partial settlement"},
  {id:"70000000-0000-4000-8000-000000000002",name:"Later receipt",operation:"date_shift_days" as const,value:14,itemIds:[caseIds.receipt],rationale:"Two additional weeks to collect"}]};
export const fixtureCaseCalculation=calculateForecastCase(caseBase,caseSubmission.assumptions,"2026-10-27");
export const emptyCases:ForecastCasesState={base:caseBase,currentBaseId:caseIds.base,bases:[{id:caseIds.base,versionNumber:1,startDate:"2026-10-26",status:"published"}],cases:[]};
export const fixtureCasesView=forecastCasesView(emptyCases,"2026-10-27");
export const savedCase:SavedForecastCase={id:caseIds.saved,versionNumber:2,caseType:"downside",name:caseSubmission.name,status:"published",createdAt:"2026-10-27T14:00:00Z",assumptions:caseSubmission.assumptions,calculation:fixtureCaseCalculation};
