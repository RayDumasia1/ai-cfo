"use client";

import StatCard from "./StatCard";
import type { CashPositionResult } from "@/lib/db";
import { financialMonthLabel } from "@/lib/financialDataStatus";
import { areConsecutiveFinancialMonths, financialDataFreshness } from "@/lib/calculations";
import { normalizedCashHealth } from "@/lib/normalizedCashHealth";
import type { FinancialMonth } from "@/lib/types";

interface CashPositionCardProps {
  initialData: CashPositionResult | null;
  minCashReserve?: number | null;
  /** New users see a setup prompt in the empty state. */
  isNewUser?: boolean;
  months?: FinancialMonth[];
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
  months = [],
}: CashPositionCardProps) {
  if (months[0]?.data_contract_version === 2) {
    const metric=normalizedCashHealth(months);
    const cash=metric.cash.availableCash;
    if (cash===null) {
      return <StatCard label="Available Cash" value="—"
        subtext={isNewUser?"Complete setup to see this":"Included or unavailable cash is missing"} />;
    }
    const money=new Intl.NumberFormat("en-US",{style:"currency",
      currency:metric.window.reportingCurrency??months[0].reporting_currency??"USD",maximumFractionDigits:0});
    const latest=months[0];
    const previous=months[1];
    const previousAvailable=previous
      && areConsecutiveFinancialMonths(latest.month_date,previous.month_date)
      && previous.data_contract_version===2
      && previous.closing_included_cash!==null
      && previous.closing_unavailable_cash!==null
        ? previous.closing_included_cash-previous.closing_unavailable_cash : null;
    const comparison=previousAvailable===null?"Previous-month comparison unavailable"
      : `${cash-previousAvailable>=0?"+":"-"}${money.format(Math.abs(cash-previousAvailable))} vs previous month`;
    const freshness=financialDataFreshness(latest.month_date);
    let borderColor=freshness==="historical"?"var(--line)":freshness==="stale"?"var(--warning)":"var(--teal)";
    if (freshness==="current"&&minCashReserve!=null&&minCashReserve>0) {
      borderColor=cash>minCashReserve?"var(--success)":"var(--danger)";
    }
    const unavailable=metric.cash.unavailableCash!>0
      ? `${money.format(metric.cash.unavailableCash!)} unavailable · `:"";
    const asOf=metric.cash.asOfDate
      ? new Date(`${metric.cash.asOfDate}T12:00:00Z`).toLocaleDateString("en-US",{
          month:"short",day:"numeric",year:"numeric",timeZone:"UTC",
        })
      : financialMonthLabel(latest.month_date);
    return <div className="bg-surface flex flex-col" style={{borderRadius:"var(--radius-lg)",
      border:"1px solid var(--line)",borderLeft:`3px solid ${borderColor}`,
      boxShadow:"var(--shadow-sm)",padding:"1rem 1.25rem",height:"100%",minHeight:140,
      justifyContent:"space-between"}}>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em]" style={{color:"var(--dim)"}}>Available Cash</p>
      <p className="mt-3 font-medium leading-none" style={{color:"var(--ink)",fontSize:28,
        letterSpacing:"-1px",whiteSpace:"nowrap"}}>{money.format(cash)}</p>
      <p className="mt-2 text-xs font-light" style={{color:"var(--dim)",lineHeight:1.4,maxWidth:"100%"}}>
        {`As of ${asOf} · ${unavailable}${comparison}`}
      </p>
    </div>;
  }
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
