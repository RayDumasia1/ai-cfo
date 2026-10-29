import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { getAlertPreferences, updateAlertPreferences } from "@/lib/db";
import { isSnoozeType } from "@/lib/alertPreferences";
import { monthlyErrorResponse } from "@/lib/monthlyAuthority";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async (_req, { userId, supabase }) => {
  const requestId = crypto.randomUUID();
  try {
    const prefs = await getAlertPreferences(userId, supabase);
    if (!isSnoozeType(prefs.snooze_duration)) throw new Error("Invalid stored preference");
    return NextResponse.json(prefs, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("settings:preferences:load:error", { userId, requestId });
    return NextResponse.json({ error: "Failed to load alert preferences.", requestId }, { status: 500 });
  }
});

export const PATCH = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const { snooze_duration } = body as Record<string, unknown>;
  if (!isSnoozeType(snooze_duration)) {
    return NextResponse.json(
      { error: "Invalid snooze_duration value." },
      { status: 400 }
    );
  }

  const requestId = crypto.randomUUID();
  try {
    await updateAlertPreferences(
      userId,
      { snooze_duration },
      supabase
    );
    return NextResponse.json({ success: true });
  } catch(error) {
    const mapped=monthlyErrorResponse(error);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    console.error("settings:preferences:save:error", { userId, requestId });
    return NextResponse.json({ error: "Failed to save alert preferences.", requestId }, { status: 500 });
  }
});
