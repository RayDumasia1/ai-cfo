import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseExcelBuffer } from "@/lib/excelParser";
import {
  getOrCreateBusinessProfile,
  upsertBusinessProfile,
  logDataImport,
  getSubscription,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  console.log("import:start", { requestId });

  let userId: string | null = null;
  let filename: string | null = null;

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    userId = user?.id ?? null;

    console.log("import:auth", {
      requestId,
      userId,
      authError: authError?.message ?? null,
    });

    if (!user) {
      console.warn("import:unauthorized", { requestId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── File ──────────────────────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    filename = file?.name ?? null;

    console.log("import:file", {
      requestId,
      exists: !!file,
      name: file?.name ?? null,
      size: file?.size ?? null,
    });

    if (!file) {
      console.warn("import:no-file", { requestId, userId });
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // ── Parse ─────────────────────────────────────────────────────────────────
    console.log("import:parse:start", { requestId, userId, filename });

    const buffer = await file.arrayBuffer();
    const parsed = parseExcelBuffer(buffer);

    console.log("import:parse:result", {
      requestId,
      userId,
      filename,
      months: parsed.months.length,
      warnings: parsed.warnings.length,
      errors: parsed.errors.length,
    });

    if (parsed.errors.length > 0) {
      console.warn("import:parse:errors", {
        requestId,
        userId,
        filename,
        errors: parsed.errors,
      });

      return NextResponse.json(
        { success: false, errors: parsed.errors, requestId },
        { status: 400 }
      );
    }

    // ── Check for existing data ───────────────────────────────────────────────
    const { count: existingCount } = await supabase
      .from("financial_months")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const isReplacing = (existingCount ?? 0) > 0;

    console.log("import:db:existing", {
      requestId,
      userId,
      existingCount,
      isReplacing,
    });

    // Log the pending import
    await logDataImport(
      user.id,
      {
        import_type: "excel",
        filename: file.name,
        months_imported: 0,
        status: "pending",
        error_message: null,
      },
      supabase
    );

    // ── Replace strategy: delete all existing rows first ─────────────────────
    if (isReplacing) {
      console.log("import:db:delete:start", { requestId, userId });

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

      console.log("import:db:delete:success", { requestId, userId });
    }

    // ── Profile ───────────────────────────────────────────────────────────────
    const profile = await getOrCreateBusinessProfile(user.id, supabase);

    if (Object.keys(parsed.profile).length > 0) {
      console.log("import:db:upsert-profile", {
        requestId,
        userId,
        profileFields: Object.keys(parsed.profile),
      });
      await upsertBusinessProfile(user.id, parsed.profile, supabase);
    }

    // ── Insert months ─────────────────────────────────────────────────────────
    const months = parsed.months.map((m) => ({
      ...m,
      user_id: user.id,
      business_id: profile.id,
    }));

    console.log("import:db:insert:start", {
      requestId,
      userId,
      count: months.length,
      firstMonth: months[0]?.month_date ?? null,
      lastMonth: months[months.length - 1]?.month_date ?? null,
    });

    if (months.length > 0) {
      const { error: insertErr } = await supabase
        .from("financial_months")
        .insert(months);

      if (insertErr) throw insertErr;
    }

    console.log("import:db:insert:success", {
      requestId,
      userId,
      count: months.length,
    });

    // Stamp data_version so 'snooze until data reload' dismissals expire.
    const dataVersion = new Date().toISOString();
    await supabase
      .from("business_profiles")
      .update({ data_version: dataVersion })
      .eq("user_id", user.id);

    await logDataImport(
      user.id,
      {
        import_type: "excel",
        filename: file.name,
        months_imported: months.length,
        status: "success",
        error_message: null,
      },
      supabase
    );

    // Ensure a subscription row exists for every user who imports data.
    await getSubscription(user.id, supabase);

    const sorted = months.map((m) => m.month_date).sort();
    const latestMonth = sorted[sorted.length - 1];
    const currentCash =
      months.find((m) => m.month_date === latestMonth)?.closing_cash ?? null;

    console.log("import:complete", {
      requestId,
      userId,
      filename,
      monthsImported: months.length,
      isReplacing,
      latestMonth,
      currentCash,
    });

    return NextResponse.json({
      success: true,
      replaced: isReplacing,
      monthsImported: months.length,
      warnings: parsed.warnings,
      dateRange: { from: sorted[0], to: latestMonth },
      currentCash,
      requestId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : null;

    console.error("import:error", {
      requestId,
      userId,
      filename,
      message: errorMessage,
      stack: errorStack,
    });

    if (userId && filename) {
      try {
        const supabase = await createClient();
        await logDataImport(
          userId,
          {
            import_type: "excel",
            filename,
            months_imported: 0,
            status: "error",
            error_message: errorMessage,
          },
          supabase
        );
      } catch (logError) {
        console.error("import:error:log-failed", {
          requestId,
          message:
            logError instanceof Error ? logError.message : String(logError),
        });
      }
    }

    return NextResponse.json(
      { error: "Import failed", detail: errorMessage, requestId },
      { status: 500 }
    );
  }
}
