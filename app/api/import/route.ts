import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseExcelBuffer } from "@/lib/excelParser";
import {
  getOrCreateBusinessProfile,
  upsertBusinessProfile,
  upsertFinancialMonths,
  logDataImport,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  console.log("import:start", { requestId });

  let userId: string | null = null;
  let filename: string | null = null;

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
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

    // ── File ────────────────────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    filename = file?.name ?? null;

    console.log("import:file", {
      requestId,
      exists: !!file,
      name: file?.name ?? null,
      size: file?.size ?? null,
      type: file?.type ?? null,
    });

    if (!file) {
      console.warn("import:no-file", { requestId, userId });
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // ── Parse ───────────────────────────────────────────────────────────────
    console.log("import:parse:start", {
      requestId,
      userId,
      filename,
    });

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
        {
          success: false,
          errors: parsed.errors,
          requestId,
        },
        { status: 400 }
      );
    }

    // ── DB ──────────────────────────────────────────────────────────────────
    console.log("import:db:start", {
      requestId,
      userId,
      filename,
    });

    await logDataImport(user.id, {
      import_type: "excel",
      filename: file.name,
      months_imported: 0,
      status: "pending",
      error_message: null,
    });

    const profile = await getOrCreateBusinessProfile(user.id, supabase);

    console.log("import:db:profile", {
      requestId,
      userId,
      profileId: profile.id,
    });

    if (Object.keys(parsed.profile).length > 0) {
      console.log("import:db:upsert-profile", {
        requestId,
        userId,
        profileFields: Object.keys(parsed.profile),
      });

      await upsertBusinessProfile(user.id, parsed.profile);
    }

    const months = parsed.months.map((m) => ({
      ...m,
      business_id: profile.id,
    }));

    console.log("import:db:upsert-months:start", {
      requestId,
      userId,
      count: months.length,
      firstMonth: months[0]?.month_date ?? null,
      lastMonth: months[months.length - 1]?.month_date ?? null,
    });

    await upsertFinancialMonths(user.id, months, supabase);

    console.log("import:db:upsert-months:success", {
      requestId,
      userId,
      count: months.length,
    });

    await logDataImport(user.id, {
      import_type: "excel",
      filename: file.name,
      months_imported: months.length,
      status: "success",
      error_message: null,
    });

    const sorted = months.map((m) => m.month_date).sort();
    const latestMonth = sorted[sorted.length - 1];
    const currentCash =
      months.find((m) => m.month_date === latestMonth)?.closing_cash ?? null;

    console.log("import:complete", {
      requestId,
      userId,
      filename,
      monthsImported: months.length,
      latestMonth,
      currentCash,
      warnings: parsed.warnings.length,
    });

    return NextResponse.json({
      success: true,
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
        await logDataImport(userId, {
          import_type: "excel",
          filename,
          months_imported: 0,
          status: "error",
          error_message: errorMessage,
        });
      } catch (logError) {
        console.error("import:error:logDataImport-failed", {
          requestId,
          userId,
          filename,
          message: logError instanceof Error ? logError.message : String(logError),
        });
      }
    }

    return NextResponse.json(
      {
        error: "Import failed",
        detail: errorMessage,
        requestId,
      },
      { status: 500 }
    );
  }
}