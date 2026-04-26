import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { getAlertPreferences, updateAlertPreferences } from "@/lib/db";
import type { SnoozeType } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async (_req, { userId, supabase }) => {
  try {
    const prefs = await getAlertPreferences(userId, supabase);
    return NextResponse.json(prefs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

export const PATCH = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
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
      userId,
      { snooze_duration: snooze_duration as SnoozeType },
      supabase
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
