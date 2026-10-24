import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportUploader from "../app/components/ImportUploader";
import ImportReviewCard from "../app/components/ImportReviewCard";
import { createImportUploadRequest } from "../lib/financialImportUpload";
import { buildImportReview } from "../lib/financialImportReview";
import type { FinancialImportMode } from "../lib/financialImportPolicy";

const file = new File(["synthetic"], "months.xlsx");
const existingMonths = Array.from({ length: 12 }, (_, i) => "2025-" + String(i + 1).padStart(2,"0") + "-01");
const review = (mode: FinancialImportMode = "update_months") => buildImportReview(file.name,mode,["2024-01-01"],
  { state_version: "a".repeat(32), months: existingMonths },[]);
const prepared = (mode: FinancialImportMode = "update_months") => ({ success: true, review: review(mode), reviewToken: "synthetic.token" });
const success = (mode: FinancialImportMode = "update_months") => ({ success: true, mode, replaced: true,
  monthsImported: 1, monthsTotal: mode === "replace_all" ? 1 : 13,
  dateRange: { from: "2024-01-01", to: mode === "replace_all" ? "2024-01-01" : "2025-12-01" }, currentCash: 1234, warnings: [] });
afterEach(() => vi.restoreAllMocks());

describe("reviewed financial upload", () => {
  it("defaults the uploader to preserving other months", () => {
    const markup = renderToStaticMarkup(createElement(ImportUploader,{ hasData: true }));
    expect(markup).toContain('<option value="update_months" selected="">');
    expect(markup).toContain("Keep other months.");
    expect(markup).toContain("aria-describedby=");
  });

  it.each(["update_months","replace_all"] as const)("reviews before sending a %s confirmation", async mode => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(prepared(mode))).mockResolvedValueOnce(Response.json(success(mode)));
    const client = createImportUploadRequest(send);
    expect(await client.prepare(file,mode)).toEqual(review(mode));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("/api/import/review");
    expect(client.hasReview()).toBe(true);
    expect(await client.confirm()).toEqual(success(mode));
    expect(send.mock.calls[1][0]).toBe("/api/import/confirm");
    const form = send.mock.calls[1][1]?.body as FormData;
    expect(form.get("mode")).toBe(mode);
    expect(form.get("reviewToken")).toBe("synthetic.token");
    expect((form.get("file") as File).name).toBe(file.name);
    expect(await (form.get("file") as File).text()).toBe("synthetic");
    expect(form.has("user_id")).toBe(false);
    expect(client.hasReview()).toBe(false);
  });

  it("cancels a review without a confirmation request", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(prepared()));
    const client = createImportUploadRequest(send);
    await client.prepare(file,"update_months");
    client.cancel();
    expect(await client.confirm()).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(client.hasReview()).toBe(false);
  });

  it("cannot confirm without a prepared review", async () => {
    const send = vi.fn<typeof fetch>();
    expect(await createImportUploadRequest(send).confirm()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks overlapping prepares and confirmation while preparing", async () => {
    let resolve!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockReturnValue(new Promise(r => { resolve = r; }));
    const client = createImportUploadRequest(send);
    const first = client.prepare(file,"update_months");
    expect(client.isPending()).toBe(true);
    expect(await client.prepare(file,"replace_all")).toBeNull();
    expect(await client.confirm()).toBeNull();
    resolve(Response.json(prepared()));
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate confirmations before and after the first response", async () => {
    let resolve!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(prepared()))
      .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const client = createImportUploadRequest(send);
    await client.prepare(file,"update_months");
    const first = client.confirm();
    expect(await client.confirm()).toBeNull();
    resolve(Response.json(success()));
    await first;
    expect(await client.confirm()).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps review state scoped to each uploader", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(prepared()));
    const first = createImportUploadRequest(send);
    const second = createImportUploadRequest(send);
    await first.prepare(file,"update_months");
    expect(await second.confirm()).toBeNull();
    first.cancel();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh review after a stale confirmation", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(prepared()))
      .mockResolvedValueOnce(Response.json({ error: "Your financial data changed. Review again." },{status:409}));
    const client = createImportUploadRequest(send);
    await client.prepare(file,"update_months");
    await expect(client.confirm()).rejects.toThrow("Review again");
    expect(client.hasReview()).toBe(false);
    expect(await client.confirm()).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("treats a lost confirmation response as unknown and does not retry", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(prepared())).mockRejectedValueOnce(new Error("Private network detail"));
    const client = createImportUploadRequest(send);
    await client.prepare(file,"update_months");
    await expect(client.confirm()).rejects.toThrow("Refresh the dashboard before retrying");
    expect(client.isPending()).toBe(false);
    expect(await client.confirm()).toBeNull();
  });

  it.each([{},[],{success:true},{...prepared(),reviewToken:""},{...prepared(),review:{...review(),mode:"replace_all"}},
    {...prepared(),review:{...review(),filename:"other.xlsx"}},
    {...prepared(),review:{...review(),addedMonths:[],updatedMonths:[]}}])("rejects malformed/legacy review responses: %j", async payload => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const client = createImportUploadRequest(send);
    await expect(client.prepare(file,"update_months")).rejects.toThrow("could not be reviewed");
    expect(await client.confirm()).toBeNull();
  });

  it.each([{},[],{success:true},{...success(),mode:"replace_all"},{...success(),monthsTotal:0},
    {...success(),warnings:[123]},{...success(),currentCash:"1234"},{...success(),dateRange:null}])("rejects malformed confirmation responses: %j", async payload => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(prepared())).mockResolvedValueOnce(Response.json(payload));
    const client = createImportUploadRequest(send);
    await client.prepare(file,"update_months");
    await expect(client.confirm()).rejects.toThrow("could not be confirmed");
  });

  it("preserves actionable workbook errors", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({errors:["Duplicate month: 2024-01-01."]},{status:400}));
    await expect(createImportUploadRequest(send).prepare(file,"update_months")).rejects.toThrow("Duplicate month");
  });

  it.each([200,404,500])("does not fall back to a legacy endpoint on HTML status %s", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Private details</html>",{status}));
    await expect(createImportUploadRequest(send).prepare(file,"update_months")).rejects.toThrow("could not be reviewed");
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/import/review",expect.anything());
  });

  it("shows historical retention without promising unavailable features", () => {
    const markup = renderToStaticMarkup(createElement(ImportReviewCard,{review:review(),onConfirm:vi.fn(),onCancel:vi.fn()}));
    expect(markup).toContain("Review your upload");
    expect(markup).toContain("latest 12 stored months");
    expect(markup).toContain("Historical browsing and forecasting are not available yet.");
    expect(markup).toContain("Add 1 month");
  });

  it("identifies newer months that replacement will remove and escapes user text", () => {
    const changed = {...review("replace_all"),filename:"<script>unsafe</script>",warnings:["<em>unsafe</em>"]};
    const markup = renderToStaticMarkup(createElement(ImportReviewCard,{review:changed,onConfirm:vi.fn(),onCancel:vi.fn()}));
    expect(markup).toContain("12 saved months");
    expect(markup).toContain("Replace all data with 1 month");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<em>");
  });

  it.each(["update_months", "replace_all"] as const)("shows missing-month consequences before the %s confirmation", mode => {
    const missing = buildImportReview(file.name,mode,existingMonths.filter(date => date !== "2025-03-01"),
      {state_version:"a".repeat(32),months:existingMonths},[]);
    const markup = renderToStaticMarkup(createElement(ImportReviewCard,{review:missing,onConfirm:vi.fn(),onCancel:vi.fn()}));
    expect(markup).toContain("Missing from this file: March 2025.");
    expect(markup).toContain(mode === "update_months" ? "will be kept" : "will be removed because Replace all is selected");
    expect(markup).toContain("You can continue with this upload, or cancel and correct the workbook.");
    expect(markup).toContain(mode === "update_months" ? "Update 11 months" : "Replace all data with 11 months");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Cancel");
  });
});
