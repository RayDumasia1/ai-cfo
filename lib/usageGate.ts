import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import type { FeatureTier } from "./featureGates";
import { USAGE_LIMITS } from "./featureGates";
import {
  getUsage,
  incrementUsage,
  markWarningSent,
} from "./db";

type Metric = "ask_cfo_questions" | "ai_insight_runs";

export interface UsageCheckResult {
  allowed: boolean;
  throttled: boolean;
  used: number;
  limit: number | null;
  response?: Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendUsageWarningEmail(
  userEmail: string,
  used: number,
  limit: number
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const billingUrl = `${appUrl}/dashboard/settings?tab=billing`;
  const remaining = limit - used;

  const body = `
    <h2 style="font-size:20px;font-weight:600;color:#0A1A2F;margin:0 0 8px;">
      You've used ${used} of your ${limit} Ask CFO questions this month
    </h2>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 8px;">
      You have <strong>${remaining}</strong> question${remaining === 1 ? "" : "s"} remaining this month.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      Once you reach ${limit}, your responses will be slightly delayed as a fair use measure.
      Upgrade to Advisory for unlimited Ask CFO access at any time.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${billingUrl}"
         style="display:inline-block;background:#2CA6A4;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;">
        View your usage &rarr;
      </a>
    </p>
    <p style="font-size:13px;color:#6B7A8D;margin:0;">
      Your usage resets on your next billing anniversary date.
      Questions? Contact us at
      <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
    </p>
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ask CFO usage warning</title>
</head>
<body style="margin:0;padding:0;background:#F4F7FA;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FA;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(10,26,47,0.10);">
        <tr>
          <td style="background:#0A1A2F;padding:24px 32px;">
            <span style="font-size:18px;font-weight:600;color:#FFFFFF;letter-spacing:-0.3px;">Elidan</span>
          </td>
        </tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr>
          <td style="background:#F4F7FA;padding:16px 32px;border-top:1px solid #D8E2EC;">
            <p style="font-size:12px;color:#6B7A8D;margin:0;">
              Elidan &middot; You're receiving this because you have an account at elidan.ai.
              Questions? Contact us at <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
    await resend.emails.send({
      from: "Elidan <no-reply@elidan.ai>",
      to: userEmail,
      subject: `You've used ${used} of your ${limit} Ask CFO questions this month`,
      html,
    });
  } catch (err) {
    console.error("usageGate:sendUsageWarningEmail:error", err);
  }
}

const UPGRADE_MESSAGES: Record<Metric, string> = {
  ask_cfo_questions:
    "Upgrade to Growth ($199/month) for 150 Ask CFO questions per month",
  ai_insight_runs:
    "Upgrade to Growth ($199/month) for unlimited AI insights",
};

export async function checkAndIncrementUsage(
  userId: string,
  userEmail: string,
  metric: Metric,
  featureTier: FeatureTier,
  billingPeriodStart: Date,
  client: SupabaseClient
): Promise<UsageCheckResult> {
  const periodStart = billingPeriodStart;
  const periodEnd = new Date(billingPeriodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const limit = USAGE_LIMITS[featureTier][metric] ?? null;

  // Unlimited — skip all tracking
  if (limit === null) {
    return { allowed: true, throttled: false, used: 0, limit: null };
  }

  const usage = await getUsage(userId, metric, periodStart, client);

  if (usage.count >= limit) {
    if (featureTier === "growth") {
      // Fair-use throttle: delay but allow
      await delay(5000);
      try {
        await incrementUsage(userId, metric, periodStart, periodEnd, limit, client);
      } catch (err) {
        console.error("usageGate:throttle:incrementUsage:error", err);
      }
      return {
        allowed: true,
        throttled: true,
        used: usage.count + 1,
        limit,
      };
    }

    // Hard limit for Core (and Starter as belt-and-suspenders)
    return {
      allowed: false,
      throttled: false,
      used: usage.count,
      limit,
      response: Response.json(
        {
          error: "Monthly limit reached",
          used: usage.count,
          limit,
          upgrade_message: UPGRADE_MESSAGES[metric],
          upgrade_to: "growth",
        },
        { status: 429 }
      ),
    };
  }

  await incrementUsage(userId, metric, periodStart, periodEnd, limit, client);

  const newCount = usage.count + 1;

  // Warning email: Growth + ask_cfo_questions at 100/150, sent once
  if (
    featureTier === "growth" &&
    metric === "ask_cfo_questions" &&
    newCount === 100 &&
    !usage.warning_sent_at
  ) {
    await sendUsageWarningEmail(userEmail, newCount, limit);
    await markWarningSent(userId, metric, periodStart, client);
  }

  return { allowed: true, throttled: false, used: newCount, limit };
}
