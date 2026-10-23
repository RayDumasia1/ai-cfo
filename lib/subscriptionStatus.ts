import type Stripe from "stripe";

/** Values permitted by public.subscriptions.subscriptions_status_check. */
export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "past_due"
  | "trialing"
  | "paused"
  | "pending_cancellation";

/** Stripe billing states and application access states are different domains. */
export function getSubscriptionStatus(
  subscription: Pick<Stripe.Subscription, "status" | "cancel_at" | "cancel_at_period_end">
): SubscriptionStatus {
  switch (subscription.status) {
    case "active":
      return subscription.cancel_at_period_end || (subscription.cancel_at ?? 0) > 0
        ? "pending_cancellation" : "active";
    case "trialing":
      return "trialing";
    case "paused":
      return "paused";
    case "past_due":
    case "unpaid":
    case "incomplete":
      // All require billing resolution. None qualifies for paid app access.
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      // Fail rather than persisting a new status or accidentally granting access.
      throw new Error("Unsupported Stripe subscription status");
  }
}
