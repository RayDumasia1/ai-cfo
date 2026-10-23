import type { BillingDetails } from "./db";

export interface ReturningFoundingMember {
  memberNumber: number;
  isTest: boolean;
  status: "cancelled" | "inactive";
  billingPeriodEnd: string | null;
}

/** Permanent identity for the support-only returning-member card. */
export function getReturningFoundingMember(
  billing: Pick<BillingDetails, "founding_member_number" | "status" | "billing_period_end"> &
    Partial<Pick<BillingDetails, "founding_member_cancelled_at" | "founding_member_is_test">>
): ReturningFoundingMember | null {
  if (billing.founding_member_number == null) return null;
  const cancelled = billing.status === "cancelled" || billing.status === "canceled";
  const endedAt = billing.founding_member_cancelled_at ?? (cancelled ? billing.billing_period_end : null);
  const end = endedAt ? new Date(endedAt) : null;
  return {
    memberNumber: billing.founding_member_number,
    isTest: billing.founding_member_is_test === true,
    status: cancelled ? "cancelled" : "inactive",
    billingPeriodEnd: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
  };
}
