import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";

export const POST = requireAuth(
  async (req: NextRequest, { userId, email, supabase }) => {
    const gate = await checkFeatureGate(
      userId,
      email,
      "forecasting",
      supabase
    );
    if (gate) return gate;

    return Response.json(
      {
        error:
          "Forecasting is coming soon. This endpoint is not yet implemented.",
      },
      { status: 501 }
    );
  }
);
