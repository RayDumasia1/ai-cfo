import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
vi.mock("server-only", () => ({}));
import { parseExcelBuffer } from "../lib/excelParser";
import { buildImportReview, getImportReviewNotices, isImportReview } from "../lib/financialImportReview";
import { WORKBOOK_BUSINESS_WARNING, WORKBOOK_THRESHOLD_WARNING } from "../lib/financialImportPolicy";
import ImportReviewCard from "../app/components/ImportReviewCard";

const state = {state_version:"a".repeat(32),months:[] as string[]};
const months = ["2025-01-01","2025-02-01","2025-04-01"];
const markup = (review: ReturnType<typeof buildImportReview>) => renderToStaticMarkup(createElement(ImportReviewCard,{review,onConfirm:vi.fn(),onCancel:vi.fn()}));

describe("import notice hierarchy", () => {
  it("keeps missing-data warnings expanded while routine notes are disclosed", () => {
    const review = buildImportReview("file.xlsx","update_months",months,state,[WORKBOOK_THRESHOLD_WARNING,WORKBOOK_BUSINESS_WARNING]);
    const html = markup(review);
    const additional = html.indexOf("Additional import information");
    expect(html.indexOf("Missing months")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('data-notice-category="warning"');
    expect(html.indexOf(WORKBOOK_THRESHOLD_WARNING)).toBeGreaterThan(additional);
    expect(html.indexOf(WORKBOOK_BUSINESS_WARNING)).toBeGreaterThan(additional);
    expect(html).toContain("To add");
    expect(html).toContain("To update");
    expect(html).toContain("To remove");
    expect(html.replace(/<!--.*?-->/g,"")).toContain("3 months ready to import");
    expect(html).not.toContain("Saved values will be replaced");
    expect(html).not.toContain("Old expense breakdowns");
  });

  it("discloses destructive overwrite and blank-field effects before month details", () => {
    const html = markup(buildImportReview("update.xlsx","update_months",["2025-01-01"],{...state,months:["2025-01-01"]},[]));
    const details = html.indexOf("<details");
    expect(html.indexOf("Destructive change")).toBeLessThan(details);
    expect(html.indexOf("including blank fields")).toBeLessThan(details);
    expect(html.indexOf("Old expense breakdowns")).toBeLessThan(details);
    expect(html).toContain('data-notice-category="danger"');
    expect(html.replace(/<!--.*?-->/g,"")).toContain("1 month ready to import");
  });

  it("shows destructive omissions ahead of missing-data warnings", () => {
    const html = markup(buildImportReview("replace.xlsx","replace_all",months,{...state,months:["2025-05-01"]},[]));
    expect(html.indexOf("Replace all financial data")).toBeLessThan(html.indexOf("Missing months"));
    expect(html.indexOf("will be removed from your current dataset")).toBeLessThan(html.indexOf("<details"));
  });

  it("keeps unknown warnings visible and supports older review responses", () => {
    const review = buildImportReview("old.xlsx","update_months",["2025-01-01"],state,["Unrecognized warning"]);
    delete review.notices;
    expect(isImportReview(review,"update_months")).toBe(true);
    const html = markup(review);
    expect(html.indexOf("Unrecognized warning")).toBeLessThan(html.indexOf("<details"));
    expect(getImportReviewNotices(review)).toMatchObject([{category:"warning"}]);
  });

  it.each([null,{},[{category:"unknown",code:"x",title:"x",message:"x"}],[{category:"info",code:"x",title:"x",message:123}]])(
    "rejects malformed structured notices: %j", notices => {
      const review = {...buildImportReview("file.xlsx","update_months",months,state,[]),notices};
      expect(isImportReview(review,"update_months")).toBe(false);
    });

  it("escapes notice titles and messages", () => {
    const review = buildImportReview("file.xlsx","update_months",["2025-01-01"],state,[]);
    review.notices = [{code:"test",category:"warning",title:"<script>title</script>",message:"<img src=x onerror=alert(1)>"}];
    const html = markup(review);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });
});

describe("parser review notice metadata", () => {
  it("says ready to import when reading stops and carries the warning title through the review", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
      ["Month","Opening Cash","Closing Cash","Total Revenue","Total Expenses"],
      ["2025-01-01",1000,900,100,200],
      ["Totals",1000,900,100,200],
      ["2025-02-01",900,800,100,200],
    ]),"Monthly Summary");
    const parsed = parseExcelBuffer(XLSX.write(workbook,{type:"array",bookType:"xlsx"}));
    expect(parsed.months).toHaveLength(1);
    expect(parsed.warnings).toContain("Stopped reading at row 3 — non-date value found in Month column. 1 month ready to import. Check that no financial rows follow it.");
    expect(parsed.notices).toContainEqual(expect.objectContaining({code:"reading_stopped",category:"warning",title:"File reading stopped early"}));
    const review = buildImportReview("file.xlsx","update_months",parsed.months.map(month => month.month_date),state,parsed.warnings,parsed.notices);
    const html = markup(review);
    expect(html.indexOf("File reading stopped early")).toBeLessThan(html.indexOf("<details"));
    expect(html).not.toContain("1 month imported");
  });
});
