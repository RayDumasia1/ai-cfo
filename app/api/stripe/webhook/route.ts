import { stripe, PLAN_TO_TIER } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";
import {
  sendCfoCallConfirmation,
  sendPaymentFailedEmail,
  sendFoundingMemberWelcomeEmail,
  sendFoundingMemberRestoreEmail,
  sendFoundingMemberCancelledEmail,
} from "@/lib/email";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const OK = () => Response.json({ received: true }, { status: 200 });

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("webhook:constructEvent:error", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          supabase
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
          supabase
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
          supabase
        );
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(
          event.data.object as Stripe.Invoice,
          supabase
        );
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(
          event.data.object as Stripe.Invoice,
          supabase
        );
        break;
    }
  } catch (err) {
    console.error(`webhook:${event.type}:error`, err);
    // Return 200 regardless — log the error but never let Stripe retry on a handler bug
  }

  return OK();
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient
) {
  const userId = session.metadata?.supabase_user_id;
  const planKey = session.metadata?.plan_key;
  if (!userId || !planKey) return;

  if (session.mode === "subscription") {
    const featureTier = PLAN_TO_TIER[planKey] ?? "starter";
    const subId = session.subscription as string;
    const stripeSub = await stripe.subscriptions.retrieve(subId);

    const row: Record<string, unknown> = {
      user_id: userId,
      plan: planKey,
      feature_tier: featureTier,
      status: "active",
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subId,
      stripe_price_id: stripeSub.items.data[0]?.price.id ?? null,
      billing_period_start: new Date(
        (stripeSub.items.data[0]?.current_period_start ?? 0) * 1000
      ).toISOString(),
      billing_period_end: new Date(
        (stripeSub.items.data[0]?.current_period_end ?? 0) * 1000
      ).toISOString(),
    };

    let emailMemberNumber: number | null = null;
    let isRestore = false;

    if (planKey === "founding_member") {
      isRestore = session.metadata?.is_founding_member_restore === "true";
      const originalNumber = session.metadata?.original_member_number
        ? parseInt(session.metadata.original_member_number)
        : null;

      if (isRestore && originalNumber) {
        row.founding_member_number = originalNumber;
        row.founding_member_cancelled_at = null;
        emailMemberNumber = originalNumber;
      } else {
        // New join: assign next member number (no expiry — Core features are permanent)
        const { count } = await supabase
          .from("subscriptions")
          .select("*", { count: "exact", head: true })
          .eq("plan", "founding_member");
        const nextNumber = (count ?? 0) + 1;
        if (nextNumber > 50) {
          console.warn(
            `webhook:founding_member:cap_exceeded number=${nextNumber}`
          );
        }
        row.founding_member_number = nextNumber;
        emailMemberNumber = nextNumber;
      }
    }

    const { error: upsertError } = await supabase
      .from("subscriptions")
      .upsert(row, { onConflict: "user_id" });
    if (upsertError) {
      console.error("webhook:checkoutCompleted:upsert:error", upsertError);
    }

    // Send founding member email after successful upsert
    if (planKey === "founding_member" && emailMemberNumber !== null) {
      const customerEmail = session.customer_details?.email;
      if (customerEmail) {
        if (isRestore) {
          await sendFoundingMemberRestoreEmail(customerEmail, emailMemberNumber);
        } else {
          await sendFoundingMemberWelcomeEmail(customerEmail, emailMemberNumber);
        }
      }
    }
  } else if (session.mode === "payment" && planKey === "cfo_call") {
    const { error: insertError } = await supabase.from("cfo_calls").insert({
      user_id: userId,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_session_id: session.id,
      amount: session.amount_total ?? 15000,
      status: "paid",
    });
    if (insertError) {
      console.error("webhook:checkoutCompleted:cfoInsert:error", insertError);
    }

    const customerId = session.customer as string;
    const customer = await stripe.customers.retrieve(customerId);
    const customerEmail = (customer as Stripe.Customer).email;
    if (customerEmail) {
      await sendCfoCallConfirmation(
        customerEmail,
        process.env.NEXT_PUBLIC_CALENDLY_URL!
      );
    }
  }
}

async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  supabase: SupabaseClient
) {
  console.log("webhook:subscriptionUpdated", {
    id: sub.id,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: sub.cancel_at,
    current_period_end: sub.items.data[0]?.current_period_end,
    customer: sub.customer,
    metadata_supabase_user_id: sub.metadata?.supabase_user_id,
  });

  // Look up by stripe_customer_id — more reliable than subscription metadata
  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("user_id, plan, status, founding_member_number")
    .eq("stripe_customer_id", sub.customer as string)
    .maybeSingle();

  if (lookupError || !existing) {
    console.error("webhook:subscriptionUpdated:lookup:notFound", { customer: sub.customer, lookupError });
    return;
  }

  const userId = existing.user_id;

  // Case 1 — Cancellation scheduled at period end
  if (sub.cancel_at_period_end) {
    // Guard: only process once (idempotent against duplicate events)
    if (existing.status === "pending_cancellation") {
      console.log("webhook:subscriptionUpdated:pendingCancellation:alreadyProcessed", { userId });
      return;
    }

    const cancelAt = sub.cancel_at
      ? new Date(sub.cancel_at * 1000)
      : new Date((sub.items.data[0]?.current_period_end ?? 0) * 1000);

    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "pending_cancellation",
        cancelled_at: new Date().toISOString(),
        billing_period_end: cancelAt.toISOString(),
      })
      .eq("user_id", userId);
    if (updateError) {
      console.error("webhook:subscriptionUpdated:pendingCancellation:error", updateError);
    } else {
      console.log("webhook:subscriptionUpdated:pendingCancellation:set", { userId, cancelAt });
    }

    if (existing.plan === "founding_member" && existing.founding_member_number) {
      const email = await getCustomerEmail(sub.customer as string);
      if (email) {
        await sendFoundingMemberCancelledEmail(
          email,
          existing.founding_member_number,
          cancelAt.toISOString()
        );
      }
    }
    return;
  }

  // Case 2 — Cancellation reversed (reactivation via portal or reactivate endpoint)
  if (!sub.cancel_at_period_end && existing.status === "pending_cancellation") {
    const { error: reactivateError } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        cancelled_at: null,
      })
      .eq("user_id", userId);
    if (reactivateError) {
      console.error("webhook:subscriptionUpdated:reactivation:error", reactivateError);
    } else {
      console.log("webhook:subscriptionUpdated:reactivation:complete", { userId });
    }
    return;
  }

  // Case 3 — Normal update (plan change, renewal, billing period refresh)
  const planKey = sub.metadata?.plan_key ?? existing.plan;
  const featureTier = PLAN_TO_TIER[planKey] ?? "starter";

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      plan: planKey,
      feature_tier: featureTier,
      status: sub.status === "active" ? "active" : sub.status,
      stripe_price_id: sub.items.data[0]?.price.id ?? null,
      billing_period_start: new Date(
        (sub.items.data[0]?.current_period_start ?? 0) * 1000
      ).toISOString(),
      billing_period_end: new Date(
        (sub.items.data[0]?.current_period_end ?? 0) * 1000
      ).toISOString(),
    })
    .eq("user_id", userId);
  if (updateError) {
    console.error("webhook:subscriptionUpdated:error", updateError);
  }
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  supabase: SupabaseClient
) {
  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("user_id, plan, status, billing_period_end, founding_member_number")
    .eq("stripe_customer_id", sub.customer as string)
    .maybeSingle();

  if (lookupError || !existing) {
    console.error("webhook:subscriptionDeleted:lookup:notFound", { customer: sub.customer, lookupError });
    return;
  }

  const userId = existing.user_id;

  if (existing?.plan === "founding_member") {
    if (existing.status === "pending_cancellation") {
      // Billing ended — suspend access
      const { error: cancelError } = await supabase
        .from("subscriptions")
        .update({ status: "cancelled", feature_tier: "suspended" })
        .eq("user_id", userId);
      if (cancelError) {
        console.error("webhook:subscriptionDeleted:foundingMember:pendingCancellation:error", cancelError);
      }
      // No email — already sent when pending_cancellation was set
    } else {
      // Immediate cancellation (no prior cancel_at_period_end event)
      const billingEnd = existing.billing_period_end
        ? new Date(existing.billing_period_end)
        : new Date();

      const { error: cancelError } = await supabase
        .from("subscriptions")
        .update({
          status: "cancelled",
          feature_tier: "suspended",
          cancelled_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (cancelError) {
        console.error("webhook:subscriptionDeleted:foundingMember:error", cancelError);
      }

      const email = await getCustomerEmail(sub.customer as string);
      if (email && existing.founding_member_number) {
        await sendFoundingMemberCancelledEmail(
          email,
          existing.founding_member_number,
          billingEnd.toISOString()
        );
      }
    }
  } else {
    // Standard plan: reset to starter
    const { error: deleteError } = await supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        feature_tier: "starter",
        plan: "starter",
        cancelled_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (deleteError) {
      console.error("webhook:subscriptionDeleted:error", deleteError);
    }
  }
}

async function getCustomerEmail(customerId: string): Promise<string> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as { deleted?: boolean }).deleted) return "";
    return (customer as Stripe.Customer).email ?? "";
  } catch {
    return "";
  }
}

async function handlePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!data) return;

  const { error: pastDueError } = await supabase
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("user_id", data.user_id);
  if (pastDueError) {
    console.error("webhook:paymentFailed:update:error", pastDueError);
  }

  const customer = await stripe.customers.retrieve(customerId);
  const customerEmail = (customer as Stripe.Customer).email;
  if (customerEmail) {
    await sendPaymentFailedEmail(customerEmail, process.env.NEXT_PUBLIC_APP_URL!);
  }
}

async function handlePaymentSucceeded(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id, stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!data) return;

  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  if (data.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        data.stripe_subscription_id
      );
      periodStart = new Date(
        (stripeSub.items.data[0]?.current_period_start ?? 0) * 1000
      ).toISOString();
      periodEnd = new Date(
        (stripeSub.items.data[0]?.current_period_end ?? 0) * 1000
      ).toISOString();
    } catch (err) {
      console.error("webhook:handlePaymentSucceeded:retrieveSub:error", err);
    }
  }

  const { error: renewError } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      ...(periodStart && {
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
      }),
    })
    .eq("user_id", data.user_id);
  if (renewError) {
    console.error("webhook:paymentSucceeded:update:error", renewError);
  }

  if (periodStart) {
    await supabase
      .from("usage_tracking")
      .delete()
      .eq("user_id", data.user_id)
      .lt("period_end", periodStart);
  }
}
