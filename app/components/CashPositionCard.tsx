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

function formatMonthLabel(iso: string): string {
  const [year, month] = iso.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric" }
  );
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
    if (cash >= minCashReserve) {
      borderColor = "#22c55e";
    } else if (cash >= minCashReserve * 0.8) {
      borderColor = "#f59e0b";
    } else {
      borderColor = "#ef4444";
    }
  }

  // MoM change subtext
  let subtext = formatMonthLabel(month);
  if (previousCash !== null) {
    const delta = cash - previousCash;
    const deltaStr = formatCurrency(Math.abs(delta));
    const prefix = delta >= 0 ? `+${deltaStr}` : `-${deltaStr}`;
    subtext = `${prefix} vs last month · ${formatMonthLabel(month)}`;
  }

  return (
    <div
      className="bg-surface flex flex-col"
      style={{
        borderRadius: "var(--radius-md)",
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--dim)" }}
      >
        Cash Position
      </p>
      <p
        className="mt-3 text-[1.65rem] font-medium leading-none"
        style={{ color: "var(--ink)" }}
      >
        {formatCurrency(cash)}
      </p>
      <p
        className="mt-2 text-xs font-light"
        style={{ color: "var(--dim)" }}
      >
        {subtext}
      </p>
    </div>
  );
}
