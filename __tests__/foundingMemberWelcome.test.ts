import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingDetails } from "../lib/db";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ hasPaidSubscription: vi.fn(), getBillingDetails: vi.fn() }));
vi.mock("../lib/foundingMembers", () => ({ getFoundingMemberAvailability: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import WelcomePage from "../app/welcome/page";
import WelcomeClient from "../app/welcome/WelcomeClient";
import FoundingMemberReturnCard from "../app/components/billing/FoundingMemberReturnCard";
import CurrentPlanCard from "../app/components/billing/CurrentPlanCard";
import PendingCancellationBanner from "../app/components/billing/PendingCancellationBanner";
import FoundingMemberPendingCancellationSection from "../app/components/billing/FoundingMemberPendingCancellationSection";
import { getReturningFoundingMember } from "../lib/foundingMemberState";
import { createClient } from "../utils/supabase/server";
import { getBillingDetails, hasPaidSubscription } from "../lib/db";
import { getFoundingMemberAvailability } from "../lib/foundingMembers";

function billing(overrides: Partial<BillingDetails> = {}): BillingDetails {
  return {
    plan: "starter", feature_tier: "starter", status: "active", stripe_customer_id: null,
    stripe_subscription_id: null, stripe_price_id: null, billing_period_start: null,
    billing_period_end: null, cancelled_at: null, founding_member_number: null, founding_member_is_test: false,
    founding_member_expires_at: null, founding_member_cancelled_at: null,
    founding_member_grace_ends_at: null, ...overrides,
  };
}

const cancelled = billing({ status: "cancelled", founding_member_number: 7, billing_period_end: "2026-10-01T12:00:00.000Z" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "own_test_user", email: "test@example.invalid" } } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(hasPaidSubscription).mockResolvedValue(false);
  vi.mocked(getBillingDetails).mockResolvedValue(billing());
  vi.mocked(getFoundingMemberAvailability).mockResolvedValue({ total: 25, claimed: 1, remaining: 24, soldOut: false });
});

describe("returning-member plan selection", () => {
  it("labels test membership explicitly without promising a permanent customer spot", () => {
    const testBilling = billing({ ...cancelled, founding_member_number: 26, founding_member_is_test: true });
    const html = renderToStaticMarkup(createElement(FoundingMemberReturnCard, {
      membership: getReturningFoundingMember(testBilling)!,
    }));
    expect(html).toContain("Test Founding Member #26");
    expect(html).toContain("does not consume a customer spot");
    expect(html).not.toContain("your spot is never offered");
    const planHtml = renderToStaticMarkup(createElement(CurrentPlanCard, { billing: testBilling }));
    expect(planHtml).toContain("Test Founding Member #26");
    expect(planHtml).not.toContain("Permanent member badge");
  });

  it("keeps the member badge after switching to Starter without claiming the old benefits are active", () => {
    const html = renderToStaticMarkup(createElement(CurrentPlanCard, {
      billing: billing({ plan: "starter", status: "active", feature_tier: "starter", founding_member_number: 7 }),
    }));
    expect(html).toContain("Founding Member #7");
    expect(html).toContain("Permanent member badge");
    expect(html).not.toContain("Core benefits active");
    expect(html).not.toContain("Grace period active");
  });
  it("replaces the acquisition offer with the member identity and leaves Starter available even when spots are sold out", () => {
    const membership = getReturningFoundingMember(cancelled)!;
    const html = renderToStaticMarkup(createElement(WelcomeClient, {
      spotsRemaining: 0, totalSpots: 25, userEmail: "test@example.invalid", returningMember: membership,
    }));
    expect(html).toContain("Founding Member #7");
    expect(html).toContain("Your Founding Member spot");
    expect(html).toContain("Subscription cancelled");
    expect(html).toContain("Contact support about reinstatement");
    expect(html).toContain("Get started with Starter");
    expect(html).not.toContain("Become a Founding Member");
    expect(html).not.toContain("Founding Member spots are now full");
    expect(html).not.toContain("spots left");
    expect(html).not.toContain("Recommended");
  });

  it.each(["2026-10-22T11:59:59.000Z", "2026-08-01T00:00:00.000Z"])("offers support after any effective billing end without automatic reinstatement: %s", end => {
    const membership = getReturningFoundingMember({ ...cancelled, billing_period_end: end })!;
    const html = renderToStaticMarkup(createElement(FoundingMemberReturnCard, { membership }));
    expect(html).toContain("Contact support about reinstatement");
    expect(html).toContain("case by case");
    expect(html).toContain("standard plan");
    expect(html).toContain("never offered to someone else");
    expect(html).toContain("mailto:hello@elidan.ai");
    expect(html).not.toContain("Restore at $49/month");
    expect(html).not.toContain("30-day");
    expect(html).not.toContain("permanently lost");
  });

  it("offers support without guessing a deadline when legacy billing dates are missing", () => {
    const membership = getReturningFoundingMember({ ...cancelled, billing_period_end: null })!;
    const html = renderToStaticMarkup(createElement(FoundingMemberReturnCard, { membership }));
    expect(html).toContain("Contact support about reinstatement");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("$49/month");
  });

  it("keeps the new-member checkout offer for applicants who do not own a number", () => {
    const html = renderToStaticMarkup(createElement(WelcomeClient, {
      spotsRemaining: 24, totalSpots: 25, userEmail: "test@example.invalid",
    }));
    expect(html).toContain("Become a Founding Member");
    expect(html).not.toContain("Your Founding Member spot");
  });
});

describe("welcome page account scoping", () => {
  it("loads the signed-in account's membership and avoids public availability for an existing holder", async () => {
    vi.mocked(getBillingDetails).mockResolvedValue(cancelled);
    const page = await WelcomePage();
    const props = page.props as { returningMember: { memberNumber: number } };
    expect(props.returningMember.memberNumber).toBe(7);
    expect(getBillingDetails).toHaveBeenCalledWith("own_test_user", expect.anything());
    expect(getFoundingMemberAvailability).not.toHaveBeenCalled();
  });

  it("loads availability for a new applicant", async () => {
    const page = await WelcomePage();
    expect((page.props as { returningMember: unknown }).returningMember).toBeNull();
    expect(getFoundingMemberAvailability).toHaveBeenCalledOnce();
  });

  it("keeps paid members with scheduled cancellations in the dashboard", async () => {
    vi.mocked(hasPaidSubscription).mockResolvedValue(true);
    await expect(WelcomePage()).rejects.toThrow("redirect:/dashboard");
    expect(getFoundingMemberAvailability).not.toHaveBeenCalled();
  });
});

describe("scheduled cancellation presentation", () => {
  it.each([
    ["dashboard", PendingCancellationBanner],
    ["billing", FoundingMemberPendingCancellationSection],
  ] as const)("shows the member number, active-until status and keep action in %s", (_location, Component) => {
    const html = renderToStaticMarkup(createElement(Component, { memberNumber: 7, billingPeriodEnd: "2026-11-01T12:00:00Z" }));
    expect(html).toContain("Founding Member #7");
    expect(html).toContain("Active until");
    expect(html).toContain("Keep my membership");
    expect(html).toContain("Your cancellation is scheduled");
    expect(html).not.toContain("Your subscription is cancelled");
  });
});
