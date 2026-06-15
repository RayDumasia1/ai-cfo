import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "./utils/supabase/middleware";
import { getSubscription } from "./lib/db";

const AUTH_BYPASS_PATHS = [
  "/auth/signup",
  "/auth/verify",
  "/auth/callback",
  "/auth/reset-password",
];

const ALLOWED_WITHOUT_SUBSCRIPTION_PREFIXES = [
  "/welcome",
  "/auth/callback",
  "/api/stripe",
  "/api/founding",
];

export async function proxy(request: NextRequest) {
  const { supabase, supabaseResponse } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

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
      return NextResponse.redirect(
        new URL(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`, request.url)
      );
    }

    if (pathname === "/auth") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    const subscription = await getSubscription(user.id, supabase);
    const hasActiveSubscription =
      subscription.status === "active" || subscription.status === "pending_cancellation";

    if (!hasActiveSubscription) {
      const isAllowed = ALLOWED_WITHOUT_SUBSCRIPTION_PREFIXES.some((prefix) =>
        pathname.startsWith(prefix)
      );
      if (!isAllowed) {
        return NextResponse.redirect(new URL("/welcome", request.url));
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
  matcher: ["/dashboard/:path*", "/auth", "/auth/:path*", "/welcome/:path*", "/welcome"],
};
