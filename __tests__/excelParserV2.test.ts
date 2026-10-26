import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));
import { parseExcelBuffer } from "../lib/excelParser";

const template = readFileSync("docs/templates/elidan-financial-template-v2.xlsx");

function workbook() {
  const result = XLSX.read(template, { type: "buffer", cellDates: true, cellFormula: true });
  XLSX.utils.sheet_add_aoa(result.Sheets["Start Here"], [["Cash"]], { origin: "B12" });
  XLSX.utils.sheet_add_aoa(result.Sheets["Monthly Cash"], [[
    "2026-01-01", "Complete", null, 100000, 75000, 60000, 3000, 2000, 500,
    8000, 0, 0, 10000, 0, 1500, 110000, 12000, null, null, null, null, "January close",
  ]], { origin: "A7" });
  return result;
}

function parse(book = workbook()) {
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return parseExcelBuffer(bytes);
}

describe("version-2 financial workbook parser", () => {
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-15T12:00:00Z").getTime()));

  it("parses classified cash data and derives only the temporary dashboard compatibility fields", () => {
    const book = workbook();
    XLSX.utils.sheet_add_aoa(book.Sheets["Optional Detail"], [[
      "2026-01-01", 5000, 18000, 14000, 50000, 10000, 82000,
    ]], { origin: "A6" });
    const result = parse(book);

    expect(result.errors).toEqual([]);
    expect(result.contractVersion).toBe(2);
    expect(result.profile).toEqual({});
    expect(result.notices).toContainEqual(expect.objectContaining({ code: "cash_contract_v2", category: "info" }));
    expect(result.months).toEqual([expect.objectContaining({
      month_date: "2026-01-01",
      data_contract_version: 2,
      source_type: "spreadsheet",
      accounting_basis: "cash",
      reporting_currency: "USD",
      period_status: "complete",
      period_cutoff_date: null,
      opening_included_cash: 100000,
      closing_included_cash: 110000,
      closing_unavailable_cash: 12000,
      cash_collected_from_customers: 75000,
      operating_cash_paid: 60000,
      owner_draws_paid: 3000,
      debt_principal_paid: 2000,
      debt_interest_paid: 500,
      investing_cash_paid: 8000,
      investing_cash_received: 0,
      debt_funding_received: 0,
      owner_funding_received: 10000,
      other_cash_inflows: 0,
      other_cash_outflows: 1500,
      closing_taxes_reserved: 5000,
      ar_expected_within_30_days: 18000,
      ap_due_within_30_days: 14000,
      available_credit: 50000,
      credit_currently_drawn: 10000,
      lowest_observed_cash: 82000,
      opening_cash: 100000,
      closing_cash: 110000,
      total_revenue: 75000,
      total_expenses: 75000,
      notes: "January close",
    })]);
  });

  it("distinguishes a required confirmed zero from an unknown blank", () => {
    const valid = parse();
    expect(valid.errors).toEqual([]);
    expect(valid.months[0].investing_cash_received).toBe(0);

    const missing = workbook();
    delete missing.Sheets["Monthly Cash"].K7;
    const result = parse(missing);
    expect(result.months).toEqual([]);
    expect(result.errors).toContain('Monthly Cash row 7: "Asset sale proceeds" is required. Enter 0 when the confirmed amount is zero.');
  });

  it("asks the user to confirm an isolated zero in customer collections", () => {
    const book = workbook();
    XLSX.utils.sheet_add_aoa(book.Sheets["Monthly Cash"], [[
      "2026-02-01", "Complete", null, 110000, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 110000, 12000, null, null, null, null, "No February collections",
    ]], { origin: "A8" });
    const result = parse(book);
    expect(result.errors).toEqual([]);
    expect(result.notices).toContainEqual(expect.objectContaining({
      code: "zero_customer_collections",
      category: "warning",
      title: "Confirm no customer cash was collected",
      message: expect.stringContaining("February 2026 reports $0 collected from customers, while January 2026 ($75,000) reports collections"),
    }));
  });

  it("does not flag consistently zero or partial-period collections", () => {
    const allZero = workbook();
    XLSX.utils.sheet_add_aoa(allZero.Sheets["Monthly Cash"], [[
      "2026-01-01", "Complete", null, 100000, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 100000, 12000, null, null, null, null, "No January activity",
    ]], { origin: "A7" });
    XLSX.utils.sheet_add_aoa(allZero.Sheets["Monthly Cash"], [[
      "2026-02-01", "Complete", null, 100000, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 100000, 12000, null, null, null, null, "No February activity",
    ]], { origin: "A8" });
    expect(parse(allZero).errors).toEqual([]);
    expect(parse(allZero).notices).not.toContainEqual(expect.objectContaining({code:"zero_customer_collections"}));

    const partial = workbook();
    XLSX.utils.sheet_add_aoa(partial.Sheets["Monthly Cash"], [[
      "2026-02-01", "Partial", "2026-02-10", 110000, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 110000, 12000, null, null, null, null, "Partial February",
    ]], { origin: "A8" });
    expect(parse(partial).notices).not.toContainEqual(expect.objectContaining({code:"zero_customer_collections"}));
  });

  it("rejects an unexplained cash difference instead of trusting workbook formulas", () => {
    const book = workbook();
    XLSX.utils.sheet_add_aoa(book.Sheets["Monthly Cash"], [[111500]], { origin: "P7" });
    const result = parse(book);
    expect(result.months).toEqual([]);
    expect(result.errors).toContain("Monthly Cash row 7: cash does not reconcile. The unexplained difference is 1500.00 USD.");
  });

  it("enforces partial-period cutoff rules", () => {
    const missing = workbook();
    XLSX.utils.sheet_add_aoa(missing.Sheets["Monthly Cash"], [["Partial"]], { origin: "B7" });
    expect(parse(missing).errors).toContain("Monthly Cash row 7: Partial periods require a cutoff date.");

    const wrongMonth = workbook();
    XLSX.utils.sheet_add_aoa(wrongMonth.Sheets["Monthly Cash"], [["Partial", "2026-02-03"]], { origin: "B7" });
    expect(parse(wrongMonth).errors).toContain("Monthly Cash row 7: Cutoff date must be within 2026-01.");

    const valid = workbook();
    XLSX.utils.sheet_add_aoa(valid.Sheets["Monthly Cash"], [["Partial", "2026-01-20"]], { origin: "B7" });
    expect(parse(valid)).toMatchObject({ errors: [], months: [{ period_status: "partial", period_cutoff_date: "2026-01-20" }] });
  });

  it("rejects invalid optional-detail ownership and reserve values", () => {
    const orphan = workbook();
    XLSX.utils.sheet_add_aoa(orphan.Sheets["Optional Detail"], [["2026-02-01", 1]], { origin: "A6" });
    expect(parse(orphan).errors).toContain("Optional Detail row 6: 2026-02-01 is not present in Monthly Cash.");

    const reserve = workbook();
    XLSX.utils.sheet_add_aoa(reserve.Sheets["Optional Detail"], [["2026-01-01", 13000]], { origin: "A6" });
    expect(parse(reserve).errors).toContain("Optional Detail row 6: Taxes reserved cannot exceed unavailable cash for 2026-01-01.");
  });

  it("requires valid workbook-level currency and accounting basis", () => {
    const book = workbook();
    XLSX.utils.sheet_add_aoa(book.Sheets["Start Here"], [["US dollars"], [""]], { origin: "B11" });
    const result = parse(book);
    expect(result.errors).toContain("Start Here: Reporting currency must be a three-letter currency code, such as USD.");
    expect(result.errors).toContain("Start Here: Accounting basis is required.");
  });

  it.each([
    ["Cash basis", "cash"],
    ["Accrual basis", "accrual"],
  ])("normalizes the owner-facing accounting basis label %s", (label, expected) => {
    const book = workbook();
    XLSX.utils.sheet_add_aoa(book.Sheets["Start Here"], [[label]], { origin: "B12" });

    const result = parse(book);

    expect(result.errors).toEqual([]);
    expect(result.months[0]?.accounting_basis).toBe(expected);
  });

  it("identifies a Monthly Cash CSV and explains why the original workbook is required", () => {
    const csv = XLSX.utils.sheet_to_csv(workbook().Sheets["Monthly Cash"]);
    const bytes = new TextEncoder().encode(csv);

    const result = parseExcelBuffer(bytes.buffer, "monthly-cash.csv");

    expect(result.contractVersion).toBe(2);
    expect(result.months).toEqual([]);
    expect(result.errors).toEqual([
      "This CSV contains version-2 Monthly Cash data but does not include the reporting currency and accounting basis from Start Here. Upload the original Elidan .xlsx workbook so those required details are preserved.",
    ]);
  });

  it.each([
    [",", "legacy.csv"],
    [";", "legacy-semicolon.csv"],
  ])("retains bounded legacy CSV parsing with %s delimiters", (delimiter, filename) => {
    const csv = [
      ["Month", "Opening Cash", "Closing Cash", "Total Revenue", "Total Expenses"].join(delimiter),
      ["2026-01-01", "100", "110", "50", "40"].join(delimiter),
    ].join("\n");

    const result = parseExcelBuffer(new TextEncoder().encode(csv).buffer, filename);

    expect(result.errors).toEqual([]);
    expect(result.months).toEqual([expect.objectContaining({
      month_date: "2026-01-01",
      opening_cash: 100,
      closing_cash: 110,
      total_revenue: 50,
      total_expenses: 40,
    })]);
  });
});
