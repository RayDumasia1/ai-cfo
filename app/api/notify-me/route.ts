import type { NextRequest } from "next/server";
import { deliverEmail } from "@/lib/emailDelivery";
import { buildFeatureNotificationEmail, type FeatureNotificationMessageType } from "@/lib/featureNotificationEmail";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { isFeatureComingSoon } from "@/lib/launchConfig";

const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
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
        && typeof (item as { created_at: unknown }).created_at === "string"
        && MESSAGE_TYPES.includes((item as { message_type: typeof MESSAGE_TYPES[number] }).message_type))) {
      throw new Error("Invalid registration result");
    }

    const returnedTypes = registration.outbox.map((item: { message_type: string }) => item.message_type);
    const hasExpectedWork = registration.inserted
      ? registration.outbox.length === MESSAGE_TYPES.length && MESSAGE_TYPES.every(type => returnedTypes.includes(type))
      : registration.outbox.length === 0;
    if (!hasExpectedWork) throw new Error("Invalid registration result");

    if (registration.inserted) {
      const messages = registration.outbox.map((item:{id:number;message_type:FeatureNotificationMessageType;created_at:string}) => ({
        id:item.id,
        message:buildFeatureNotificationEmail({email,feature,messageType:item.message_type,userId:user_id,createdAt:item.created_at}),
      }));
      for (const item of messages) {
        const delivery = await deliverEmail(item.message, "notify_me", {idempotencyKey:`email-outbox/${item.id}`});
        const now = new Date();
        const update = delivery.accepted
          ? {status:"sent",attempts:1,provider_message_id:delivery.providerMessageId,sent_at:now.toISOString(),
              next_attempt_at:null,updated_at:now.toISOString(),last_failure_reason:null}
          : {status:delivery.retryable ? "failed" : "permanent_failed",attempts:1,last_failure_reason:delivery.reason,
              next_attempt_at:delivery.retryable ? new Date(now.getTime()+5*60_000).toISOString() : null,updated_at:now.toISOString()};
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
