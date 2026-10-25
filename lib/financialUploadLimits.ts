import type { WorkBook } from "xlsx";

export const MAX_FINANCIAL_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FINANCIAL_REQUEST_BYTES = MAX_FINANCIAL_FILE_BYTES + 256 * 1024;
export const MAX_WORKBOOK_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_WORKBOOK_ARCHIVE_ENTRIES = 200;
export const MAX_WORKBOOK_COMPRESSION_RATIO = 100;
export const MAX_WORKBOOK_SHEETS = 8;
export const MAX_WORKBOOK_ROWS_PER_SHEET = 250;
export const MAX_WORKBOOK_COLUMNS_PER_SHEET = 64;
export const MAX_FINANCIAL_MONTHS = 240;
export const MAX_IMPORT_ERRORS_RETURNED = 25;
export const MAX_FINANCIAL_FILENAME_LENGTH = 200;

export class FinancialUploadLimitError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FinancialUploadLimitError";
  }
}

export function validateFinancialFileMetadata(file: File): void {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
    throw new FinancialUploadLimitError("IMPORT_FILE_TYPE", "Upload an Excel (.xlsx) or CSV file.");
  }
  if (!file.name.trim() || file.name.length > MAX_FINANCIAL_FILENAME_LENGTH) {
    throw new FinancialUploadLimitError("IMPORT_FILENAME", "Use a file name of 200 characters or fewer.");
  }
  if (file.size === 0) {
    throw new FinancialUploadLimitError("IMPORT_FILE_EMPTY", "The selected file is empty.");
  }
  if (file.size > MAX_FINANCIAL_FILE_BYTES) {
    throw new FinancialUploadLimitError("IMPORT_FILE_TOO_LARGE", "The file is larger than 2 MB. Upload a monthly-summary workbook with only the records Elidan needs.");
  }
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

/** Reject expensive XLSX archives before SheetJS expands them. CSV files skip ZIP checks. */
export function validateFinancialArchive(buffer: ArrayBuffer, filename: string): void {
  if (!filename.toLowerCase().endsWith(".xlsx")) return;
  const view = new DataView(buffer);
  const end = findEndOfCentralDirectory(view);
  if (end < 0) throw new FinancialUploadLimitError("IMPORT_WORKBOOK_INVALID", "The Excel workbook is not a valid .xlsx file.");

  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new FinancialUploadLimitError("IMPORT_WORKBOOK_TOO_COMPLEX", "This workbook uses an unsupported large-file format. Use the Elidan monthly template.");
  }
  if (entries > MAX_WORKBOOK_ARCHIVE_ENTRIES) {
    throw new FinancialUploadLimitError("IMPORT_WORKBOOK_TOO_COMPLEX", `The workbook contains more than ${MAX_WORKBOOK_ARCHIVE_ENTRIES} internal files. Use the Elidan monthly template.`);
  }
  if (centralOffset + centralSize > end || centralOffset < 0) {
    throw new FinancialUploadLimitError("IMPORT_WORKBOOK_INVALID", "The Excel workbook is damaged or incomplete.");
  }

  let offset = centralOffset;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new FinancialUploadLimitError("IMPORT_WORKBOOK_INVALID", "The Excel workbook is damaged or incomplete.");
    }
    const flags = view.getUint16(offset + 8, true);
    if ((flags & 1) !== 0) {
      throw new FinancialUploadLimitError("IMPORT_WORKBOOK_ENCRYPTED", "Password-protected workbooks cannot be imported.");
    }
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new FinancialUploadLimitError("IMPORT_WORKBOOK_TOO_COMPLEX", "This workbook uses an unsupported large-file format. Use the Elidan monthly template.");
    }
    compressedTotal += compressed;
    uncompressedTotal += uncompressed;
    if (uncompressedTotal > MAX_WORKBOOK_UNCOMPRESSED_BYTES) {
      throw new FinancialUploadLimitError("IMPORT_WORKBOOK_EXPANDED_TOO_LARGE", "The workbook expands beyond 20 MB. Remove unused sheets, formatting, and embedded content.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (uncompressedTotal / Math.max(compressedTotal, 1) > MAX_WORKBOOK_COMPRESSION_RATIO) {
    throw new FinancialUploadLimitError("IMPORT_WORKBOOK_COMPRESSION", "The workbook is compressed unusually heavily and cannot be processed safely.");
  }
}

function usedRangeSize(reference: string): { rows: number; columns: number } | null {
  const cells = reference.split(":");
  if (cells.length > 2) return null;
  const decodeCell = (cell: string) => {
    const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(cell);
    if (!match) return null;
    let column = 0;
    for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
    return { column, row: Number(match[2]) };
  };
  const start = decodeCell(cells[0]);
  const end = decodeCell(cells[1] ?? cells[0]);
  if (!start || !end || end.row < start.row || end.column < start.column) return null;
  return { rows: end.row - start.row + 1, columns: end.column - start.column + 1 };
}

export function validateWorkbookStructure(workbook: WorkBook): void {
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) {
    throw new FinancialUploadLimitError("IMPORT_TOO_MANY_SHEETS", `The workbook contains more than ${MAX_WORKBOOK_SHEETS} sheets. Keep only the Elidan template sheets.`);
  }
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const reference = sheet?.["!fullref"] ?? sheet?.["!ref"];
    if (!reference) continue;
    const range = usedRangeSize(reference);
    if (!range) throw new FinancialUploadLimitError("IMPORT_WORKBOOK_INVALID", `The sheet “${name}” has an invalid used range.`);
    const { rows, columns } = range;
    if (rows > MAX_WORKBOOK_ROWS_PER_SHEET) {
      throw new FinancialUploadLimitError("IMPORT_TOO_MANY_ROWS", `The sheet “${name}” contains more than ${MAX_WORKBOOK_ROWS_PER_SHEET} used rows. Remove unused rows or split the history into smaller uploads.`);
    }
    if (columns > MAX_WORKBOOK_COLUMNS_PER_SHEET) {
      throw new FinancialUploadLimitError("IMPORT_TOO_MANY_COLUMNS", `The sheet “${name}” contains more than ${MAX_WORKBOOK_COLUMNS_PER_SHEET} used columns. Remove unused columns and use the Elidan template.`);
    }
  }
}

export function boundedImportErrors(errors: string[]): string[] {
  if (errors.length <= MAX_IMPORT_ERRORS_RETURNED) return errors;
  return [
    ...errors.slice(0, MAX_IMPORT_ERRORS_RETURNED),
    `${errors.length - MAX_IMPORT_ERRORS_RETURNED} additional issues were omitted. Correct the listed issues and review the file again.`,
  ];
}
