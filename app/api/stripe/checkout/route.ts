import { requireAuth } from "@/lib/apiAuth";
import { stripe, STRIPE_PRICES } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";
import type { NextRequest } from "next/server";

const VALID_PLAN_KEYS = new Set(Object.keys(STRIPE_PRICES));

export const POST = requireAuth(async (req: NextRequest, { userId, email }) => {
  const body = await req.json();
  const { planKey, mode } = body as { planKey: string; mode: string };

  if (!planKey || !VALID_PLAN_KEYS.has(planKey)) {
    return Response.json({ error: "Invalid plan" }, { status: 400 });
  }
  if (mode !== "subscription" && mode !== "payment") {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  const priceId = STRIPE_PRICES[planKey];
  const supabase = createServiceClient();

  // Get or create Stripe customer
  const { data: sub, error: subReadError } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (subReadError) {
    console.error("checkout:readSubscription:error", subReadError);
  }

  let customerId: string;
  if (sub?.stripe_customer_id) {
    customerId = sub.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_user_id: userId },
    });
    customerId = customer.id;
    const { error: upsertError } = await supabase
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          plan: "starter",
          feature_tier: "starter",
          status: "active",
        },
        { onConflict: "user_id" }
      );
    if (upsertError) {
      console.error("checkout:upsertCustomer:error", upsertError);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
    customer: customerId,
    mode: mode as "subscription" | "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/dashboard/settings?tab=billing&checkout=cancelled`,
    allow_promotion_codes: true,
    metadata: { supabase_user_id: userId, plan_key: planKey },
  };

  if (mode === "subscription") {
    sessionParams.subscription_data = {
      metadata: { supabase_user_id: userId, plan_key: planKey },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return Response.json({ url: session.url });
});
