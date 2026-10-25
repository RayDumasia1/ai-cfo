import type { NextRequest } from "next/server";
import { deliverEmail, escapeHtml } from "@/lib/emailDelivery";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { isFeatureComingSoon } from "@/lib/launchConfig";

const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const FEATURE_LABELS: Record<string, string> = {
  ai_insights: "AI insights",
  cfo_call: "CFO assistance",
  tier_advisory: "Advisory",
  tier_core: "Core",
  tier_growth: "Growth",
};
const MESSAGE_TYPES = ["feature_customer_confirmation", "feature_internal_notification"] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const { email: rawEmail, feature } = body as Record<string, unknown>;
    const email = typeof rawEmail === "string" ? rawEmail.trim() : rawEmail;

    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !EMAIL_REGEX.test(email) ||
      typeof feature !== "string" ||
      feature.trim().length === 0 ||
      !isFeatureComingSoon(feature)
    ) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    const user_id = authError ? null : user?.id ?? null;

    const adminClient = createServiceClient();
    const { data: registration, error } = await adminClient.rpc("register_feature_notification", {
      p_email:email,p_feature:feature,p_user_id:user_id,
    });

    if (error) throw error;
    if (!registration || typeof registration.inserted !== "boolean" || !Array.isArray(registration.outbox)
      || !registration.outbox.every((item:unknown) => item && typeof item === "object" && Number.isSafeInteger((item as { id: unknown }).id)
        && MESSAGE_TYPES.includes((item as { message_type: typeof MESSAGE_TYPES[number] }).message_type))) {
      throw new Error("Invalid registration result");
    }

    const returnedTypes = registration.outbox.map((item: { message_type: string }) => item.message_type);
    const hasExpectedWork = registration.inserted
      ? registration.outbox.length === MESSAGE_TYPES.length && MESSAGE_TYPES.every(type => returnedTypes.includes(type))
      : registration.outbox.length === 0;
    if (!hasExpectedWork) throw new Error("Invalid registration result");

    if (registration.inserted) {
      const featureLabel = FEATURE_LABELS[feature] ?? feature;
      const messages = registration.outbox.map((item:{id:number;message_type:string}) => ({id:item.id,
        message:item.message_type === "feature_customer_confirmation" ? {from:"Elidan AI <hello@elidan.ai>",to:email,subject:`You're on the list for ${featureLabel}`,
          html:`<p>You’re on the list for <strong>${escapeHtml(featureLabel)}</strong>.</p><p>We’ll email you at this address when it becomes available. No purchase or plan change has been made.</p>`}
        : {from:"Elidan AI <hello@elidan.ai>",to:"hello@elidan.ai",subject:`Notify me: ${feature}`,html:`
          <p>A user has requested
          notification for a coming
          soon feature.</p>
          <p><strong>Feature:</strong>
            ${escapeHtml(feature)}</p>
          <p><strong>Email:</strong>
            ${escapeHtml(email)}</p>
          <p><strong>User ID:</strong>
            ${escapeHtml(user_id ?? "Not signed in")}</p>
          <p><strong>Time:</strong>
            ${new Date().toISOString()}</p>
        `}}));
      for (const item of messages) {
        const delivery = await deliverEmail(item.message, "notify_me");
        const update = delivery.accepted
          ? {status:"sent",attempts:1,provider_message_id:delivery.providerMessageId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_failure_reason:null}
          : {status:"failed",attempts:1,last_failure_reason:delivery.reason,updated_at:new Date().toISOString()};
        const {error:updateError}=await adminClient.from("email_outbox").update(update).eq("id",item.id).eq("status","pending");
        if(updateError) console.error("notify-me:outbox:update:error",{reason:"database_error"});
      }
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("notify-me:error", { reason: err instanceof Error ? "request_exception" : "database_error" });
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
