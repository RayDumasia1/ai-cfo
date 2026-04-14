import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { dismissAlert } from "@/lib/db";
import type { SnoozeType } from "@/lib/types";

const UNSNOOZABLE = new Set(["RUNWAY_DANGER", "CASH_BELOW_RESERVE"]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { alert_code?: string; snooze_type?: SnoozeType };
  const { alert_code, snooze_type } = body;

  if (!alert_code || !snooze_type) {
    return NextResponse.json(
      { error: "alert_code and snooze_type are required" },
      { status: 400 }
    );
  }

  if (UNSNOOZABLE.has(alert_code)) {
    return NextResponse.json(
      { error: "Danger alerts cannot be dismissed" },
      { status: 403 }
    );
  }

  // Get current data_version from business_profiles
  const { data: profileData } = await supabase
    .from("business_profiles")
    .select("data_version")
    .eq("user_id", user.id)
    .maybeSingle();

  const dataVersion = profileData?.data_version ?? null;

  // Calculate snooze_until
  let snoozeUntil: string | null = null;
  if (snooze_type === "24h") {
    snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else if (snooze_type === "7d") {
    snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  // data_reload → snooze_until stays null

  await dismissAlert(
    user.id,
    {
      alert_code,
      snooze_type,
      snooze_until: snoozeUntil,
      data_version: dataVersion,
    },
    supabase
  );

  return NextResponse.json({ success: true });
}
