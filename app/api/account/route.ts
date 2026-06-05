import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { createServiceClient } from "@/utils/supabase/service";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async (_req: NextRequest, { userId, email, supabase }) => {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("business_name, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }

  return NextResponse.json({
    business_name: data?.business_name ?? null,
    email,
    created_at: data?.created_at ?? null,
  });
});

export const PATCH = requireAuth(async (req: NextRequest, { userId }) => {
  let body: { business_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.business_name !== "string") {
    return NextResponse.json({ error: "business_name must be a string" }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("business_profiles")
    .update({ business_name: body.business_name.trim() || null })
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to update business name" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
