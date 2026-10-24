import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

function failure(error: string, code: string, status: number, phase?: string) {
  const requestId = phase ? crypto.randomUUID() : undefined;
  if (phase) console.error("auth:password:error", { requestId, phase });
  return NextResponse.json({ error, code, ...(requestId ? { requestId } : {}) }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

export const PATCH = requireAuth(async (req: NextRequest, { userId, email, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failure("Request body must be a JSON object", "INVALID_PASSWORD_INPUT", 400);
  }
  const { currentPassword, newPassword } = body as Record<string, unknown>;
  if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string" || !newPassword) {
    return failure("Current and new passwords must be non-empty strings", "INVALID_PASSWORD_INPUT", 400);
  }
  if (!email) return failure("An email account is required", "INVALID_PASSWORD_INPUT", 400);

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Re-authenticate to verify current password
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (signInError) {
    if (signInError.code === "invalid_credentials") {
      return failure("Current password is incorrect", "CURRENT_PASSWORD_INCORRECT", 400);
    }
    if (signInError.status === 429 || signInError.code === "over_request_rate_limit") {
      return failure("Too many attempts. Please wait and try again.", "PASSWORD_RATE_LIMITED", 429);
    }
    return failure("Password verification is temporarily unavailable", "PASSWORD_CHANGE_UNAVAILABLE", 503, "reauthenticate");
  }
  // Do not update credentials unless the provider confirms the original account.
  if (signInData?.user?.id !== userId || signInData?.session?.user?.id !== userId) {
    return failure("Could not verify your account", "PASSWORD_CHANGE_UNAVAILABLE", 503, "reauthenticate_identity");
  }

  const { data: updateData, error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    if (updateError.status === 429 || updateError.code === "over_request_rate_limit") {
      return failure("Too many attempts. Please wait and try again.", "PASSWORD_RATE_LIMITED", 429);
    }
    if (updateError.code === "weak_password" || updateError.code === "same_password") {
      return failure("Choose a different password that meets the account password policy.", "PASSWORD_REJECTED", 422);
    }
    return failure("Failed to update password", "PASSWORD_CHANGE_FAILED", 500, "update");
  }
  if (updateData?.user?.id !== userId) {
    return failure("Could not confirm password update", "PASSWORD_CHANGE_FAILED", 500, "update_identity");
  }

  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
});
