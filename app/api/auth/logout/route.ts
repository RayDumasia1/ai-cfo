import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { logSessionEvent } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    if (user) {
      await logSessionEvent({
        userId: user.id,
        action: "logout",
        userAgent: req.headers.get("user-agent") ?? undefined,
        reason: "manual logout",
        status: "success",
      });
    }

    return NextResponse.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("logout:error", message);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
