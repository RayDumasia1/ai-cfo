import { requireAuth } from "@/lib/apiAuth";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";

export const dynamic = "force-dynamic";

export const POST = requireAuth(async (_req, { userId }) => {
  const serviceSupabase = createServiceClient();

  const { data: sub, error: readError } = await serviceSupabase
    .from("subscriptions")
    .select("stripe_subscription_id, plan, status, billing_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return Response.json({ error: "Could not verify subscription" }, { status: 503 });

  if (!sub?.stripe_subscription_id) {
    return Response.json({ error: "No active subscription found" }, { status: 400 });
  }

  if (sub.status !== "pending_cancellation") {
    return Response.json(
      { error: "Subscription is not pending cancellation" },
      { status: 400 }
    );
  }

  const billingEnd = sub.billing_period_end ? new Date(sub.billing_period_end).getTime() : NaN;
  if (!Number.isFinite(billingEnd) || Date.now() >= billingEnd) {
    return Response.json({ error: "Your billing cycle has ended or could not be verified. Contact hello@elidan.ai for help with reinstatement." }, { status: 409 });
  }

  try {
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    if (current.status !== "active" && current.status !== "trialing") {
      return Response.json({ error: "This subscription has ended. Refresh the page to see your restoration options." }, { status: 409 });
    }
    const stripeEnd = current.cancel_at ?? current.items.data[0]?.current_period_end;
    if (!stripeEnd || Date.now() >= stripeEnd * 1000) {
      return Response.json({ error: "Your billing cycle has ended. Contact hello@elidan.ai for reinstatement, reviewed case by case." }, { status: 409 });
    }
    await stripe.subscriptions.update(sub.stripe_subscription_id, current.cancel_at
      ? { cancel_at: null }
      : { cancel_at_period_end: false });
  } catch (err) {
    console.error("reactivate:stripe:error", err);
    return Response.json({ error: "Failed to reactivate subscription" }, { status: 500 });
  }

  const { error: updateError } = await serviceSupabase
    .from("subscriptions")
    .update({
      status: "active",
      cancelled_at: null,
    })
    .eq("user_id", userId).eq("stripe_subscription_id", sub.stripe_subscription_id).eq("status", "pending_cancellation");

  if (updateError) {
    console.error("reactivate:update:error", updateError);
    return Response.json({ error: "Failed to update subscription" }, { status: 500 });
  }

  return Response.json({ success: true });
});
