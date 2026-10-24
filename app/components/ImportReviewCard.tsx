"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { importReviewAction, type ImportReview } from "@/lib/financialImportReview";

function monthLabel(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function Months({ label, months }: { label: string; months: string[] }) {
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer">{label}: {months.length}</summary>
    {months.length > 0 ? <ul className="mt-1 max-h-36 overflow-auto pl-5 list-disc">
      {months.map(month => <li key={month}>{monthLabel(month)}</li>)}
    </ul> : <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>None</p>}
  </details>;
}

export default function ImportReviewCard({ review, onConfirm, onCancel }: {
  review: ImportReview; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const first = review.incomingMonths[0];
  const last = review.incomingMonths.at(-1)!;
  return <section aria-labelledby={titleId} className="p-6 text-left" style={{ color: "var(--ink)",
    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)" }}>
    <h2 ref={title} id={titleId} tabIndex={-1} className="text-lg font-medium">Review your upload</h2>
    <p className="mt-2 break-words text-sm">{review.filename}</p>
    <p className="mt-1 text-sm">{monthLabel(first)}{first !== last ? `–${monthLabel(last)}` : ""} · {review.incomingMonths.length} month{review.incomingMonths.length === 1 ? "" : "s"} in this file</p>
    <p className="mt-3 text-sm">{review.mode === "update_months"
      ? "Uploaded months replace saved values, including blank fields. Other months will be kept."
      : "This file will replace your entire current financial dataset."}</p>
    <Months label="Months to add" months={review.addedMonths} />
    <Months label="Existing months to update" months={review.updatedMonths} />
    <Months label="Months to remove" months={review.removedMonths} />
    {review.mode === "replace_all" && review.removedMonths.length > 0 &&
      <p className="mt-3 flex gap-2 text-sm" style={{ color: "var(--danger)" }}>
        <AlertTriangle aria-hidden size={18} className="shrink-0" />
        {review.removedMonths.length} saved months are not in this file and will be removed from your current dataset.
      </p>}
    {review.olderMonths.length > 0 && <div className="mt-4 text-sm">
      <p className="font-medium">This file includes older financial data.</p>
      <p className="mt-1">{review.mode === "update_months"
        ? "These months will be retained alongside the other months in your dataset."
        : "Older dates do not preserve newer months when Replace all is selected."}</p>
    </div>}
    <p className="mt-3 text-sm">After this upload, your latest month will be {monthLabel(review.resultingLatestMonth)}.</p>
    {review.currentLatestMonth === review.resultingLatestMonth && <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>
      {review.incomingMonths.includes(review.resultingLatestMonth)
        ? "This file updates your latest month, so its cash value may change."
        : "Your latest cash position will remain based on that month."}
    </p>}
    {review.outsideDashboardMonths.length > 0 && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>
      {review.outsideDashboardMonths.length} uploaded months will be retained outside the dashboard’s latest {review.dashboardMonthsLimit} stored months.
      Historical browsing and forecasting are not available yet.
    </p>}
    <p className="mt-3 text-xs" style={{ color: "var(--dim)" }}>Your existing account details and saved alert thresholds will be preserved.
      Old expense breakdowns for uploaded months will be cleared. No financial data changes until you confirm.</p>
    {review.warnings.length > 0 && <ul className="mt-3 text-xs space-y-1" style={{ color: "var(--dim)" }}>
      {review.warnings.map((warning,index) => <li key={index}>{warning}</li>)}
    </ul>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" onClick={onConfirm} className="px-4 py-2 text-sm font-medium"
        style={{ color: "var(--surface)", background: review.mode === "replace_all" ? "var(--danger)" : "var(--teal)", borderRadius: "var(--radius-sm)" }}>
        {importReviewAction(review)}
      </button>
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm"
        style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>Cancel</button>
    </div>
  </section>;
}
