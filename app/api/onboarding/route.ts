import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

/**
 * Marks onboarding as done — called when the user completes the import
 * flow or dismisses the welcome banner. Idempotent: the first timestamp
 * is kept, later calls are no-ops.
 */
export const POST = requireAuth(async (_req: NextRequest, { userId, supabase }) => {
  const { error } = await supabase
    .from("business_profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("onboarding_completed_at", null);

  if (error) {
    console.error("onboarding:complete:error", { userId, message: error.message });
    return NextResponse.json({ error: "Failed to update onboarding status" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
