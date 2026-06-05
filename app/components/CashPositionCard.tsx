"use client";

import StatCard from "./StatCard";
import type { CashPositionResult } from "@/lib/db";

interface CashPositionCardProps {
  initialData: CashPositionResult | null;
  minCashReserve?: number | null;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}


export default function CashPositionCard({
  initialData,
  minCashReserve,
}: CashPositionCardProps) {
  if (!initialData) {
    return (
      <StatCard
        label="Cash Position"
        value="—"
        subtext="No data imported yet"
      />
    );
  }

  const { cash, month, previousCash } = initialData;

  // Colour logic
  let borderColor = "var(--teal)";
  if (minCashReserve != null && minCashReserve > 0) {
    borderColor = cash > minCashReserve ? "#22C55E" : "#E84545";
  }

  // MoM change subtext — only shown when previous month data exists
  let subtext: string | undefined;
  if (previousCash !== null) {
    const delta = cash - previousCash;
    const deltaStr = formatCurrency(Math.abs(delta));
    const prefix = delta >= 0 ? `+${deltaStr}` : `-${deltaStr}`;
    subtext = `${prefix} vs last month`;
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
        height: "100%",
        minHeight: 120,
        justifyContent: "space-between",
      }}
    >
      <p
        className="text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: "var(--dim)" }}
      >
        Cash Position
      </p>
      <p
        className="mt-3 font-medium leading-none"
        style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
      >
        {formatCurrency(cash)}
      </p>
      <p
        className="mt-2 text-xs font-light"
        style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}
      >
        {subtext}
      </p>
    </div>
  );
}
