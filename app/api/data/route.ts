import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { logDataImport } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { error: delMonthsErr } = await supabase
      .from("financial_months")
      .delete()
      .eq("user_id", user.id);

    if (delMonthsErr) throw delMonthsErr;

    const { error: delCatsErr } = await supabase
      .from("expense_categories")
      .delete()
      .eq("user_id", user.id);

    if (delCatsErr) throw delCatsErr;

    // Reset financial settings on the profile — keep the record, null out the numbers.
    const { error: resetProfileErr } = await supabase
      .from("business_profiles")
      .update({
        min_cash_reserve: null,
        runway_warning_threshold: 6,
        runway_danger_threshold: 3,
        burn_rate_warning_pct: 0.1,
        invoice_overdue_days: 30,
      })
      .eq("user_id", user.id);

    if (resetProfileErr) throw resetProfileErr;

    await logDataImport(
      user.id,
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
    console.error("data:clear:error", { userId: user.id, message });
    return NextResponse.json(
      { error: "Failed to clear data", detail: message },
      { status: 500 }
    );
  }
}
