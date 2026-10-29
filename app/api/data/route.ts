import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { clearFinancialData } from "@/lib/db";
import { monthlySelection, monthlyErrorResponse } from "@/lib/monthlyAuthority";

export const dynamic = "force-dynamic";

export const DELETE = requireAuth(async (req, { userId, supabase }) => {
  const requestId = crypto.randomUUID();
  try {
    // Never fall back to separate deletes if the RPC/migration is unavailable.
    await clearFinancialData(userId, supabase,monthlySelection(req.nextUrl.searchParams),requestId);
    return NextResponse.json({ success: true },{headers:{"Cache-Control":"no-store"}});
  } catch (err) {
    const authorityFailure=monthlyErrorResponse(err);
    if(authorityFailure){const {status,...body}=authorityFailure;return NextResponse.json({...body,requestId},{status,headers:{"Cache-Control":"no-store"}});}
    const message = err instanceof Error ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message : "Unknown clear-data failure";
    console.error("data:clear:error", { requestId, userId, message });
    return NextResponse.json(
      { error: "Clear could not be confirmed. Refresh the dashboard before retrying.", requestId },
      { status: 500,headers:{"Cache-Control":"no-store"} }
    );
  }
});
