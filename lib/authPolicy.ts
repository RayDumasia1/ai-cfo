import type { User } from "@supabase/supabase-js";

/** Use the validated Auth user, never request fields or editable user metadata. */
export function hasVerifiedEmail(user: Pick<User, "email_confirmed_at">): boolean {
  return Boolean(user.email_confirmed_at);
}

export function emailVerificationRequired(): Response {
  return Response.json({
    error: "Please verify your email before continuing.",
    code: "EMAIL_NOT_VERIFIED",
  }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
