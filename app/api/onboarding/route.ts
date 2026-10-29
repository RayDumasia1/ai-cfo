import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { completeOwnedOnboarding } from "@/lib/db";
import { monthlyErrorResponse } from "@/lib/monthlyAuthority";

export const dynamic = "force-dynamic";

/**
 * Marks onboarding as done — called when the user completes the import
 * flow or dismisses the welcome banner. Idempotent: the first timestamp
 * is kept, later calls are no-ops.
 */
export const POST = requireAuth(async (_req: NextRequest, { userId, supabase }) => {
  try {
    await completeOwnedOnboarding(userId,supabase);
  } catch(error) {
    const mapped=monthlyErrorResponse(error);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    console.error("onboarding:complete:error");
    return NextResponse.json({ error: "Failed to update onboarding status" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
