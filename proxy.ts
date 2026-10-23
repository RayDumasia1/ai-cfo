import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "./utils/supabase/middleware";
import { hasPaidSubscription } from "./lib/db";
import { hasVerifiedEmail, emailVerificationRequired } from "./lib/authPolicy";

// Unauthenticated, CDN-cached endpoints (e.g. the marketing site's Founding
// Member counter). Skipped before any auth lookup so no cookies are set.
const PUBLIC_PATHS = ["/api/public/"];
// Stripe authenticates its webhook in the route using the raw-body signature.
// User cookies and Auth availability must not interfere with delivery.
const SESSION_INDEPENDENT_PATHS = new Set(["/api/stripe/webhook"]);
const ALLOWED_WITHOUT_EMAIL_VERIFICATION = new Set(["/api/auth/login", "/api/auth/logout"]);

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
// Joining a coming-soon list does not require purchasing a current plan.
// Keep this exact so unrelated endpoints retain their subscription guard.
const ALLOWED_WITHOUT_SUBSCRIPTION_PATHS = new Set(["/api/notify-me"]);

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path)) ||
      SESSION_INDEPENDENT_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const { supabase, finishResponse } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  if (AUTH_BYPASS_PATHS.some((path) => pathname.startsWith(path))) {
    return finishResponse();
  }

  if (pathname.startsWith("/dashboard") && !user) {
    return finishResponse(NextResponse.redirect(
      new URL("/auth?reason=session_expired", request.url)
    ));
  }

  if (user) {
    if (!hasVerifiedEmail(user)) {
      if (isApi) {
        if (ALLOWED_WITHOUT_EMAIL_VERIFICATION.has(pathname)) return finishResponse();
        return finishResponse(emailVerificationRequired());
      }
      return finishResponse(NextResponse.redirect(
        new URL(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`, request.url)
      ));
    }

    if (pathname === "/auth") {
      return finishResponse(NextResponse.redirect(new URL("/dashboard", request.url)));
    }

    const isAllowed = ALLOWED_WITHOUT_SUBSCRIPTION_PATHS.has(pathname) || ALLOWED_WITHOUT_SUBSCRIPTION_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
    if (!isAllowed && !(await hasPaidSubscription(user.id, supabase))) {
      if (isApi) {
        return finishResponse(NextResponse.json(
          { error: "An active subscription is required" },
          { status: 402 }
        ));
      }
      return finishResponse(NextResponse.redirect(new URL("/welcome", request.url)));
    }
  }

  // Prevent browsers from caching protected pages. Without this, the back
  // button after logout serves a stale cached copy, bypassing the auth check.
  const supabaseResponse = finishResponse();
  if (pathname.startsWith("/dashboard")) {
    if (!supabaseResponse.headers.has("Cache-Control")) {
      supabaseResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    }
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
