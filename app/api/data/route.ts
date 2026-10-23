import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { clearFinancialData, hasPaidSubscription } from "@/lib/db";
import { createServiceClient } from "@/utils/supabase/service";

export const dynamic = "force-dynamic";

export const DELETE = requireAuth(async (_req, { userId, supabase }) => {
  const requestId = crypto.randomUUID();
  try {
    if (!(await hasPaidSubscription(userId, supabase))) {
      return NextResponse.json(
        { error: "An active subscription is required" },
        { status: 402, headers: { "Cache-Control": "no-store" } }
      );
    }
    // Never fall back to separate deletes if the RPC/migration is unavailable.
    await clearFinancialData(userId, createServiceClient());
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message : "Unknown clear-data failure";
    console.error("data:clear:error", { requestId, userId, message });
    return NextResponse.json(
      { error: "Clear could not be confirmed. Refresh the dashboard before retrying.", requestId },
      { status: 500 }
    );
  }
});
