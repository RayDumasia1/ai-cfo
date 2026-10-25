import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/utils/supabase/service";
import { deliverEmail } from "@/lib/emailDelivery";
import { buildFeatureNotificationEmail, type FeatureNotificationMessageType } from "@/lib/featureNotificationEmail";

type OutboxRow = {
  id: number;
  email: string;
  feature: string;
  message_type: FeatureNotificationMessageType;
  attempts: number;
  created_at: string;
  user_id: string | null;
};

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function retryDelayMinutes(attempts: number): number {
  return Math.min(360, 5 * 2 ** Math.max(0, attempts - 1));
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("claim_email_outbox_batch", { p_limit: 20 });
  if (error || !Array.isArray(data)) {
    console.error("email-outbox:claim:error", { reason: "database_error" });
    return Response.json({ error: "Unable to process email queue" }, { status: 500 });
  }

  let accepted = 0;
  let deferred = 0;
  let permanentFailures = 0;
  for (const row of data as OutboxRow[]) {
    const message = buildFeatureNotificationEmail({
      email: row.email,
      feature: row.feature,
      messageType: row.message_type,
      userId: row.user_id,
      createdAt: row.created_at,
    });
    const delivery = await deliverEmail(message, "email_outbox_retry", { idempotencyKey: `email-outbox/${row.id}` });
    const now = new Date();
    const exhausted = row.attempts >= 5;
    const permanent = !delivery.accepted && (!delivery.retryable || exhausted);
    const update = delivery.accepted
      ? { status:"sent", provider_message_id:delivery.providerMessageId, sent_at:now.toISOString(), locked_at:null,
          next_attempt_at:null, last_failure_reason:null, updated_at:now.toISOString() }
      : { status:permanent ? "permanent_failed" : "failed", locked_at:null,
          next_attempt_at:permanent ? null : new Date(now.getTime()+retryDelayMinutes(row.attempts)*60_000).toISOString(),
          last_failure_reason:delivery.reason, updated_at:now.toISOString() };
    const { error: updateError } = await admin.from("email_outbox").update(update).eq("id",row.id).eq("status","sending");
    if (updateError) {
      console.error("email-outbox:update:error", { reason:"database_error" });
      continue;
    }
    if (delivery.accepted) accepted += 1;
    else if (permanent) permanentFailures += 1;
    else deferred += 1;
  }

  return Response.json({ claimed:data.length, accepted, deferred, permanentFailures });
}
