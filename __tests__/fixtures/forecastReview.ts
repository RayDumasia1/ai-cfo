import type { ForecastReviewEvidence } from "../../lib/forecastReviewStorage";
import { ownerReviewEvidence, REVIEW_POLICY, type OwnerReviewState, type ReviewQueueItem } from "../../lib/forecastReviewWorkflow";
import { calculateForecastVarianceReview } from "../../lib/forecastVariance";

export const reviewIds={owner:"10000000-0000-4000-8000-000000000001",business:"20000000-0000-4000-8000-000000000001",
  version:"30000000-0000-4000-8000-000000000001",planned:"40000000-0000-4000-8000-000000000001",
  actual:"50000000-0000-4000-8000-000000000001",request:"60000000-0000-4000-8000-000000000001",review:"70000000-0000-4000-8000-000000000001"};
export const rawReviewEvidence:ForecastReviewEvidence={version_id:reviewIds.version,business_id:reviewIds.business,
  week_start:"2026-10-05",week_end:"2026-10-11",reporting_currency:"USD",minimum_reserve:1000,review_revision:0,evidence_token:"a".repeat(32),
  planned_items:[{id:reviewIds.planned,description:"Customer invoice",amount:1000,direction:"inflow",category:"customer_receipt",
    expected_date:"2026-10-06",status:"confirmed",confidence:"high",source_type:"manual",source_updated_at:"2026-10-05",amount_is_estimated:false,date_is_estimated:false}],
  actual_events:[Object.assign({id:reviewIds.actual,amount:900,direction:"inflow" as const,cash_date:"2026-10-08",reporting_currency:"USD",source_type:"manual",source_event_id:"manual-receipt"},
    {source_connection:"owner-manual",lineage:{description:"Customer deposit",privateProviderPayload:"must-not-reach-browser"}})]};
export const reviewSubmission={action:"save",versionId:reviewIds.version,weekStart:"2026-10-05",requestKey:reviewIds.request,
  evidenceToken:"a".repeat(32),openingCash:5000,closingCash:5900,activityConfirmed:true,
  allocations:[{id:"80000000-0000-4000-8000-000000000001",plannedItemId:reviewIds.planned,actualEventId:reviewIds.actual,
    plannedAmount:1000,actualAmount:900,resolution:"matched" as const,method:"user_confirmed" as const,confidence:"confirmed" as const,
    rationale:"Receipt confirmed against bank record",matchingPolicyVersion:"owner-review-1"}]};
export const reviewFixtureResult=calculateForecastVarianceReview({weekStart:"2026-10-05",weekEnd:"2026-10-11",evaluationDate:"2026-10-27",
  reportingCurrency:"USD",minimumReserve:1000,actualOpeningCash:5000,actualClosingCash:5900,
  plannedItems:[{id:reviewIds.planned,description:"Customer invoice",amount:1000,direction:"inflow",category:"customer_receipt",expectedDate:"2026-10-06",
    status:"confirmed",confidence:"high",sourceType:"manual",sourceUpdatedAt:"2026-10-05",amountIsEstimate:false,dateIsEstimate:false}],
  actualEvents:[{id:reviewIds.actual,amount:900,direction:"inflow",cashDate:"2026-10-08",reportingCurrency:"USD",sourceType:"manual",sourceReference:"manual-receipt"}],
  allocations:reviewSubmission.allocations,policy:REVIEW_POLICY});
export const reviewWeek:ReviewQueueItem={versionId:reviewIds.version,versionNumber:1,weekStart:"2026-10-05",weekEnd:"2026-10-11",reviewId:null,revision:0,coverage:null};
export const ownerReviewState:OwnerReviewState={evidence:ownerReviewEvidence(rawReviewEvidence),latest:null,history:[]};
export const savedReviewState:OwnerReviewState={evidence:{...structuredClone(ownerReviewState.evidence),evidence_token:"b".repeat(32),review_revision:1},
  latest:{id:reviewIds.review,revision:1,createdAt:"2026-10-27T14:00:00Z",evidenceChanged:false,activityConfirmed:true,
    openingCash:5000,closingCash:5900,evidence:structuredClone(ownerReviewState.evidence),policy:REVIEW_POLICY,allocations:reviewSubmission.allocations,result:reviewFixtureResult},
  history:[{id:reviewIds.review,revision:1,coverage:"complete",created_at:"2026-10-27T14:00:00Z"}]};
