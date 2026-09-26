import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPaidSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/auth?error=Email+link+expired", req.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/auth?error=Email+link+expired", req.url));
  }

  if (!(await hasPaidSubscription(data.user.id, supabase))) {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }

  return NextResponse.redirect(new URL("/dashboard", req.url));
}
