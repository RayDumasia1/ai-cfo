import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { upsertBusinessProfile } from "@/lib/db";
import { validateBusinessName } from "@/lib/businessName";

export const dynamic = "force-dynamic";

function profileFailure(phase: "load" | "save", userId: string) {
  const requestId = crypto.randomUUID();
  console.error(`account:profile:${phase}:error`, { requestId, userId });
  return NextResponse.json({ error: "Could not complete profile request.", requestId }, {
    status: 500, headers: { "Cache-Control": "no-store" },
  });
}

export const GET = requireAuth(async (_req: NextRequest, { userId, email, supabase }) => {
  try {
    const { data, error } = await supabase
      .from("business_profiles")
      .select("business_name, created_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      business_name: data?.business_name ?? null,
      email,
      created_at: data?.created_at ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return profileFailure("load", userId);
  }
});

export const PATCH = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = validateBusinessName(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const profile = await upsertBusinessProfile(userId, { business_name: parsed.value }, supabase);
    if (!profile || profile.user_id !== userId || profile.business_name !== parsed.value) {
      throw new Error("Unconfirmed business name update");
    }
    return NextResponse.json({ success: true, business_name: profile.business_name }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return profileFailure("save", userId);
  }
});
