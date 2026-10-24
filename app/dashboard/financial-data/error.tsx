"use client";

import Link from "next/link";

export default function FinancialDataError({unstable_retry}:{unstable_retry:()=>void}) {
  return <div role="alert" className="p-8" style={{color:"var(--ink)"}}>
    <h2 className="text-lg font-medium">Financial data could not be loaded</h2>
    <p className="mt-2 text-sm">Try again to load your current data before importing.</p>
    <button type="button" onClick={unstable_retry} className="mt-4 rounded px-4 py-2 text-sm" style={{background:"var(--teal)",color:"var(--surface)"}}>Try again</button>
    <Link href="/dashboard" className="ml-4 text-sm underline" style={{color:"var(--teal)"}}>Back to dashboard</Link>
  </div>;
}
