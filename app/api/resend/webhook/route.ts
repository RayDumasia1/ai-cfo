import { Resend, type WebhookEventPayload } from "resend";
import { createServiceClient } from "@/utils/supabase/service";

const TRACKED_EVENTS = new Set([
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!webhookSecret || !id || !timestamp || !signature) {
    return Response.json({ error:"Invalid webhook" }, { status:400 });
  }

  let event: WebhookEventPayload;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    event = resend.webhooks.verify({ payload:await request.text(), headers:{id,timestamp,signature}, webhookSecret });
  } catch {
    return Response.json({ error:"Invalid webhook" }, { status:400 });
  }

  if (!TRACKED_EVENTS.has(event.type) || !("email_id" in event.data)) return Response.json({ received:true });
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("record_email_delivery_event", {
    p_event_id:id,
    p_provider_message_id:event.data.email_id,
    p_event_type:event.type,
    p_event_at:event.created_at,
  });
  if (error || !data || typeof data.matched !== "boolean") {
    console.error("resend-webhook:record:error", { reason:"database_error" });
    return Response.json({ error:"Unable to record webhook" }, { status:500 });
  }
  if (!data.matched) return Response.json({ error:"Email not ready for event" }, { status:500 });
  return Response.json({ received:true });
}
