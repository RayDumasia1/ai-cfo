import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getBillingDetails, getUsage } from "@/lib/db";
import { USAGE_LIMITS } from "@/lib/featureGates";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const billing = await getBillingDetails(user.id, supabase);
  const tier = billing.feature_tier;

  if (tier === "starter" || tier === "advisory") {
    return NextResponse.json({ usage: [] });
  }

  const periodStart = billing.billing_period_start
    ? new Date(billing.billing_period_start)
    : new Date();

  const metrics = ["ask_cfo_questions", "ai_insight_runs", "actions_active"];
  const limits = USAGE_LIMITS[tier];

  const usageData = await Promise.all(
    metrics.map(async (metric) => {
      const result = await getUsage(user.id, metric, periodStart, supabase);
      return { metric, count: result.count, limit: limits[metric] ?? null };
    })
  );

  return NextResponse.json({ usage: usageData });
}
