"use client";

import { useRef, useState } from "react";

type UploadState = "idle" | "uploading" | "success" | "error";

interface SuccessPayload {
  monthsImported: number;
  dateRange: { from: string; to: string };
  currentCash: number | null;
  warnings: string[];
}

interface ImportUploaderProps {
  onSuccess?: () => void;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMonthLabel(iso: string): string {
  // "2026-04-01" → "April 2026"
  const [year, month] = iso.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" }
  );
}

export default function ImportUploader({ onSuccess }: ImportUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [success, setSuccess] = useState<SuccessPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
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
        setErrorMsg(msg);
        setState("error");
        return;
      }

      setSuccess(json as SuccessPayload);
      setState("success");
      onSuccess?.();
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  }

  function reset() {
    setState("idle");
    setSuccess(null);
    setErrorMsg(null);
  }

  // ── Uploading ──────────────────────────────────────────────────────────────
  if (state === "uploading") {
    return (
      <div
        className="flex items-center gap-4 bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin shrink-0"
          style={{ borderColor: "var(--teal)", borderTopColor: "transparent" }}
        />
        <p className="text-sm font-light" style={{ color: "var(--ink)" }}>
          Processing your file…
        </p>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (state === "success" && success) {
    return (
      <div
        className="bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          borderLeft: "3px solid var(--teal)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--teal)" }}>
          ✓ Imported {success.monthsImported} month
          {success.monthsImported !== 1 ? "s" : ""} of data
        </p>
        <p className="mt-1 text-xs font-light" style={{ color: "var(--dim)" }}>
          Most recent month: {formatMonthLabel(success.dateRange.to)}
        </p>
        {success.currentCash !== null && (
          <p className="mt-0.5 text-xs font-light" style={{ color: "var(--dim)" }}>
            Current cash position: {formatCurrency(success.currentCash)}
          </p>
        )}
        {success.warnings.length > 0 && (
          <ul className="mt-3 space-y-0.5">
            {success.warnings.map((w, i) => (
              <li key={i} className="text-xs" style={{ color: "#b45309" }}>
                ⚠ {w}
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={reset}
          className="mt-4 text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: "var(--teal)" }}
        >
          Upload another file
        </button>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div
        className="bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          borderLeft: "3px solid #ef4444",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <p className="text-sm font-medium text-red-500">Upload failed</p>
        {errorMsg && (
          <p className="mt-1 text-xs font-light" style={{ color: "var(--dim)" }}>
            {errorMsg}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-4 text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: "var(--ink)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="bg-surface px-6 py-6"
      style={{
        borderRadius: "var(--radius-md)",
        border: "2px dashed var(--line)",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={handleInputChange}
      />

      <div className="flex flex-col items-start gap-3">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            Upload Financial Data
          </p>
          <p className="mt-0.5 text-xs font-light" style={{ color: "var(--dim)" }}>
            Excel (.xlsx) or CSV — monthly summary format required
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            style={{
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--teal)",
            }}
          >
            Choose file
          </button>

          <a
            href="/downloads/elidan-financial-template.xlsx"
            download
            className="text-xs font-medium underline transition-opacity hover:opacity-70"
            style={{ color: "var(--teal)" }}
          >
            Download template
          </a>
        </div>
      </div>
    </div>
  );
}
