import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { logDataImport } from "@/lib/db";

export const dynamic = "force-dynamic";

export const DELETE = requireAuth(async (_req, { userId, supabase }) => {
  try {
    const { error: delMonthsErr } = await supabase
      .from("financial_months")
      .delete()
      .eq("user_id", userId);

    if (delMonthsErr) throw delMonthsErr;

    const { error: delCatsErr } = await supabase
      .from("expense_categories")
      .delete()
      .eq("user_id", userId);

    if (delCatsErr) throw delCatsErr;

    const { error: resetProfileErr } = await supabase
      .from("business_profiles")
      .update({
        min_cash_reserve: null,
        runway_warning_threshold: 6,
        runway_danger_threshold: 3,
        burn_rate_warning_pct: 0.1,
        invoice_overdue_days: 30,
      })
      .eq("user_id", userId);

    if (resetProfileErr) throw resetProfileErr;

    await logDataImport(
      userId,
      {
        import_type: "manual",
        filename: null,
        months_imported: 0,
        status: "success",
        error_message: "User cleared data",
      },
      supabase
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("data:clear:error", { userId, message });
    return NextResponse.json(
      { error: "Failed to clear data", detail: message },
      { status: 500 }
    );
  }
});
