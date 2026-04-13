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
 * Map a normalised header label → FinancialMonth field name.
 * Accepts common aliases and the "($)" currency suffix variant.
 * Returns null for unrecognised headers (ignored silently).
 */
function headerToField(
  header: string
): keyof Omit<FinancialMonthInsert, "user_id" | "business_id"> | null {
  const h = norm(header);

  if (h === "month" || h === "date" || h === "month date") return "month_date";
  if (
    h === "opening cash" ||
    h === "opening balance" ||
    h === "opening cash ($)" ||
    h === "opening balance ($)"
  )
    return "opening_cash";
  if (
    h === "closing cash" ||
    h === "closing balance" ||
    h === "closing cash ($)" ||
    h === "closing balance ($)"
  )
    return "closing_cash";
  if (
    h === "revenue" ||
    h === "total revenue" ||
    h === "revenue ($)" ||
    h === "total revenue ($)"
  )
    return "total_revenue";
  if (
    h === "expenses" ||
    h === "total expenses" ||
    h === "expenses ($)" ||
    h === "total expenses ($)"
  )
    return "total_expenses";
  if (h === "payroll" || h === "payroll ($)") return "payroll";
  if (
    h === "ar" ||
    h === "accounts receivable" ||
    h === "ar outstanding" ||
    h === "ar outstanding ($)"
  )
    return "ar_outstanding";
  if (
    h === "ap" ||
    h === "accounts payable" ||
    h === "ap outstanding" ||
    h === "ap outstanding ($)"
  )
    return "ap_outstanding";
  if (h === "notes") return "notes";

  return null;
}

const REQUIRED_FIELDS: Array<
  keyof Omit<FinancialMonthInsert, "user_id" | "business_id">
> = [
  "month_date",
  "opening_cash",
  "closing_cash",
  "total_revenue",
  "total_expenses",
];

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
 * Parse a cell value (Date object, ISO string, named month string, or Excel
 * date serial) into a YYYY-MM-01 string. Returns null if unparseable.
 */
function parseMonthDate(raw: unknown): string | null {
  if (raw instanceof Date) return toMonthDate(raw);

  if (typeof raw === "number") {
    // Fallback for raw Excel date serials when cellDates:true is not effective.
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-01`;
    return null;
  }

  if (typeof raw === "string") {
    const s = raw.trim();

    // "2024-01" or "2024-01-15" (dateNF output format)
    const iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-01`;

    // "Jan 2024" / "January 2024"
    const named = new Date(`1 ${s}`);
    if (!Number.isNaN(named.getTime())) return toMonthDate(named);

    // Any other parseable date string
    const fallback = new Date(s);
    if (!Number.isNaN(fallback.getTime())) return toMonthDate(fallback);
  }

  return null;
}

/**
 * Coerce a cell value to a number.
 *
 * Handles currency-formatted strings from Excel:
 *   "$120,000"  → 120000
 *   "(1,250)"   → -1250   (accounting negative notation)
 *   "-"         → null    (common Excel placeholder for zero/N/A)
 *   ""          → null    (empty cell)
 *
 * Returns null for empty/missing cells (stored as NULL in DB).
 * Returns NaN for genuinely unparseable values — callers must check
 * Number.isNaN() before using the result.
 *
 * Note: % symbols are NOT stripped. These fields are all monetary amounts;
 * a % in the cell indicates bad data and should surface as an error.
 */
function toNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;

  // Defensive: XLSX with raw:false always gives us strings, but handle the
  // numeric case explicitly in case that assumption ever changes.
  if (typeof raw === "number") return raw; // NaN passthrough is intentional

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-") return null;

    // Parenthetical negatives: "(1,250)" → -1250
    const isNegative = trimmed.startsWith("(") && trimmed.endsWith(")");

    // Strip currency symbol, thousands separator, and parens only.
    const cleaned = trimmed.replace(/[$,()]/g, "").trim();

    const n = Number(cleaned);
    return Number.isNaN(n) ? NaN : isNegative ? -n : n;
  }

  return Number(raw);
}

/**
 * Scan the first up to 10 rows looking for a header row.
 * A row qualifies when at least 4 of the 5 required field names are found
 * (threshold of 4 instead of 5 allows for minor column variations while still
 * being specific enough to avoid false positives on title/metadata rows).
 * Returns the 0-based row index, or -1 if not found.
 */
function findHeaderRowIndex(rows: unknown[][]): number {
  for (let rowIdx = 0; rowIdx < Math.min(rows.length, 10); rowIdx++) {
    const row = rows[rowIdx] as unknown[];
    const found = new Set<string>();

    for (const cell of row) {
      if (cell === null || cell === undefined || cell === "") continue;
      const field = headerToField(String(cell));
      if (field) found.add(field);
    }

    const requiredFound = REQUIRED_FIELDS.filter((f) => found.has(f)).length;
    if (requiredFound >= 4) return rowIdx;
  }

  return -1;
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
    // header:1 produces unknown[][] (each row is an array indexed by column).
    const infoRows = XLSX.utils.sheet_to_json(infoSheet, {
      header: 1,
    }) as unknown[][];

    for (const row of infoRows) {
      const key = row[0];
      const value = row[1];
      if (!key || !value) continue;
      const k = norm(String(key));

      console.log("parser:info-row", { raw: String(key), normed: k, value });

      if (k === "business name") {
        profile.business_name = String(value);
      } else if (k === "industry") {
        profile.industry = String(value);
      } else if (k === "accounting system") {
        profile.accounting_system = String(value);
      } else if (k === "employee count" || k === "employees" || k === "number of employees") {
        const n = Number(String(value).replace(/,/g, ""));
        if (!Number.isNaN(n)) profile.employee_count = Math.round(n);
      } else if (
        k === "min cash reserve" ||
        k === "minimum cash reserve" ||
        k === "minimum cash reserve ($)" ||
        k === "minimum cash balance" ||
        k === "cash reserve"
      ) {
        // Strip currency formatting before parsing (e.g. "$25,000" → 25000).
        const n = Number(String(value).replace(/[$,]/g, ""));
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
  // Fall back to the first sheet if the expected name isn't present.
  const summarySheet =
    workbook.Sheets["Monthly Summary"] ??
    workbook.Sheets[workbook.SheetNames[0]];

  if (!summarySheet) {
    errors.push(
      'No usable sheet found. Expected a sheet named "Monthly Summary".'
    );
    return { months, profile, errors, warnings };
  }

  // raw:false + dateNF formats date cells as "YYYY-MM-DD" strings, which
  // parseMonthDate handles. defval:null gives us explicit nulls for empty cells.
  const rows = XLSX.utils.sheet_to_json(summarySheet, {
    header: 1,
    defval: null,
    raw: false,
    dateNF: "yyyy-mm-dd",
  }) as unknown[][];

  if (rows.length < 2) {
    errors.push("Sheet has no data rows.");
    return { months, profile, errors, warnings };
  }

  // ── Locate header row ──────────────────────────────────────────────────────
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex === -1) {
    errors.push(
      'Could not find a valid header row in the first 10 rows. ' +
        'Expected columns like "Month", "Opening Cash", "Closing Cash", ' +
        '"Total Revenue", and "Total Expenses".'
    );
    return { months, profile, errors, warnings };
  }

  // ── Build column index map ─────────────────────────────────────────────────
  const headerRow = rows[headerRowIndex] as (unknown | null)[];
  const colMap = new Map<
    keyof Omit<FinancialMonthInsert, "user_id" | "business_id">,
    number
  >();

  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h === null || h === undefined || h === "") continue;
    const field = headerToField(String(h));
    if (field) colMap.set(field, i);
  }

  // ── Validate required columns ──────────────────────────────────────────────
  for (const required of REQUIRED_FIELDS) {
    if (!colMap.has(required)) {
      errors.push(
        `Required column missing: "${required.replace(/_/g, " ")}". ` +
          `Check that your header row includes the expected column names.`
      );
    }
  }

  if (errors.length > 0) return { months, profile, errors, warnings };

  // Warn about missing optional columns (excluding notes — plain text, less critical).
  for (const opt of OPTIONAL_FIELDS) {
    if (!colMap.has(opt) && opt !== "notes") {
      warnings.push(
        `Optional column not found: "${opt.replace(/_/g, " ")}". It will be left empty.`
      );
    }
  }

  // ── Parse data rows ────────────────────────────────────────────────────────
  const now = new Date();

  for (let rowIdx = headerRowIndex + 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] as (unknown | null)[];

    // Stop at the first completely empty row (end of data block).
    if (row.every((cell) => cell === null || cell === "")) break;

    const humanRow = rowIdx + 1; // 1-based for user-facing messages

    // month_date
    const rawDate = row[colMap.get("month_date")!];
    const monthDate = parseMonthDate(rawDate);

    if (!monthDate) {
      errors.push(
        `Row ${humanRow}: cannot parse date value "${rawDate}". ` +
          `Use a format like "Jan 2024" or "2024-01-01".`
      );
      continue;
    }

    // Numeric fields
    const numericFields = [
      "opening_cash",
      "closing_cash",
      "total_revenue",
      "total_expenses",
      "payroll",
      "ar_outstanding",
      "ap_outstanding",
    ] as const;

    const numericValues: Partial<
      Record<(typeof numericFields)[number], number | null>
    > = {};
    let hasError = false;

    for (const field of numericFields) {
      const colIdx = colMap.get(field);
      if (colIdx === undefined) {
        numericValues[field] = null;
        continue;
      }

      const raw = row[colIdx];
      const n = toNumber(raw);

      if (n !== null && Number.isNaN(n)) {
        errors.push(
          `Row ${humanRow}: "${field.replace(/_/g, " ")}" has non-numeric value "${raw}".`
        );
        hasError = true;
      } else {
        numericValues[field] = n;
      }
    }

    if (hasError) continue;

    // Cross-field: payroll cannot exceed total expenses
    if (
      numericValues.payroll != null &&
      numericValues.total_expenses != null &&
      numericValues.payroll > numericValues.total_expenses
    ) {
      errors.push(
        `Row ${humanRow}: payroll ($${numericValues.payroll}) exceeds ` +
          `total expenses ($${numericValues.total_expenses}).`
      );
      continue;
    }

    // Warnings
    const monthDateObj = new Date(monthDate + "T12:00:00Z");
    if (monthDateObj > now) {
      warnings.push(`Row ${humanRow}: month ${monthDate} is in the future.`);
    }

    const allZero = [
      numericValues.opening_cash,
      numericValues.closing_cash,
      numericValues.total_revenue,
      numericValues.total_expenses,
    ].every((v) => v === 0 || v === null);

    if (allZero) {
      warnings.push(`Row ${humanRow}: all numeric fields are zero.`);
    }

    // Notes (optional free-text column)
    const notesIdx = colMap.get("notes");
    const notes =
      notesIdx !== undefined && row[notesIdx] !== null
        ? String(row[notesIdx])
        : null;

    months.push({
      month_date: monthDate,
      opening_cash: numericValues.opening_cash ?? null,
      closing_cash: numericValues.closing_cash ?? null,
      total_revenue: numericValues.total_revenue ?? null,
      total_expenses: numericValues.total_expenses ?? null,
      payroll: numericValues.payroll ?? null,
      ar_outstanding: numericValues.ar_outstanding ?? null,
      ap_outstanding: numericValues.ap_outstanding ?? null,
      notes,
    });
  }

  if (months.length === 0 && errors.length === 0) {
    errors.push("No valid data rows found in the sheet.");
  }

  console.log("parser:profile", profile);

  return { months, profile, errors, warnings };
}
