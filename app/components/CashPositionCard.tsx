"use client";

import StatCard from "./StatCard";
import type { CashPositionResult } from "@/lib/db";
import { financialMonthLabel } from "@/lib/financialDataStatus";
import { financialDataFreshness } from "@/lib/calculations";

interface CashPositionCardProps {
  initialData: CashPositionResult | null;
  minCashReserve?: number | null;
  /** New users see a setup prompt in the empty state. */
  isNewUser?: boolean;
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
  isNewUser = false,
}: CashPositionCardProps) {
  if (!initialData) {
    return (
      <StatCard
        label="Cash Balance"
        value="—"
        subtext={isNewUser ? "Complete setup to see this" : "No data imported yet"}
      />
    );
  }

  const { cash, month, previousCash } = initialData;
  if (cash === null) {
    return <StatCard label="Cash Balance" value="—" subtext={`Closing cash missing for ${financialMonthLabel(month)}`} />;
  }

  // Current data can carry a reserve status. Older balances use a freshness
  // accent so a stale historical balance is not presented as healthy.
  const freshness=financialDataFreshness(month);
  let borderColor = freshness==="historical" ? "var(--line)"
    : freshness==="stale" ? "var(--warning)" : "var(--teal)";
  if (freshness==="current"&&minCashReserve != null && minCashReserve > 0) {
    borderColor = cash > minCashReserve ? "var(--success)" : "var(--danger)";
  }

  let comparison = "Previous-month comparison unavailable";
  if (previousCash !== null) {
    const delta = cash - previousCash;
    const deltaStr = formatCurrency(Math.abs(delta));
    const prefix = delta >= 0 ? `+${deltaStr}` : `-${deltaStr}`;
    comparison = `${prefix} vs previous month`;
  }
  const subtext=`Last reported ${financialMonthLabel(month)} · ${comparison}`;

  return (
    <div
      className="bg-surface flex flex-col"
      style={{
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--line)",
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
        Cash Balance
      </p>
      <p
        className="mt-3 font-medium leading-none"
        style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
      >
        {formatCurrency(cash)}
      </p>
      <p
        className="mt-2 text-xs font-light"
        style={{ color: "var(--dim)", lineHeight: 1.4, maxWidth: "100%" }}
      >
        {subtext}
      </p>
    </div>
  );
}
