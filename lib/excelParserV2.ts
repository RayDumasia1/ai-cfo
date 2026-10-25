import * as XLSX from "xlsx";
import type { FinancialMonthInsert, BusinessProfileInsert } from "./types";
import type { ParseResult } from "./financialWorkbookTypes";
import type { ImportNotice } from "./importNotices";

type MonthInput = Omit<FinancialMonthInsert, "user_id" | "business_id">;
type MonthField = keyof MonthInput;

const REQUIRED_HEADERS = new Map<string, MonthField>([
  ["month", "month_date"],
  ["period status", "period_status"],
  ["cutoff date", "period_cutoff_date"],
  ["opening included cash", "opening_included_cash"],
  ["cash collected from customers", "cash_collected_from_customers"],
  ["operating cash paid", "operating_cash_paid"],
  ["owner draws or distributions", "owner_draws_paid"],
  ["debt principal paid", "debt_principal_paid"],
  ["debt interest paid", "debt_interest_paid"],
  ["asset purchases", "investing_cash_paid"],
  ["asset sale proceeds", "investing_cash_received"],
  ["new debt received", "debt_funding_received"],
  ["owner or equity funding", "owner_funding_received"],
  ["other cash in", "other_cash_inflows"],
  ["other cash out", "other_cash_outflows"],
  ["closing included cash", "closing_included_cash"],
  ["unavailable cash", "closing_unavailable_cash"],
]);

const OPTIONAL_HEADERS = new Map<string, MonthField>([
  ["notes", "notes"],
]);

const OPTIONAL_DETAIL_HEADERS = new Map<string, MonthField>([
  ["month", "month_date"],
  ["taxes reserved", "closing_taxes_reserved"],
  ["customer invoices expected within 30 days", "ar_expected_within_30_days"],
  ["bills due within 30 days", "ap_due_within_30_days"],
  ["available credit", "available_credit"],
  ["credit currently drawn", "credit_currently_drawn"],
  ["lowest observed cash", "lowest_observed_cash"],
]);

const REQUIRED_NUMERIC_FIELDS = [
  "opening_included_cash", "cash_collected_from_customers", "operating_cash_paid",
  "owner_draws_paid", "debt_principal_paid", "debt_interest_paid",
  "investing_cash_paid", "investing_cash_received", "debt_funding_received",
  "owner_funding_received", "other_cash_inflows", "other_cash_outflows",
  "closing_included_cash", "closing_unavailable_cash",
] as const;

const NONNEGATIVE_REQUIRED_FIELDS = REQUIRED_NUMERIC_FIELDS.filter(field =>
  field !== "opening_included_cash" && field !== "closing_included_cash"
);

const OPTIONAL_NUMERIC_FIELDS = [
  "closing_taxes_reserved", "ar_expected_within_30_days", "ap_due_within_30_days",
  "available_credit", "credit_currently_drawn", "lowest_observed_cash",
] as const;

const ROW_INPUT_FIELDS: MonthField[] = [
  ...REQUIRED_NUMERIC_FIELDS, "period_status", "period_cutoff_date", "notes",
];

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dateParts(raw: unknown): { year: number; month: number; day: number } | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { year: raw.getFullYear(), month: raw.getMonth() + 1, day: raw.getDate() };
  }
  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    return parsed ? { year: parsed.y, month: parsed.m, day: parsed.d } : null;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function validDate(parts: { year: number; month: number; day: number }): boolean {
  if (parts.year < 1900 || parts.year > 9999 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return false;
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return date.getFullYear() === parts.year && date.getMonth() + 1 === parts.month && date.getDate() === parts.day;
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseMonth(raw: unknown): string | null {
  const parts = dateParts(raw);
  return parts && validDate(parts) && parts.day === 1 ? isoDate(parts) : null;
}

function parseDate(raw: unknown): string | null {
  const parts = dateParts(raw);
  return parts && validDate(parts) ? isoDate(parts) : null;
}

function toNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  const value = raw.trim();
  if (!value) return null;
  const negative = value.startsWith("(") && value.endsWith(")");
  const cleaned = value.replace(/[$,()]/g, "").trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isNaN(number) ? NaN : negative ? -number : number;
}

function headerRow(rows: unknown[][], expected: Map<string, MonthField>): number {
  for (let index = 0; index < Math.min(rows.length, 10); index++) {
    const found = (rows[index] ?? []).filter(cell => typeof cell === "string" && expected.has(norm(cell))).length;
    if (found >= Math.min(4, expected.size)) return index;
  }
  return -1;
}

function columnMap(row: unknown[], expected: Map<string, MonthField>, errors: string[], sheet: string): Map<MonthField, number> {
  const result = new Map<MonthField, number>();
  for (let index = 0; index < row.length; index++) {
    if (typeof row[index] !== "string") continue;
    const field = expected.get(norm(row[index] as string));
    if (!field) continue;
    if (result.has(field)) errors.push(`${sheet}: duplicate column "${String(row[index]).trim()}".`);
    else result.set(field, index);
  }
  return result;
}

function pushNotice(notices: ImportNotice[], warnings: string[], notice: ImportNotice) {
  notices.push(notice);
  warnings.push(notice.message);
}

function readStartHere(workbook: XLSX.WorkBook, errors: string[]): {
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>;
  currency: string | null;
  basis: MonthInput["accounting_basis"];
} {
  const profile: Partial<Omit<BusinessProfileInsert, "user_id">> = {};
  let currency: string | null = null;
  let basis: MonthInput["accounting_basis"] = null;
  const sheet = workbook.Sheets["Start Here"];
  if (!sheet) {
    errors.push('Required sheet missing: "Start Here".');
    return { profile, currency, basis };
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
  for (const row of rows) {
    if (typeof row[0] !== "string") continue;
    const key = norm(row[0]);
    const value = row[1];
    if (value === null || value === "") continue;
    if (key === "business name") profile.business_name = String(value).trim();
    else if (key === "industry") profile.industry = String(value).trim();
    else if (key === "accounting system") profile.accounting_system = String(value).trim();
    else if (key === "number of employees") {
      const count = toNumber(value);
      if (count === null || !Number.isInteger(count) || count < 0) errors.push("Start Here: Number of employees must be a whole number of zero or more.");
      else profile.employee_count = count;
    } else if (key === "reporting currency") {
      const code = String(value).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) errors.push("Start Here: Reporting currency must be a three-letter currency code, such as USD.");
      else currency = code;
    } else if (key === "accounting basis") {
      const normalized = norm(String(value));
      if (!["cash", "accrual", "mixed", "unknown"].includes(normalized)) errors.push("Start Here: Accounting basis must be Cash, Accrual, Mixed, or Unknown.");
      else basis = normalized as MonthInput["accounting_basis"];
    }
  }
  if (!currency) errors.push("Start Here: Reporting currency is required.");
  if (!basis) errors.push("Start Here: Accounting basis is required.");
  return { profile, currency, basis };
}

function reconciliation(month: MonthInput): number {
  return (month.closing_included_cash ?? 0) - (month.opening_included_cash ?? 0) - (
    (month.cash_collected_from_customers ?? 0) - (month.operating_cash_paid ?? 0)
    - (month.owner_draws_paid ?? 0) - (month.debt_principal_paid ?? 0)
    - (month.debt_interest_paid ?? 0) - (month.investing_cash_paid ?? 0)
    + (month.investing_cash_received ?? 0) + (month.debt_funding_received ?? 0)
    + (month.owner_funding_received ?? 0) + (month.other_cash_inflows ?? 0)
    - (month.other_cash_outflows ?? 0)
  );
}

function parseOptionalDetail(workbook: XLSX.WorkBook, months: Map<string, MonthInput>, errors: string[]) {
  const sheet = workbook.Sheets["Optional Detail"];
  if (!sheet) return;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
  const header = headerRow(rows, OPTIONAL_DETAIL_HEADERS);
  if (header < 0) {
    errors.push('Optional Detail: could not find the expected header row.');
    return;
  }
  const columns = columnMap(rows[header], OPTIONAL_DETAIL_HEADERS, errors, "Optional Detail");
  if (!columns.has("month_date")) {
    errors.push('Optional Detail: required column missing: "Month".');
    return;
  }
  const seen = new Set<string>();
  for (let rowIndex = header + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const humanRow = rowIndex + 1;
    const rawMonth = row[columns.get("month_date")!];
    if (typeof rawMonth === "string" && norm(rawMonth).startsWith("taxes reserved are part of unavailable cash")) continue;
    const populated = OPTIONAL_NUMERIC_FIELDS.some(field => {
      const index = columns.get(field);
      return index !== undefined && row[index] !== null && row[index] !== "";
    });
    if (rawMonth === null || rawMonth === "") {
      if (populated) errors.push(`Optional Detail row ${humanRow}: add a matching month or clear the row.`);
      continue;
    }
    const monthDate = parseMonth(rawMonth);
    if (!monthDate) {
      if (populated) errors.push(`Optional Detail row ${humanRow}: Month must be the first day of a valid month.`);
      continue;
    }
    if (seen.has(monthDate)) {
      errors.push(`Optional Detail row ${humanRow}: duplicate month ${monthDate}.`);
      continue;
    }
    seen.add(monthDate);
    const month = months.get(monthDate);
    if (!month) {
      if (populated) errors.push(`Optional Detail row ${humanRow}: ${monthDate} is not present in Monthly Cash.`);
      continue;
    }
    for (const field of OPTIONAL_NUMERIC_FIELDS) {
      const index = columns.get(field);
      if (index === undefined) continue;
      const number = toNumber(row[index]);
      if (number !== null && (!Number.isFinite(number) || (field !== "lowest_observed_cash" && number < 0))) {
        errors.push(`Optional Detail row ${humanRow}: "${String(rows[header][index])}" must be a nonnegative number or blank.`);
      } else {
        month[field] = number;
      }
    }
    if (month.closing_taxes_reserved != null && month.closing_unavailable_cash != null &&
      month.closing_taxes_reserved > month.closing_unavailable_cash) {
      errors.push(`Optional Detail row ${humanRow}: Taxes reserved cannot exceed unavailable cash for ${monthDate}.`);
    }
  }
}

export function parseV2Workbook(workbook: XLSX.WorkBook): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notices: ImportNotice[] = [];
  const { profile, currency, basis } = readStartHere(workbook, errors);
  const sheet = workbook.Sheets["Monthly Cash"];
  if (!sheet) return { months: [], profile, errors: [...errors, 'Required sheet missing: "Monthly Cash".'], warnings, notices, contractVersion: 2 };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
  const header = headerRow(rows, REQUIRED_HEADERS);
  if (header < 0) return { months: [], profile, errors: [...errors, "Monthly Cash: could not find the version-2 header row."], warnings, notices, contractVersion: 2 };
  const columns = columnMap(rows[header], new Map([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]), errors, "Monthly Cash");
  for (const [label, field] of REQUIRED_HEADERS) {
    if (!columns.has(field)) errors.push(`Monthly Cash: required column missing: "${label}".`);
  }
  if (errors.some(error => error.startsWith("Monthly Cash: required column") || error.includes("duplicate column"))) {
    return { months: [], profile, errors, warnings, notices, contractVersion: 2 };
  }

  const months = new Map<string, MonthInput>();
  for (let rowIndex = header + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const humanRow = rowIndex + 1;
    const rawMonth = row[columns.get("month_date")!];
    const hasInput = ROW_INPUT_FIELDS.some(field => {
      const index = columns.get(field);
      return index !== undefined && row[index] !== null && row[index] !== "";
    });
    if (rawMonth === null || rawMonth === "") {
      if (hasInput) errors.push(`Monthly Cash row ${humanRow}: add a month or clear the row.`);
      continue;
    }
    const monthDate = parseMonth(rawMonth);
    if (!monthDate) {
      errors.push(`Monthly Cash row ${humanRow}: Month must be the first day of a valid month.`);
      continue;
    }
    if (months.has(monthDate)) {
      errors.push(`Duplicate month: ${monthDate}. Include each month only once.`);
      continue;
    }
    const statusIndex = columns.get("period_status")!;
    const status = typeof row[statusIndex] === "string" ? norm(row[statusIndex] as string) : "";
    if (status !== "complete" && status !== "partial") errors.push(`Monthly Cash row ${humanRow}: Period status must be Complete or Partial.`);
    const cutoffRaw = row[columns.get("period_cutoff_date")!];
    const cutoff = cutoffRaw === null || cutoffRaw === "" ? null : parseDate(cutoffRaw);
    if (cutoffRaw !== null && cutoffRaw !== "" && !cutoff) errors.push(`Monthly Cash row ${humanRow}: Cutoff date is invalid.`);
    if (status === "partial" && !cutoff) errors.push(`Monthly Cash row ${humanRow}: Partial periods require a cutoff date.`);
    if (status === "complete" && cutoff) errors.push(`Monthly Cash row ${humanRow}: Complete periods must not have a cutoff date.`);
    if (status === "partial" && cutoff && cutoff.slice(0, 7) !== monthDate.slice(0, 7)) errors.push(`Monthly Cash row ${humanRow}: Cutoff date must be within ${monthDate.slice(0, 7)}.`);

    const values: Partial<Record<(typeof REQUIRED_NUMERIC_FIELDS)[number], number | null>> = {};
    for (const field of REQUIRED_NUMERIC_FIELDS) {
      const index = columns.get(field)!;
      const number = toNumber(row[index]);
      if (number === null) errors.push(`Monthly Cash row ${humanRow}: "${String(rows[header][index])}" is required. Enter 0 when the confirmed amount is zero.`);
      else if (!Number.isFinite(number)) errors.push(`Monthly Cash row ${humanRow}: "${String(rows[header][index])}" must be numeric.`);
      else if (NONNEGATIVE_REQUIRED_FIELDS.includes(field as (typeof NONNEGATIVE_REQUIRED_FIELDS)[number]) && number < 0) errors.push(`Monthly Cash row ${humanRow}: "${String(rows[header][index])}" cannot be negative.`);
      values[field] = number;
    }
    if (REQUIRED_NUMERIC_FIELDS.some(field => values[field] === null || !Number.isFinite(values[field]))) continue;
    if ((values.closing_unavailable_cash ?? 0) > Math.max(values.closing_included_cash ?? 0, 0)) {
      errors.push(`Monthly Cash row ${humanRow}: Unavailable cash cannot exceed closing included cash.`);
      continue;
    }
    const notesIndex = columns.get("notes");
    const month: MonthInput = {
      month_date: monthDate,
      opening_cash: values.opening_included_cash!,
      closing_cash: values.closing_included_cash!,
      total_revenue: values.cash_collected_from_customers!,
      total_expenses: values.operating_cash_paid! + values.owner_draws_paid! + values.debt_principal_paid!
        + values.debt_interest_paid! + values.investing_cash_paid! + values.other_cash_outflows!,
      payroll: null,
      ar_outstanding: null,
      ap_outstanding: null,
      notes: notesIndex !== undefined && row[notesIndex] !== null ? String(row[notesIndex]).trim() || null : null,
      data_contract_version: 2,
      source_type: "spreadsheet",
      accounting_basis: basis,
      reporting_currency: currency,
      period_status: status === "partial" ? "partial" : "complete",
      period_cutoff_date: cutoff,
      opening_included_cash: values.opening_included_cash!,
      closing_included_cash: values.closing_included_cash!,
      closing_unavailable_cash: values.closing_unavailable_cash!,
      cash_collected_from_customers: values.cash_collected_from_customers!,
      operating_cash_paid: values.operating_cash_paid!,
      owner_draws_paid: values.owner_draws_paid!,
      debt_principal_paid: values.debt_principal_paid!,
      debt_interest_paid: values.debt_interest_paid!,
      investing_cash_paid: values.investing_cash_paid!,
      investing_cash_received: values.investing_cash_received!,
      debt_funding_received: values.debt_funding_received!,
      owner_funding_received: values.owner_funding_received!,
      other_cash_inflows: values.other_cash_inflows!,
      other_cash_outflows: values.other_cash_outflows!,
      closing_taxes_reserved: null,
      ar_expected_within_30_days: null,
      ap_due_within_30_days: null,
      available_credit: null,
      credit_currently_drawn: null,
      lowest_observed_cash: null,
    };
    const difference = reconciliation(month);
    if (Math.abs(difference) > 1) {
      errors.push(`Monthly Cash row ${humanRow}: cash does not reconcile. The unexplained difference is ${difference.toFixed(2)} ${currency ?? "in the reporting currency"}.`);
      continue;
    }
    months.set(monthDate, month);
    if (new Date(`${monthDate}T12:00:00`).getTime() > Date.now()) pushNotice(notices, warnings, {
      code: "future_month", category: "warning", title: "Future-dated month",
      message: `Monthly Cash row ${humanRow}: ${monthDate} is in the future.`,
    });
  }

  parseOptionalDetail(workbook, months, errors);
  if (months.size === 0 && errors.length === 0) errors.push("The workbook must contain at least one financial month.");
  notices.push({
    code: "cash_contract_v2", category: "info", title: "Classified cash data",
    message: "This workbook uses Elidan's version-2 cash model. Cash activity is classified and reconciled before import.",
  });
  return { months: [...months.values()], profile, errors, warnings, notices, contractVersion: 2 };
}
