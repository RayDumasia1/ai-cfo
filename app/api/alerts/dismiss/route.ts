import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { dismissAlert } from "@/lib/db";
import { isSnoozeType } from "@/lib/alertPreferences";
import { isDismissibleAlertCode, isProtectedAlertCode } from "@/lib/alertPolicy";

export const POST = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const { alert_code, snooze_type } = body as Record<string, unknown>;
  if (typeof alert_code !== "string" || !isSnoozeType(snooze_type)) {
    return NextResponse.json({ error: "A valid alert_code and snooze_type are required." }, { status: 400 });
  }
  if (isProtectedAlertCode(alert_code)) {
    return NextResponse.json({ error: "Danger alerts cannot be dismissed" }, { status: 403 });
  }
  if (!isDismissibleAlertCode(alert_code)) {
    return NextResponse.json({ error: "Invalid alert_code." }, { status: 400 });
  }

  const requestId = crypto.randomUUID();
  try {
    const { data: profileData, error } = await supabase
      .from("business_profiles")
      .select("data_version")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const dataVersion = profileData?.data_version ?? null;
    if (snooze_type === "data_reload" && !dataVersion) {
      return NextResponse.json(
        { error: "Import data before snoozing until the next import." },
        { status: 409 }
      );
    }
    const duration = snooze_type === "24h" ? 24 * 60 * 60 * 1000
      : snooze_type === "7d" ? 7 * 24 * 60 * 60 * 1000 : null;
    const snoozeUntil = duration === null ? null : new Date(Date.now() + duration).toISOString();
    await dismissAlert(userId, {
      alert_code, snooze_type, snooze_until: snoozeUntil, data_version: dataVersion,
    }, supabase);
    return NextResponse.json({ success: true });
  } catch {
    console.error("alerts:dismiss:error", { requestId, userId });
    return NextResponse.json({ error: "Failed to dismiss alert.", requestId }, { status: 500 });
  }
});
