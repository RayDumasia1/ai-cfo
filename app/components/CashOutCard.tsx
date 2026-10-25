"use client";

import {financialDataFreshness,legacyCashHealth,runoutDate} from "@/lib/calculations";
import type {FinancialMonth} from "@/lib/types";
import StatCard from "./StatCard";

interface CashOutCardProps { cash:number|null; months:FinancialMonth[]; isNewUser?:boolean; }

export default function CashOutCard({cash,months,isNewUser=false}:CashOutCardProps) {
  if (cash===null&&months.length>0) {
    return <StatCard label="Cash Runway" value="—" subtext="Latest month is missing closing cash" />;
  }
  const metric=legacyCashHealth(cash,months);
  if (metric.monthsUsed===0) {
    return <StatCard label="Cash Runway" value="—"
      subtext={isNewUser?"Complete setup to see this":"Cash collected or paid is missing"} />;
  }
  const freshness=financialDataFreshness(metric.periodEnd);
  if (freshness==="historical") {
    return <StatCard label="Cash Runway" value="Update needed"
      subtext="Your data is too old to estimate your current runway" />;
  }
  if (metric.estimatedRunway===null) {
    const value=metric.estimatedNetCashFlow===0?"Not currently declining":"Cash is currently growing";
    return <StatCard label="Cash Runway" value={value}
      subtext={`Recent cash collected ${metric.estimatedNetCashFlow===0?"matched":"covered"} cash paid${freshness==="stale"?" · Data may be out of date":""}`} />;
  }
  return <StatCard label="Cash Runway" value={`${metric.estimatedRunway.toFixed(1)} months`}
    subtext={`At the recent pace, cash may last until ${runoutDate(metric.estimatedRunway,metric.periodEnd??undefined)}${freshness==="stale"?" · Data may be out of date":""}`} />;
}
