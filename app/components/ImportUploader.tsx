"use client";

import { useId, useRef, useState } from "react";
import { useImportUpload } from "./useImportUpload";
import ImportReviewCard from "./ImportReviewCard";
import { DEFAULT_IMPORT_MODE, type FinancialImportMode } from "@/lib/financialImportPolicy";
import { FINANCIAL_TEMPLATE_URL } from "@/lib/financialTemplate";

type ClearState = "idle" | "confirming" | "clearing";

interface ImportUploaderProps {
  /** Whether the user already has financial data imported. */
  hasData?: boolean;
  /** New users (onboarding not completed) get a pulsing ring on "Choose file". */
  isNewUser?: boolean;
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
  const [year, month] = iso.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" }
  );
}

function ClearFinancialDataButton({onClick}:{onClick:()=>void}) {
  return <button
    type="button"
    onClick={onClick}
    className="py-2 text-left text-sm font-normal text-dim transition-colors hover:text-danger focus-visible:text-danger focus-visible:outline-none focus-visible:underline"
  >
    Clear all financial data
  </button>;
}

export default function ImportUploader({
  hasData = false,
  isNewUser = false,
  onSuccess,
}: ImportUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeId = useId();
  const [mode, setMode] = useState<FinancialImportMode>(DEFAULT_IMPORT_MODE);
  const [clearState, setClearState] = useState<ClearState>("idle");
  // Track whether the user HAS data locally (may change after clear)
  const [localHasData, setLocalHasData] = useState(hasData);
  const {
    state,
    success,
    review,
    errorMsg,
    upload,
    confirm,
    fail,
    reset: resetUpload,
  } = useImportUpload(() => {
    setLocalHasData(true);
    onSuccess?.();
  });

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file, mode);
    e.target.value = "";
  }

  function reset() {
    resetUpload();
    setClearState("idle");
    setMode(DEFAULT_IMPORT_MODE);
  }

  async function handleClear() {
    setClearState("clearing");
    try {
      const res = await fetch("/api/data", { method: "DELETE" });
      if (!res.ok) throw new Error("Server error");
      setLocalHasData(false);
      setClearState("idle");
      resetUpload();
      onSuccess?.();
    } catch {
      setClearState("idle");
      fail("Could not confirm whether data was cleared. Refresh the dashboard before trying again.");
    }
  }

  // ── Clear confirmation dialog ──────────────────────────────────────────────
  if (clearState === "confirming") {
    return (
      <div
        className="bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--danger)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          Clear all financial data?
        </p>
        <p className="mt-1 text-xs font-light" style={{ color: "var(--dim)" }}>
          This will permanently delete your financial data and saved financial
          history. Your account details and alert thresholds will be kept.
          This cannot be undone.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setClearState("idle")}
            className="px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-70"
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80"
            style={{
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--danger)",
            }}
          >
            Clear data
          </button>
        </div>
      </div>
    );
  }

  // ── Clearing in progress ───────────────────────────────────────────────────
  if (clearState === "clearing") {
    return (
      <div
        className="flex items-center gap-4 bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          className="h-5 w-5 rounded-full border-2 animate-spin shrink-0"
          style={{ borderColor: "var(--teal)", borderTopColor: "transparent" }}
        />
        <p className="text-sm font-light" style={{ color: "var(--ink)" }}>
          Clearing data…
        </p>
      </div>
    );
  }

  // ── Uploading ──────────────────────────────────────────────────────────────
  if (state === "review" && review) {
    return <ImportReviewCard review={review} onConfirm={confirm} onCancel={reset} />;
  }

  if (state === "uploading" || state === "reviewing") {
    return (
      <div role="status"
        className="flex items-center gap-4 bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          className="h-5 w-5 rounded-full border-2 animate-spin shrink-0"
          style={{ borderColor: "var(--teal)", borderTopColor: "transparent" }}
        />
        <p className="text-sm font-light" style={{ color: "var(--ink)" }}>
          {state === "reviewing" ? "Checking your file for review…" : "Saving your reviewed upload…"}
        </p>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (state === "success" && success) {
    const verb = success.mode === "update_months" ? "Updated" : "Replaced all data with";
    return (
      <div
        className="bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          borderLeft: "3px solid var(--teal)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--teal)" }}>
          ✓ {verb} {success.monthsImported} month
          {success.monthsImported !== 1 ? "s" : ""} of data
        </p>
        <p className="mt-1 text-xs font-light" style={{ color: "var(--dim)" }}>
          {success.monthsTotal} months in your dataset. Most recent month: {formatMonthLabel(success.dateRange.to)}
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
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={reset}
            className="text-xs font-medium transition-opacity hover:opacity-70 text-left"
            style={{ color: "var(--teal)" }}
          >
            Upload another file
          </button>
          {localHasData && (
            <ClearFinancialDataButton onClick={() => setClearState("confirming")} />
          )}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div
        className="bg-surface px-6 py-5"
        style={{
          borderRadius: "var(--radius-lg)",
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
        borderRadius: "var(--radius-lg)",
        border: "1px solid #D8E2EC",
        boxShadow: "var(--shadow-sm)",
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
            Import Financial Data
          </p>
          <p className="mt-0.5 text-xs font-light" style={{ color: "var(--dim)" }}>
            Excel (.xlsx) or CSV — monthly summary format required
          </p>
        </div>

        <div className="w-full">
          <label htmlFor={modeId} className="text-xs font-medium" style={{ color: "var(--ink)" }}>Upload behavior</label>
          <select id={modeId} value={mode} aria-describedby={`${modeId}-help`}
            onChange={event => setMode(event.target.value as FinancialImportMode)}
            className="mt-1 block w-full px-3 py-2 text-sm"
            style={{ color: "var(--ink)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>
            <option value="update_months">Update months in this file</option>
            <option value="replace_all">Replace all financial data</option>
          </select>
          <p id={`${modeId}-help`} className="mt-1 text-xs" style={{ color: mode === "replace_all" ? "var(--danger)" : "var(--dim)" }}>
            {mode === "update_months"
              ? "Replace values for uploaded months, including blank fields. Keep other months."
              : "Replace your entire dataset. Months not included in this file will be removed."}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`px-4 py-2 text-sm font-medium text-white transition hover:opacity-90${
              isNewUser && !localHasData ? " pulse-ring" : ""
            }`}
            style={{
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--teal)",
            }}
          >
            Choose file
          </button>

          <a
            href={FINANCIAL_TEMPLATE_URL}
            download
            className="text-xs font-medium underline transition-opacity hover:opacity-70"
            style={{ color: "var(--teal)" }}
          >
            Download template
          </a>
        </div>

        <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
          Uploads preserve existing account details and alert thresholds. Manage your business name and thresholds in Settings.
        </p>

        {localHasData && (
          <ClearFinancialDataButton onClick={() => setClearState("confirming")} />
        )}
      </div>
    </div>
  );
}
