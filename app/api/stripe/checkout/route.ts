import { requireAuth } from "@/lib/apiAuth";
import { stripe, STRIPE_PRICES } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";
import { getFoundingMemberAvailability } from "@/lib/foundingMembers";
import type { NextRequest } from "next/server";

const VALID_PLAN_KEYS = new Set(Object.keys(STRIPE_PRICES));

export const POST = requireAuth(async (req: NextRequest, { userId, email }) => {
  const body = await req.json();
  const { planKey, mode } = body as {
    planKey: string;
    mode: string;
  };

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

  if (!customerId) {
    console.error("checkout:missingCustomerId", { userId });
    return Response.json({ error: "Could not resolve Stripe customer" }, { status: 500 });
  }

  // Founding member checks. Checkout only ever creates new claims — anyone who
  // already holds a member number is restored manually by CS (see launchConfig).
  if (planKey === "founding_member") {
    const { data: existingSub, error: existingError } = await supabase
      .from("subscriptions")
      .select("founding_member_number")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) {
      console.error("checkout:foundingMember:readExisting:error", existingError);
      return Response.json({ error: "Could not verify availability" }, { status: 503 });
    }
    if (existingSub?.founding_member_number != null) {
      return Response.json(
        { error: "You are already a Founding Member.", already_member: true },
        { status: 409 }
      );
    }

    let soldOut: boolean;
    try {
      ({ soldOut } = await getFoundingMemberAvailability(supabase));
    } catch (err) {
      console.error("checkout:foundingMember:availability:error", err);
      return Response.json({ error: "Could not verify availability" }, { status: 503 });
    }
    if (soldOut) {
      return Response.json(
        { error: "Founding Member spots are sold out.", sold_out: true, spots_remaining: 0 },
        { status: 409 }
      );
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error("checkout:missingAppUrl — NEXT_PUBLIC_APP_URL is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const successUrl = `${appUrl}/dashboard?checkout=success`;
  const cancelUrl = `${appUrl}/dashboard/settings?tab=billing&checkout=cancelled`;
  console.log("checkout:urls", { successUrl, cancelUrl, customerId, planKey, mode });

  const sessionMetadata: Record<string, string> = {
    supabase_user_id: userId,
    plan_key: planKey,
  };

  const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
    customer: customerId,
    mode: mode as "subscription" | "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    metadata: sessionMetadata,
  };

  if (mode === "subscription") {
    sessionParams.subscription_data = {
      metadata: sessionMetadata,
    };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err: unknown) {
    const stripeErr = err as { code?: string; param?: string };
    if (stripeErr.code === "resource_missing" && stripeErr.param === "customer") {
      // Stale customer ID — belongs to a different Stripe account (e.g. local vs preview).
      // Create a fresh customer and retry once.
      console.warn("checkout:staleCustomer — creating fresh customer", { customerId });
      const freshCustomer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      const { error: clearError } = await supabase
        .from("subscriptions")
        .update({ stripe_customer_id: freshCustomer.id })
        .eq("user_id", userId);
      if (clearError) {
        console.error("checkout:clearStaleCustomer:error", clearError);
      }
      sessionParams.customer = freshCustomer.id;
      session = await stripe.checkout.sessions.create(sessionParams);
    } else {
      throw err;
    }
  }
  return Response.json({ url: session.url });
});
