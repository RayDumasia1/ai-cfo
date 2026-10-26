import { requireAuth } from "@/lib/apiAuth";
import { stripe, STRIPE_PRICES, PLAN_TO_TIER } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";
import { getFoundingMemberAvailability } from "@/lib/foundingMembers";
import { CheckoutConflict, SubscriptionRecovered, subscriptionCheckout } from "@/lib/subscriptionCheckout";
import { ensureBillingCustomer } from "@/lib/db";
import { getSubscriptionStatus } from "@/lib/subscriptionStatus";
import type Stripe from "stripe";
import type { NextRequest } from "next/server";

const VALID_PLAN_KEYS = new Set(Object.keys(STRIPE_PRICES));

function planForSubscription(subscription: Stripe.Subscription) {
  const metadataPlan = subscription.metadata?.plan_key;
  if (metadataPlan && metadataPlan !== "cfo_call" && VALID_PLAN_KEYS.has(metadataPlan)) return metadataPlan;
  const priceId = subscription.items.data[0]?.price.id;
  return Object.entries(STRIPE_PRICES).find(([key, value]) => key !== "cfo_call" && value === priceId)?.[0] ?? null;
}

export const POST = requireAuth(async (req: NextRequest, { userId }) => {
  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { planKey, mode } = body as Record<string, unknown>;
  if (typeof planKey !== "string" || !VALID_PLAN_KEYS.has(planKey)) {
    return Response.json({ error: "Invalid plan" }, { status: 400 });
  }
  // Subscription products must always use the coordinated subscription flow.
  if (mode !== (planKey === "cfo_call" ? "payment" : "subscription")) {
    return Response.json({ error: "Invalid mode for this plan" }, { status: 400 });
  }
  const priceId = STRIPE_PRICES[planKey];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || !priceId) {
    return Response.json({ error: "Checkout is unavailable" }, { status: 503 });
  }

  try {
    const supabase = createServiceClient();
    const { data: sub, error } = await supabase.from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, plan, founding_member_number")
      .eq("user_id", userId).maybeSingle();
    if (error) throw error;

    const hasExistingSubscription = mode === "subscription" && sub &&
      (sub.stripe_subscription_id || sub.plan !== "starter") &&
      !["cancelled", "canceled", "incomplete_expired"].includes(sub.status);
    if (hasExistingSubscription) {
      // Change the existing Stripe subscription through the hosted portal.
      // Starting another Checkout subscription could double-bill the customer.
      if (planKey === "founding_member") {
        throw new CheckoutConflict("Manage your existing subscription in billing settings.");
      }
      if (!sub.stripe_customer_id) {
        throw new CheckoutConflict("Your billing account needs support before the plan can be changed.");
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${appUrl}/dashboard/settings?tab=billing`,
      });
      return Response.json({ url: portal.url, manage_existing: true });
    }

    if (planKey === "founding_member") {
      if (sub?.founding_member_number != null) {
        return Response.json({
          error: "Your Founding Member number stays yours. After your billing cycle ends, contact hello@elidan.ai for manual reinstatement, reviewed case by case. You can also choose a standard plan.",
          already_member: true,
        }, { status: 409 });
      }
      const { soldOut } = await getFoundingMemberAvailability(supabase);
      if (soldOut) {
        return Response.json({ error: "Founding Member spots are sold out.", sold_out: true, spots_remaining: 0 }, { status: 409 });
      }
    }

    if (mode === "subscription") {
      const url = await subscriptionCheckout(stripe, supabase, {
        userId, planKey, priceId, appUrl,
        customerId: sub?.stripe_customer_id ?? null,
        onExistingSubscription: async (customerId, existing) => {
          const recoveredPlan = planForSubscription(existing);
          if (!recoveredPlan) throw new Error("Existing Stripe subscription has an unknown plan");
          const item = existing.items.data[0];
          const status = getSubscriptionStatus(existing);
          const { error: recoveryError } = await supabase.from("subscriptions").update({
            stripe_customer_id: customerId,
            stripe_subscription_id: existing.id,
            stripe_price_id: item?.price.id ?? null,
            plan: recoveredPlan,
            feature_tier: PLAN_TO_TIER[recoveredPlan] ?? "starter",
            status,
            billing_period_start: item?.current_period_start
              ? new Date(item.current_period_start * 1000).toISOString() : null,
            billing_period_end: (existing.cancel_at ?? item?.current_period_end)
              ? new Date((existing.cancel_at ?? item!.current_period_end) * 1000).toISOString() : null,
            ...(status === "active" ? { cancelled_at: null } : {}),
          }).eq("user_id", userId).is("stripe_subscription_id", null);
          if (recoveryError) throw recoveryError;
        },
      });
      return Response.json({ url });
    }

    // One-time purchases cannot create recurring subscriptions.
    let customerId = sub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { supabase_user_id: userId },
      }, { idempotencyKey: `billing-customer:${userId}` });
      customerId = await ensureBillingCustomer(userId, customer.id, supabase);
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/dashboard/settings?tab=billing&checkout=cancelled`,
      allow_promotion_codes: true,
      metadata: { supabase_user_id: userId, plan_key: planKey },
    });
    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof SubscriptionRecovered) {
      return Response.json({
        url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
        reconciled: true,
      });
    }
    if (err instanceof CheckoutConflict) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    console.error("checkout:failed", err);
    return Response.json({ error: "Checkout is temporarily unavailable. Please try again." }, { status: 503 });
  }
});
