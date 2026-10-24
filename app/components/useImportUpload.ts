"use client";

import { useState } from "react";
import { createImportUploadRequest, type ImportSuccessPayload } from "@/lib/financialImportUpload";
import { DEFAULT_IMPORT_MODE, type FinancialImportMode } from "@/lib/financialImportPolicy";
export type { ImportSuccessPayload } from "@/lib/financialImportUpload";

export type UploadState = "idle" | "uploading" | "success" | "error";

/**
 * Upload state machine for POST /api/import.
 * Shared by ImportUploader (dashboard card) and the onboarding modal.
 */
export function useImportUpload(onSuccess?: (result: ImportSuccessPayload) => void) {
  const [state, setState] = useState<UploadState>("idle");
  const [success, setSuccess] = useState<ImportSuccessPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [client] = useState(() => createImportUploadRequest());

  async function upload(file: File, mode: FinancialImportMode = DEFAULT_IMPORT_MODE) {
    if (client.isPending()) return;
    setState("uploading");
    setErrorMsg(null);
    setSuccess(null);

    let result: ImportSuccessPayload | null;
    try {
      result = await client.upload(file, mode);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Import could not be confirmed. Refresh the dashboard before retrying.");
      return;
    }
    if (!result) return;
    setSuccess(result);
    setState("success");
    onSuccess?.(result);
  }

  function fail(message: string) {
    setErrorMsg(message);
    setState("error");
  }

  function reset() {
    setState("idle");
    setSuccess(null);
    setErrorMsg(null);
  }

  return { state, success, errorMsg, upload, fail, reset };
}
