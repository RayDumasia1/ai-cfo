import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const path = "public/downloads/elidan-financial-template-v2.xlsx";
const candidatePath = "docs/templates/elidan-financial-template-v2.xlsx";

describe("launch financial template v2", () => {
  const workbook = XLSX.read(readFileSync(path), {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
  });

  it("publishes the validated candidate without workbook drift", () => {
    expect(readFileSync(path)).toEqual(readFileSync(candidatePath));
  });

  it("ships only the intended owner-facing worksheets", () => {
    expect(workbook.SheetNames).toEqual([
      "Start Here",
      "Monthly Cash",
      "Optional Detail",
      "Worked Example",
    ]);
  });

  it("uses the classified cash contract without preloading customer rows", () => {
    const sheet = workbook.Sheets["Monthly Cash"];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];

    expect(rows[5]).toEqual([
      "Month",
      "Period status",
      "Cutoff date",
      "Opening included cash",
      "Cash collected from customers",
      "Operating cash paid",
      "Owner draws or distributions",
      "Debt principal paid",
      "Debt interest paid",
      "Asset purchases",
      "Asset sale proceeds",
      "New debt received",
      "Owner or equity funding",
      "Other cash in",
      "Other cash out",
      "Closing included cash",
      "Unavailable cash",
      "Reconciliation difference",
      "Row check",
      "Notes",
    ]);
    expect(rows.slice(6).every(row => row[0] == null)).toBe(true);
  });

  it("retains reconciliation and readiness formulas in customer input rows", () => {
    const sheet = workbook.Sheets["Monthly Cash"];
    expect(sheet.R7?.f).toContain("ROUND($P7-$D7");
    expect(sheet.S7?.f).toContain("Ready to upload");
    expect(sheet.R42?.f).toContain("ROUND($P42-$D42");
    expect(sheet.S42?.f).toContain("Duplicate month");
  });

  it("includes a reconciled reference month outside the import sheet", () => {
    const sheet = workbook.Sheets["Worked Example"];
    expect(sheet.P6?.v).toBe(110000);
    expect(sheet.Q6?.v).toBe(12000);
    expect(sheet.R6?.f).toContain("ROUND(P6-D6");
    expect(sheet.R6?.v).toBe(0);
    expect(sheet.S6?.v).toBe("Reconciles");
  });
});
