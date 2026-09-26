import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "./utils/supabase/middleware";
import { hasPaidSubscription } from "./lib/db";

const AUTH_BYPASS_PATHS = [
  "/auth/signup",
  "/auth/verify",
  "/auth/callback",
  "/auth/reset-password",
];

// Reachable by signed-in users who have not yet chosen a plan.
// /api/stripe/webhook has no user session, so it always passes through.
const ALLOWED_WITHOUT_SUBSCRIPTION_PREFIXES = [
  "/welcome",
  "/auth/callback",
  "/api/auth",
  "/api/stripe",
  "/api/founding",
];

export async function proxy(request: NextRequest) {
  const { supabase, supabaseResponse } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  if (AUTH_BYPASS_PATHS.some((path) => pathname.startsWith(path))) {
    return supabaseResponse;
  }

  if (pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(
      new URL("/auth?reason=session_expired", request.url)
    );
  }

  if (user) {
    if (!user.email_confirmed_at) {
      if (isApi) return supabaseResponse;
      return NextResponse.redirect(
        new URL(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`, request.url)
      );
    }

    if (pathname === "/auth") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    const isAllowed = ALLOWED_WITHOUT_SUBSCRIPTION_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
    if (!isAllowed && !(await hasPaidSubscription(user.id, supabase))) {
      if (isApi) {
        return NextResponse.json(
          { error: "An active subscription is required" },
          { status: 402 }
        );
      }
      return NextResponse.redirect(new URL("/welcome", request.url));
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
  matcher: [
    "/dashboard/:path*",
    "/auth",
    "/auth/:path*",
    "/welcome",
    "/welcome/:path*",
    "/api/:path*",
  ],
};
