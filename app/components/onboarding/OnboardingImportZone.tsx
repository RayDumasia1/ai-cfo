"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { useImportUpload } from "@/app/components/useImportUpload";

interface OnboardingImportZoneProps {
  /** Fired once /api/import succeeds. */
  onImported: () => void;
  /** "See my dashboard →" on the success state. */
  onContinue: () => void;
}

/**
 * Simplified modal variant of ImportUploader: .xlsx only, drag-and-drop,
 * same upload logic via useImportUpload.
 */
export default function OnboardingImportZone({
  onImported,
  onContinue,
}: OnboardingImportZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { state, errorMsg, upload, fail, reset } = useImportUpload(onImported);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      fail("Please upload an Excel (.xlsx) file.");
      return;
    }
    upload(file);
  }

  if (state === "uploading") {
    return (
      <div className="flex flex-col items-center gap-3 py-10" role="status">
        <Loader2 size={32} className="animate-spin text-teal" />
        <p className="text-sm text-dim">Importing your data...</p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 size={40} className="text-success" />
        <p className="mt-3 text-lg font-medium text-navy">Import successful!</p>
        <p className="mt-1 text-sm text-dim">Your dashboard is ready.</p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-5 h-12 w-full bg-teal text-sm font-medium text-white transition-colors hover:bg-teal-light"
          style={{ borderRadius: "var(--radius-md)" }}
        >
          See my dashboard →
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center py-4 text-center" role="alert">
        <XCircle size={32} className="text-danger" />
        <p className="mt-3 text-base font-medium text-navy">Import failed</p>
        {errorMsg && <p className="mt-1 text-[13px] text-dim">{errorMsg}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-4 h-10 border-[1.5px] border-navy px-5 text-sm font-medium text-navy transition-colors hover:bg-navy hover:text-white"
          style={{ borderRadius: "var(--radius-md)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex w-full cursor-pointer flex-col items-center border-2 border-dashed p-8 text-center transition-colors hover:border-teal hover:bg-[rgba(44,166,164,0.04)] ${
          dragOver ? "border-teal bg-[rgba(44,166,164,0.04)]" : "border-line bg-cloud"
        }`}
        style={{ borderRadius: 12 }}
      >
        <Upload size={32} className="text-line" />
        <span className="mt-3 text-sm font-medium text-dim">Drop your .xlsx file here</span>
        <span className="mt-1 text-[13px] text-dim">or click to browse</span>
      </button>
    </>
  );
}
