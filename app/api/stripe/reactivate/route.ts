import { requireAuth } from "@/lib/apiAuth";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const POST = requireAuth(async (_req, { userId, supabase }) => {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, plan, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    return Response.json({ error: "No active subscription found" }, { status: 400 });
  }

  if (sub.status !== "pending_cancellation") {
    return Response.json(
      { error: "Subscription is not pending cancellation" },
      { status: 400 }
    );
  }

  try {
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
  } catch (err) {
    console.error("reactivate:stripe:error", err);
    return Response.json({ error: "Failed to reactivate subscription" }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      cancelled_at: null,
    })
    .eq("user_id", userId);

  if (updateError) {
    console.error("reactivate:update:error", updateError);
    return Response.json({ error: "Failed to update subscription" }, { status: 500 });
  }

  return Response.json({ success: true });
});
