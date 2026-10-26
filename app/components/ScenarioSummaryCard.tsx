import Link from "next/link";
import { ArrowRight, ChartLine } from "lucide-react";
import type { ScenarioBaseline } from "@/lib/scenarioPlanning";

function dateLabel(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function baselineSummary(baseline: ScenarioBaseline): string {
  if (baseline.status !== "ready") {
    return "Enter a manual starting point, or add financial data to use your saved numbers automatically.";
  }
  const asOf = dateLabel(baseline.asOfDate);
  const period = `${baseline.monthsUsed} complete ${baseline.monthsUsed === 1 ? "month" : "months"}`;
  return `${asOf ? `Starting from ${asOf}` : "Saved financial starting point"} · ${period}`;
}

export default function ScenarioSummaryCard({ baseline }: { baseline: ScenarioBaseline }) {
  const needsUpdate = baseline.freshness === "stale" || baseline.freshness === "historical";
  return (
    <section
      aria-labelledby="scenario-summary-title"
      className="mb-8 flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <ChartLine aria-hidden="true" className="mt-0.5 shrink-0 text-teal" size={20} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="scenario-summary-title" className="text-sm font-medium text-ink">Test a business decision</h2>
            {needsUpdate && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">Update recommended</span>}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-dim">
            Test changes to customer cash, operating spending, or a one-time cash event without changing saved data.
          </p>
          <p className="mt-1 text-xs text-dim">{baselineSummary(baseline)}</p>
        </div>
      </div>
      <Link
        href="/dashboard/scenarios"
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
      >
        Test a decision <ArrowRight aria-hidden="true" size={15} />
      </Link>
    </section>
  );
}
