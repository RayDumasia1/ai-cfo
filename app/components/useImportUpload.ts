"use client";

import { useState } from "react";
import { createImportUploadRequest, type ImportSuccessPayload } from "@/lib/financialImportUpload";
import { DEFAULT_IMPORT_MODE, type FinancialImportMode } from "@/lib/financialImportPolicy";
import type { ImportReview } from "@/lib/financialImportReview";
export type { ImportSuccessPayload } from "@/lib/financialImportUpload";

export type UploadState = "idle" | "reviewing" | "review" | "uploading" | "success" | "error";

/**
 * Review/confirm upload workflow; selecting a file does not commit its data.
 * Shared by ImportUploader (dashboard card) and the onboarding modal.
 */
export function useImportUpload(onSuccess?: (result: ImportSuccessPayload) => void) {
  const [state, setState] = useState<UploadState>("idle");
  const [success, setSuccess] = useState<ImportSuccessPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [client] = useState(() => createImportUploadRequest());
  const [review, setReview] = useState<ImportReview | null>(null);

  async function upload(file: File, mode: FinancialImportMode = DEFAULT_IMPORT_MODE) {
    if (client.isPending()) return;
    setState("reviewing");
    setErrorMsg(null);
    setSuccess(null);

    try {
      const result = await client.prepare(file, mode);
      if (!result) return;
      setReview(result);
      setState("review");
    } catch (error) {
      fail(error instanceof Error ? error.message : "The file could not be reviewed. Please try again.");
    }
  }

  async function confirm() {
    if (client.isPending() || !client.hasReview()) return;
    setState("uploading");
    let result: ImportSuccessPayload | null;
    try {
      result = await client.confirm();
    } catch (error) {
      fail(error instanceof Error ? error.message : "Import could not be confirmed. Refresh the dashboard before retrying.");
      return;
    }
    if (!result) return;
    setSuccess(result);
    setReview(null);
    setState("success");
    onSuccess?.(result);
  }

  function fail(message: string) {
    if (client.isPending()) return;
    client.cancel();
    setReview(null);
    setErrorMsg(message);
    setState("error");
  }

  function reset() {
    if (client.isPending()) return;
    client.cancel();
    setState("idle");
    setSuccess(null);
    setErrorMsg(null);
    setReview(null);
  }

  return { state, success, review, errorMsg, upload, confirm, fail, reset };
}
