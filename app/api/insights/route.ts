import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";
import { getBillingDetails } from "@/lib/db";
import { checkAndIncrementUsage } from "@/lib/usageGate";

export const POST = requireAuth(
  async (req: NextRequest, { userId, email, supabase }) => {
    const gate = await checkFeatureGate(userId, email, "ai_insights", supabase);
    if (gate) return gate;

    const billing = await getBillingDetails(userId, supabase);
    const usageResult = await checkAndIncrementUsage(
      userId,
      email,
      "ai_insight_runs",
      billing.feature_tier,
      new Date(billing.billing_period_start ?? Date.now()),
      supabase
    );
    if (!usageResult.allowed) return usageResult.response!;

    return Response.json(
      {
        error: "AI Insights is coming soon. This endpoint is not yet implemented.",
        usage: {
          used: usageResult.used,
          limit: usageResult.limit,
          throttled: usageResult.throttled,
        },
      },
      {
        status: 501,
        headers: {
          "X-Usage-Used": String(usageResult.used),
          "X-Usage-Limit":
            usageResult.limit != null ? String(usageResult.limit) : "unlimited",
          "X-Usage-Throttled": String(usageResult.throttled),
        },
      }
    );
  }
);
