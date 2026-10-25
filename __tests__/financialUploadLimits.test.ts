import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  FinancialUploadLimitError,
  MAX_FINANCIAL_FILE_BYTES,
  MAX_IMPORT_ERRORS_RETURNED,
  MAX_WORKBOOK_COLUMNS_PER_SHEET,
  MAX_WORKBOOK_ROWS_PER_SHEET,
  MAX_WORKBOOK_SHEETS,
  MAX_WORKBOOK_UNCOMPRESSED_BYTES,
  boundedImportErrors,
  validateFinancialArchive,
  validateFinancialFileMetadata,
  validateWorkbookStructure,
} from "../lib/financialUploadLimits";

const template = readFileSync("docs/templates/elidan-financial-template-v2.xlsx");

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function findSignature(bytes: Uint8Array, signature: number, fromEnd = false): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fromEnd) {
    for (let offset = bytes.byteLength - 4; offset >= 0; offset--) {
      if (view.getUint32(offset, true) === signature) return offset;
    }
  } else {
    for (let offset = 0; offset <= bytes.byteLength - 4; offset++) {
      if (view.getUint32(offset, true) === signature) return offset;
    }
  }
  return -1;
}

describe("financial upload resource limits", () => {
  it("accepts the launch template within file and archive budgets", () => {
    const file = new File([template], "template.xlsx");
    expect(() => validateFinancialFileMetadata(file)).not.toThrow();
    expect(() => validateFinancialArchive(arrayBuffer(template), file.name)).not.toThrow();
  });

  it.each([
    [new File([], "empty.xlsx"), "IMPORT_FILE_EMPTY"],
    [new File([new Uint8Array(MAX_FINANCIAL_FILE_BYTES + 1)], "large.xlsx"), "IMPORT_FILE_TOO_LARGE"],
    [new File(["content"], "data.xls"), "IMPORT_FILE_TYPE"],
    [new File(["content"], `${"a".repeat(197)}.csv`), "IMPORT_FILENAME"],
  ])("rejects unsafe file metadata", (file, code) => {
    expect(() => validateFinancialFileMetadata(file)).toThrow(expect.objectContaining({ code }));
  });

  it("rejects malformed and oversized archive metadata before workbook parsing", () => {
    expect(() => validateFinancialArchive(new Uint8Array([1, 2, 3]).buffer, "bad.xlsx"))
      .toThrow(expect.objectContaining({ code: "IMPORT_WORKBOOK_INVALID" }));

    const expanded = new Uint8Array(template);
    const central = findSignature(expanded, 0x02014b50);
    expect(central).toBeGreaterThanOrEqual(0);
    new DataView(expanded.buffer).setUint32(central + 24, MAX_WORKBOOK_UNCOMPRESSED_BYTES + 1, true);
    expect(() => validateFinancialArchive(arrayBuffer(expanded), "expanded.xlsx"))
      .toThrow(expect.objectContaining({ code: "IMPORT_WORKBOOK_EXPANDED_TOO_LARGE" }));

    const entries = new Uint8Array(template);
    const end = findSignature(entries, 0x06054b50, true);
    expect(end).toBeGreaterThanOrEqual(0);
    new DataView(entries.buffer).setUint16(end + 10, 201, true);
    expect(() => validateFinancialArchive(arrayBuffer(entries), "entries.xlsx"))
      .toThrow(expect.objectContaining({ code: "IMPORT_WORKBOOK_TOO_COMPLEX" }));
  });

  it("rejects excessive sheets and declared used ranges", () => {
    const manySheets = XLSX.utils.book_new();
    for (let index = 0; index <= MAX_WORKBOOK_SHEETS; index++) {
      XLSX.utils.book_append_sheet(manySheets, XLSX.utils.aoa_to_sheet([[index]]), `Sheet ${index}`);
    }
    expect(() => validateWorkbookStructure(manySheets))
      .toThrow(expect.objectContaining({ code: "IMPORT_TOO_MANY_SHEETS" }));

    const rows = XLSX.utils.book_new();
    const rowSheet = XLSX.utils.aoa_to_sheet([[1]]);
    rowSheet["!ref"] = `A1:A${MAX_WORKBOOK_ROWS_PER_SHEET + 1}`;
    XLSX.utils.book_append_sheet(rows, rowSheet, "Rows");
    expect(() => validateWorkbookStructure(rows))
      .toThrow(expect.objectContaining({ code: "IMPORT_TOO_MANY_ROWS" }));

    const columns = XLSX.utils.book_new();
    const columnSheet = XLSX.utils.aoa_to_sheet([[1]]);
    columnSheet["!ref"] = `A1:${XLSX.utils.encode_col(MAX_WORKBOOK_COLUMNS_PER_SHEET)}1`;
    XLSX.utils.book_append_sheet(columns, columnSheet, "Columns");
    expect(() => validateWorkbookStructure(columns))
      .toThrow(expect.objectContaining({ code: "IMPORT_TOO_MANY_COLUMNS" }));
  });

  it("bounds user-facing parser errors", () => {
    const errors = Array.from({ length: MAX_IMPORT_ERRORS_RETURNED + 7 }, (_, index) => `Error ${index + 1}`);
    const bounded = boundedImportErrors(errors);
    expect(bounded).toHaveLength(MAX_IMPORT_ERRORS_RETURNED + 1);
    expect(bounded.at(-1)).toContain("7 additional issues");
  });

  it("uses typed, actionable limit errors", () => {
    const error = new FinancialUploadLimitError("TEST", "Safe message");
    expect(error).toMatchObject({ name: "FinancialUploadLimitError", code: "TEST", message: "Safe message" });
  });
});
