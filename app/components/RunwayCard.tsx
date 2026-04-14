"use client";

import { monthlyBurnRate, runwayMonths, runoutDate } from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";

interface RunwayCardProps {
  /** Closing cash of the most recent month (from CashPositionResult.cash). */
  cash: number | null;
  /** Recent financial months, newest-first. */
  months: FinancialMonth[];
}

export default function RunwayCard({ cash, months }: RunwayCardProps) {
  // ── Derive values ──────────────────────────────────────────────────────────
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);

  // avgBurn null  → no expense data
  // avgBurn <= 0  → profitable / break-even, no runway concern
  const runway =
    cash != null && avgBurn != null && avgBurn > 0
      ? runwayMonths(cash, avgBurn)
      : null;

  const cashOut = runway != null ? runoutDate(runway) : null;

  // ── Colour thresholds ──────────────────────────────────────────────────────
  // Green > 6 months | Amber 3–6 months | Red < 3 months
  let borderColor = "var(--line)";
  if (runway != null) {
    if (runway > 6) borderColor = "#22c55e";
    else if (runway >= 3) borderColor = "#f59e0b";
    else borderColor = "#ef4444";
  }

  // ── Shared card shell ──────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    borderRadius: "var(--radius-md)",
    border: `1px solid ${borderColor}`,
    boxShadow: "var(--shadow-sm)",
    padding: "1.25rem 1.5rem",
  };

  // ── No data ────────────────────────────────────────────────────────────────
  if (runway === null && avgBurn === null) {
    return (
      <div className="bg-surface flex flex-col" style={cardStyle}>
        <p
          className="text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--dim)" }}
        >
          Runway
        </p>
        <p
          className="mt-3 text-[1.65rem] font-medium leading-none"
          style={{ color: "var(--ink)" }}
        >
          —
        </p>
        <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
          No data imported yet
        </p>
      </div>
    );
  }

  // ── Profitable / break-even ────────────────────────────────────────────────
  if (runway === null) {
    return (
      <div className="bg-surface flex flex-col" style={{ ...cardStyle, borderColor: "#22c55e" }}>
        <p
          className="text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--dim)" }}
        >
          Runway
        </p>
        <p
          className="mt-3 text-[1.65rem] font-medium leading-none"
          style={{ color: "var(--ink)" }}
        >
          Stable
        </p>
        <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
          Not burning cash
        </p>
      </div>
    );
  }

  // ── Burning cash ───────────────────────────────────────────────────────────
  return (
    <div className="bg-surface flex flex-col" style={cardStyle}>
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--dim)" }}
      >
        Runway
      </p>
      <p
        className="mt-3 text-[1.65rem] font-medium leading-none"
        style={{ color: "var(--ink)" }}
      >
        {runway.toFixed(1)} months
      </p>
      <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
        Cash out: {cashOut}
      </p>
    </div>
  );
}
