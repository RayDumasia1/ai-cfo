import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logSessionEvent } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * Server-side login endpoint.
 *
 * Security: Using the server client means Supabase sets the session
 * cookie server-side with HttpOnly and Secure flags, preventing
 * client-side JavaScript from reading the raw token.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      await logSessionEvent({
        userId: "unknown",
        action: "failed_login",
        userAgent: req.headers.get("user-agent") ?? undefined,
        reason: error.message,
        status: "failure",
      });
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    await logSessionEvent({
      userId: data.user.id,
      action: "login",
      userAgent: req.headers.get("user-agent") ?? undefined,
      status: "success",
    });

    return NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("login:error", message);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
