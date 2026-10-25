import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseResult } from "../lib/excelParser";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("../lib/excelParser", () => ({ parseExcelBuffer: vi.fn() }));
vi.mock("../lib/db", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/db")>(),
  hasPaidSubscription: vi.fn(), logDataImport: vi.fn(),
}));

import { createClient } from "../utils/supabase/server";
import { createServiceClient } from "../utils/supabase/service";
import { parseExcelBuffer } from "../lib/excelParser";
import { hasPaidSubscription, logDataImport, replaceFinancialImport, importFinancialData } from "../lib/db";
import { POST } from "../app/api/import/confirm/route";
import { POST as REVIEW } from "../app/api/import/review/route";
import { POST as LEGACY } from "../app/api/import/route";
import { POST as LEGACY_MODES } from "../app/api/import/modes/route";
import { importFileHash, issueImportReviewToken, verifyImportReviewToken } from "../lib/financialImportReviewToken";
import {
  MAX_FINANCIAL_FILE_BYTES,
  MAX_FINANCIAL_MONTHS,
  MAX_FINANCIAL_REQUEST_BYTES,
  MAX_IMPORT_ERRORS_RETURNED,
} from "../lib/financialUploadLimits";

const rpc = vi.fn();
const getUser = vi.fn();
const from = vi.fn(() => { throw new Error("Financial writes must use the transaction RPC"); });
const service = { rpc, from } as unknown as SupabaseClient;
const user = { id: "own-user", email_confirmed_at: "2026-10-01T00:00:00Z" };
let parsed: ParseResult;
const reviewedState = "a".repeat(32);
let reviewedFileHash: string;

function workbookBytes(label = "synthetic workbook") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[label]]), "Monthly Data");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

const defaultWorkbook = workbookBytes();

function month(date = "2026-09-01") {
  return { month_date: date, opening_cash: 100, closing_cash: 90, total_revenue: 50,
    total_expenses: 60, payroll: null, ar_outstanding: null, ap_outstanding: null, notes: null };
}
function request(file: File | string | null = new File([defaultWorkbook], "import.xlsx"), modes: (string | File)[] = []) {
  const body = new FormData();
  if (file !== null) body.append("file", file);
  body.append("user_id", "another-account");
  for (const mode of modes) body.append("mode", mode);
  const mode = modes[0] === "replace_all" ? "replace_all" : "update_months";
  body.append("reviewToken", issueImportReviewToken({ userId: user.id, mode,
    filename: file instanceof File ? file.name : "import.xlsx", fileHash: reviewedFileHash }, reviewedState));
  return new NextRequest("https://app.example.invalid/api/import?user_id=another-account", { method: "POST", body });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-import-review-test-key");
  reviewedFileHash = importFileHash(defaultWorkbook.buffer);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  parsed = { months: [month()], profile: { business_name: "Test business" }, warnings: ["A warning"], errors: [] };
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser }, from } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createServiceClient).mockReturnValue(service);
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(parseExcelBuffer).mockImplementation(() => structuredClone(parsed));
  rpc.mockImplementation(async (name, args) => {
    const dates = args.p_months.map((m: { month_date: string }) => m.month_date).sort();
    return { data: { unchanged: false, replaced: false, months_imported: args.p_months.length,
      ...(name === "import_financial_data" || name === "import_reviewed_financial_data" ? { mode: args.p_mode, months_total: dates.length,
        date_from: dates[0], date_to: dates.at(-1), current_cash: 90 } : {}) }, error: null };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("financial import authorization and validation", () => {
  it.each(["missing", "error", "unverified", "unpaid"])("rejects %s authorization before reading the upload or creating a service client", async condition => {
    if (condition === "missing") getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (condition === "error") getUser.mockResolvedValue({ data: { user }, error: new Error("Invalid session") });
    if (condition === "unverified") getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
    if (condition === "unpaid") vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    const req = request();
    const readForm = vi.spyOn(req, "formData");
    const response = await POST(req);
    expect(response.status).toBe(condition === "unpaid" ? 402 : condition === "unverified" ? 403 : 401);
    expect(readForm).not.toHaveBeenCalled();
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it.each([null, "not a file"])("rejects a missing or non-file upload: %s", async file => {
    expect((await POST(request(file))).status).toBe(400);
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid upload form", async () => {
    const req = new NextRequest("https://app.example.invalid/api/import", { method: "POST", body: "bad form" });
    expect((await POST(req)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized request before reading multipart form data", async () => {
    const req = request();
    req.headers.set("content-length", String(MAX_FINANCIAL_REQUEST_BYTES + 1));
    const readForm = vi.spyOn(req, "formData");
    const response = await POST(req);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "IMPORT_REQUEST_TOO_LARGE" });
    expect(readForm).not.toHaveBeenCalled();
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before parsing or writing", async () => {
    const response = await POST(request(new File([
      new Uint8Array(MAX_FINANCIAL_FILE_BYTES + 1),
    ], "large.xlsx")));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "IMPORT_FILE_TOO_LARGE" });
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [new File([], "empty.xlsx"), "IMPORT_FILE_EMPTY"],
    [new File(["values"], "financials.txt"), "IMPORT_FILE_TYPE"],
  ])("rejects invalid file metadata before parsing: %s", async (file, code) => {
    const response = await POST(request(file));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for an unreadable workbook", async () => {
    vi.mocked(parseExcelBuffer).mockImplementation(() => { throw new Error("Internal parser detail"); });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("Internal parser detail");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["parser errors", "no months", "duplicate month", "invalid month", "infinite financial amount", "infinite profile value"])("rejects %s before any financial writes", async condition => {
    if (condition === "parser errors") parsed.errors.push("Invalid workbook column");
    if (condition === "no months") parsed.months = [];
    if (condition === "duplicate month") parsed.months.push(month());
    if (condition === "invalid month") parsed.months[0].month_date = "2026-13-01";
    if (condition === "infinite financial amount") parsed.months[0].closing_cash = Infinity;
    if (condition === "infinite profile value") parsed.profile.min_cash_reserve = Infinity;
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, errors: expect.any(Array) });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects more than 20 years of monthly records before any financial writes", async () => {
    parsed.months = Array.from({ length: MAX_FINANCIAL_MONTHS + 1 }, (_, index) => ({
      ...month(`${2026 - Math.floor(index / 12)}-${String(12 - (index % 12)).padStart(2, "0")}-01`),
      closing_cash: 90 + index,
    }));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain(
      `The file contains more than ${MAX_FINANCIAL_MONTHS} financial months. Import no more than 20 years at a time.`
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bounds parser errors returned to the user and logs the same safe list", async () => {
    parsed.errors = Array.from({ length: MAX_IMPORT_ERRORS_RETURNED + 10 }, (_, index) => `Issue ${index + 1}`);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.errors).toHaveLength(MAX_IMPORT_ERRORS_RETURNED + 1);
    expect(body.errors.at(-1)).toContain("10 additional issues were omitted");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("atomic import route and database adapter", () => {
  it("accepts the existing Excel template through the real workbook parser", async () => {
    const actual = await vi.importActual<typeof import("../lib/excelParser")>("../lib/excelParser");
    vi.mocked(parseExcelBuffer).mockImplementation(actual.parseExcelBuffer);
    const content = new Uint8Array(readFileSync("__tests__/fixtures/elidan-financial-template.xlsx"));
    reviewedFileHash = importFileHash(content.buffer);
    const response = await POST(request(new File([content], "template.xlsx")));
    expect(response.status).toBe(200);
    expect((await response.json()).monthsImported).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledOnce();
    const payload = rpc.mock.calls[0][1].p_profile;
    expect(payload).not.toHaveProperty("min_cash_reserve");
    expect(payload).not.toHaveProperty("runway_warning_threshold");
    expect(payload).not.toHaveProperty("runway_danger_threshold");
    expect(payload).not.toHaveProperty("burn_rate_warning_pct");
    expect(payload).not.toHaveProperty("invoice_overdue_days");
  });

  it("passes a reconciled version-2 workbook to the reviewed atomic import", async () => {
    const actual = await vi.importActual<typeof import("../lib/excelParser")>("../lib/excelParser");
    vi.mocked(parseExcelBuffer).mockImplementation(actual.parseExcelBuffer);
    const workbook = XLSX.read(readFileSync("docs/templates/elidan-financial-template-v2.xlsx"), {
      type: "buffer", cellDates: true, cellFormula: true,
    });
    XLSX.utils.sheet_add_aoa(workbook.Sheets["Start Here"], [["Cash"]], { origin: "B12" });
    XLSX.utils.sheet_add_aoa(workbook.Sheets["Monthly Cash"], [[
      "2026-01-01", "Complete", null, 100000, 75000, 60000, 3000, 2000, 500,
      8000, 0, 0, 10000, 0, 1500, 110000, 12000, null, null, "January close",
    ]], { origin: "A7" });
    const content = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
    reviewedFileHash = importFileHash(content.buffer);

    const response = await POST(request(new File([content], "v2-template.xlsx")));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ monthsImported: 1, currentCash: 90 });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1].p_months).toEqual([expect.objectContaining({
      data_contract_version: 2,
      source_type: "spreadsheet",
      reporting_currency: "USD",
      accounting_basis: "cash",
      opening_included_cash: 100000,
      closing_included_cash: 110000,
      cash_collected_from_customers: 75000,
      total_expenses: 75000,
    })]);
  });

  it("warns when workbook thresholds are ignored while still importing business details", async () => {
    parsed.profile = { business_name: "Updated business", min_cash_reserve: 25000,
      runway_warning_threshold: 6, runway_danger_threshold: 3, burn_rate_warning_pct: 0.1,
      invoice_overdue_days: 30 };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toContain(
      "Workbook alert thresholds were ignored. Manage your alert thresholds in Settings."
    );
    expect(rpc.mock.calls[0][1].p_profile).toEqual({ business_name: "Updated business" });
    expect(parsed.profile).toMatchObject({ min_cash_reserve: 25000, burn_rate_warning_pct: 0.1 });
  });

  it.each([null, 0, 25000])("excludes workbook settings from direct adapter calls, including reserve %s", async reserve => {
    await replaceFinancialImport(user.id, parsed.months, {
      business_name: "Business", min_cash_reserve: reserve, runway_warning_threshold: 6,
      runway_danger_threshold: 3, burn_rate_warning_pct: 0.1, invoice_overdue_days: 30,
    }, "legacy.xlsx", service);
    expect(rpc.mock.calls[0][1].p_profile).toEqual({ business_name: "Business" });
  });

  it("does not add account warnings for a financial-only workbook", async () => {
    parsed.profile = {};
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toEqual(["A warning"]);
    expect(rpc.mock.calls[0][1].p_profile).toEqual({});
  });

  it.each([false, true])("returns the committed result for replaced=%s and uses only the signed-in account", async replaced => {
    parsed.months = [month("2026-09-01"), { ...month("2026-08-01"), closing_cash: 110 }];
    rpc.mockResolvedValue({ data: { unchanged: false, replaced, months_imported: 2, mode: "update_months", months_total: 2,
      date_from: "2026-08-01", date_to: "2026-09-01", current_cash: 90 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, replaced, monthsImported: 2,
      warnings: ["A warning", "Workbook business details only fill empty fields during onboarding. Existing account details are preserved."],
      dateRange: { from: "2026-08-01", to: "2026-09-01" }, currentCash: 90 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("import_reviewed_financial_data", {
      p_user_id: user.id, p_months: parsed.months, p_profile: parsed.profile, p_filename: "import.xlsx",
      p_mode: "update_months",
      p_expected_state: reviewedState,
    });
    expect(from).not.toHaveBeenCalled();
    // Success auditing belongs to the database transaction, not a later request.
    expect(logDataImport).not.toHaveBeenCalled();
  });

  it("returns an explicit no-op without claiming that any months were imported", async () => {
    rpc.mockResolvedValue({ data: { unchanged: true, replaced: true, months_imported: 0,
      mode: "update_months", months_total: 12, date_from: "2025-10-01",
      date_to: "2026-09-01", current_cash: 4500 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, unchanged: true,
      monthsImported: 0, monthsTotal: 12, currentCash: 4500 });
    expect(logDataImport).not.toHaveBeenCalled();
  });

  it.each(["database unavailable", "RPC migration missing"])("fails without falling back to destructive writes: %s", async message => {
    rpc.mockResolvedValue({ data: null, error: { message, code: "test" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ requestId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain(message);
    expect(body.detail).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(logDataImport).toHaveBeenCalledWith(user.id, expect.objectContaining({ status: "error", error_message: message }), expect.anything());
  });

  it("retains a safe failure response if error auditing also fails", async () => {
    rpc.mockRejectedValue(new Error("Database unavailable"));
    vi.mocked(logDataImport).mockRejectedValue(new Error("Audit unavailable"));
    expect((await POST(request())).status).toBe(500);
  });

  it("propagates database errors from the adapter", async () => {
    const failure = { code: "23505", message: "Duplicate month" };
    rpc.mockResolvedValue({ data: null, error: failure });
    await expect(replaceFinancialImport(user.id, parsed.months, parsed.profile, "test.xlsx", service)).rejects.toBe(failure);
  });

  it.each([null, {}, { replaced: true, months_imported: 0 }])("rejects an unconfirmed RPC result: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(replaceFinancialImport(user.id, parsed.months, parsed.profile, "test.xlsx", service)).rejects.toThrow("Invalid financial import result");
  });
});

describe("explicit import modes", () => {
  it.each(["update_months", "replace_all"])("passes %s without accepting account IDs from the form", async mode => {
    const response = await POST(request(undefined, [mode]));
    expect(response.status).toBe(200);
    expect((await response.json()).mode).toBe(mode);
    expect(rpc).toHaveBeenCalledWith("import_reviewed_financial_data", expect.objectContaining({ p_mode: mode, p_user_id: user.id }));
  });

  it.each([[""], ["merge"], ["REPLACE_ALL"], [" replace_all"], ["update_months", "replace_all"],
    [new File(["replace_all"], "mode.txt")]].map(modes => ({ modes })))("rejects invalid or repeated mode fields before parsing: $modes", async ({ modes }) => {
    expect((await POST(request(undefined, modes))).status).toBe(400);
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the resulting dataset summary when older months are uploaded", async () => {
    rpc.mockResolvedValue({ data: { unchanged: false, replaced: true, months_imported: 1, mode: "update_months", months_total: 12,
      date_from: "2026-01-01", date_to: "2026-12-01", current_cash: 4321 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ monthsImported: 1, monthsTotal: 12,
      dateRange: { from: "2026-01-01", to: "2026-12-01" }, currentCash: 4321 });
  });

  it.each([null, {}, { replaced: true, months_imported: 1 },
    { mode: "replace_all" }, { months_total: 0 }, { date_to: "2025-01-01" },
    { current_cash: "90" }, { current_cash: Infinity }])("rejects absent, legacy or inconsistent mode-aware acknowledgments: %j", async patch => {
    const base = { unchanged: false, replaced: true, months_imported: 1, mode: "update_months", months_total: 1,
      date_from: "2026-09-01", date_to: "2026-09-01", current_cash: 90 };
    const data = patch === null || Object.keys(patch).length === 0 || "replaced" in patch ? patch : { ...base, ...patch };
    rpc.mockResolvedValue({ data, error: null });
    await expect(importFinancialData(user.id, parsed.months, parsed.profile, "file.xlsx", "update_months", service))
      .rejects.toThrow("Invalid financial import result");
  });

  it("never falls back to full replacement if the new RPC is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing migration" } });
    expect((await POST(request())).status).toBe(500);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("import_reviewed_financial_data", expect.anything());
    expect(from).not.toHaveBeenCalled();
  });
});

describe("read-only upload review and guarded confirmation", () => {
  it("surfaces a v2 semantic no-op during review without offering a confirmation write", async () => {
    parsed.contractVersion = 2;
    rpc.mockImplementation(async name => name === "financial_import_review_state"
      ? { data: { state_version: reviewedState, months: ["2026-09-01"] }, error: null }
      : name === "financial_import_v2_is_unchanged" ? { data: true, error: null }
      : { data: null, error: { message: "unexpected rpc" } });
    const response = await REVIEW(request());
    expect(response.status).toBe(200);
    expect((await response.json()).review.unchanged).toBe(true);
    expect(rpc).toHaveBeenCalledWith("financial_import_v2_is_unchanged", expect.objectContaining({p_user_id:user.id,p_mode:"update_months"}));
    expect(rpc).not.toHaveBeenCalledWith("import_reviewed_financial_data", expect.anything());
  });
  it("returns missing-month consequences in a read-only review without changing the commit contract", async () => {
    parsed.months = [month("2025-02-01"),month("2025-04-01")];
    rpc.mockResolvedValue({ data: {state_version:reviewedState,months:["2025-03-01"]}, error:null });
    const response = await REVIEW(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.warnings).toContain("Missing from this file: March 2025. Your saved data for these months will be kept.");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("financial_import_review_state",{p_user_id:user.id});
    expect(from).not.toHaveBeenCalled();
    expect(logDataImport).not.toHaveBeenCalled();
  });
  it("prepares historical additions without financial writes, profiles, revisions or audit calls", async () => {
    parsed.months = [month("2024-01-01")];
    rpc.mockResolvedValue({ data: { state_version: reviewedState,
      months: Array.from({length:12},(_,i) => "2025-" + String(i+1).padStart(2,"0") + "-01") }, error: null });
    const response = await REVIEW(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.review).toMatchObject({ addedMonths: ["2024-01-01"], updatedMonths: [], removedMonths: [],
      olderMonths: ["2024-01-01"], resultingLatestMonth: "2025-12-01", outsideDashboardMonths: ["2024-01-01"] });
    expect(verifyImportReviewToken(body.reviewToken,{ userId:user.id,mode:"update_months",filename:"import.xlsx",fileHash:reviewedFileHash })).toBe(reviewedState);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("financial_import_review_state",{p_user_id:user.id});
    expect(from).not.toHaveBeenCalled();
    expect(logDataImport).not.toHaveBeenCalled();
  });

  it.each([LEGACY,LEGACY_MODES])("retires direct-write endpoints with an actionable review-required response", async handler => {
    const req = request();
    const readForm = vi.spyOn(req,"formData");
    const response = await handler(req);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"IMPORT_REVIEW_REQUIRED"});
    expect(readForm).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(parseExcelBuffer).not.toHaveBeenCalled();
  });

  it.each(["missing","tampered","account","mode","filename","file","expired","repeated"])("rejects %s confirmation tokens before parsing or database work", async kind => {
    const form = await request().formData();
    if (kind === "missing") form.delete("reviewToken");
    if (kind === "tampered") form.set("reviewToken",String(form.get("reviewToken")) + "a");
    if (kind === "account") form.set("reviewToken",issueImportReviewToken({userId:"other-user",mode:"update_months",filename:"import.xlsx",fileHash:reviewedFileHash},reviewedState));
    if (kind === "mode") form.set("mode","replace_all");
    if (kind === "filename") form.set("file",new File([defaultWorkbook],"renamed.xlsx"));
    if (kind === "file") form.set("file",new File([workbookBytes("different workbook")],"import.xlsx"));
    if (kind === "expired") form.set("reviewToken",issueImportReviewToken({userId:user.id,mode:"update_months",filename:"import.xlsx",fileHash:reviewedFileHash},reviewedState,Date.now()-3600000));
    if (kind === "repeated") form.append("reviewToken",String(form.get("reviewToken")));
    const response = await POST(new NextRequest("https://app.example.invalid/api/import/confirm",{method:"POST",body:form}));
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
    expect(parseExcelBuffer).not.toHaveBeenCalled();
    expect(logDataImport).not.toHaveBeenCalled();
  });

  it("returns a stale-review conflict without writing an import-error audit", async () => {
    rpc.mockResolvedValue({data:null,error:{code:"P0001",message:"import_review_stale"}});
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"IMPORT_REVIEW_STALE"});
    expect(logDataImport).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not log an import audit if read-only review preparation fails", async () => {
    rpc.mockResolvedValue({data:null,error:{code:"test",message:"Private database detail"}});
    const response = await REVIEW(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Private database detail");
    expect(logDataImport).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("financial_import_review_state",{p_user_id:user.id});
  });

  it.each([null,{}, {state_version:reviewedState,months:["bad"]},
    {state_version:reviewedState,months:["2025-01-01","2025-01-01"]}])("rejects malformed database review state: %j", async data => {
    rpc.mockResolvedValue({data,error:null});
    expect((await REVIEW(request())).status).toBe(500);
    expect(logDataImport).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("financial_import_review_state",{p_user_id:user.id});
  });
});
