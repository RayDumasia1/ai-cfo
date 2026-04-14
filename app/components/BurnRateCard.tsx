"use client";

import { monthlyBurnRate, burnRateChangeMoM } from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";

interface BurnRateCardProps {
  /** Recent financial months, newest-first. Minimum 1 required for a value; 2 for MoM change. */
  months: FinancialMonth[];
}

function formatBurnRate(n: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n) + "/mo"
  );
}

export default function BurnRateCard({ months }: BurnRateCardProps) {
  // Extract expenses newest-first (nulls preserved — monthlyBurnRate skips them).
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);

  // MoM change: compare the two most recent individual months.
  let momChange: number | null = null;
  const e0 = expenses[0];
  const e1 = expenses[1];
  if (e0 != null && e1 != null) {
    momChange = burnRateChangeMoM(e0, e1);
  }

  // ── No data ───────────────────────────────────────────────────────────────
  if (avgBurn === null) {
    return (
      <div
        className="bg-surface flex flex-col"
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--dim)" }}
        >
          Monthly Burn
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

  // ── MoM subtext ───────────────────────────────────────────────────────────
  let subtextNode: React.ReactNode;
  if (momChange === null) {
    subtextNode = (
      <span style={{ color: "var(--dim)" }}>— vs last month</span>
    );
  } else {
    const pct = Math.abs(momChange).toFixed(1);
    const increased = momChange > 0;
    subtextNode = (
      <span style={{ color: increased ? "#ef4444" : "#22c55e" }}>
        {increased ? "↑" : "↓"} {pct}% vs last month
      </span>
    );
  }

  return (
    <div
      className="bg-surface flex flex-col"
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--dim)" }}
      >
        Monthly Burn
      </p>
      <p
        className="mt-3 text-[1.65rem] font-medium leading-none"
        style={{ color: "var(--ink)" }}
      >
        {formatBurnRate(avgBurn)}
      </p>
      <p className="mt-2 text-xs font-light">{subtextNode}</p>
    </div>
  );
}
