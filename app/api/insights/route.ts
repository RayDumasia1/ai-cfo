import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";

export const POST = requireAuth(
  async (_req: NextRequest, { userId, email, supabase }) => {
    const gate = await checkFeatureGate(userId, email, "ai_insights", supabase);
    if (gate) return gate;

    // An unavailable feature must never consume allowance or trigger warnings.
    return Response.json(
      {
        error: "AI Insights is coming soon. This endpoint is not yet implemented.",
        code: "FEATURE_NOT_IMPLEMENTED",
      },
      {
        status: 501,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
);
