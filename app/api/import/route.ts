import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { parseExcelBuffer } from "@/lib/excelParser";
import {
  getOrCreateBusinessProfile,
  upsertBusinessProfile,
  upsertFinancialMonths,
  logDataImport,
} from "@/lib/db";

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── File ──────────────────────────────────────────────────────────────────
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  const buffer = await file.arrayBuffer();
  const parsed = parseExcelBuffer(buffer);

  if (parsed.errors.length > 0) {
    return NextResponse.json(
      { success: false, errors: parsed.errors },
      { status: 400 }
    );
  }

  // ── DB ────────────────────────────────────────────────────────────────────
  try {
    // Log pending import for audit trail
    await logDataImport(user.id, {
      import_type: "excel",
      filename: file.name,
      months_imported: 0,
      status: "pending",
      error_message: null,
    });

    // Ensure profile exists; update with parsed business info if present
    const profile = await getOrCreateBusinessProfile(user.id, supabase);
    if (Object.keys(parsed.profile).length > 0) {
      await upsertBusinessProfile(user.id, parsed.profile);
    }

    // Upsert financial months (server client carries RLS auth context)
    const months = parsed.months.map((m) => ({
      ...m,
      business_id: profile.id,
    }));
    await upsertFinancialMonths(user.id, months, supabase);

    // Log success
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

    return NextResponse.json({
      success: true,
      monthsImported: months.length,
      warnings: parsed.warnings,
      dateRange: { from: sorted[0], to: latestMonth },
      currentCash,
    });
  } catch (err) {
    await logDataImport(user.id, {
      import_type: "excel",
      filename: file.name,
      months_imported: 0,
      status: "error",
      error_message: String(err),
    });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
