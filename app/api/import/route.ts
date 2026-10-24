import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { parseExcelBuffer } from "@/lib/excelParser";
import {
  WORKBOOK_BUSINESS_FIELDS, WORKBOOK_BUSINESS_WARNING,
  WORKBOOK_THRESHOLD_FIELDS, WORKBOOK_THRESHOLD_WARNING,
} from "@/lib/financialImportPolicy";
import { hasVerifiedEmail, emailVerificationRequired } from "@/lib/authPolicy";
import {
  hasPaidSubscription,
  replaceFinancialImport,
  logDataImport,
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

    if (authError || !user) {
      console.warn("import:unauthorized", { requestId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasVerifiedEmail(user)) return emailVerificationRequired();
    if (!(await hasPaidSubscription(user.id, supabase))) {
      return NextResponse.json(
        { error: "An active subscription is required" },
        { status: 402, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ── File ──────────────────────────────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid upload form" }, { status: 400 });
    }
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    filename = file.name;

    console.log("import:file", {
      requestId,
      exists: !!file,
      name: file?.name ?? null,
      size: file?.size ?? null,
    });

    const buffer = await file.arrayBuffer();
    let parsed;
    try {
      parsed = parseExcelBuffer(buffer);
    } catch {
      return NextResponse.json(
        { error: "The file could not be read. Please upload a valid workbook.", requestId },
        { status: 400 }
      );
    }
    if (parsed.months.length === 0 && parsed.errors.length === 0) {
      parsed.errors.push("The workbook must contain at least one financial month.");
    }
    const dates = new Set<string>();
    for (const month of parsed.months) {
      if (dates.has(month.month_date)) {
        parsed.errors.push(`Duplicate month: ${month.month_date}. Include each month only once.`);
      }
      dates.add(month.month_date);
      if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month.month_date)) {
        parsed.errors.push(`Invalid month: ${month.month_date}.`);
      }
    }
    if ([...parsed.months, parsed.profile].some(row =>
      Object.values(row).some(value => typeof value === "number" && !Number.isFinite(value))
    )) {
      parsed.errors.push("Financial and business profile numbers must be finite.");
    }

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

    if (WORKBOOK_THRESHOLD_FIELDS.some(field => Object.hasOwn(parsed.profile, field))) {
      parsed.warnings.push(WORKBOOK_THRESHOLD_WARNING);
    }
    if (WORKBOOK_BUSINESS_FIELDS.some(field => Object.hasOwn(parsed.profile, field))) {
      parsed.warnings.push(WORKBOOK_BUSINESS_WARNING);
    }

    // All replacement writes, the data version, and the success audit commit
    // together. Missing RPC/migration or any database error must fail closed.
    const { replaced: isReplacing } = await replaceFinancialImport(
      user.id, parsed.months, parsed.profile, file.name, createServiceClient()
    );
    const months = parsed.months;

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
    const errorMessage = err instanceof Error ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message : "Unknown import failure";
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
      { error: "Import failed. Your replacement could not be confirmed. Please refresh before retrying.", requestId },
      { status: 500 }
    );
  }
}
