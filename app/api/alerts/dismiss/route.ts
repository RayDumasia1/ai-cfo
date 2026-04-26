import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { dismissAlert } from "@/lib/db";
import type { SnoozeType } from "@/lib/types";

const UNSNOOZABLE = new Set(["RUNWAY_DANGER", "CASH_BELOW_RESERVE"]);

export const POST = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  const body = (await req.json()) as {
    alert_code?: string;
    snooze_type?: SnoozeType;
  };
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

  const { data: profileData } = await supabase
    .from("business_profiles")
    .select("data_version")
    .eq("user_id", userId)
    .maybeSingle();

  const dataVersion = profileData?.data_version ?? null;

  let snoozeUntil: string | null = null;
  if (snooze_type === "24h") {
    snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else if (snooze_type === "7d") {
    snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  await dismissAlert(
    userId,
    {
      alert_code,
      snooze_type,
      snooze_until: snoozeUntil,
      data_version: dataVersion,
    },
    supabase
  );

  return NextResponse.json({ success: true });
});
