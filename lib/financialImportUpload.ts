import { isFinancialImportMode, isFinancialImportResult, type FinancialImportMode } from "./financialImportPolicy";
import { isImportReview, type ImportReview } from "./financialImportReview";

export interface ImportSuccessPayload {
  unchanged: boolean;
  replaced: boolean;
  mode: FinancialImportMode;
  monthsImported: number;
  monthsTotal: number;
  dateRange: { from: string; to: string };
  currentCash: number | null;
  warnings: string[];
}

const UNCONFIRMED = "Import could not be confirmed. Refresh the dashboard before retrying.";
const REVIEW_FAILED = "The file could not be reviewed. Please try again.";

function confirmedPayload(value: unknown, mode: FinancialImportMode): value is ImportSuccessPayload & { success: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const range = v.dateRange as Record<string, unknown> | undefined;
  return v.success === true && typeof v.unchanged === "boolean" && typeof v.monthsImported === "number" && Number.isSafeInteger(v.monthsImported) &&
    v.monthsImported >= 0 && Array.isArray(v.warnings) && v.warnings.every(w => typeof w === "string") &&
    isFinancialImportResult({ unchanged: v.unchanged, replaced: v.replaced, mode: v.mode, months_imported: v.monthsImported,
      months_total: v.monthsTotal, date_from: range?.from, date_to: range?.to, current_cash: v.currentCash }, mode, v.monthsImported);
}

/** Per-uploader synchronous guard; no shared state or browser persistence. */
export function createImportUploadRequest(send: typeof fetch = fetch) {
  let pending = false;
  let prepared: { file: File; mode: FinancialImportMode; token: string } | null = null;
  async function post(path: string, form: FormData, fallback: string): Promise<unknown> {
    let response: Response;
    let value: unknown;
    try { response = await send(path, { method: "POST", body: form }); value = await response.json(); }
    catch { throw new Error(fallback); }
    if (!response.ok) {
      if (response.status < 500 && value && typeof value === "object" && !Array.isArray(value)) {
        const error = value as { errors?: unknown; error?: unknown };
        const message = Array.isArray(error.errors) ? error.errors[0] : error.error;
        if (typeof message === "string" && message.trim()) throw new Error(message);
      }
      throw new Error(fallback);
    }
    return value;
  }
  function formFor(file: File, mode: FinancialImportMode) {
    const form = new FormData(); form.append("file", file); form.append("mode", mode); return form;
  }
  return {
    isPending: () => pending,
    hasReview: () => prepared !== null,
    cancel() { if (!pending) prepared = null; },
    async prepare(file: File, mode: FinancialImportMode): Promise<ImportReview | null> {
      if (pending) return null;
      if (!isFinancialImportMode(mode)) throw new Error("Choose update months or replace all data.");
      pending = true;
      prepared = null;
      try {
        const value = await post("/api/import/review", formFor(file, mode), REVIEW_FAILED);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(REVIEW_FAILED);
        const body = value as Record<string, unknown>;
        if (body.success !== true || !isImportReview(body.review, mode) || body.review.filename !== file.name ||
          typeof body.reviewToken !== "string" || !body.reviewToken || body.reviewToken.length > 16384) {
          throw new Error(REVIEW_FAILED);
        }
        prepared = { file, mode, token: body.reviewToken };
        return body.review;
      } finally { pending = false; }
    },
    async confirm(): Promise<ImportSuccessPayload | null> {
      if (pending || !prepared) return null;
      const selected = prepared;
      prepared = null; // Unknown outcomes require a fresh review, never a blind retry.
      pending = true;
      try {
        const form = formFor(selected.file, selected.mode);
        form.append("reviewToken", selected.token);
        const value = await post("/api/import/confirm", form, UNCONFIRMED);
        if (!confirmedPayload(value, selected.mode)) throw new Error(UNCONFIRMED);
        return value;
      } finally { pending = false; }
    },
  };
}
