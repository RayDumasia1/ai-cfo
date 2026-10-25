"use client";

import { legacyCashHealth } from "@/lib/calculations";
import { normalizedCashHealth } from "@/lib/normalizedCashHealth";
import type { FinancialMonth } from "@/lib/types";
import StatCard from "./StatCard";

interface BurnRateCardProps { cash:number|null; months:FinancialMonth[]; isNewUser?:boolean; }
const currency=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});

/** Legacy-data cash cushion. The filename remains stable to avoid unrelated import churn. */
export default function BurnRateCard({cash,months,isNewUser=false}:BurnRateCardProps) {
  if (months[0]?.data_contract_version === 2) {
    const metric = normalizedCashHealth(months);
    const coverage = metric.operating.cashCoverageMonths;
    if (coverage === null) {
      const subtext = metric.window.monthsUsed === 0
        ? "Complete, reconciled operating data is needed"
        : metric.operating.averageCashPaid === 0
          ? "No operating cash payments were reported"
          : "Available cash is missing";
      return <StatCard label="Operating Cash Buffer" value="—" subtext={subtext} />;
    }
    const money = new Intl.NumberFormat("en-US", { style: "currency",
      currency: metric.window.reportingCurrency ?? "USD", maximumFractionDigits: 0 });
    return <StatCard label="Operating Cash Buffer"
      value={`${coverage.toFixed(1)} months`}
      subtext={`Operating payments covered with no new collections · ${money.format(metric.operating.averageCashPaid!)}/mo average`} />;
  }
  if (cash === null && months.length > 0) {
    return <StatCard label="Cash Buffer" value="—" subtext="Latest month is missing closing cash" />;
  }
  const metric=legacyCashHealth(cash,months);
  if (metric.reportedSpendingCoverage === null) {
    const subtext=metric.monthsUsed === 0
      ? (isNewUser ? "Complete setup to see this" : "Cash collected or paid is missing")
      : metric.averageCashPaid === 0 ? "No reported cash paid" : "No data imported yet";
    return <StatCard label="Cash Buffer" value="—" subtext={subtext} />;
  }
  return <StatCard label="Cash Buffer"
    value={`${metric.reportedSpendingCoverage.toFixed(1)} months`}
    subtext={`Could cover about ${metric.reportedSpendingCoverage.toFixed(1)} months of recent spending with no new cash in · ${currency.format(metric.averageCashPaid!)}/mo average`} />;
}
