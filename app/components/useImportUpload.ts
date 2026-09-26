"use client";

import { useState } from "react";

export type UploadState = "idle" | "uploading" | "success" | "error";

export interface ImportSuccessPayload {
  replaced: boolean;
  monthsImported: number;
  dateRange: { from: string; to: string };
  currentCash: number | null;
  warnings: string[];
}

/**
 * Upload state machine for POST /api/import.
 * Shared by ImportUploader (dashboard card) and the onboarding modal.
 */
export function useImportUpload(onSuccess?: (result: ImportSuccessPayload) => void) {
  const [state, setState] = useState<UploadState>("idle");
  const [success, setSuccess] = useState<ImportSuccessPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function upload(file: File) {
    setState("uploading");
    setErrorMsg(null);
    setSuccess(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok || !json.success) {
        const msg =
          (json.errors as string[] | undefined)?.[0] ??
          json.error ??
          "Upload failed.";
        fail(msg);
        return;
      }

      setSuccess(json as ImportSuccessPayload);
      setState("success");
      onSuccess?.(json as ImportSuccessPayload);
    } catch {
      fail("Network error. Please try again.");
    }
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
