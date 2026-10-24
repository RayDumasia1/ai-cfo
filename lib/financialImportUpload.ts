import { isFinancialImportMode, isFinancialImportResult, type FinancialImportMode } from "./financialImportPolicy";

export interface ImportSuccessPayload {
  replaced: boolean;
  mode: FinancialImportMode;
  monthsImported: number;
  monthsTotal: number;
  dateRange: { from: string; to: string };
  currentCash: number | null;
  warnings: string[];
}

const UNCONFIRMED = "Import could not be confirmed. Refresh the dashboard before retrying.";

function confirmedPayload(value: unknown, mode: FinancialImportMode): value is ImportSuccessPayload & { success: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const range = v.dateRange as Record<string, unknown> | undefined;
  return v.success === true && typeof v.monthsImported === "number" && Number.isSafeInteger(v.monthsImported) &&
    v.monthsImported > 0 && Array.isArray(v.warnings) && v.warnings.every(w => typeof w === "string") &&
    isFinancialImportResult({ replaced: v.replaced, mode: v.mode, months_imported: v.monthsImported,
      months_total: v.monthsTotal, date_from: range?.from, date_to: range?.to, current_cash: v.currentCash }, mode, v.monthsImported);
}

/** Per-uploader synchronous guard; no shared state or browser persistence. */
export function createImportUploadRequest(send: typeof fetch = fetch) {
  let pending = false;
  return {
    isPending: () => pending,
    async upload(file: File, mode: FinancialImportMode): Promise<ImportSuccessPayload | null> {
      if (pending) return null;
      if (!isFinancialImportMode(mode)) throw new Error("Choose update months or replace all data.");
      pending = true;
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("mode", mode);
        let response: Response;
        let value: unknown;
        try {
          response = await send("/api/import/modes", { method: "POST", body: form });
          value = await response.json();
        } catch { throw new Error(UNCONFIRMED); }
        if (!response.ok) {
          if (response.status < 500 && value && typeof value === "object" && !Array.isArray(value)) {
            const error = value as { errors?: unknown; error?: unknown };
            const message = Array.isArray(error.errors) ? error.errors[0] : error.error;
            if (typeof message === "string" && message.trim()) throw new Error(message);
          }
          throw new Error(UNCONFIRMED);
        }
        if (!confirmedPayload(value, mode)) throw new Error(UNCONFIRMED);
        return value;
      } finally { pending = false; }
    },
  };
}
