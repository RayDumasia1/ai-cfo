"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { getImportReviewNotices, importReviewAction, type ImportReview } from "@/lib/financialImportReview";
import type { ImportNotice } from "@/lib/importNotices";

function monthLabel(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function Months({ label, months }: { label: string; months: string[] }) {
  return <div className="mt-3 text-sm">
    <h4 className="font-medium">{label}: {months.length}</h4>
    {months.length > 0 ? <ul className="mt-1 max-h-36 overflow-auto pl-5 list-disc">
      {months.map(month => <li key={month}>{monthLabel(month)}</li>)}
    </ul> : <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>None</p>}
  </div>;
}

function Notice({ notice }: { notice: ImportNotice }) {
  const accent = notice.category === "danger" ? "var(--danger)" : notice.category === "warning" ? "var(--warning)" : "var(--teal)";
  const Icon = notice.category === "info" ? Info : AlertTriangle;
  return <div className="flex gap-3 p-4 text-sm" data-notice-category={notice.category}
    style={{ border: `1px solid ${accent}`, borderRadius: "var(--radius-md)", background: `color-mix(in srgb, ${accent} 6%, var(--surface))` }}>
    <Icon aria-hidden size={18} className="mt-0.5 shrink-0" style={{ color: accent }} />
    <div className="min-w-0">
      <p className="text-xs font-medium">{notice.category === "danger" ? "Destructive change" : notice.category === "warning" ? "Check before importing" : "Information"}</p>
      <h3 className="mt-1 font-medium">{notice.title}</h3>
      <p className="mt-1 break-words">{notice.message}</p>
    </div>
  </div>;
}

export default function ImportReviewCard({ review, onConfirm, onCancel }: {
  review: ImportReview; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const first = review.incomingMonths[0];
  const last = review.incomingMonths.at(-1)!;
  const count = review.incomingMonths.length;
  const notices = getImportReviewNotices(review);
  const important = notices.filter(notice => notice.category !== "info" || notice.code === "missing_kept");
  const informational = notices.filter(notice => notice.category === "info" && !["missing_kept", "missing_continue"].includes(notice.code));
  const changes: ImportNotice[] = [];
  if (review.mode === "replace_all") changes.push({code:"replace_all",category:"danger",title:"Replace all financial data",
    message:`This file will replace your entire current financial dataset. ${review.removedMonths.length} saved months are not in this file and will be removed from your current dataset. Existing expense breakdowns will be cleared.`});
  else if (review.updatedMonths.length > 0) changes.push({code:"replace_values",category:"danger",title:"Saved values will be replaced",
    message:"Uploaded existing months replace saved values, including blank fields. Old expense breakdowns for uploaded months will be cleared. Other months will be kept."});
  const displayed = [...changes, ...important.filter(notice => notice.category === "danger"),
    ...important.filter(notice => notice.category === "warning"), ...important.filter(notice => notice.category === "info")];
  return <section aria-labelledby={titleId} className="min-w-0 p-6 text-left" style={{ color:"var(--ink)",
    background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)" }}>
    <h2 ref={title} id={titleId} tabIndex={-1} className="text-lg font-medium">Review your upload</h2>
    <p className="mt-2 text-sm">{monthLabel(first)}{first !== last ? `–${monthLabel(last)}` : ""}</p>
    <p className="mt-1 text-sm font-medium">{count} {count === 1 ? "month" : "months"} ready to import</p>
    <p className="mt-1 break-words text-xs" style={{color:"var(--dim)"}}>{review.filename}</p>
    <dl className="my-5 grid grid-cols-3 gap-2" aria-label="Import changes">
      {[["To add",review.addedMonths.length],["To update",review.updatedMonths.length],["To remove",review.removedMonths.length]].map(([label,value]) =>
        <div key={label} className="flex min-w-0 flex-col-reverse gap-1 rounded-lg p-3" style={{background:"var(--cloud)"}}>
          <dt className="text-xs">{label}</dt><dd className="text-xl font-medium">{value}</dd>
        </div>)}
    </dl>
    {displayed.length > 0 && <div className="space-y-3">{displayed.map((notice,index) => <Notice key={`${notice.code}-${index}`} notice={notice} />)}</div>}
    <div className="mt-4 space-y-2 text-sm">
      <p>Latest month after import: <span className="font-medium">{monthLabel(review.resultingLatestMonth)}</span></p>
      {review.currentLatestMonth === review.resultingLatestMonth && review.incomingMonths.includes(review.resultingLatestMonth) &&
        <p>This file updates your latest month, so its cash value may change.</p>}
      <p className="flex items-center gap-2"><ShieldCheck aria-hidden size={16} className="shrink-0" style={{color:"var(--teal)"}} />Account details and alert settings will be preserved.</p>
    </div>
    <details className="mt-5 border-t pt-3 text-sm" style={{borderColor:"var(--line)"}}>
      <summary className="cursor-pointer font-medium">View month details</summary>
      <Months label="Months to add" months={review.addedMonths} />
      <Months label="Existing months to update" months={review.updatedMonths} />
      <Months label="Months to remove" months={review.removedMonths} />
    </details>
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">Additional import information</summary>
      <div className="mt-2 space-y-2 text-xs" style={{color:"var(--dim)"}}>
        <p>{review.mode === "update_months" ? "Only uploaded months change. Other saved months will be kept." : "Only months in this file will remain in your current dataset."}</p>
        {review.olderMonths.length > 0 && <p>This file includes older financial data. {review.mode === "update_months"
          ? "These months will be retained alongside the other months in your dataset."
          : "Older dates do not preserve newer months when Replace all is selected."}</p>}
        {review.currentLatestMonth === review.resultingLatestMonth && !review.incomingMonths.includes(review.resultingLatestMonth) && <p>Your latest cash position will remain based on that month.</p>}
        {review.outsideDashboardMonths.length > 0 && <p>{review.outsideDashboardMonths.length} uploaded months will be retained outside the dashboard’s latest {review.dashboardMonthsLimit} stored months. Historical browsing and forecasting are not available yet.</p>}
        {informational.map((notice,index) => <p key={`${notice.code}-${index}`}>{notice.message}</p>)}
      </div>
    </details>
    <p className="mt-5 text-xs" style={{color:"var(--dim)"}}>Nothing changes until you confirm.</p>
    {notices.some(notice => notice.code === "missing_continue") && <p className="mt-1 text-xs" style={{color:"var(--dim)"}}>You can continue with this upload, or cancel and correct the workbook.</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" onClick={onConfirm} className="px-4 py-2 text-sm font-medium"
        style={{color:"var(--surface)",background:review.mode === "replace_all" ? "var(--danger)" : "var(--teal)",borderRadius:"var(--radius-sm)"}}>{importReviewAction(review)}</button>
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm"
        style={{border:"1px solid var(--line)",borderRadius:"var(--radius-sm)"}}>Cancel</button>
    </div>
  </section>;
}
