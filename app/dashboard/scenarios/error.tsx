"use client";

import Link from "next/link";

export default function ScenariosError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <section role="alert" className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-medium text-ink">Your decision test could not be loaded</h1>
        <p className="mt-2 text-sm text-dim">Your saved financial data was not changed. Try loading the planner again.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            Try again
          </button>
          <Link href="/dashboard" className="rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink hover:border-teal">
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
