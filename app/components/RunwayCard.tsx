"use client";

import {
  monthlyBurnRate,
  runwayMonths,
  runwayChangeMoM,
} from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";

interface RunwayCardProps {
  /** Closing cash of the most recent month. */
  cash: number | null;
  /** Recent financial months, newest-first. */
  months: FinancialMonth[];
  /**
   * Months of runway considered healthy (from business_profiles).
   * Defaults to 6 when not set.
   */
  runwayWarningThreshold?: number | null;
}

export default function RunwayCard({
  cash,
  months,
  runwayWarningThreshold,
}: RunwayCardProps) {
  const threshold = runwayWarningThreshold ?? 6;

  // ── Core calculations ──────────────────────────────────────────────────────
  const expenses = months.map((m) => m.total_expenses);
  const avgBurn = monthlyBurnRate(expenses);

  const runway =
    cash != null && avgBurn != null && avgBurn > 0
      ? runwayMonths(cash, avgBurn)
      : null;

  // MoM runway delta — uses closing_cash from the two most recent months.
  const prevCash = months[1]?.closing_cash ?? null;
  const momDelta =
    runway != null && prevCash != null && avgBurn != null
      ? runwayChangeMoM(cash!, prevCash, avgBurn)
      : null;

  // ── Border colour ──────────────────────────────────────────────────────────
  let borderColor = "var(--line)";
  if (runway != null) {
    if (runway > 6) borderColor = "#22C55E";
    else if (runway >= 3) borderColor = "#F59E0B";
    else borderColor = "#E84545";
  }

  // ── No data ────────────────────────────────────────────────────────────────
  if (avgBurn === null) {
    return (
      <div
        className="bg-surface flex flex-col"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid #D8E2EC",
          borderLeft: "3px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
          padding: "1.25rem 1.5rem",
          height: "100%",
          minHeight: 120,
          justifyContent: "space-between",
        }}
      >
        <p
          className="text-[10px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--dim)" }}
        >
          Runway
        </p>
        <p
          className="mt-3 font-medium leading-none"
          style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
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
      <div
        className="bg-surface flex flex-col"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid #D8E2EC",
          borderLeft: "3px solid #22C55E",
          boxShadow: "var(--shadow-sm)",
          padding: "1.25rem 1.5rem",
          height: "100%",
          minHeight: 120,
          justifyContent: "space-between",
        }}
      >
        <p
          className="text-[10px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--dim)" }}
        >
          Runway
        </p>
        <p
          className="mt-3 font-medium leading-none"
          style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
        >
          Stable
        </p>
        <p className="mt-2 text-xs font-light" style={{ color: "var(--dim)" }}>
          Not burning cash
        </p>
      </div>
    );
  }

  // ── Sub-label line 1: target progress ─────────────────────────────────────
  const meetsTarget = runway >= threshold;
  const targetLabel = `${runway.toFixed(1)} of ${threshold} month target${meetsTarget ? " ✓" : ""}`;

  // ── Sub-label line 2: MoM delta ───────────────────────────────────────────
  let momLabel: React.ReactNode;
  if (momDelta === null) {
    momLabel = <span style={{ color: "var(--dim)" }}>— vs last month</span>;
  } else {
    const improved = momDelta >= 0;
    const abs = Math.abs(momDelta).toFixed(1);
    momLabel = (
      <span style={{ color: improved ? "#22c55e" : "#ef4444" }}>
        {improved ? "↑" : "↓"} {abs} months vs last month
      </span>
    );
  }

  return (
    <div
      className="bg-surface flex flex-col"
      style={{
        borderRadius: "var(--radius-lg)",
        border: "1px solid #D8E2EC",
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <p
        className="text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: "var(--dim)" }}
      >
        Runway
      </p>
      <p
        className="mt-3 font-medium leading-none"
        style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
      >
        {runway.toFixed(1)} months
      </p>

      {/* Line 1 — target progress */}
      <p
        className="mt-2 text-xs font-light"
        style={{ color: meetsTarget ? "var(--teal)" : "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}
      >
        {targetLabel}
      </p>

      {/* Line 2 — MoM delta */}
      <p className="mt-0.5 text-xs font-light">{momLabel}</p>
    </div>
  );
}
