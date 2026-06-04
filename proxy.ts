import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "./utils/supabase/middleware";

const SUSPENDED_ALLOWLIST = [
  "/dashboard/suspended",
  "/api/stripe/checkout",
  "/api/founding/availability",
  "/api/auth",
  "/auth",
  "/dashboard/settings",
];

export async function proxy(request: NextRequest) {
  const { supabase, supabaseResponse } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(
      new URL("/auth?reason=session_expired", request.url)
    );
  }
  if (pathname === "/auth" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Redirect suspended founding members away from protected pages
  if (user) {
    const isAllowlisted = SUSPENDED_ALLOWLIST.some((p) => pathname.startsWith(p));
    if (!isAllowlisted) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("feature_tier")
        .eq("user_id", user.id)
        .maybeSingle();

      if (sub?.feature_tier === "suspended") {
        return NextResponse.redirect(
          new URL("/dashboard/suspended", request.url)
        );
      }
    }
  }

  // Prevent browsers from caching protected pages. Without this, the back
  // button after logout serves a stale cached copy, bypassing the auth check.
  if (pathname.startsWith("/dashboard")) {
    supabaseResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    supabaseResponse.headers.set("Pragma", "no-cache");
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth"],
};
