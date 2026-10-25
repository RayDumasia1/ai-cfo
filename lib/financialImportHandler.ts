import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { parseExcelBuffer } from "@/lib/excelParser";
import { buildImportReview } from "@/lib/financialImportReview";
import { importFileHash, issueImportReviewToken, verifyImportReviewToken } from "@/lib/financialImportReviewToken";
import {
  WORKBOOK_BUSINESS_FIELDS, WORKBOOK_BUSINESS_WARNING,
  WORKBOOK_THRESHOLD_FIELDS, WORKBOOK_THRESHOLD_WARNING,
  DEFAULT_IMPORT_MODE, isFinancialImportMode,
} from "@/lib/financialImportPolicy";
import { hasVerifiedEmail, emailVerificationRequired } from "@/lib/authPolicy";
import {
  FinancialUploadLimitError,
  MAX_FINANCIAL_MONTHS,
  MAX_FINANCIAL_REQUEST_BYTES,
  boundedImportErrors,
  validateFinancialArchive,
  validateFinancialFileMetadata,
} from "@/lib/financialUploadLimits";
import {
  hasPaidSubscription,
  getFinancialImportReviewState,
  commitReviewedFinancialImport,
  logDataImport,
} from "@/lib/db";



export async function handleFinancialImport(request: NextRequest, operation: "review" | "confirm" | "legacy") {
  const requestId = crypto.randomUUID();

  console.log("import:start", { requestId });

  let userId: string | null = null;
  let filename: string | null = null;
  let commitAttempted = false;

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

    if (operation === "legacy") {
      return NextResponse.json({ error: "Review this upload before importing. Refresh the page to continue.",
        code: "IMPORT_REVIEW_REQUIRED", requestId }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_FINANCIAL_REQUEST_BYTES) {
      return NextResponse.json({
        error: "The upload request is too large. Upload a file of 2 MB or less.",
        code: "IMPORT_REQUEST_TOO_LARGE",
        requestId,
      }, { status: 413, headers: { "Cache-Control": "no-store" } });
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
    try {
      validateFinancialFileMetadata(file);
    } catch (error) {
      if (error instanceof FinancialUploadLimitError) {
        return NextResponse.json({ error: error.message, code: error.code, requestId },
          { status: error.code === "IMPORT_FILE_TOO_LARGE" ? 413 : 400, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    filename = file.name;
    const modes = formData.getAll("mode");
    const mode = modes.length === 0 ? DEFAULT_IMPORT_MODE : modes[0];
    if (modes.length > 1 || !isFinancialImportMode(mode)) {
      return NextResponse.json({ error: "Choose update months or replace all data.", requestId }, { status: 400 });
    }

    console.log("import:file", {
      requestId,
      exists: !!file,
      name: file?.name ?? null,
      size: file?.size ?? null,
    });

    const buffer = await file.arrayBuffer();
    try {
      validateFinancialArchive(buffer, file.name);
    } catch (error) {
      if (error instanceof FinancialUploadLimitError) {
        return NextResponse.json({ error: error.message, code: error.code, requestId },
          { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    const identity = { userId: user.id, mode, filename: file.name, fileHash: importFileHash(buffer) };
    let expectedState: string | null = null;
    if (operation === "confirm") {
      const tokens = formData.getAll("reviewToken");
      if (tokens.length === 1 && typeof tokens[0] === "string") {
        expectedState = verifyImportReviewToken(tokens[0], identity);
      }
      if (!expectedState) {
        return NextResponse.json({ error: "This review expired or no longer matches the file. Select the file and review it again.",
          code: "IMPORT_REVIEW_REQUIRED", requestId }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
    }
    let parsed;
    try {
      parsed = parseExcelBuffer(buffer, file.name);
    } catch (error) {
      if (error instanceof FinancialUploadLimitError) {
        return NextResponse.json({ error: error.message, code: error.code, requestId },
          { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json(
        { error: "The file could not be read. Please upload a valid workbook.", requestId },
        { status: 400 }
      );
    }
    if (parsed.months.length > MAX_FINANCIAL_MONTHS) {
      parsed.errors.push(`The file contains more than ${MAX_FINANCIAL_MONTHS} financial months. Import no more than 20 years at a time.`);
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
      contractVersion: parsed.contractVersion ?? 1,
      months: parsed.months.length,
      warnings: parsed.warnings.length,
      errors: parsed.errors.length,
    });

    if (parsed.errors.length > 0) {
      const safeErrors = boundedImportErrors(parsed.errors);
      console.warn("import:parse:errors", {
        requestId,
        userId,
        filename,
        errors: safeErrors,
      });

      return NextResponse.json(
        { success: false, errors: safeErrors, requestId },
        { status: 400 }
      );
    }

    if (WORKBOOK_THRESHOLD_FIELDS.some(field => Object.hasOwn(parsed.profile, field))) {
      parsed.warnings.push(WORKBOOK_THRESHOLD_WARNING);
    }
    if (WORKBOOK_BUSINESS_FIELDS.some(field => Object.hasOwn(parsed.profile, field))) {
      parsed.warnings.push(WORKBOOK_BUSINESS_WARNING);
    }

    if (operation === "review") {
      const state = await getFinancialImportReviewState(user.id, createServiceClient());
      const review = buildImportReview(file.name, mode, parsed.months.map(month => month.month_date), state, parsed.warnings, parsed.notices);
      const reviewToken = issueImportReviewToken(identity, state.state_version);
      return NextResponse.json({ success: true, review, reviewToken, requestId }, { headers: { "Cache-Control": "no-store" } });
    }

    // All replacement writes, the data version, and the success audit commit
    // together. Missing RPC/migration or any database error must fail closed.
    commitAttempted = true;
    const result = await commitReviewedFinancialImport(
      user.id, parsed.months, parsed.profile, file.name, mode, expectedState!, createServiceClient()
    );
    const months = parsed.months;

    const latestMonth = result.date_to;
    const currentCash = result.current_cash;

    console.log("import:complete", {
      requestId,
      userId,
      filename,
      monthsImported: months.length,
      isReplacing: result.replaced,
      mode,
      latestMonth,
      currentCash,
    });

    return NextResponse.json({
      success: true,
      replaced: result.replaced,
      mode,
      monthsTotal: result.months_total,
      monthsImported: months.length,
      warnings: parsed.warnings,
      dateRange: { from: result.date_from, to: latestMonth },
      currentCash,
      requestId,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P0001" &&
      "message" in err && err.message === "import_review_stale") {
      return NextResponse.json({ error: "Your financial data changed since this review. Select the file and review it again.",
        code: "IMPORT_REVIEW_STALE", requestId }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
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

    if (commitAttempted && userId && filename) {
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
      { error: operation === "review" ? "The upload could not be reviewed. Please try again."
        : "Import failed. Your replacement could not be confirmed. Please refresh before retrying.", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
