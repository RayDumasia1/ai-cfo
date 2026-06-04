// Handles Founding Member grace period lifecycle only.
// 24-month Core expiry was removed by design — benefits are permanent while subscribed.
import { createServiceClient } from "@/utils/supabase/service";
import {
  sendFoundingMemberSuspendedEmail,
  sendFoundingMember5DayWarningEmail,
  sendFoundingMemberExpiredEmail,
} from "@/lib/email";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const processed = {
    billing_ended: 0,
    grace_warnings_sent: 0,
    grace_expired: 0,
  };

  // Check A — Billing period ended, still showing Core → suspend
  {
    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("user_id, founding_member_number, founding_member_grace_ends_at")
      .eq("plan", "founding_member")
      .eq("status", "cancelled")
      .eq("feature_tier", "core")
      .lt("billing_period_end", new Date().toISOString());

    if (error) {
      console.error("cron:founding-expiry:checkA:error", error);
    } else {
      for (const row of rows ?? []) {
        const { error: updateErr } = await supabase
          .from("subscriptions")
          .update({ feature_tier: "suspended" })
          .eq("user_id", row.user_id);
        if (updateErr) {
          console.error("cron:founding-expiry:checkA:update:error", updateErr);
          continue;
        }
        const { data: { user } } = await supabase.auth.admin.getUserById(row.user_id);
        if (user?.email && row.founding_member_number && row.founding_member_grace_ends_at) {
          await sendFoundingMemberSuspendedEmail(
            user.email,
            row.founding_member_number,
            row.founding_member_grace_ends_at
          );
        }
        processed.billing_ended++;
      }
    }
  }

  // Check B — 5-day grace warning
  {
    const now = new Date();
    const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("user_id, founding_member_number, founding_member_grace_ends_at")
      .eq("plan", "founding_member")
      .eq("status", "cancelled")
      .eq("feature_tier", "suspended")
      .not("fm_grace_warning_sent", "is", null)
      .or("fm_grace_warning_sent.is.null,fm_grace_warning_sent.eq.false")
      .gte("founding_member_grace_ends_at", now.toISOString())
      .lte("founding_member_grace_ends_at", fiveDaysFromNow.toISOString());

    if (error) {
      console.error("cron:founding-expiry:checkB:error", error);
    } else {
      for (const row of rows ?? []) {
        const { error: updateErr } = await supabase
          .from("subscriptions")
          .update({ fm_grace_warning_sent: true })
          .eq("user_id", row.user_id);
        if (updateErr) {
          console.error("cron:founding-expiry:checkB:update:error", updateErr);
          continue;
        }
        const { data: { user } } = await supabase.auth.admin.getUserById(row.user_id);
        if (user?.email && row.founding_member_number && row.founding_member_grace_ends_at) {
          await sendFoundingMember5DayWarningEmail(
            user.email,
            row.founding_member_number,
            row.founding_member_grace_ends_at
          );
        }
        processed.grace_warnings_sent++;
      }
    }
  }

  // Check C — Grace period expired
  {
    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("user_id, founding_member_number, founding_member_grace_ends_at")
      .eq("plan", "founding_member")
      .eq("status", "cancelled")
      .eq("feature_tier", "suspended")
      .lt("founding_member_grace_ends_at", new Date().toISOString())
      .or("fm_grace_expired_email_sent.is.null,fm_grace_expired_email_sent.eq.false");

    if (error) {
      console.error("cron:founding-expiry:checkC:error", error);
    } else {
      for (const row of rows ?? []) {
        const { error: updateErr } = await supabase
          .from("subscriptions")
          .update({ fm_grace_expired_email_sent: true })
          .eq("user_id", row.user_id);
        if (updateErr) {
          console.error("cron:founding-expiry:checkC:update:error", updateErr);
          continue;
        }
        const { data: { user } } = await supabase.auth.admin.getUserById(row.user_id);
        if (user?.email && row.founding_member_number) {
          await sendFoundingMemberExpiredEmail(user.email, row.founding_member_number);
        }
        processed.grace_expired++;
      }
    }
  }

  return Response.json({ processed });
}
