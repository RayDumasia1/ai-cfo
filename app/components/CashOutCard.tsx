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
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "1.25rem 1.5rem",
};

export default function CashOutCard({ cash, months }: CashOutCardProps) {
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);

  const runway =
    cash != null && avgBurn != null && avgBurn > 0
      ? runwayMonths(cash, avgBurn)
      : null;

  const anchorDate = months[0]?.month_date;

  // ── No data ────────────────────────────────────────────────────────────────
  if (avgBurn === null || runway === null) {
    return (
      <div
        className="bg-surface flex flex-col"
        style={{ ...cardBase, border: "1px solid var(--line)" }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--dim)" }}
        >
          Cash-Out Date
        </p>
        <p
          className="mt-3 text-[1.65rem] font-medium leading-none"
          style={{ color: "var(--ink)" }}
        >
          —
        </p>
        <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
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
      style={{ ...cardBase, border: "1px solid var(--gold)" }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--dim)" }}
      >
        Cash-Out Date
      </p>
      <p
        className="mt-3 text-[1.65rem] font-medium leading-none"
        style={{ color: "var(--ink)" }}
      >
        {displayDate}
      </p>
      <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
        {subtext}
      </p>
    </div>
  );
}
