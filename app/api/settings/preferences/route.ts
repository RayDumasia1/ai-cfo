import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAlertPreferences, updateAlertPreferences } from "@/lib/db";
import type { SnoozeType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prefs = await getAlertPreferences(user.id, supabase);
    return NextResponse.json(prefs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { snooze_duration } = body as Record<string, unknown>;
  const valid: SnoozeType[] = ["data_reload", "24h", "7d"];

  if (!valid.includes(snooze_duration as SnoozeType)) {
    return NextResponse.json(
      { error: "Invalid snooze_duration value." },
      { status: 400 }
    );
  }

  try {
    await updateAlertPreferences(
      user.id,
      { snooze_duration: snooze_duration as SnoozeType },
      supabase
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
