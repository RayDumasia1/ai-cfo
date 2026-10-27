import "server-only";
import type { ForecastCashItem } from "./cashForecast";
import { calculateForecastVarianceReview, type ForecastVarianceAllocation,
  type ForecastVariancePolicy, type ForecastVarianceReviewResult } from "./forecastVariance";

/** SQL snapshots retain full source rows; only these fields enter the pure engine. */
export type ForecastReviewEvidence = {
  version_id: string;
  business_id: string;
  week_start: string;
  week_end: string;
  reporting_currency: string;
  minimum_reserve: number;
  review_revision: number;
  evidence_token: string;
  planned_items: Array<{
    id: string; description: string; amount: number; direction: ForecastCashItem["direction"];
    category: ForecastCashItem["category"]; expected_date: string; status: ForecastCashItem["status"];
    confidence: ForecastCashItem["confidence"]; source_type: ForecastCashItem["sourceType"];
    source_updated_at: string | null; amount_is_estimated: boolean; date_is_estimated: boolean;
  }>;
  actual_events: Array<{
    id: string; amount: number; direction: ForecastCashItem["direction"]; cash_date: string;
    reporting_currency: string; source_type: string; source_event_id: string;
  }>;
};

export type StoredForecastAllocation = ForecastVarianceAllocation & {
  rationale: string;
  matchingPolicyVersion: string;
};

export type ForecastReviewCommand = {
  userId: string;
  versionId: string;
  weekStart: string;
  requestKey: string;
  evidenceToken: string;
  allocations: StoredForecastAllocation[];
  policy: ForecastVariancePolicy;
  openingCash: number | null;
  closingCash: number | null;
  result: ForecastVarianceReviewResult;
};

/** Prepare once and retry the exact command after an uncertain network response.
 * A changed source snapshot requires a fresh command and request key.
 * This is an internal server boundary, not a customer-facing write API.
 */
export function prepareForecastReview(
  userId: string, evidence: ForecastReviewEvidence,
  options: { requestKey: string; evaluationDate: string; allocations: StoredForecastAllocation[];
    policy: ForecastVariancePolicy; openingCash: number | null; closingCash: number | null },
): ForecastReviewCommand {
  const result = calculateForecastVarianceReview({
    weekStart: evidence.week_start, weekEnd: evidence.week_end, evaluationDate: options.evaluationDate,
    reportingCurrency: evidence.reporting_currency, minimumReserve: Number(evidence.minimum_reserve),
    actualOpeningCash: options.openingCash, actualClosingCash: options.closingCash,
    plannedItems: evidence.planned_items.map(item => ({ id: item.id, description: item.description,
      amount: Number(item.amount), direction: item.direction, category: item.category,
      expectedDate: item.expected_date, status: item.status, confidence: item.confidence,
      sourceType: item.source_type, sourceUpdatedAt: item.source_updated_at?.slice(0, 10) ?? null,
      amountIsEstimate: item.amount_is_estimated, dateIsEstimate: item.date_is_estimated })),
    actualEvents: evidence.actual_events.map(event => ({ id: event.id, amount: Number(event.amount),
      direction: event.direction, cashDate: event.cash_date, reportingCurrency: event.reporting_currency,
      sourceType: event.source_type, sourceReference: event.source_event_id })),
    allocations: options.allocations, policy: options.policy,
  });
  if (!result.valid) throw new Error("Resolve invalid forecast review evidence before saving");
  if (options.allocations.some(a => !a.rationale.trim() || !a.matchingPolicyVersion.trim())) {
    throw new Error("Every match decision requires a rationale and policy version");
  }
  // Decouple the retry payload from editable caller state.
  return structuredClone({ userId, versionId: evidence.version_id, weekStart: evidence.week_start,
    requestKey: options.requestKey, evidenceToken: evidence.evidence_token, allocations: options.allocations,
    policy: options.policy, openingCash: options.openingCash, closingCash: options.closingCash, result });
}
