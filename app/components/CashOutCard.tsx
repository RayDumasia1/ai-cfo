"use client";

import { monthlyBurnRate, runwayMonths, runoutDate } from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";

interface CashOutCardProps {
  /** Closing cash of the most recent month. */
  cash: number | null;
  /** Recent financial months, newest-first. */
  months: FinancialMonth[];
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const cardBase: React.CSSProperties = {
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
  padding: "1.25rem 1.5rem",
  height: "100%",
  minHeight: 120,
  justifyContent: "space-between",
};

export default function CashOutCard({ cash, months }: CashOutCardProps) {
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);

  const runway =
    cash != null && avgBurn != null && avgBurn > 0
      ? runwayMonths(cash, avgBurn)
      : null;

  const anchorDate = months[0]?.month_date;

  // ── Border colour — mirrors Runway logic ────────────────────────────────────
  let borderColor = "var(--line)";
  if (runway != null) {
    if (runway > 6) borderColor = "#22C55E";
    else if (runway >= 3) borderColor = "#F59E0B";
    else borderColor = "#E84545";
  }

  // ── No data ────────────────────────────────────────────────────────────────
  if (avgBurn === null || runway === null) {
    return (
      <div
        className="bg-surface flex flex-col"
        style={{ ...cardBase, border: "1px solid #D8E2EC", borderLeft: "3px solid var(--line)" }}
      >
        <p
          className="text-[10px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--dim)" }}
        >
          Cash-Out Date
        </p>
        <p
          className="mt-3 font-medium leading-none"
          style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
        >
          —
        </p>
        <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
          {avgBurn !== null && avgBurn <= 0
            ? "Not burning cash"
            : "No data imported yet"}
        </p>
      </div>
    );
  }

  // ── Long runway — no meaningful date to show ───────────────────────────────
  const displayDate =
    runway > 24 ? "2+ years" : runoutDate(runway, anchorDate);

  const subtext = `Based on ${formatCurrency(avgBurn)}/mo avg burn`;

  return (
    <div
      className="bg-surface flex flex-col"
      style={{ ...cardBase, border: "1px solid #D8E2EC", borderLeft: `3px solid ${borderColor}` }}
    >
      <p
        className="text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: "var(--dim)" }}
      >
        Cash-Out Date
      </p>
      <p
        className="mt-3 font-medium leading-none"
        style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
      >
        {displayDate}
      </p>
      <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
        {subtext}
      </p>
    </div>
  );
}
