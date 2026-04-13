import "server-only";
import * as XLSX from "xlsx";
import type { FinancialMonthInsert, BusinessProfileInsert } from "./types";

export interface ParseResult {
  months: Omit<FinancialMonthInsert, "user_id" | "business_id">[];
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>;
  errors: string[];
  warnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a header string for case/whitespace-insensitive matching. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Map normalised header → FinancialMonth field name.
 * Returns null for unknown headers (ignored silently).
 */
function headerToField(
  header: string
): keyof Omit<FinancialMonthInsert, "user_id" | "business_id"> | null {
  const h = norm(header);
  if (h === "month" || h === "date") return "month_date";
  if (h === "opening cash" || h === "opening balance") return "opening_cash";
  if (h === "closing cash" || h === "closing balance") return "closing_cash";
  if (h === "revenue" || h === "total revenue") return "total_revenue";
  if (h === "expenses" || h === "total expenses") return "total_expenses";
  if (h === "payroll") return "payroll";
  if (h === "ar" || h === "accounts receivable") return "ar_outstanding";
  if (h === "ap" || h === "accounts payable") return "ap_outstanding";
  if (h === "notes") return "notes";
  return null;
}

const REQUIRED_FIELDS: Array<
  keyof Omit<FinancialMonthInsert, "user_id" | "business_id">
> = ["month_date", "opening_cash", "closing_cash", "total_revenue", "total_expenses"];

const OPTIONAL_FIELDS: Array<
  keyof Omit<FinancialMonthInsert, "user_id" | "business_id">
> = ["payroll", "ar_outstanding", "ap_outstanding", "notes"];

/** Format a JS Date as YYYY-MM-01 (first of month). */
function toMonthDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Parse a cell value (Date object, Excel serial, or string) into YYYY-MM-01.
 * Returns null if unparseable.
 */
function parseMonthDate(raw: unknown): string | null {
  if (raw instanceof Date) return toMonthDate(raw);

  if (typeof raw === "number") {
    // Excel date serial — XLSX already converts with cellDates:true but handle
    // plain numbers as fallback.
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-01`;
    return null;
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    // "2024-01" or "2024-01-15"
    const iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-01`;

    // "Jan 2024" / "January 2024"
    const named = new Date(`1 ${s}`);
    if (!Number.isNaN(named.getTime())) return toMonthDate(named);

    // Fallback: any parseable date string
    const fallback = new Date(s);
    if (!Number.isNaN(fallback.getTime())) return toMonthDate(fallback);
  }

  return null;
}

/** Coerce a cell value to a non-negative number, or return null if empty/missing. */
function toNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return "NaN" as unknown as null; // sentinel for error detection
  return n;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const months: Omit<FinancialMonthInsert, "user_id" | "business_id">[] = [];
  let profile: Partial<Omit<BusinessProfileInsert, "user_id">> = {};

  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  // ── "Business Info" sheet (optional) ──────────────────────────────────────
  const infoSheet = workbook.Sheets["Business Info"];
  if (infoSheet) {
    const rows = XLSX.utils.sheet_to_json<[string, unknown]>(infoSheet, {
      header: 1,
    }) as [string, unknown][];

    for (const [key, value] of rows) {
      if (!key || !value) continue;
      const k = norm(String(key));
      if (k === "business name") {
        profile.business_name = String(value);
      } else if (k === "industry") {
        profile.industry = String(value);
      } else if (k === "min cash reserve" || k === "minimum cash reserve") {
        const n = Number(value);
        if (!Number.isNaN(n)) profile.min_cash_reserve = n;
      } else if (k === "runway warning threshold") {
        const n = Number(value);
        if (!Number.isNaN(n)) profile.runway_warning_threshold = n;
      } else if (k === "runway danger threshold") {
        const n = Number(value);
        if (!Number.isNaN(n)) profile.runway_danger_threshold = n;
      }
    }
  }

  // ── "Monthly Summary" sheet ────────────────────────────────────────────────
  const summarySheet =
    workbook.Sheets["Monthly Summary"] ?? workbook.Sheets[workbook.SheetNames[0]];

  if (!summarySheet) {
    errors.push('No usable sheet found. Expected a sheet named "Monthly Summary".');
    return { months, profile, errors, warnings };
  }

  const rows = (XLSX.utils.sheet_to_json(summarySheet, {
    header: 1,
    defval: null,
    raw: false,
    dateNF: "yyyy-mm-dd",
  }) as unknown) as unknown[][];

  if (rows.length < 2) {
    errors.push("Sheet has no data rows.");
    return { months, profile, errors, warnings };
  }

  // Row 0 is headers
  const headerRow = rows[0] as (string | null)[];

  // Build column index map
  const colMap = new Map<
    keyof Omit<FinancialMonthInsert, "user_id" | "business_id">,
    number
  >();
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (!h) continue;
    const field = headerToField(String(h));
    if (field) colMap.set(field, i);
  }

  // Check required columns
  for (const required of REQUIRED_FIELDS) {
    if (!colMap.has(required)) {
      errors.push(
        `Required column missing: "${required.replace(/_/g, " ")}". ` +
          `Check that your header row includes the expected column names.`
      );
    }
  }
  if (errors.length > 0) return { months, profile, errors, warnings };

  // Warn about missing optional columns
  for (const opt of OPTIONAL_FIELDS) {
    if (!colMap.has(opt) && opt !== "notes") {
      warnings.push(
        `Optional column not found: "${opt.replace(/_/g, " ")}". It will be left empty.`
      );
    }
  }

  const now = new Date();

  // Data rows
  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] as (unknown | null)[];

    // Stop at first completely empty row
    const isEmpty = row.every((cell) => cell === null || cell === "");
    if (isEmpty) break;

    const humanRow = rowIdx + 1; // 1-based for user messages

    // month_date
    const rawDate = row[colMap.get("month_date")!];
    // Re-parse with cellDates:true — we need the actual date
    const monthDate = parseMonthDate(rawDate);
    if (!monthDate) {
      errors.push(
        `Row ${humanRow}: cannot parse date value "${rawDate}". ` +
          `Use a format like "Jan 2024" or "2024-01-01".`
      );
      continue;
    }

    // Numeric fields
    let hasError = false;
    const numericFields = [
      "opening_cash",
      "closing_cash",
      "total_revenue",
      "total_expenses",
      "payroll",
      "ar_outstanding",
      "ap_outstanding",
    ] as const;

    const parsed: Partial<Record<(typeof numericFields)[number], number | null>> =
      {};

    for (const field of numericFields) {
      const colIdx = colMap.get(field);
      if (colIdx === undefined) {
        parsed[field] = null;
        continue;
      }
      const raw = row[colIdx];
      const n = toNumber(raw);
      if (n === ("NaN" as unknown)) {
        errors.push(
          `Row ${humanRow}: "${field.replace(/_/g, " ")}" has non-numeric value "${raw}".`
        );
        hasError = true;
      } else {
        parsed[field] = n;
      }
    }

    if (hasError) continue;

    // Cross-field validation
    if (
      parsed.payroll !== null &&
      parsed.payroll !== undefined &&
      parsed.total_expenses !== null &&
      parsed.total_expenses !== undefined &&
      parsed.payroll > parsed.total_expenses
    ) {
      errors.push(
        `Row ${humanRow}: payroll ($${parsed.payroll}) exceeds total expenses ($${parsed.total_expenses}).`
      );
      continue;
    }

    // Warnings
    const monthDateObj = new Date(monthDate + "T12:00:00Z");
    if (monthDateObj > now) {
      warnings.push(`Row ${humanRow}: month ${monthDate} is in the future.`);
    }

    const allZero = [
      parsed.opening_cash,
      parsed.closing_cash,
      parsed.total_revenue,
      parsed.total_expenses,
    ].every((v) => v === 0 || v === null);
    if (allZero) {
      warnings.push(`Row ${humanRow}: all numeric fields are zero.`);
    }

    // Notes
    const notesIdx = colMap.get("notes");
    const notes =
      notesIdx !== undefined && row[notesIdx] !== null
        ? String(row[notesIdx])
        : null;

    months.push({
      month_date: monthDate,
      opening_cash: parsed.opening_cash ?? null,
      closing_cash: parsed.closing_cash ?? null,
      total_revenue: parsed.total_revenue ?? null,
      total_expenses: parsed.total_expenses ?? null,
      payroll: parsed.payroll ?? null,
      ar_outstanding: parsed.ar_outstanding ?? null,
      ap_outstanding: parsed.ap_outstanding ?? null,
      notes,
    });
  }

  if (months.length === 0 && errors.length === 0) {
    errors.push("No valid data rows found in the sheet.");
  }

  return { months, profile, errors, warnings };
}
