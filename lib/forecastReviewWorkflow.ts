import type { ForecastReviewEvidence, StoredForecastAllocation } from "./forecastReviewStorage";
import type { ForecastVariancePolicy, ForecastVarianceReviewResult } from "./forecastVariance";
import { FORECAST_CATEGORIES } from "./forecastWorkflow";

export const REVIEW_POLICY = { version: "owner-variance-1", currencyPrecision: 2,
  absoluteAmountThreshold: 100, percentageOfPlannedThreshold: 0.1, timingDaysThreshold: 2 } as const;
export const MATCHING_POLICY = "owner-review-1";
export const isReviewId = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const validReviewDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
export function reviewMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12
    && Number(value.toFixed(4)) === value;
}
export class ReviewInputError extends Error {}
function fail(message: string): never { throw new ReviewInputError(message); }

export type ReviewQueueItem = { versionId: string; versionNumber: number; weekStart: string; weekEnd: string;
  reviewId: string | null; revision: number; coverage: "complete" | "partial" | "unknown" | null };
export function buildReviewQueue(versions: Array<{ id: string; version_number: number; start_date: string }>,
  reviews: Array<{ id: string; version_id: string; week_start: string; revision: number; coverage: ReviewQueueItem["coverage"] }>,
  evaluationDate: string): ReviewQueueItem[] {
  const days = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n*86400000).toISOString().slice(0,10);
  return versions.flatMap(v => Array.from({ length: 13 }, (_, n) => {
    const weekStart = days(v.start_date,n*7), weekEnd = days(weekStart,6);
    const latest = reviews.filter(r => r.version_id === v.id && r.week_start === weekStart)
      .sort((a,b) => b.revision-a.revision)[0];
    return { versionId:v.id,versionNumber:v.version_number,weekStart,weekEnd,
      reviewId:latest?.id??null,revision:latest?.revision??0,coverage:latest?.coverage??null };
  }).filter(w => w.weekEnd < evaluationDate)).sort((a,b) => b.versionNumber-a.versionNumber || b.weekStart.localeCompare(a.weekStart));
}

export type OwnerReviewEvidence = Omit<ForecastReviewEvidence,"actual_events"> & { actual_events: Array<ForecastReviewEvidence["actual_events"][number] & {
  description: string; category: string | null; editable: boolean;
}> };
export type SavedOwnerReview = { id: string; revision: number; createdAt: string; evidenceChanged: boolean;
  openingCash: number | null; closingCash: number | null; activityConfirmed: boolean; evidence: OwnerReviewEvidence;
  policy: ForecastVariancePolicy; allocations: StoredForecastAllocation[]; result: ForecastVarianceReviewResult };
export type OwnerReviewState = { evidence: OwnerReviewEvidence; latest: SavedOwnerReview | null;
  history:Array<{id:string;revision:number;coverage:string;created_at:string}> };

/** Only the owner-facing fields reach the browser, never provider payloads. */
export function ownerReviewEvidence(e: ForecastReviewEvidence): OwnerReviewEvidence {
  return { version_id:e.version_id,business_id:e.business_id,week_start:e.week_start,week_end:e.week_end,
    reporting_currency:e.reporting_currency,minimum_reserve:e.minimum_reserve,review_revision:e.review_revision,evidence_token:e.evidence_token,
    planned_items:e.planned_items.map(i => ({ id:i.id,description:i.description,amount:i.amount,direction:i.direction,category:i.category,
      expected_date:i.expected_date,status:i.status,confidence:i.confidence,source_type:i.source_type,source_updated_at:i.source_updated_at,
      amount_is_estimated:i.amount_is_estimated,date_is_estimated:i.date_is_estimated })),
    actual_events:e.actual_events.map(i => {
      const raw = i as typeof i & { lineage?: { description?: string }; category?: string; source_connection?: string };
      return { id:i.id,amount:i.amount,direction:i.direction,cash_date:i.cash_date,reporting_currency:i.reporting_currency,
        source_type:i.source_type,source_event_id:i.source_event_id,description:raw.lineage?.description || "Recorded cash movement",
        category:raw.category??null,editable:i.source_type==="manual" && raw.source_connection==="owner-manual" };
    }) };
}

export function parseReviewSelection(body: Record<string,unknown>) {
  if (!isReviewId(body.versionId) || !validReviewDate(body.weekStart)) fail("Choose a saved plan and completed week.");
  return { versionId:body.versionId,weekStart:body.weekStart };
}
export function parseReviewSubmission(body: Record<string,unknown>) {
  const selection = parseReviewSelection(body);
  if(typeof body.activityConfirmed!=="boolean")fail("Confirm whether you checked all cash activity for the week.");
  if (!isReviewId(body.requestKey) || typeof body.evidenceToken!=="string" || !/^[a-f0-9]{32}$/.test(body.evidenceToken)) fail("Reload this week before saving.");
  if (body.openingCash!==null && !reviewMoney(body.openingCash) || body.closingCash!==null && !reviewMoney(body.closingCash)
    || (body.openingCash===null)!==(body.closingCash===null)) fail("Enter both opening and closing cash, or leave both blank.");
  if (!Array.isArray(body.allocations) || body.allocations.length>1000) fail("Review contains too many match decisions.");
  const allocations: StoredForecastAllocation[] = body.allocations.map((entry: unknown) => {
    if (!entry || typeof entry!=="object" || Array.isArray(entry)) fail("Invalid match decision.");
    const a=entry as Record<string,unknown>;
    if (!isReviewId(a.id) || a.plannedItemId!==null&&!isReviewId(a.plannedItemId) || a.actualEventId!==null&&!isReviewId(a.actualEventId)
      || !reviewMoney(a.plannedAmount) || !reviewMoney(a.actualAmount)
      || !["matched","cancelled","missed","unplanned","unresolved"].includes(String(a.resolution))
      || typeof a.rationale!=="string" || !a.rationale.trim() || a.rationale.trim().length>2000) fail("Each decision needs valid amounts, references and a short explanation.");
    return { id:a.id,plannedItemId:a.plannedItemId as string|null,actualEventId:a.actualEventId as string|null,
      plannedAmount:a.plannedAmount,actualAmount:a.actualAmount,resolution:a.resolution as StoredForecastAllocation["resolution"],
      method:"user_confirmed",confidence:"confirmed",rationale:a.rationale.trim(),matchingPolicyVersion:MATCHING_POLICY };
  });
  return { ...selection,requestKey:body.requestKey,evidenceToken:body.evidenceToken,activityConfirmed:body.activityConfirmed,
    openingCash:body.openingCash as number|null,closingCash:body.closingCash as number|null,allocations };
}
export function parseManualActual(body: Record<string,unknown>) {
  const selection = parseReviewSelection(body);
  if (!isReviewId(body.requestKey) || body.correctionId!==null&&!isReviewId(body.correctionId)
    || !reviewMoney(body.amount) || !validReviewDate(body.cashDate)
    || !["inflow","outflow"].includes(String(body.direction))
    || typeof body.description!=="string" || !body.description.trim() || body.description.trim().length>500
    || typeof body.note!=="string" || body.note.trim().length>2000) fail("Enter a description, cash date, direction and nonnegative amount.");
  const category=body.category??(body.direction==="inflow"?"other_cash_in":"other_cash_out");
  if(!FORECAST_CATEGORIES.some(c=>c.value===category&&c.direction===body.direction))fail("Choose a cash category that agrees with the direction.");
  return { ...selection,requestKey:body.requestKey,correctionId:body.correctionId as string|null,
    amount:body.amount,cashDate:body.cashDate,direction:body.direction as "inflow"|"outflow",
    category:category as typeof FORECAST_CATEGORIES[number]["value"],description:body.description.trim(),note:body.note.trim() };
}

export function reviewResultGuidance(result: ForecastVarianceReviewResult): { title: string; detail: string; next: string } {
  if (result.coverage!=="complete") return { title:"This week still needs checking",
    detail:result.reconciliation.unexplainedDifference!==null && !result.reconciliation.reconciled
      ? "The cash movements do not explain the closing balance. Check the balances and missing or duplicate entries."
      : "The week’s activity or matching evidence still needs checking. Unresolved differences are not treated as performance.",
    next:"Check the remaining entries and balances. You can save a partial review and return to it." };
  return { title:"This week’s cash is reconciled",detail:result.summary.closingCashBelowReserve
    ? "Closing cash was below your protected reserve. Review upcoming payments before updating the plan."
    : "The recorded cash movements explain the closing balance and every item has a recorded decision.",
    next:"Confirm your current cash and update future dates in the weekly plan. Amount and date differences are observations; they do not establish a cause." };
}
