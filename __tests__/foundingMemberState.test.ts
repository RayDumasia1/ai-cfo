import { describe, expect, it } from "vitest";
import { getReturningFoundingMember } from "../lib/foundingMemberState";

const cancelled = {
  founding_member_number: 7, status: "cancelled",
  billing_period_end: "2026-10-01T12:00:00.000Z",
};

describe("returning Founding Member display state", () => {
  it("does not give new applicants a returning-member identity", () => {
    expect(getReturningFoundingMember({ ...cancelled, founding_member_number: null })).toBeNull();
  });
  it("retains the member number and billing end without an automatic grace period", () => {
    expect(getReturningFoundingMember(cancelled)).toEqual({
      memberNumber: 7, isTest: false, status: "cancelled", billingPeriodEnd: cancelled.billing_period_end,
    });
  });
  it("accepts the Stripe spelling of canceled", () => {
    expect(getReturningFoundingMember({ ...cancelled, status: "canceled" })?.status).toBe("cancelled");
  });
  it("uses actual subscription end for immediate cancellation", () => {
    expect(getReturningFoundingMember({ ...cancelled,
      founding_member_cancelled_at: "2026-09-25T12:00:00Z",
    })?.billingPeriodEnd).toBe("2026-09-25T12:00:00.000Z");
  });
  it.each([null, "invalid date"])("handles missing/invalid dates: %s", end => {
    expect(getReturningFoundingMember({ ...cancelled, billing_period_end: end })?.billingPeriodEnd).toBeNull();
  });
  it("retains the identity after switching to a standard plan without showing its future billing date as the Founding cancellation date", () => {
    expect(getReturningFoundingMember({ ...cancelled, status: "active" })).toEqual({
      memberNumber: 7, isTest: false, status: "inactive", billingPeriodEnd: null,
    });
  });
});
