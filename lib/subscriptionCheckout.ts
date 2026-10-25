import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBillingCustomer, reserveCheckoutAttempt, saveCheckoutAttempt, releaseCheckoutAttempt } from "./db";

export interface CheckoutAttempt {
  user_id: string;
  id: string;
  plan_key: string;
  price_id: string;
  app_url: string;
  customer_id: string | null;
  session_id: string | null;
  created_at: string;
}

export class CheckoutConflict extends Error {}
export class SubscriptionRecovered extends CheckoutConflict {}

/** Only terminal subscriptions permit a new purchase, including after cancellation. */
export async function findCurrentStripeSubscription(stripe: Stripe, customerId: string) {
  let current: Stripe.Subscription | null = null;
  await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })
    .autoPagingEach((subscription) => {
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        current = subscription;
        return false;
      }
    });
  return current;
}

export async function assertNoStripeSubscription(stripe: Stripe, customerId: string) {
  if (await findCurrentStripeSubscription(stripe, customerId)) {
    throw new CheckoutConflict("You already have a subscription. Manage it in billing settings.");
  }
}

/**
 * Immutable attempt parameters make Stripe retries safe across app instances.
 * Never release an attempt on a timeout: Stripe may have created the session.
 */
export async function subscriptionCheckout(
  stripe: Stripe,
  db: SupabaseClient,
  input: {
    userId: string; planKey: string; priceId: string; appUrl: string; customerId: string | null;
    onExistingSubscription?: (customerId: string, subscription: Stripe.Subscription) => Promise<void>;
  },
  retries = 0
): Promise<string> {
  const attempt = await reserveCheckoutAttempt({
    user_id: input.userId,
    id: crypto.randomUUID(),
    plan_key: input.planKey,
    price_id: input.priceId,
    app_url: input.appUrl,
    customer_id: input.customerId,
  }, db);
  async function retryAfterRelease(customer: string): Promise<string> {
    await releaseCheckoutAttempt(attempt, db);
    if (retries >= 2) throw new CheckoutConflict("Another checkout is being updated. Please try again.");
    return subscriptionCheckout(stripe, db, { ...input, customerId: customer }, retries + 1);
  }

  let customerId = attempt.customer_id;
  if (!customerId) {
    // Stay within Stripe's minimum idempotency retention window. An old,
    // ambiguous attempt requires reconciliation, never a fresh charge attempt.
    assertRetryWindow(attempt);
    const customer = await stripe.customers.create({
      metadata: { supabase_user_id: input.userId },
    }, { idempotencyKey: `billing-customer:${input.userId}` });
    customerId = customer.id;
    await saveCheckoutAttempt(attempt, { customer_id: customerId }, db);
  }

  const existingSubscription = await findCurrentStripeSubscription(stripe, customerId);
  if (existingSubscription) {
    await input.onExistingSubscription?.(customerId, existingSubscription);
    throw new SubscriptionRecovered("We restored your existing subscription.");
  }

  const canonicalCustomer = await ensureBillingCustomer(input.userId, customerId, db);
  if (canonicalCustomer !== customerId) throw new Error("Billing customer changed; reconciliation required");

  let session: Stripe.Checkout.Session;
  if (attempt.session_id) {
    session = await stripe.checkout.sessions.retrieve(attempt.session_id);
  } else {
    assertRetryWindow(attempt);
    // Retire legacy checkout URLs too: they were created before coordination
    // existed and could otherwise complete alongside this new checkout.
    await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 })
      .autoPagingEach(async (openSession) => {
        if (openSession.mode === "subscription" && openSession.metadata?.checkout_attempt_id !== attempt.id) {
          await stripe.checkout.sessions.expire(openSession.id);
        }
      });
    // A legacy session may have completed between the first subscription check
    // and the open-session listing. Recheck after retiring all older open URLs.
    const racedSubscription = await findCurrentStripeSubscription(stripe, customerId);
    if (racedSubscription) {
      await input.onExistingSubscription?.(customerId, racedSubscription);
      throw new SubscriptionRecovered("We restored your existing subscription.");
    }
    const metadata: Record<string, string> = { supabase_user_id: input.userId, plan_key: attempt.plan_key, checkout_attempt_id: attempt.id };
    session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: attempt.price_id, quantity: 1 }],
      success_url: `${attempt.app_url}/dashboard?checkout=success`,
      cancel_url: `${attempt.app_url}/dashboard/settings?tab=billing&checkout=cancelled`,
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    }, { idempotencyKey: `subscription-checkout:${attempt.id}` });
    await saveCheckoutAttempt(attempt, { session_id: session.id }, db);
  }

  if (session.status === "complete") {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (["canceled", "incomplete_expired"].includes(subscription.status)) {
        return retryAfterRelease(customerId);
      }
    }
    throw new CheckoutConflict("Your checkout is complete. Please refresh while your subscription is activated.");
  }
  if (session.status === "expired" || attempt.plan_key !== input.planKey) {
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    // Compare-and-delete prevents a competing retry from deleting a newer attempt.
    return retryAfterRelease(customerId);
  }
  if (session.status !== "open" || !session.url) throw new Error("Checkout session is unavailable");
  return session.url;
}

function assertRetryWindow(attempt: CheckoutAttempt) {
  if (Date.now() - new Date(attempt.created_at).getTime() >= 23 * 60 * 60 * 1000) {
    throw new CheckoutConflict("Your previous checkout needs review. Please contact hello@elidan.ai before trying again.");
  }
}
