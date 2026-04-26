import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

export const PATCH = requireAuth(async (req: NextRequest, { email, supabase }) => {
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Re-authenticate to verify current password
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (signInError) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
});
