import { stripe, PLAN_TO_TIER, STRIPE_PRICES } from "@/lib/stripe";
import { createServiceClient } from "@/utils/supabase/service";
import { upsertNewFoundingMember } from "@/lib/foundingMembers";
import { getSubscriptionStatus } from "@/lib/subscriptionStatus";
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

  const objectId = "id" in event.data.object ? event.data.object.id : null;
  const { data: claimed, error: claimError } = await supabase.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id, p_event_type: event.type, p_object_id: objectId,
  });
  if (claimError) {
    console.error("webhook:claim:error", { eventId: event.id, type: event.type, claimError });
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
  if (!claimed) return OK();

  console.log("webhook:event", { eventId: event.id, type: event.type });

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
          supabase,
          new Date(event.created * 1000)
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
          supabase,
          new Date(event.created * 1000)
        );
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(
          event.data.object as Stripe.Invoice,
          supabase,
          new Date(event.created * 1000)
        );
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(
          event.data.object as Stripe.Invoice,
          supabase,
          new Date(event.created * 1000)
        );
        break;
    }
    const { error: completionError } = await supabase.from("stripe_webhook_events").update({
      status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null,
    }).eq("event_id", event.id).eq("status", "processing");
    if (completionError) throw completionError;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "Webhook processing failed";
    const { error: failureError } = await supabase.from("stripe_webhook_events").update({
      status: "failed", updated_at: new Date().toISOString(), last_error: message,
    }).eq("event_id", event.id).eq("status", "processing");
    if (failureError) console.error("webhook:failureRecord:error", { eventId: event.id, failureError });
    console.error(`webhook:${event.type}:error`, err);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
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
    const attemptId = session.metadata?.checkout_attempt_id;
    // Only support can set this metadata using privileged Stripe tools. Public
    // checkout never sets it; existing holders cannot purchase a new claim.
    const supportReinstatement = planKey === "founding_member" &&
      session.metadata?.founding_reinstatement === "support";
    const { data: current, error: currentError } = await supabase
      .from("subscriptions").select("stripe_subscription_id, status, founding_member_cancelled_at")
      .eq("user_id", userId).maybeSingle();
    if (currentError) throw currentError;
    if (current?.stripe_subscription_id === subId &&
        ["active", "pending_cancellation"].includes(current.status) &&
        !current.founding_member_cancelled_at) return;
    if (attemptId) {
      const { data: attempt, error: attemptError } = await supabase
        .from("subscription_checkout_attempts").select("id")
        .eq("user_id", userId).eq("id", attemptId).maybeSingle();
      if (attemptError) throw attemptError;
      if (!attempt) return; // A superseded checkout must never replace the current plan.
    } else if (!supportReinstatement && current?.stripe_subscription_id && current.stripe_subscription_id !== subId) {
      return; // Legacy checkout: never replace a different subscription.
    }
    if (current?.stripe_subscription_id && current.stripe_subscription_id !== subId) {
      const previous = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
      if (!["canceled", "incomplete_expired"].includes(previous.status)) return;
    }
    const stripeSub = await stripe.subscriptions.retrieve(subId);
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;

    const row: Record<string, unknown> = {
      user_id: userId,
      plan: planKey,
      feature_tier: featureTier,
      status: getSubscriptionStatus(stripeSub),
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
    let isNewFoundingClaim = false;

    if (planKey === "founding_member") {
      // Trust the DB, not session metadata: a user who already holds a number
      // re-activates that spot rather than claiming a new one.
      const { data: existing, error: existingError } = await supabase
        .from("subscriptions")
        .select("founding_member_number")
        .eq("user_id", userId)
        .maybeSingle();
      if (existingError) {
        throw existingError;
      }
      const originalNumber = existing?.founding_member_number ?? null;

      if (originalNumber !== null) {
        if (!supportReinstatement) {
          // Retire any checkout left open by the superseded 30-day policy.
          await reverseIneligibleSubscription(stripeSub);
          return;
        }
        isRestore = true;
        row.founding_member_cancelled_at = null;
        row.founding_member_grace_ends_at = null;
        row.cancelled_at = null;
        emailMemberNumber = originalNumber;
      } else if (!existingError) {
        // New join (no expiry — Core features are permanent)
        isNewFoundingClaim = true;
      }
    }

    if (["canceled", "incomplete_expired"].includes(stripeSub.status)) return;

    let upsertError: { code?: string } | null = null;
    if (isNewFoundingClaim) {
      ({ upsertError, memberNumber: emailMemberNumber } =
        await upsertNewFoundingMember(row, userId, supabase));
      if (upsertError?.code === "P0002") {
        await reverseIneligibleSubscription(stripeSub);
        return;
      }
    } else {
      ({ error: upsertError } = await supabase
        .from("subscriptions")
        .upsert(row, { onConflict: "user_id" }));
      if (upsertError) {
        console.error("webhook:checkoutCompleted:upsert:error", upsertError);
      }
    }
    if (upsertError) throw upsertError;

    // Send founding member email only after a successful upsert
    if (planKey === "founding_member" && !upsertError && emailMemberNumber !== null) {
      const customerEmail = session.customer_details?.email;
      if (customerEmail) {
        if (isRestore) {
          await deliverWebhookEmail("founding-restore", () =>
            sendFoundingMemberRestoreEmail(customerEmail, emailMemberNumber));
        } else {
          await deliverWebhookEmail("founding-welcome", () =>
            sendFoundingMemberWelcomeEmail(customerEmail, emailMemberNumber));
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
      throw insertError;
    }

    const customerId = session.customer as string;
    const customer = await stripe.customers.retrieve(customerId);
    const customerEmail = (customer as Stripe.Customer).email;
    if (customerEmail) {
      await deliverWebhookEmail("cfo-call-confirmation", () => sendCfoCallConfirmation(
        customerEmail,
        process.env.NEXT_PUBLIC_CALENDLY_URL!
      ));
    }
  }
}

async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  supabase: SupabaseClient,
  eventTime: Date
) {
  const deliveredCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const current = await stripe.subscriptions.retrieve(sub.id);
  const currentCustomer = typeof current.customer === "string" ? current.customer : current.customer.id;
  if (currentCustomer !== deliveredCustomer) throw new Error("Stripe subscription customer mismatch");
  sub = current;
  console.log("webhook:subscriptionUpdated", {
    id: sub.id,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: sub.cancel_at,
    customer: sub.customer,
  });

  // Customer IDs are shared across successive subscriptions. Match both IDs.
  const { data: matchedSubscription, error: lookupError } = await supabase
    .from("subscriptions")
    .select("user_id, plan, status, founding_member_number, stripe_price_id, stripe_customer_id, stripe_subscription_id")
    .eq("stripe_customer_id", sub.customer as string)
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  let existing = matchedSubscription;

  if (lookupError) throw lookupError;
  if (!existing) {
    // A customer can retain a live Stripe subscription after a delayed or
    // missed checkout webhook leaves our local subscription ID stale. Recover
    // only when this is the customer's sole row and the formerly linked Stripe
    // subscription is confirmed terminal. This prevents an older or duplicate
    // active subscription event from replacing the current entitlement.
    const { data: customerRow, error: customerLookupError } = await supabase
      .from("subscriptions")
      .select("user_id, plan, status, founding_member_number, stripe_price_id, stripe_customer_id, stripe_subscription_id")
      .eq("stripe_customer_id", sub.customer as string)
      .maybeSingle();
    if (customerLookupError) throw customerLookupError;

    const linkedId = customerRow?.stripe_subscription_id as string | null | undefined;
    let linkedIsTerminal = !linkedId;
    if (linkedId && linkedId !== sub.id) {
      try {
        const linked = await stripe.subscriptions.retrieve(linkedId);
        linkedIsTerminal = ["canceled", "incomplete_expired"].includes(linked.status);
      } catch (error) {
        if ((error as { code?: string }).code !== "resource_missing") throw error;
        linkedIsTerminal = true;
      }
    }

    if (customerRow && linkedId !== sub.id && linkedIsTerminal &&
        !["canceled", "incomplete_expired"].includes(sub.status)) {
      const relink = supabase.from("subscriptions")
        .update({ stripe_subscription_id: sub.id })
        .eq("user_id", customerRow.user_id)
        .eq("stripe_customer_id", sub.customer as string);
      if (linkedId) relink.eq("stripe_subscription_id", linkedId);
      else relink.is("stripe_subscription_id", null);
      const { data: recovered, error: recoveryError } = await relink
        .select("user_id, plan, status, founding_member_number, stripe_price_id, stripe_customer_id, stripe_subscription_id")
        .maybeSingle();
      if (recoveryError) throw recoveryError;
      existing = recovered;
      console.log("webhook:subscriptionUpdated:lookup:recovered", {
        userId: customerRow.user_id,
        previousSubscription: linkedId ?? null,
        subscription: sub.id,
      });
    }

    if (!existing) {
      console.error("webhook:subscriptionUpdated:lookup:notFound", {
        customer: sub.customer,
        subscription: sub.id,
        linkedSubscription: linkedId ?? null,
        lookupError,
      });
      return;
    }
  }

  const userId = existing.user_id;
  const status = getSubscriptionStatus(sub);
  if (status === "cancelled") {
    // Terminal state wins over lingering cancellation flags. Route it through
    // the same identity-preserving cleanup as customer.subscription.deleted.
    await handleSubscriptionDeleted(sub, supabase, eventTime);
    return;
  }
  if (["cancelled", "canceled"].includes(existing.status)) return;
  if (existing.plan !== "founding_member" && existing.founding_member_number != null && sub.metadata?.founding_restore_deadline) {
    // An in-flight self-service price change from the old policy is no longer
    // authorized. Restore the standard plan without granting Founding benefits.
    const previousPrice = existing.stripe_price_id ?? sub.metadata.founding_restore_previous_price;
    if (!previousPrice || !sub.items.data[0]) throw new Error("Cannot reverse an obsolete plan restoration");
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: previousPrice }], proration_behavior: "none",
      metadata: { ...sub.metadata, plan_key: existing.plan, founding_restore_deadline: "", founding_restore_previous_price: "" },
    }, { idempotencyKey: `expired-founding-plan-restore:${sub.id}:${sub.metadata.founding_restore_deadline}` });
    return;
  }

  // Case 1 — Cancellation scheduled (portal uses cancel_at, not cancel_at_period_end)
  const isCancelScheduled = status === "pending_cancellation";
  if (isCancelScheduled) {
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
      .eq("user_id", userId).eq("stripe_subscription_id", sub.id);
    if (updateError) {
      throw updateError;
    } else {
      console.log("webhook:subscriptionUpdated:pendingCancellation:set", { userId, cancelAt });
    }

    if (existing.plan === "founding_member" && existing.founding_member_number) {
      const email = await getCustomerEmail(sub.customer as string);
      if (email) {
        await deliverWebhookEmail("founding-cancellation", () => sendFoundingMemberCancelledEmail(
          email,
          existing.founding_member_number,
          cancelAt.toISOString()
        ));
      }
    }
    return;
  }

  // Case 2 — Cancellation reversed (reactivation via portal or reactivate endpoint)
  const isCancelCleared = status === "active" && existing.status === "pending_cancellation";
  if (isCancelCleared) {
    const { error: reactivateError } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        cancelled_at: null,
      })
      .eq("user_id", userId).eq("stripe_subscription_id", sub.id);
    if (reactivateError) {
      throw reactivateError;
    } else {
      console.log("webhook:subscriptionUpdated:reactivation:complete", { userId });
    }
    return;
  }

  // Case 3 — Normal update (plan change, renewal, billing period refresh)
  // Portal price changes do not rewrite custom subscription metadata. The
  // current Stripe price is authoritative for standard plan changes.
  const currentPriceId = sub.items.data[0]?.price.id;
  const pricePlan = Object.entries(STRIPE_PRICES).find(
    ([key, configuredPrice]) => key !== "cfo_call" && configuredPrice === currentPriceId
  )?.[0];
  const planKey = pricePlan ?? sub.metadata?.plan_key ?? existing.plan;
  const featureTier = PLAN_TO_TIER[planKey] ?? "starter";

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      plan: planKey,
      feature_tier: featureTier,
      status,
      stripe_price_id: sub.items.data[0]?.price.id ?? null,
      billing_period_start: new Date(
        (sub.items.data[0]?.current_period_start ?? 0) * 1000
      ).toISOString(),
      billing_period_end: new Date(
        (sub.items.data[0]?.current_period_end ?? 0) * 1000
      ).toISOString(),
    })
    .eq("user_id", userId).eq("stripe_subscription_id", sub.id);
  if (updateError) {
    throw updateError;
  }
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  supabase: SupabaseClient,
  eventTime: Date = new Date()
) {
  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("user_id, plan, status, cancelled_at, billing_period_end, founding_member_number, founding_member_cancelled_at")
    .eq("stripe_customer_id", sub.customer as string)
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!existing) {
    console.error("webhook:subscriptionDeleted:lookup:notFound", { customer: sub.customer, lookupError });
    return;
  }

  const isFoundingPlan = existing.plan === "founding_member";
  const alreadyCancelled = ["cancelled", "canceled"].includes(existing.status);
  const shouldNotify = isFoundingPlan && !alreadyCancelled && existing.status !== "pending_cancellation" &&
    existing.founding_member_number != null;
  const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null;
  // Keep the effective end stable on retries, even when Stripe omits ended_at.
  const effectiveEnd = endedAt ?? (isFoundingPlan ? existing.founding_member_cancelled_at : null) ??
    (alreadyCancelled ? existing.cancelled_at : null) ?? eventTime.toISOString();
  const { error: cancelError } = await supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: effectiveEnd,
      billing_period_end: effectiveEnd,
      feature_tier: isFoundingPlan ? "suspended" : "starter",
      ...(isFoundingPlan ? {
        founding_member_cancelled_at: effectiveEnd,
        founding_member_grace_ends_at: null,
      } : { plan: "starter" }),
      // A permanent member number/test designation is never cleared here,
      // including when a former Founder has subsequently bought a standard plan.
    })
    .eq("user_id", existing.user_id)
    .eq("stripe_customer_id", sub.customer as string)
    .eq("stripe_subscription_id", sub.id);
  if (cancelError) throw cancelError;

  // A scheduled cancellation already sent its notice; repeated terminal events
  // must not send a second notice after another event path completed cleanup.
  if (shouldNotify) {
    const email = await getCustomerEmail(sub.customer as string);
    if (email) await deliverWebhookEmail("founding-ended", () =>
      sendFoundingMemberCancelledEmail(email, existing.founding_member_number!, effectiveEnd));
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

/** Resolve invoice events against the current subscription, not the invoice's
 * historical payment result. Old invoices can arrive after recovery or ending. */
async function syncInvoiceSubscription(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient,
  eventTime: Date
) {
  const customerId = invoice.customer as string;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!customerId || !subscriptionId) return null;

  const { data, error: readError } = await supabase
    .from("subscriptions")
    .select("user_id, status")
    .eq("stripe_customer_id", customerId)
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (readError) throw readError;
  if (!data || ["cancelled", "canceled"].includes(data.status)) return null;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const status = getSubscriptionStatus(subscription);
  if (status === "cancelled") {
    await handleSubscriptionDeleted(subscription, supabase, eventTime);
    return null;
  }
  const item = subscription.items.data[0];
  const start = item?.current_period_start;
  const end = subscription.cancel_at ?? item?.current_period_end;
  const periodStart = start && start > 0 ? new Date(start * 1000).toISOString() : null;
  const periodEnd = end && end > 0 ? new Date(end * 1000).toISOString() : null;
  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({
      status,
      ...(periodStart ? { billing_period_start: periodStart } : {}),
      ...(periodEnd ? { billing_period_end: periodEnd } : {}),
      // Clear a reversed cancellation only when Stripe confirms active state.
      ...(status === "active" ? { cancelled_at: null } : {}),
    })
    .eq("user_id", data.user_id)
    .eq("stripe_customer_id", customerId)
    .eq("stripe_subscription_id", subscriptionId)
    // Do not overwrite a cancellation or replacement that raced this lookup.
    .eq("status", data.status)
    .select("user_id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) return null;
  return { userId: data.user_id, subscription, status, periodStart };
}

async function handlePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient,
  eventTime: Date
) {
  const current = await syncInvoiceSubscription(invoice, supabase, eventTime);
  if (!current || current.status !== "past_due") return;
  const email = await getCustomerEmail(current.subscription.customer as string);
  if (email) await deliverWebhookEmail("payment-failed", () =>
    sendPaymentFailedEmail(email, process.env.NEXT_PUBLIC_APP_URL!));
}

async function deliverWebhookEmail(label: string, send: () => Promise<void>) {
  try {
    await send();
  } catch (error) {
    // Billing state is authoritative. Log delivery failures for operational
    // follow-up without rolling back or repeatedly mutating entitlements.
    console.error("webhook:email:error", { label, error });
  }
}

async function handlePaymentSucceeded(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient,
  eventTime: Date
) {
  const current = await syncInvoiceSubscription(invoice, supabase, eventTime);
  if (!current?.periodStart || !["active", "pending_cancellation"].includes(current.status)) return;
  const { error } = await supabase
    .from("usage_tracking")
    .delete()
    .eq("user_id", current.userId)
    .lt("period_end", current.periodStart);
  if (error) throw error;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return typeof subscription === "string" ? subscription : subscription?.id ?? null;
}

/** Reverse an obsolete self-service restoration or a sold-out new claim. */
async function reverseIneligibleSubscription(subscription: Stripe.Subscription) {
  if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
    await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false }, {
      idempotencyKey: `ineligible-founding-cancel:${subscription.id}`,
    });
  }
  const invoiceId = typeof subscription.latest_invoice === "string"
    ? subscription.latest_invoice : subscription.latest_invoice?.id;
  if (!invoiceId) return;
  await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 100 })
    .autoPagingEach(async (payment) => {
      if (!payment.amount_paid) return;
      const intent = payment.payment.payment_intent;
      const charge = payment.payment.charge;
      const target = intent
        ? { payment_intent: typeof intent === "string" ? intent : intent.id }
        : charge ? { charge: typeof charge === "string" ? charge : charge.id } : null;
      if (!target) throw new Error("Unsupported payment requires manual reversal");
      try {
        await stripe.refunds.create({ ...target, amount: payment.amount_paid }, {
          idempotencyKey: `ineligible-founding-refund:${payment.id}`,
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "charge_already_refunded") throw error;
      }
    });
}
