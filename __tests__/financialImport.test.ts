import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseResult } from "../lib/excelParser";
import { readFileSync } from "node:fs";

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
import { hasPaidSubscription, logDataImport, replaceFinancialImport } from "../lib/db";
import { POST } from "../app/api/import/route";

const rpc = vi.fn();
const getUser = vi.fn();
const from = vi.fn(() => { throw new Error("Financial writes must use the transaction RPC"); });
const service = { rpc, from } as unknown as SupabaseClient;
const user = { id: "own-user", email_confirmed_at: "2026-10-01T00:00:00Z" };
let parsed: ParseResult;

function month(date = "2026-09-01") {
  return { month_date: date, opening_cash: 100, closing_cash: 90, total_revenue: 50,
    total_expenses: 60, payroll: null, ar_outstanding: null, ap_outstanding: null, notes: null };
}
function request(file: File | string | null = new File(["synthetic workbook"], "import.xlsx")) {
  const body = new FormData();
  if (file !== null) body.append("file", file);
  body.append("user_id", "another-account");
  return new NextRequest("https://app.example.invalid/api/import?user_id=another-account", { method: "POST", body });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  parsed = { months: [month()], profile: { business_name: "Test business" }, warnings: ["A warning"], errors: [] };
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser }, from } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createServiceClient).mockReturnValue(service);
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(parseExcelBuffer).mockImplementation(() => parsed);
  rpc.mockImplementation(async (_name, args) => ({ data: { replaced: false, months_imported: args.p_months.length }, error: null }));
});
afterEach(() => vi.restoreAllMocks());

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
});

describe("atomic import route and database adapter", () => {
  it("accepts the existing Excel template through the real workbook parser", async () => {
    const actual = await vi.importActual<typeof import("../lib/excelParser")>("../lib/excelParser");
    vi.mocked(parseExcelBuffer).mockImplementation(actual.parseExcelBuffer);
    const content = new Uint8Array(readFileSync("__tests__/fixtures/elidan-financial-template.xlsx"));
    const response = await POST(request(new File([content], "template.xlsx")));
    expect(response.status).toBe(200);
    expect((await response.json()).monthsImported).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([false, true])("returns the committed result for replaced=%s and uses only the signed-in account", async replaced => {
    parsed.months = [month("2026-09-01"), { ...month("2026-08-01"), closing_cash: 110 }];
    rpc.mockResolvedValue({ data: { replaced, months_imported: 2 }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, replaced, monthsImported: 2,
      warnings: ["A warning"], dateRange: { from: "2026-08-01", to: "2026-09-01" }, currentCash: 90 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("replace_financial_import", {
      p_user_id: user.id, p_months: parsed.months, p_profile: parsed.profile, p_filename: "import.xlsx",
    });
    expect(from).not.toHaveBeenCalled();
    // Success auditing belongs to the database transaction, not a later request.
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
